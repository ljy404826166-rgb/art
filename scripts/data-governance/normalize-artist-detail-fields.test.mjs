import assert from "node:assert/strict";
import test from "node:test";
import { buildStyleNormalization, parseArgs } from "./normalize-artist-detail-fields.mjs";

test("keeps controlled style ids and removes legacy non-style labels", () => {
  const result = buildStyleNormalization({
    _id: "artist-1",
    style_ids: ["style-impressionism"],
    styles: ["1930年代", "人物画"],
    bio_zh: "这是一位印象派画家。",
  });

  assert.deepEqual(result.style_ids, ["style-impressionism"]);
  assert.deepEqual(result.styles, ["印象派"]);
  assert.equal(result.evidence_type, "existing_controlled_ids");
  assert.equal(result.changed, true);
});

test("maps an explicit authority movement before biography terms", () => {
  const result = buildStyleNormalization(
    {
      _id: "artist-2",
      style_ids: [],
      styles: ["油画"],
      bio_zh: "后印象派画家。",
    },
    {
      wikidata_url: "https://www.wikidata.org/wiki/Q1",
      movements: [{ label: "Expressionism" }],
    },
  );

  assert.deepEqual(result.style_ids, ["style-expressionism"]);
  assert.deepEqual(result.styles, ["表现主义"]);
  assert.equal(result.evidence_type, "wikidata_explicit_movement");
  assert.equal(result.evidence_url, "https://www.wikidata.org/wiki/Q1");
});

test("does not treat a biography keyword as structured movement evidence", () => {
  const result = buildStyleNormalization({
    _id: "artist-3",
    style_ids: [],
    styles: ["19世纪"],
    bio_zh: "他是法国现实主义的重要代表画家。",
  });

  assert.deepEqual(result.style_ids, []);
  assert.deepEqual(result.styles, []);
  assert.equal(result.evidence_type, "unresolved");
});

test("does not infer a movement from occupation, medium, or decade", () => {
  const result = buildStyleNormalization(
    {
      _id: "albert-hahn-jr",
      style_ids: [],
      styles: ["书籍装帧", "1930年代", "20世纪"],
      bio_zh: "荷兰画家、版画家和插图作者。",
    },
    {
      movements: [],
      occupations: [{ label: "插画家" }],
    },
  );

  assert.deepEqual(result.style_ids, []);
  assert.deepEqual(result.styles, []);
  assert.equal(result.evidence_type, "unresolved");
});

test("production run requires an exact environment confirmation", () => {
  assert.throws(() => parseArgs(["--run"]), /requires --confirm-production/);
  assert.equal(
    parseArgs(["--run", "--confirm-production", "cloudbase-d6gvny27ib05e0ede"]).run,
    true,
  );
});
