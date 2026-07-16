import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadCommonJsModule(filename) {
  const module = { exports: {} };
  const source = readFileSync(filename, "utf8");
  vm.runInNewContext(source, { module, exports: module.exports }, { filename });
  return module.exports;
}

const {
  canUseWxCapability,
  hasWxApi,
  normalizePlatformError,
} = loadCommonJsModule("miniapp/services/platform-capabilities.js");

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
