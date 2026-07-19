const ERROR_PATTERNS = [
  ["permission-denied", /auth deny|authorize no response|permission|auth denied/i],
  ["quota-exceeded", /quota|maximum size|storage limit|space is not enough/i],
  ["file-missing", /no such file|not found|file does not exist/i],
  ["offline", /network|offline|disconnected|internet/i],
  ["remote-failed", /downloadFile:fail|request:fail|statusCode\s*[45]\d\d/i],
  ["invalid-data", /invalid data|invalid parameter|parameter error/i],
];
const VALID_ERROR_CODES = [
  "unsupported",
  "offline",
  "permission-denied",
  "quota-exceeded",
  "file-missing",
  "remote-failed",
  "invalid-data",
  "unknown",
];

function getWxApi(wxApi) {
  if (wxApi) return wxApi;
  if (typeof wx !== "undefined") return wx;
  return null;
}

function hasWxApi(name, wxApi) {
  const api = getWxApi(wxApi);
  return Boolean(api && typeof api[name] === "function");
}

function canUseWxCapability(capability, wxApi) {
  const api = getWxApi(wxApi);
  if (!api) return false;

  if (typeof api.canIUse === "function") {
    try {
      return Boolean(api.canIUse(capability));
    } catch (error) {
      // Developer Tools and older clients may throw for capability probes.
    }
  }

  const apiName = String(capability || "").split(".")[0];
  return hasWxApi(apiName, api);
}

function normalizePlatformError(error, fallbackCode = "unknown") {
  if (
    error instanceof Error &&
    VALID_ERROR_CODES.includes(error.code) &&
    Object.prototype.hasOwnProperty.call(error, "originalError")
  ) {
    return error;
  }

  const normalizedFallbackCode = VALID_ERROR_CODES.includes(fallbackCode) ? fallbackCode : "unknown";
  const message = String((error && (error.errMsg || error.message)) || error || "");
  const match = ERROR_PATTERNS.find(([, pattern]) => pattern.test(message));
  const normalized = new Error(message || "微信平台能力调用失败");
  normalized.code = match
    ? match[0]
    : error && VALID_ERROR_CODES.includes(error.code)
      ? error.code
      : normalizedFallbackCode;
  normalized.originalError = error;
  return normalized;
}

module.exports = {
  canUseWxCapability,
  getWxApi,
  hasWxApi,
  normalizePlatformError,
};
