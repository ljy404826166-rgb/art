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
  computeDetailHeroFrameStyle,
  resolveDetailMeasureSrc,
} = loadCommonJsModule("miniapp/pages/detail/detail-image-layout.js", {
  "../../services/artwork-image-sources": imageSources,
});

test("computeDetailHeroFrameStyle preserves portrait artwork ratio", () => {
  assert.equal(
    computeDetailHeroFrameStyle(0.52),
    "height: 1335rpx; min-height: 1335rpx;",
  );
});

test("computeDetailHeroFrameStyle preserves landscape artwork ratio", () => {
  assert.equal(
    computeDetailHeroFrameStyle(1.79),
    "height: 388rpx; min-height: 388rpx;",
  );
});

test("computeDetailHeroFrameStyle preserves routed artwork ratio", () => {
  assert.equal(
    computeDetailHeroFrameStyle(0.72),
    "height: 964rpx; min-height: 964rpx;",
  );
});

test("resolveDetailMeasureSrc prioritizes display URL over cloud and original fields", () => {
  assert.equal(resolveDetailMeasureSrc({
    cloud_file_id: "cloud://display",
    display_url: "display.webp",
    thumbnail_url: "thumb.webp",
    download_url: "original.jpg",
    original_url: "source-original.jpg",
  }), "display.webp");

  assert.equal(resolveDetailMeasureSrc({
    display_url: "display.webp",
    thumbnail_url: "thumb.webp",
    download_url: "original.jpg",
  }), "display.webp");

  assert.equal(resolveDetailMeasureSrc({
    thumbnail_url: "thumb.webp",
    download_url: "original.jpg",
  }), "thumb.webp");

  assert.equal(resolveDetailMeasureSrc({
    imageSrc: "original.jpg",
    download_url: "original.jpg",
  }), "");

  assert.equal(resolveDetailMeasureSrc({
    imageSrc: " source-original.jpg ",
    original_url: "source-original.jpg",
  }), "");
});

test("resolveDetailMeasureSrc skips display aliases of both original fields", () => {
  for (const originalField of ["download_url", "original_url"]) {
    const artwork = {
      display_url: "",
      thumbnail_url: "safe-thumb.webp",
      imageSrc: "safe-image.webp",
      download_url: "download-original.jpg",
      original_url: "source-original.jpg",
    };
    artwork.display_url = ` ${artwork[originalField]} `;

    assert.equal(resolveDetailMeasureSrc(artwork), "safe-thumb.webp");
  }
});

test("resolveDetailMeasureSrc skips thumbnail aliases of both original fields", () => {
  for (const originalField of ["download_url", "original_url"]) {
    const artwork = {
      display_url: "",
      thumbnail_url: "",
      imageSrc: "safe-image.webp",
      download_url: "download-original.jpg",
      original_url: "source-original.jpg",
    };
    artwork.thumbnail_url = ` ${artwork[originalField]} `;

    assert.equal(resolveDetailMeasureSrc(artwork), "safe-image.webp");
  }
});
