import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadArtworkImageDefinition() {
  const filename = fileURLToPath(new URL("./artwork-image.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  let definition;
  const imageSources = loadCommonJsModule(
    fileURLToPath(new URL("../../services/artwork-image-sources.js", import.meta.url)),
  );

  vm.runInNewContext(source, {
    Component(nextDefinition) {
      definition = nextDefinition;
    },
    require(id) {
      if (id === "../../services/artwork-image-sources") return imageSources;
      throw new Error(`Unexpected require: ${id}`);
    },
  }, { filename });

  return definition;
}

function loadCommonJsModule(filename) {
  const module = { exports: {} };
  const source = readFileSync(filename, "utf8");
  vm.runInNewContext(source, { module, exports: module.exports }, { filename });
  return module.exports;
}

function resolveCandidates(artwork, usage) {
  const definition = loadArtworkImageDefinition();
  const candidates = definition.methods.resolveCandidates.call({
    compactUnique: definition.methods.compactUnique,
  }, artwork, usage);
  return Array.from(candidates);
}

test("artwork-image card rendering prioritizes thumbnail URL over cloud and safe fallbacks", () => {
  assert.deepEqual(resolveCandidates({
    thumbnail_url: "thumb.webp",
    display_url: "display.webp",
    cloud_file_id: "cloud://artwork",
    imageSrc: "safe-image.webp",
    download_url: "original.jpg",
    original_url: "original-source.jpg",
  }, "card"), [
    "thumb.webp",
    "display.webp",
    "safe-image.webp",
  ]);
});

test("artwork-image detail rendering prioritizes display URL and never uses original fields", () => {
  assert.deepEqual(resolveCandidates({
    display_url: "display.webp",
    thumbnail_url: "thumb.webp",
    cloud_file_id: "cloud://artwork",
    imageSrc: "safe-image.webp",
    download_url: "original.jpg",
    original_url: "original-source.jpg",
  }, "detail"), [
    "display.webp",
    "thumb.webp",
    "safe-image.webp",
  ]);

  assert.deepEqual(resolveCandidates({
    imageSrc: " original.jpg ",
    download_url: "original.jpg",
    original_url: "original-source.jpg",
  }, "detail"), []);
});

test("artwork-image display component does not inspect original-image fields", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./artwork-image.js", import.meta.url)),
    "utf8",
  );

  assert.doesNotMatch(source, /download_url|original_url/);
});
