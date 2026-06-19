import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCommonJsModule(filePath) {
  const filename = filePath instanceof URL ? fileURLToPath(filePath) : filePath;
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };
  const localRequire = (id) => {
    if (id === "../../services/search-engine") return loadCommonJsModule(new URL("../../services/search-engine.js", import.meta.url));
    return require(id);
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: localRequire }, { filename });
  return module.exports;
}

const { createHomeSearchState } = loadCommonJsModule(new URL("./home-search.js", import.meta.url));
const { searchArtworks } = loadCommonJsModule(new URL("../../services/search-engine.js", import.meta.url));

const artworks = [
  { id: "1", title: "Starry Night", artist: "Vincent van Gogh" },
  { id: "2", title: "Water Lilies", artist: "Claude Monet" },
];

function assertIds(actualItems, expectedIds) {
  assert.equal(JSON.stringify(Array.from(actualItems).map((item) => item.id)), JSON.stringify(expectedIds));
}

test("createHomeSearchState returns to the home feed when the query is empty", () => {
  const state = createHomeSearchState(artworks, "   ");

  assert.equal(state.searchQuery, "   ");
  assert.equal(state.searchMode, false);
  assert.equal(state.searchResults.length, 0);
});

test("createHomeSearchState does not search the random home sample for non-empty input", () => {
  const state = createHomeSearchState(artworks, " van ");

  assert.equal(state.searchQuery, " van ");
  assert.equal(state.searchMode, true);
  assertIds(state.searchResults, []);
});

test("createHomeSearchState can preserve full-database results supplied by caller", () => {
  const state = createHomeSearchState([], " van ", { results: [artworks[0]] });

  assert.equal(state.searchMode, true);
  assertIds(state.searchResults, ["1"]);
});

test("searchArtworks tolerates mixed cloud field shapes", () => {
  const results = searchArtworks([
    { id: "1", title: "Portrait", tags: { subject: "梵高" } },
    { id: "2", title: "Landscape", tag_keys: ["莫奈"] },
  ], "梵高");

  assertIds(results, ["1"]);
});

test("searchArtworks matches da Vinci aliases with or without middle dot", () => {
  const results = searchArtworks([
    { id: "1", title: "Study", artist: "列奥纳多·达·芬奇（Leonardo da Vinci, 1452-1519）" },
    { id: "2", title: "Portrait", artist: "伊达·西尔弗伯格" },
  ], "达芬奇");

  assertIds(results, ["1"]);
});

test("searchArtworks matches Leonardo Chinese partial name", () => {
  const results = searchArtworks([
    { id: "1", title: "Study", tag_keys: ["列奥纳多·达·芬奇"] },
  ], "列奥纳多");

  assertIds(results, ["1"]);
});

test("searchArtworks searches all related database content instead of artist-only results", () => {
  const results = searchArtworks([
    { id: "1", title: "圣母习作", artist: "列奥纳多·达·芬奇（Leonardo da Vinci, 1452-1519）" },
    { id: "2", title: "达芬奇手稿研究", artist: "其他画家" },
    { id: "3", title: "艺术史笔记", artist: "其他画家", description: "这件作品讨论列奥纳多对构图的影响。" },
    { id: "4", title: "莫奈花园", artist: "克洛德·莫奈" },
  ], "达芬奇");

  assert.equal(
    JSON.stringify(Array.from(results).map((item) => item.id).sort()),
    JSON.stringify(["1", "2", "3"]),
  );
});

test("searchArtworks ranks title matches before artist and description matches", () => {
  const results = searchArtworks([
    { id: "artist", title: "圣母习作", artist: "列奥纳多·达·芬奇（Leonardo da Vinci, 1452-1519）" },
    { id: "description", title: "艺术史笔记", artist: "其他画家", description: "简介内容提到了达·芬奇。" },
    { id: "title", title: "达芬奇构图研究", artist: "其他画家" },
  ], "达芬奇");

  assertIds(results, ["title", "artist", "description"]);
});
