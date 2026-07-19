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

const {
  resolveArtworkImageCandidates,
  resolveSafeArtworkImageSrc,
} = loadCommonJsModule(
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

test("resolveArtworkImageCandidates removes every normal source that aliases an original", () => {
  const artwork = {
    thumbnail_url: " original-source.jpg ",
    display_url: " original-download.jpg ",
    imageSrc: " safe-image.webp ",
    download_url: "original-download.jpg",
    original_url: "original-source.jpg",
  };

  assert.deepEqual(
    Array.from(resolveArtworkImageCandidates(artwork, "card")),
    ["safe-image.webp"],
  );
  assert.deepEqual(
    Array.from(resolveArtworkImageCandidates(artwork, "detail")),
    ["safe-image.webp"],
  );
});
