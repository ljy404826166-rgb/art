import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRepresentativeWorkNormalization,
  chineseTitleForArtwork,
  parseArgs,
} from "./normalize-artist-representative-works.mjs";

test("Chinese artwork title never falls back to English", () => {
  assert.equal(
    chineseTitleForArtwork({
      title_cn: "草地上的午餐",
      title_en: "Luncheon on the Grass",
    }),
    "草地上的午餐",
  );
  assert.equal(
    chineseTitleForArtwork({
      title_en: "Olympia",
    }),
    "",
  );
});

test("representative works use at most two Chinese titles and preserve matching ids", () => {
  const result = buildRepresentativeWorkNormalization(
    {
      _id: "edouard-manet",
      representative_artwork_ids: ["one", "two", "three"],
      representative_works: ["Olympia", "Luncheon on the Grass", "The Fifer"],
    },
    new Map([
      ["one", { title_cn: "奥林匹亚" }],
      ["two", { title_cn: "草地上的午餐" }],
      ["three", { title_cn: "吹笛少年" }],
    ]),
  );

  assert.deepEqual(result.representative_artwork_ids, ["one", "two"]);
  assert.deepEqual(result.representative_works, ["奥林匹亚", "草地上的午餐"]);
  assert.equal(result.changed, true);
});

test("missing Chinese titles are skipped instead of displaying English", () => {
  const result = buildRepresentativeWorkNormalization(
    {
      _id: "artist-1",
      representative_artwork_ids: ["english-only", "chinese"],
      representative_works: ["English Work", "中文作品"],
    },
    new Map([
      ["english-only", { title_en: "English Work" }],
      ["chinese", { title_cn: "中文作品" }],
    ]),
  );

  assert.deepEqual(result.representative_artwork_ids, ["chinese"]);
  assert.deepEqual(result.representative_works, ["中文作品"]);
  assert.deepEqual(result.missing_chinese_title_ids, ["english-only"]);
});

test("production run requires the exact production environment confirmation", () => {
  assert.throws(() => parseArgs(["--run"]), /requires --confirm-production/);
  assert.equal(
    parseArgs(["--run", "--confirm-production", "cloudbase-d6gvny27ib05e0ede"]).run,
    true,
  );
});
