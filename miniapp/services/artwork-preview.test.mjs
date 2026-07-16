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

const platformCapabilities = loadCommonJsModule("miniapp/services/platform-capabilities.js");
const {
  previewArtwork,
  resolveArtworkPreviewUrl,
} = loadCommonJsModule("miniapp/services/artwork-preview.js", {
  "./platform-capabilities": platformCapabilities,
});

test("resolveArtworkPreviewUrl prefers display images and never selects download_url", () => {
  assert.equal(resolveArtworkPreviewUrl({
    display_url: "https://img.example/display.webp",
    thumbnail_url: "https://img.example/thumb.webp",
    download_url: "https://img.example/original.jpg",
  }), "https://img.example/display.webp");

  assert.equal(resolveArtworkPreviewUrl({
    thumbnail_url: "https://img.example/thumb.webp",
    download_url: "https://img.example/original.jpg",
  }), "https://img.example/thumb.webp");
});

test("previewArtwork calls wx.previewImage with exactly one display URL", async () => {
  const calls = [];
  const result = await previewArtwork({ display_url: "https://img.example/display.webp" }, {
    canIUse: () => true,
    previewImage(options) {
      calls.push(options);
      options.success({ errMsg: "previewImage:ok" });
    },
  });

  assert.equal(result.url, "https://img.example/display.webp");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].current, "https://img.example/display.webp");
  assert.deepEqual(Array.from(calls[0].urls), ["https://img.example/display.webp"]);
});

test("previewArtwork rejects unsupported and missing-image cases with stable codes", async () => {
  await assert.rejects(
    previewArtwork({ display_url: "https://img.example/display.webp" }, { canIUse: () => false }),
    (error) => error.code === "unsupported",
  );
  await assert.rejects(
    previewArtwork({}, { canIUse: () => true, previewImage() {} }),
    (error) => error.code === "invalid-data",
  );
});
