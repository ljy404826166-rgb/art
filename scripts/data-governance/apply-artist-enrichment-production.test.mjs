import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductionDocuments,
  buildRelationshipTargets,
  parseArgs,
  PUBLIC_ARTIST_FIELDS,
} from "./apply-artist-enrichment-production.mjs";

const ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const BIO = `示例画家生于1880年，卒于1950年。${"艺".repeat(190)}`;

function fullPatch(overrides = {}) {
  return {
    _id: "artist-1",
    entity_type: "person",
    identity_status: "verified",
    name_zh: "示例画家",
    name_en: "Example Artist",
    aliases: ["Example Artist"],
    birth_year: 1880,
    death_year: 1950,
    lifespan_text: "1880–1950",
    country: "法国",
    region: "欧洲",
    occupations_zh: ["画家"],
    active_period: "19世纪末至20世纪前期",
    bio_zh: BIO,
    bio_facts: {
      lifespan: "1880年生，1950年卒",
      title: "画家",
      career: "从事绘画创作",
      standing: "具有艺术史价值",
    },
    historical_significance_zh: "具有艺术史价值",
    representative_artwork_ids: ["artwork-1"],
    artwork_count: 1,
    authority_ids: { wikidata: "Q1" },
    sources: [{ title: "Authority", url: "https://example.com" }],
    review_status: "candidate",
    ...overrides,
  };
}

test("production writer requires exact production confirmation", () => {
  assert.equal(parseArgs([]).run, false);
  assert.throws(() => parseArgs(["--run"]), /confirm-production/);
  assert.throws(() => parseArgs(["--run", "--confirm-production", "wrong"]), /confirm-production/);
  assert.equal(parseArgs(["--run", "--confirm-production", ENV_ID]).run, true);
  assert.equal(parseArgs(["--incremental"]).incremental, true);
});

test("public artist documents contain only display fields", () => {
  const manifest = {
    artist_patches: [fullPatch()],
    validation: [{ _id: "artist-1", ok: true }],
  };
  const result = buildProductionDocuments(
    [{ _id: "artist-1", styles: ["印象派"], authority_ids: { old: "internal" } }],
    manifest,
    [{ _id: "artwork-1", title_zh: "示例作品" }],
    "2026-07-25T00:00:00.000Z",
  );
  const publicRecord = result.publicArtists[0];
  assert.equal(publicRecord.review_status, "reviewed");
  assert.equal(publicRecord.public_visibility, "visible");
  assert.equal(publicRecord.bio_zh, BIO);
  assert.deepEqual(publicRecord.representative_works, ["示例作品"]);
  assert.equal(publicRecord.sources, undefined);
  assert.equal(publicRecord.authority_ids, undefined);
  assert.equal(publicRecord.bio_facts, undefined);
  assert.ok(Object.keys(publicRecord).every((field) => PUBLIC_ARTIST_FIELDS.has(field)));
  assert.equal(result.governanceRecords[0].sources.length, 1);
  assert.equal(result.governanceRecords[0].authority_ids.wikidata, "Q1");
});

test("approved portrait display fields survive a public artist rebuild", () => {
  const manifest = {
    artist_patches: [
      fullPatch({
        portrait_url: "https://cdn.example.test/artist-1.webp",
        portrait_source: "https://example.test/source",
        portrait_license: "Public Domain",
        portrait_credit: "Museum",
        portrait_kind: "self_portrait",
        portrait_artwork_id: "artwork-1",
        portrait_status: "approved",
        portrait_updated_at: "2026-07-26T00:00:00.000Z",
      }),
    ],
    validation: [{ _id: "artist-1", ok: true }],
  };
  const result = buildProductionDocuments(
    [{ _id: "artist-1" }],
    manifest,
    [{ _id: "artwork-1", title_zh: "示例作品" }],
    "2026-07-26T00:00:00.000Z",
  );
  const [artist] = result.publicArtists;

  assert.equal(artist.portrait_url, "https://cdn.example.test/artist-1.webp");
  assert.equal(artist.portrait_source, "https://example.test/source");
  assert.equal(artist.portrait_license, "Public Domain");
  assert.equal(artist.portrait_credit, "Museum");
  assert.equal(artist.portrait_kind, "self_portrait");
  assert.equal(artist.portrait_artwork_id, "artwork-1");
  assert.equal(artist.portrait_status, "approved");
  assert.equal(artist.portrait_updated_at, "2026-07-26T00:00:00.000Z");
});

