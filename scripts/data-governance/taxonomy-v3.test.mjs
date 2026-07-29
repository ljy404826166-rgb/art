import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTaxonomy,
  buildPilot,
  decadeIdForArtwork,
  extractRawSignals,
  resolveArtistId,
  buildArtistAliasIndex,
  buildMigrationPlan,
} from "./taxonomy-v3.mjs";

test("splits aggregate tag strings and derives deterministic decades", () => {
  assert.deepEqual(extractRawSignals({ tags: ["现代主义,肖像,金黄色调"] }), [
    "现代主义",
    "肖像",
    "金黄色调",
  ]);
  assert.equal(decadeIdForArtwork({ year_and_place: "约1946年，法国" }), "period-1940s");
});

test("retains current concepts, excludes noise, and proposes only genuinely new subjects", () => {
  const artworks = Array.from({ length: 5 }, (_, index) => ({
    _id: `new-${index + 1}`,
    tags: ["印象主义", "舞蹈", "乡村生活", "橙色调", "油画", "公共领域"],
    year_and_place: "1931年",
  }));
  const analysis = analyzeTaxonomy(artworks);
  assert.equal(
    analysis.current_terms.find((term) => term.id === "style-impressionism").raw_support,
    5,
  );
  assert.equal(analysis.current_terms.find((term) => term.id === "subject-dance").raw_support, 5);
  assert.ok(!analysis.proposed_new_terms.some((term) => term.id === "subject-dance"));
  assert.ok(analysis.proposed_new_terms.some((term) => term.id === "subject-rural-life"));
  assert.ok(analysis.excluded_signals.some((entry) => entry.label === "橙色调"));
  assert.ok(analysis.excluded_signals.some((entry) => entry.label === "油画"));
  assert.ok(analysis.proposed_new_terms.some((term) => term.id === "period-1930s") === false);
});

test("resolves existing artists from bilingual artwork labels", () => {
  const index = buildArtistAliasIndex([
    {
      _id: "henri-matisse",
      name_zh: "亨利·马蒂斯",
      name_en: "Henri Matisse",
      aliases: ["Matisse"],
    },
  ]);
  assert.equal(
    resolveArtistId(
      {
        artist: "亨利·马蒂斯 (Henri Matisse, 1869–1954)",
      },
      index,
    ),
    "henri-matisse",
  );
});

test("builds balanced old and new pilot cohorts with known ids only", () => {
  const artworks = [
    {
      _id: "old-1",
      artist: "莫奈",
      tag_ids: ["style-impressionism"],
      tags: ["印象主义"],
      year: "1890",
    },
    {
      _id: "new-1",
      artist: "莫奈",
      tags: ["印象主义", "舞蹈"],
      year: "1891",
    },
  ];
  const analysis = analyzeTaxonomy(artworks, { minSubjectCount: 1 });
  const pilot = buildPilot(
    artworks,
    [
      {
        _id: "claude-monet",
        name_zh: "莫奈",
      },
    ],
    analysis,
    1,
  );
  assert.deepEqual(pilot.cohorts, {
    existing_classified: 1,
    new_unclassified: 1,
  });
  assert.equal(pilot.checks.unknown_classification_ids, 0);
  assert.equal(pilot.rows[1].suggested_artist_id, "claude-monet");
});

test("builds a reversible v3 migration plan with accepted terms only", () => {
  const artworks = [
    {
      _id: "old-1",
      artist: "莫奈",
      artist_ids: ["claude-monet"],
      tag_ids: ["style-impressionism"],
      tags: ["印象主义", "风景"],
      year: "1890",
      classification_version: "classification-v2",
    },
    {
      _id: "new-1",
      artist: "莫奈",
      tags: ["印象主义", "舞蹈"],
      year: "1891",
    },
  ];
  const artists = [
    {
      _id: "claude-monet",
      name_zh: "莫奈",
      style_ids: ["style-impressionism"],
      subject_ids: [],
      decade_ids: [],
      classified_artwork_count: 1,
    },
  ];
  const analysis = analyzeTaxonomy(artworks, {
    minSubjectCount: 1,
    artistLabels: ["莫奈"],
  });
  const plan = buildMigrationPlan(artworks, artists, analysis);

  assert.equal(plan.checks.artworks_total, 2);
  assert.equal(plan.checks.new_artworks_total, 1);
  assert.equal(plan.checks.new_artworks_without_classification, 0);
  assert.equal(plan.checks.new_artworks_without_artist, 0);
  assert.equal(plan.checks.unknown_classification_ids.length, 0);
  assert.ok(plan.artwork_assignments[1].classification_ids.includes("subject-dance"));
  assert.equal(plan.artwork_assignments[1].previous.classification_version, "");
  assert.equal(plan.artist_assignments[0].classified_artwork_count, 2);
});
