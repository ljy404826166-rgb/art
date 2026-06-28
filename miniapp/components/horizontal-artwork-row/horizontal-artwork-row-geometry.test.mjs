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
  computeArtworkCardFrame,
  computeRowArtworkCardWidth,
  estimateRowMoverWidth,
  resolveRowArtworkMeasureSrc,
} = loadCommonJsModule("miniapp/components/horizontal-artwork-row/horizontal-artwork-row-geometry.js");

test("wide artwork width is not capped by card max width", () => {
  const frame = computeArtworkCardFrame({ ratio: 2.4, mediaHeight: 260, minWidth: 120 });
  assert.equal(frame.height, 260);
  assert.equal(frame.width, 624);
});

test("narrow artwork respects minimum readable width only", () => {
  const frame = computeArtworkCardFrame({ ratio: 0.35, mediaHeight: 260, minWidth: 120 });
  assert.equal(frame.height, 260);
  assert.equal(frame.width, 120);
});

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
  }), "cloud://artwork-thumb");

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
