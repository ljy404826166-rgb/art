import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadCommonJsModule(filename) {
  const module = { exports: {} };
  const source = readFileSync(filename, "utf8");
  vm.runInNewContext(source, { Error, module, exports: module.exports }, { filename });
  return module.exports;
}

const {
  canUseWxCapability,
  getWxApi,
  hasWxApi,
  normalizePlatformError,
} = loadCommonJsModule("miniapp/services/platform-capabilities.js");

test("getWxApi prefers injection and returns null without a global API", () => {
  const injectedWxApi = { previewImage() {} };

  assert.equal(getWxApi(injectedWxApi), injectedWxApi);
  assert.equal(getWxApi(), null);
});

test("hasWxApi detects callable WeChat APIs", () => {
  assert.equal(hasWxApi("previewImage", { previewImage() {} }), true);
  assert.equal(hasWxApi("previewImage", {}), false);
});

test("canUseWxCapability honors wx.canIUse", () => {
  const calls = [];
  const wxApi = {
    canIUse(capability) {
      calls.push(capability);
      return capability === "previewImage";
    },
    previewImage() {},
  };

  assert.equal(canUseWxCapability("previewImage", wxApi), true);
  assert.equal(canUseWxCapability("onShareTimeline", wxApi), false);
  assert.deepEqual(calls, ["previewImage", "onShareTimeline"]);
});

test("canUseWxCapability falls back to API presence when canIUse throws", () => {
  const wxApi = {
    canIUse() {
      throw new Error("developer-tools-unavailable");
    },
    previewImage() {},
  };

  assert.equal(canUseWxCapability("previewImage", wxApi), true);
});

test("normalizePlatformError maps stable project error codes", () => {
  assert.equal(normalizePlatformError({ errMsg: "request:fail network disconnected" }).code, "offline");
  assert.equal(normalizePlatformError({ errMsg: "saveImageToPhotosAlbum:fail auth deny" }).code, "permission-denied");
  assert.equal(normalizePlatformError({ errMsg: "file system quota exceeded" }).code, "quota-exceeded");
  assert.equal(normalizePlatformError({ errMsg: "open:fail no such file" }).code, "file-missing");
  assert.equal(normalizePlatformError({ errMsg: "downloadFile:fail statusCode 500" }).code, "remote-failed");
});

test("normalizePlatformError uses the exact platform failure fallback message", () => {
  assert.equal(normalizePlatformError().message, "微信平台能力调用失败");
});

test("normalizePlatformError wraps plain objects with recognized codes", () => {
  const originalError = { code: "offline" };
  const normalized = normalizePlatformError(originalError);

  assert.equal(normalized instanceof Error, true);
  assert.notEqual(normalized, originalError);
  assert.equal(normalized.code, "offline");
  assert.equal(normalized.originalError, originalError);
});

test("normalizePlatformError preserves already-normalized Errors", () => {
  const originalError = new Error("network disconnected");
  const normalized = new Error("offline");
  normalized.code = "offline";
  normalized.originalError = originalError;

  assert.equal(normalizePlatformError(normalized), normalized);
});

test("normalizePlatformError replaces invalid fallback codes with unknown", () => {
  const normalized = normalizePlatformError(new Error("unmatched failure"), "not-stable");

  assert.equal(normalized.code, "unknown");
});
