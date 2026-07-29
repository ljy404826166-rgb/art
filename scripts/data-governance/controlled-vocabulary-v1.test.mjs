import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTROLLED_VOCABULARY_VERSION,
  buildArtistDimensionCatalog,
  buildControlledVocabulary,
  buildLegacyTagRouting,
  resolveControlledVocabularyLabel,
  validateControlledVocabulary,
} from "./controlled-vocabulary-v1.mjs";

const terms = buildControlledVocabulary();

test("preserves the 124 production terms and builds a valid versioned vocabulary", () => {
  const validation = validateControlledVocabulary(terms);

  assert.equal(validation.ok, true);
  assert.equal(validation.errors.length, 0);
  assert.equal(validation.published_terms, 124);
  assert.equal(validation.published_classification_filter_terms, 124);
  assert.equal(validation.draft_classification_filter_terms, 4);
  assert.ok(validation.draft_terms > 0);
  assert.equal(validation.counts_by_type.style, 34);
  assert.equal(validation.counts_by_type.period >= 50, true);
  assert.equal(validation.counts_by_type.medium >= 8, true);
  assert.equal(
    terms.every((term) => term.taxonomy_version === CONTROLLED_VOCABULARY_VERSION),
    true,
  );
});

test("routes common legacy aliases into stable controlled ids", () => {
  assert.deepEqual(resolveControlledVocabularyLabel("印象主义", terms), ["style-impressionism"]);
  assert.deepEqual(resolveControlledVocabularyLabel("肖像", terms), ["subject-portrait"]);
  assert.deepEqual(resolveControlledVocabularyLabel("油画", terms), ["medium-oil-painting"]);
  assert.deepEqual(resolveControlledVocabularyLabel("公共领域", terms), ["rights-public-domain"]);
  assert.deepEqual(resolveControlledVocabularyLabel("1880年代", terms), ["period-1880s"]);
});

test("keeps artist names outside the general vocabulary", () => {
  assert.deepEqual(resolveControlledVocabularyLabel("塞尚", terms), []);

  const routing = buildLegacyTagRouting(
    [
      {
        label: "塞尚",
        artwork_count: 10,
        artist_matches: [],
        top_artist_id: "artist-607b032dd4",
        top_artist_share: 1,
      },
    ],
    terms,
  );
  assert.equal(routing[0].route_type, "artist_dimension");
  assert.deepEqual(routing[0].target_ids, ["artist-607b032dd4"]);
});

test("only reviewed person entities with resolved works become public artist dimensions", () => {
  const rows = buildArtistDimensionCatalog([
    {
      id: "artist-a",
      artist_name: "画家甲",
      entity_type: "person",
      review_status: "reviewed",
      artwork_count: 9,
      has_artworks: true,
    },
    {
      id: "publisher-a",
      artist_name: "出版社甲",
      entity_type: "organization",
      review_status: "reviewed",
      artwork_count: 20,
      has_artworks: true,
    },
    {
      id: "artist-b",
      artist_name: "画家乙",
      entity_type: "person",
      review_status: "reviewed",
      artwork_count: 0,
      has_artworks: false,
    },
  ]);

  assert.equal(rows[0].recommendation_eligible, true);
  assert.equal(rows[0].default_home_channel_ready, true);
  assert.equal(rows[1].public_dimension_status, "non_painter_entity");
  assert.equal(rows[1].recommendation_eligible, false);
  assert.equal(rows[2].public_dimension_status, "blocked_no_resolved_artworks");
});
