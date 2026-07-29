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

const { getDownloadFailureMessage, resolveArtworkDownloadUrl, isAlbumPermissionError } =
  loadCommonJsModule("miniapp/services/downloads.js");

test("resolveArtworkDownloadUrl uses only explicit download_url", () => {
  assert.equal(
    resolveArtworkDownloadUrl({
      download_url: " https://example.com/original.jpg ",
      display_url: "https://example.com/display.webp",
      thumbnail_url: "https://example.com/thumb.webp",
    }),
    "https://example.com/original.jpg",
  );
});

test("resolveArtworkDownloadUrl does not fall back to display or thumbnail images", () => {
  assert.equal(
    resolveArtworkDownloadUrl({
      display_url: "https://example.com/display.webp",
      thumbnail_url: "https://example.com/thumb.webp",
    }),
    "",
  );
});

test("resolveArtworkDownloadUrl ignores display aliases and only reads download_url", () => {
  assert.equal(
    resolveArtworkDownloadUrl({
      downloadUrl: "https://example.com/camel-original.jpg",
      display_url: "https://example.com/display.webp",
    }),
    "",
  );
});

test("isAlbumPermissionError detects common WeChat save-album auth failures", () => {
  assert.equal(isAlbumPermissionError({ errMsg: "saveImageToPhotosAlbum:fail auth deny" }), true);
  assert.equal(
    isAlbumPermissionError({ errMsg: "saveImageToPhotosAlbum:fail authorize no response" }),
    true,
  );
  assert.equal(isAlbumPermissionError({ errMsg: "downloadFile:fail timeout" }), false);
});

test("getDownloadFailureMessage gives specific user-facing messages", () => {
  assert.equal(
    getDownloadFailureMessage({ errMsg: "saveImageToPhotosAlbum:fail auth deny" }),
    "请允许保存到相册后重试",
  );
  assert.equal(getDownloadFailureMessage(new Error("download-http-404")), "原图暂时无法下载");
  assert.equal(
    getDownloadFailureMessage(new Error("download-empty-file")),
    "图片文件异常，请稍后重试",
  );
  assert.equal(
    getDownloadFailureMessage({ errMsg: "downloadFile:fail timeout" }),
    "网络异常，请稍后重试",
  );
});
