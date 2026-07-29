import assert from "node:assert/strict";
import test from "node:test";
import { buildRecommendationAudit } from "./audit-recommendation-readiness.mjs";

test("separates reviewed classifications, artists, and recommendation candidates", () => {
  const report = buildRecommendationAudit({
    artworks: [
      {
        _id: "work-1",
        artist_ids: ["artist-a"],
        classification_ids: ["style-a"],
        tag_keys: ["印象派", "宁静", "画家甲"],
      },
      {
        _id: "work-2",
        artist_ids: ["artist-a"],
        classification_ids: ["subject-a"],
        tag_keys: ["宁静"],
      },
    ],
    artists: [
      {
        _id: "artist-a",
        name_zh: "画家甲",
        review_status: "reviewed",
      },
    ],
    vocabTerms: [
      {
        _id: "style-a",
        label_zh: "印象派",
        aliases: ["印象主义"],
        review_status: "reviewed",
      },
      {
        _id: "subject-a",
        label_zh: "风景画",
        review_status: "reviewed",
      },
    ],
    categoryCatalog: {
      CATEGORY_CATALOG_VERSION: "test-v1",
      CATEGORY_GROUPS: [
        {
          key: "style",
          tags: [{ id: "style-a", label: "印象派", count: 1 }],
        },
      ],
    },
    sourceInspection: {
      home_uses_legacy_tags: true,
      category_uses_versioned_catalog: true,
    },
  });

  assert.equal(report.summary.artworks_total, 2);
  assert.equal(report.summary.classification_coverage, 1);
  assert.equal(report.summary.artist_coverage, 1);
  assert.equal(report.summary.resolved_artist_coverage, 1);
  assert.equal(report.summary.artist_dimensions_with_artworks, 1);
  assert.equal(report.summary.legacy_tag_dispositions.classification_alias, 1);
  assert.equal(report.summary.legacy_tag_dispositions.artist_dimension, 1);
  assert.equal(report.summary.legacy_tag_dispositions.recommendation_signal_candidate, 1);
  assert.equal(report.summary.catalog_count_mismatches, 0);

  const artist = report.artist_recommendation_dimensions[0];
  assert.equal(artist.id, "artist-a");
  assert.equal(artist.artwork_count, 2);

  const tranquil = report.legacy_tag_frequency.find((row) => row.label === "宁静");
  assert.equal(tranquil.artwork_count, 2);
  assert.equal(tranquil.top_artist_share, 1);
});

test("reports unknown ids, catalog drift, and ambiguous aliases", () => {
  const report = buildRecommendationAudit({
    artworks: [
      {
        _id: "work-1",
        artist_ids: ["missing-artist"],
        classification_ids: ["unknown-term"],
        tag_keys: ["共同别名"],
      },
    ],
    artists: [],
    vocabTerms: [
      {
        _id: "style-a",
        label_zh: "流派甲",
        aliases: ["共同别名"],
        review_status: "reviewed",
      },
      {
        _id: "style-b",
        label_zh: "流派乙",
        aliases: ["共同别名"],
        review_status: "reviewed",
      },
    ],
    categoryCatalog: {
      CATEGORY_GROUPS: [
        {
          key: "style",
          tags: [{ id: "style-a", label: "流派甲", count: 9 }],
        },
      ],
    },
  });

  assert.equal(report.summary.unknown_classification_ids, 1);
  assert.equal(report.summary.orphan_artist_ids, 1);
  assert.equal(report.summary.resolved_artist_coverage, 0);
  assert.equal(report.summary.artworks_with_orphan_artist_reference, 1);
  assert.equal(report.issues.orphan_artist_references[0].id, "missing-artist");
  assert.equal(report.summary.alias_conflicts, 1);
  assert.equal(report.summary.catalog_count_mismatches, 1);
  assert.equal(report.summary.reviewed_classification_terms_missing_from_catalog, 1);
  assert.equal(report.legacy_tag_frequency[0].disposition, "ambiguous");
});
