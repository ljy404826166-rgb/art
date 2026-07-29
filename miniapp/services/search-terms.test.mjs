import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadSearchTerms() {
  const source = readFileSync("miniapp/services/search-terms.js", "utf8");
  const module = { exports: {} };
  vm.runInNewContext(
    source,
    { module, exports: module.exports, String, Set, Array, Number },
    {
      filename: "miniapp/services/search-terms.js",
    },
  );
  return module.exports;
}

test("artwork search terms cover Chinese substrings, Latin prefixes, and descriptions", () => {
  const { buildArtworkSearchTerms } = loadSearchTerms();
  const terms = buildArtworkSearchTerms({
    title_cn: "睡莲池",
    title_en: "Water Lilies",
    artist: "克洛德·莫奈 (Claude Monet)",
    description: "简介内容提到梵高。",
    tag_keys: ["印象派"],
  });

  assert.equal(terms.includes("莫奈"), true);
  assert.equal(terms.includes("claude"), true);
  assert.equal(terms.includes("mone"), true);
  assert.equal(terms.includes("梵高"), true);
  assert.equal(terms.includes("印象派"), true);
});

test("query terms use exact short terms and intersecting trigrams for long Chinese text", () => {
  const { buildSearchQueryTerms } = loadSearchTerms();

  assert.deepEqual(JSON.parse(JSON.stringify(buildSearchQueryTerms("达·芬奇"))), ["达", "芬奇"]);
  assert.deepEqual(JSON.parse(JSON.stringify(buildSearchQueryTerms("Claude Monet"))), [
    "claude",
    "monet",
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(buildSearchQueryTerms("戴珍珠耳环的少女"))), [
    "戴珍珠",
    "珍珠耳",
    "珠耳环",
    "耳环的",
    "环的少",
    "的少女",
  ]);
});

test("artwork search term arrays remain bounded", () => {
  const { buildArtworkSearchTerms } = loadSearchTerms();
  const terms = buildArtworkSearchTerms({ description: "艺术".repeat(2000) }, { limit: 40 });

  assert.ok(terms.length > 0);
  assert.ok(terms.length <= 40);
});
