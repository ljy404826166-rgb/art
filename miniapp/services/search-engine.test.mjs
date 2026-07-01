import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);

function loadSearchEngine() {
  const filename = fileURLToPath(new URL("./search-engine.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports, require }, { filename });
  return module.exports;
}

test("searchArtworks ranks title, artist, description, then tag matches", () => {
  const { searchArtworks } = loadSearchEngine();
  const results = searchArtworks([
    { id: "tag", title: "素描习作", artist: "其他画家", tag_labels: ["达芬奇研究"] },
    { id: "artist", title: "女子头像", artist: "列奥纳多·达·芬奇" },
    { id: "description", title: "古典构图", artist: "其他画家", description: "简介提到达芬奇式构图。" },
    { id: "title", title: "达芬奇的研究", artist: "其他画家" },
  ], "达芬奇");

  assert.deepEqual(JSON.parse(JSON.stringify(results.map((item) => item.id))), ["title", "artist", "description", "tag"]);
});

test("searchArtworks matches da Vinci variants and normalized artist ids broadly", () => {
  const { searchArtworks } = loadSearchEngine();
  const results = searchArtworks([
    { id: "middle-dot", title: "三分之四侧向右的圣母头像", artist: "列奥纳多·达·芬奇" },
    { id: "no-dot", title: "达芬奇手稿研究", artist: "其他画家" },
    { id: "english", title: "Study of Hands", artist: "Leonardo da Vinci" },
    { id: "artist-id", title: "蓬发男子讽刺头像", artist_ids: ["leonardo-da-vinci"] },
    { id: "unrelated", title: "莫奈花园", artist: "Claude Monet" },
  ], "达芬奇");

  assert.deepEqual(
    JSON.parse(JSON.stringify(results.map((item) => item.id).sort())),
    ["artist-id", "english", "middle-dot", "no-dot"].sort(),
  );
});

test("searchArtworks paginates ranked results without changing order", () => {
  const { searchArtworks } = loadSearchEngine();
  const artworks = Array.from({ length: 25 }, (_, index) => ({
    id: `artwork-${index + 1}`,
    title: `达芬奇相关作品 ${index + 1}`,
  }));

  const firstPage = searchArtworks(artworks, "达芬奇", { limit: 20, skip: 0 });
  const secondPage = searchArtworks(artworks, "达芬奇", { limit: 20, skip: 20 });

  assert.equal(firstPage.length, 20);
  assert.equal(secondPage.length, 5);
  assert.equal(firstPage[0].id, "artwork-1");
  assert.equal(secondPage[0].id, "artwork-21");
});
