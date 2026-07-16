import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadCommonJsModule(filename, dependencies = {}) {
  const module = { exports: {} };
  const source = readFileSync(filename, "utf8");
  const localRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(dependencies, id)) {
      return dependencies[id];
    }
    throw new Error(`Unexpected dependency: ${id}`);
  };
  vm.runInNewContext(source, {
    Error,
    module,
    exports: module.exports,
    require: localRequire,
  }, { filename });
  return module.exports;
}

const platformCapabilities = loadCommonJsModule(
  "miniapp/services/platform-capabilities.js",
);
const {
  getNetworkSnapshot,
  isCellularNetwork,
  normalizeNetworkState,
  subscribeNetworkStatus,
} = loadCommonJsModule("miniapp/services/network-status.js", {
  "./platform-capabilities": platformCapabilities,
});

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("normalizeNetworkState recognizes offline and connected networks", () => {
  assert.deepEqual(plain(normalizeNetworkState({ networkType: "none" })), {
    isConnected: false,
    networkType: "none",
  });
  assert.deepEqual(plain(normalizeNetworkState({
    isConnected: true,
    networkType: "wifi",
  })), {
    isConnected: true,
    networkType: "wifi",
  });
});

test("isCellularNetwork recognizes mobile network types", () => {
  for (const type of ["2g", "3g", "4g", "5g"]) {
    assert.equal(isCellularNetwork(type), true);
  }
  assert.equal(isCellularNetwork("wifi"), false);
  assert.equal(isCellularNetwork("none"), false);
});

test("getNetworkSnapshot wraps wx.getNetworkType", async () => {
  const state = await getNetworkSnapshot({
    getNetworkType(options) {
      options.success({ networkType: "wifi" });
    },
  });

  assert.deepEqual(plain(state), {
    isConnected: true,
    networkType: "wifi",
  });
});

test("subscribeNetworkStatus forwards changes and unregisters its exact handler", async () => {
  let registered;
  let removed;
  const states = [];
  const wxApi = {
    getNetworkType(options) {
      options.success({ networkType: "wifi" });
    },
    onNetworkStatusChange(handler) {
      registered = handler;
    },
    offNetworkStatusChange(handler) {
      removed = handler;
    },
  };

  const unsubscribe = subscribeNetworkStatus(
    (state) => states.push(plain(state)),
    wxApi,
  );
  await Promise.resolve();
  registered({ isConnected: false, networkType: "none" });
  unsubscribe();

  assert.deepEqual(states.at(-1), {
    isConnected: false,
    networkType: "none",
  });
  assert.equal(removed, registered);
});

test("unsubscribe is idempotent and suppresses a pending initial snapshot", async () => {
  let resolveSnapshot;
  let removeCalls = 0;
  const states = [];
  const wxApi = {
    getNetworkType(options) {
      resolveSnapshot = options.success;
    },
    onNetworkStatusChange() {},
    offNetworkStatusChange() {
      removeCalls += 1;
    },
  };

  const unsubscribe = subscribeNetworkStatus(
    (state) => states.push(plain(state)),
    wxApi,
  );
  unsubscribe();
  unsubscribe();
  resolveSnapshot({ networkType: "wifi" });
  await Promise.resolve();

  assert.equal(removeCalls, 1);
  assert.deepEqual(states, []);
});

test("a live network event supersedes a pending initial snapshot", async () => {
  let resolveSnapshot;
  let registered;
  const states = [];
  const wxApi = {
    getNetworkType(options) {
      resolveSnapshot = options.success;
    },
    onNetworkStatusChange(handler) {
      registered = handler;
    },
    offNetworkStatusChange() {},
  };

  subscribeNetworkStatus((state) => states.push(plain(state)), wxApi);
  registered({ isConnected: false, networkType: "none" });
  resolveSnapshot({ networkType: "wifi" });
  await Promise.resolve();

  assert.deepEqual(states, [{
    isConnected: false,
    networkType: "none",
  }]);
});
