import assert from "node:assert/strict";
import test from "node:test";
import { buildArtworkCountPlan, parseArgs } from "./sync-artist-artwork-counts-production.mjs";

const ENV_ID = "cloudbase-d6gvny27ib05e0ede";

test("production count synchronization requires explicit confirmation", () => {
  assert.equal(parseArgs([]).run, false);
  assert.throws(() => parseArgs(["--run"]), /confirm-production/u);
  assert.throws(() => parseArgs(["--env-id", "other"]), /restricted/u);
  assert.equal(parseArgs(["--run", "--confirm-production", ENV_ID]).run, true);
});

test("count plan follows normalized artist_ids used by artist detail", () => {
  const artists = [
    {
      _id: "paul-cezanne",
      name_zh: "保罗·塞尚",
      review_status: "reviewed",
      public_visibility: "visible",
      artwork_count: 1,
    },
    {
      _id: "already-correct",
      review_status: "reviewed",
      public_visibility: "visible",
      artwork_count: 1,
    },
  ];
  const artworks = [
    { _id: "one", status: "published", artist_ids: ["paul-cezanne", "paul-cezanne"] },
    { _id: "two", status: "published", artist_ids: ["paul-cezanne"] },
    { _id: "three", status: "published", artist_ids: ["already-correct"] },
    { _id: "draft", status: "draft", artist_ids: ["paul-cezanne"] },
  ];
  const plan = buildArtworkCountPlan(artists, artworks);
  assert.deepEqual(plan.changes, [
    {
      artist_id: "paul-cezanne",
      name_zh: "保罗·塞尚",
      name_en: "",
      before_artwork_count: 1,
      after_artwork_count: 2,
      count_path: "normalized_artist_ids",
      reason: "match_artist_detail_countArtworksByArtist",
    },
  ]);
});

test("zero normalized count is left to the existing detail alias fallback", () => {
  const plan = buildArtworkCountPlan(
    [
      {
        _id: "legacy-artist",
        review_status: "reviewed",
        public_visibility: "visible",
        artwork_count: 1,
      },
    ],
    [],
  );
  assert.deepEqual(plan.changes, []);
});

test("zero normalized count follows the published alias fallback used by detail", () => {
  const plan = buildArtworkCountPlan(
    [
      {
        _id: "legacy-artist",
        name_zh: "示例画家",
        name_en: "Example Artist",
        aliases: ["Artist, Example"],
        review_status: "reviewed",
        public_visibility: "visible",
        artwork_count: 1,
      },
    ],
    [
      {
        _id: "one",
        status: "published",
        artist: "Example Artist",
        tag_keys: [],
        artist_ids: [],
      },
      {
        _id: "two",
        status: "published",
        artist: "Other",
        tag_keys: ["示例画家"],
        artist_ids: [],
      },
      {
        _id: "draft",
        status: "draft",
        artist: "Example Artist",
        tag_keys: ["示例画家"],
        artist_ids: [],
      },
    ],
  );
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].after_artwork_count, 2);
  assert.equal(plan.changes[0].count_path, "published_alias_fallback");
});