test("representative works prefer Chinese titles and are limited to two", () => {
  const manifest = {
    artist_patches: [
      fullPatch({
        representative_artwork_ids: ["artwork-1", "artwork-2", "artwork-3"],
        artwork_count: 3,
      }),
    ],
    validation: [{ _id: "artist-1", ok: true }],
  };
  const result = buildProductionDocuments(
    [{ _id: "artist-1" }],
    manifest,
    [
      { _id: "artwork-1", title_cn: "中文作品一", title_en: "English One" },
      { _id: "artwork-2", title_cn: "中文作品二", title_en: "English Two" },
      { _id: "artwork-3", title_cn: "中文作品三", title_en: "English Three" },
    ],
    "2026-07-25T00:00:00.000Z",
  );

  assert.deepEqual(result.publicArtists[0].representative_works, ["中文作品一", "中文作品二"]);
  assert.deepEqual(result.publicArtists[0].representative_artwork_ids, ["artwork-1", "artwork-2"]);
});

test("structural dispositions remain hidden and omit biography fields", () => {
  const result = buildProductionDocuments(
    [
      {
        _id: "unknown-1",
        name_zh: "待核作者",
        name_en: "Unknown",
        bio_zh: "不应公开",
      },
    ],
    {
      artist_patches: [
        {
          _id: "unknown-1",
          entity_type: "unresolved",
          identity_status: "conflicted",
          record_action: "hold_for_source_resolution",
          unresolved_reason: "缺少权威来源",
        },
      ],
      validation: [],
    },
    [],
    "2026-07-25T00:00:00.000Z",
  );
  assert.equal(result.publicArtists[0].review_status, "candidate");
  assert.equal(result.publicArtists[0].public_visibility, "hidden");
  assert.equal(result.publicArtists[0].bio_zh, undefined);
  assert.equal(result.governanceRecords[0].unresolved_reason, "缺少权威来源");
});

test("a new workshop authority can be created without an existing public artist", () => {
  const result = buildProductionDocuments(
    [],
    {
      artist_patches: [
        {
          _id: "workshop-of-artist-1",
          preferred_name: "Workshop of Artist 1",
          entity_type: "workshop",
          identity_status: "provisional",
          base_artist_id: "artist-1",
          attribution_qualifier: "studio_of",
          record_action: "retain_as_workshop_authority",
          unresolved_reason: "Awaiting collection-level attribution review",
        },
      ],
      validation: [],
    },
    [],
    "2026-07-27T00:00:00.000Z",
  );

  assert.equal(result.publicArtists[0]._id, "workshop-of-artist-1");
  assert.equal(result.publicArtists[0].entity_type, "workshop");
  assert.equal(result.publicArtists[0].review_status, "candidate");
  assert.equal(result.publicArtists[0].public_visibility, "hidden");
});

test("relationship targets expand multi-artwork changes and assign stable ids", () => {
  const result = buildRelationshipTargets(
    [
      {
        _id: "change-1",
        artwork_ids: ["artwork-1", "artwork-2"],
        artist_id: "publisher-1",
        set_role: "publisher",
      },
    ],
    [
      {
        _id: "publisher-1",
        name_zh: "示例出版社",
        name_en: "Example Publisher",
      },
    ],
    "2026-07-25T00:00:00.000Z",
  );
  assert.equal(result.artworkPatches.length, 2);
  assert.equal(result.links.length, 2);
  assert.equal(result.governance.length, 2);
  assert.equal(result.links[0]._id, "artwork-1--publisher--publisher-1");
  assert.equal(result.artworkPatches[0].primary_artist_id, "publisher-1");
  assert.equal(result.artworkPatches[0].artist, "示例出版社 (Example Publisher)");
});
