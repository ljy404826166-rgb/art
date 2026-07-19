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
    module,
    exports: module.exports,
    require: localRequire,
  }, { filename });
  return module.exports;
}

const imageSources = loadCommonJsModule(
  "miniapp/services/artwork-image-sources.js",
);
const {
  computeRowArtworkCardWidth,
  estimateRowMoverWidth,
  resolveRowArtworkMeasureSrc,
} = loadCommonJsModule(
  "miniapp/components/horizontal-artwork-row/horizontal-artwork-row-geometry.js",
  {
    "../../services/artwork-image-sources": imageSources,
  },
);

test("computeRowArtworkCardWidth keeps fixed image height without min or max width clamps", () => {
  assert.equal(computeRowArtworkCardWidth(2), 700);
  assert.equal(computeRowArtworkCardWidth(3), 1050);
  assert.equal(computeRowArtworkCardWidth(0.72), 252);
  assert.equal(computeRowArtworkCardWidth(0.36), 126);
});

test("estimateRowMoverWidth uses measured card widths when available", () => {
  const items = [
    { _id: "a", homeCardClass: "is-compact" },
    { _id: "b", homeCardClass: "is-wide" },
    { _id: "c", homeCardClass: "is-compact" },
  ];
  const measuredWidths = {
    a: 252,
    b: 700,
    c: 360,
  };

  assert.equal(estimateRowMoverWidth(items, measuredWidths), 1460);
});

test("resolveRowArtworkMeasureSrc only uses display-safe image sources", () => {
  assert.equal(resolveRowArtworkMeasureSrc({
    cloud_file_id: "cloud://artwork-thumb",
    thumbnail_url: "thumb.webp",
    display_url: "display.webp",
    download_url: "original.jpg",
  }), "thumb.webp");

  assert.equal(resolveRowArtworkMeasureSrc({
    thumbnail_url: "thumb.webp",
    display_url: "display.webp",
    download_url: "original.jpg",
  }), "thumb.webp");

  assert.equal(resolveRowArtworkMeasureSrc({
    display_url: "display.webp",
    download_url: "original.jpg",
  }), "display.webp");

  assert.equal(resolveRowArtworkMeasureSrc({
    download_url: "original.jpg",
  }), "");
});

test("resolveRowArtworkMeasureSrc skips thumbnail and display aliases of both original fields", () => {
  for (const [sourceField, originalField, expected] of [
    ["thumbnail_url", "download_url", "safe-display.webp"],
    ["thumbnail_url", "original_url", "safe-display.webp"],
    ["display_url", "download_url", "safe-image.webp"],
    ["display_url", "original_url", "safe-image.webp"],
  ]) {
    const artwork = {
      thumbnail_url: sourceField === "display_url" ? "" : "safe-thumb.webp",
      display_url: "safe-display.webp",
      imageSrc: "safe-image.webp",
      download_url: "download-original.jpg",
      original_url: "source-original.jpg",
    };
    artwork[sourceField] = ` ${artwork[originalField]} `;

    assert.equal(resolveRowArtworkMeasureSrc(artwork), expected);
  }
});
