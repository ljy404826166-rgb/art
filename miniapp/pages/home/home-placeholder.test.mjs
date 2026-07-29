import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCommonJs(relativeUrl) {
  const filename = fileURLToPath(new URL(relativeUrl, import.meta.url));
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      require(id) {
        throw new Error(`Unexpected dependency: ${id}`);
      },
    },
    { filename },
  );
  return module.exports;
}

const { DEFAULT_SEARCH_PLACEHOLDER, pickRandomArtworkTitle } =
  loadCommonJs("./home-placeholder.js");

test("search placeholder can select any valid artwork title", () => {
  const artworks = [{ title_cn: "星月夜" }, { title: "睡莲" }, { title_en: "The Kiss" }];

  assert.equal(pickRandomArtworkTitle(artworks, { random: () => 0 }), "星月夜");
  assert.equal(pickRandomArtworkTitle(artworks, { random: () => 0.5 }), "睡莲");
  assert.equal(pickRandomArtworkTitle(artworks, { random: () => 0.999 }), "The Kiss");
});

test("search placeholder ignores blank, unnamed, and duplicate titles", () => {
  const artworks = [
    { title: "" },
    { title: "未命名作品" },
    { title_cn: "睡莲" },
    { title: "睡莲" },
  ];

  assert.equal(pickRandomArtworkTitle(artworks, { random: () => 0.99 }), "睡莲");
});

test("search placeholder has a neutral fallback when no title is available", () => {
  assert.equal(pickRandomArtworkTitle([]), DEFAULT_SEARCH_PLACEHOLDER);
});

test("home search input binds to the dynamic placeholder", () => {
  const template = readFileSync(new URL("./home.wxml", import.meta.url), "utf8");

  assert.match(template, /placeholder="\{\{searchPlaceholder\}\}"/);
  assert.doesNotMatch(template, /placeholder="星月夜"/);
});
