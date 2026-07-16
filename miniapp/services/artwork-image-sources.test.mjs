import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCommonJsModule(filename) {
  const module = { exports: {} };
  const source = readFileSync(filename, "utf8");
  vm.runInNewContext(source, { module, exports: module.exports }, { filename });
  return module.exports;
}

const { resolveSafeArtworkImageSrc } = loadCommonJsModule(
  fileURLToPath(new URL("./artwork-image-sources.js", import.meta.url)),
);

test("resolveSafeArtworkImageSrc trims display-safe fallbacks and rejects original aliases", () => {
  assert.equal(resolveSafeArtworkImageSrc({
    imageSrc: " safe-image.webp ",
    download_url: "original.jpg",
    original_url: "source-original.jpg",
  }), "safe-image.webp");

  assert.equal(resolveSafeArtworkImageSrc({
    imageSrc: " original.jpg ",
    download_url: "original.jpg",
  }), "");

  assert.equal(resolveSafeArtworkImageSrc({
    imageSrc: " source-original.jpg ",
    original_url: "source-original.jpg",
  }), "");
});
