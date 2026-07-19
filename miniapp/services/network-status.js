const {
  getWxApi,
  hasWxApi,
  normalizePlatformError,
} = require("./platform-capabilities");

const CELLULAR_TYPES = ["2g", "3g", "4g", "5g"];

function normalizeNetworkState(result) {
  const networkType = String((result && result.networkType) || "unknown").toLowerCase();
  const isConnected = typeof (result && result.isConnected) === "boolean"
    ? result.isConnected
    : networkType !== "none";
  return { isConnected, networkType };
}

function isCellularNetwork(networkType) {
  return CELLULAR_TYPES.includes(String(networkType || "").toLowerCase());
}

function getNetworkSnapshot(wxApi) {
  const api = getWxApi(wxApi);
  if (!api || !hasWxApi("getNetworkType", api)) {
    return Promise.resolve({
      isConnected: true,
      networkType: "unknown",
    });
  }

  return new Promise((resolve, reject) => {
    api.getNetworkType({
      success(result) {
        resolve(normalizeNetworkState(result));
      },
      fail(error) {
        reject(normalizePlatformError(error, "remote-failed"));
      },
    });
  });
}

function subscribeNetworkStatus(listener, wxApi) {
  const api = getWxApi(wxApi);
  let active = true;
  let receivedLiveState = false;
  const handler = (result) => {
    if (!active) return;
    receivedLiveState = true;
    listener(normalizeNetworkState(result));
  };
  if (api && hasWxApi("onNetworkStatusChange", api)) {
    api.onNetworkStatusChange(handler);
  }
  getNetworkSnapshot(api).then((networkState) => {
    if (active && !receivedLiveState) listener(networkState);
  }).catch(() => {});

  return function unsubscribe() {
    if (!active) return;
    active = false;
    if (api && hasWxApi("offNetworkStatusChange", api)) {
      api.offNetworkStatusChange(handler);
    }
  };
}

module.exports = {
  getNetworkSnapshot,
  isCellularNetwork,
  normalizeNetworkState,
  subscribeNetworkStatus,
};
