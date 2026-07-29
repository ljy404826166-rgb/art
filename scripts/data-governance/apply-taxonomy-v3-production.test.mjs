import assert from "node:assert/strict";
import test from "node:test";
import { buildPreflight, parseArgs } from "./apply-taxonomy-v3-production.mjs";

const ENV_ID = "cloudbase-d6gvny27ib05e0ede";

test("production writer requires exact confirmation and validates batch size", () => {
  assert.equal(parseArgs([]).run, false);
  assert.throws(() => parseArgs(["--run"]), /confirm-production/);
  assert.throws(() => parseArgs(["--run", "--confirm-production", "wrong"]), /confirm-production/);
  assert.throws(() => parseArgs(["--batch-size", "51"]), /between 1 and 50/);
  assert.equal(parseArgs(["--run", "--confirm-production", ENV_ID]).run, true);
});

test("preflight accepts an unchanged production snapshot", () => {
  const artwork = {
    _id: "a1",
    classification_version: "classification-v2",
    classification_ids: ["style-old"],
    tag_ids: ["style-old"],
    artist_ids: ["p1"],
    primary_artist_id: "p1",
  };
  const artist = {
    _id: "p1",
    classification_version: "classification-v2",
    region_id: "region-europe",
    style_ids: ["style-old"],
    subject_ids: [],
    decade_ids: ["period-1900s"],
    classified_artwork_count: 1,
  };
  const result = buildPreflight({
    currentArtworks: [artwork],
    currentArtists: [artist],
    currentVocabTerms: [{ _id: "style-old" }],
    currentTagLinks: [{ _id: "a1--style-old" }],
    currentArtistLinks: [],
    artworkAssignments: [
      {
        _id: "a1",
        previous: artwork,
      },
    ],
    artistAssignments: [
      {
        _id: "p1",
        previous: artist,
      },
    ],
    rollbackVocabTerms: [{ _id: "style-old" }],
    rollbackTagLinks: [{ _id: "a1--style-old" }],
    rollbackArtistLinks: [],
    targetVocabTerms: [{ _id: "style-old" }, { _id: "style-new" }],
    targetTagLinks: [{ _id: "a1--style-old" }, { _id: "a1--style-new" }],
    targetArtistLinks: [{ _id: "a1--p1" }],
  });
  assert.equal(result.safe_to_write, true);
});

test("preflight rejects source drift before any production write", () => {
  const previous = {
    _id: "a1",
    classification_version: "classification-v2",
    classification_ids: ["style-old"],
    tag_ids: ["style-old"],
    artist_ids: [],
    primary_artist_id: "",
  };
  const result = buildPreflight({
    currentArtworks: [{ ...previous, classification_ids: ["style-changed"] }],
    currentArtists: [],
    currentVocabTerms: [],
    currentTagLinks: [],
    currentArtistLinks: [],
    artworkAssignments: [{ _id: "a1", previous }],
    artistAssignments: [],
    rollbackVocabTerms: [],
    rollbackTagLinks: [],
    rollbackArtistLinks: [],
    targetVocabTerms: [],
    targetTagLinks: [],
    targetArtistLinks: [],
  });
  assert.equal(result.safe_to_write, false);
  assert.deepEqual(result.artwork_state_mismatches, ["a1"]);
});

test("preflight permits an idempotent partially completed migration", () => {
  const previous = {
    classification_version: "classification-v2",
    classification_ids: ["style-old"],
    tag_ids: ["style-old"],
    artist_ids: [],
    primary_artist_id: "",
  };
  const target = {
    _id: "a1",
    classification_version: "classification-v3",
    classification_ids: ["style-new"],
    tag_ids: ["style-new"],
    artist_ids: ["p1"],
    primary_artist_id: "p1",
    previous,
  };
  const result = buildPreflight({
    currentArtworks: [target],
    currentArtists: [],
    currentVocabTerms: [{ _id: "style-old" }, { _id: "style-new" }],
    currentTagLinks: [{ _id: "a1--style-old" }, { _id: "a1--style-new" }],
    currentArtistLinks: [{ _id: "a1--p1" }],
    artworkAssignments: [target],
    artistAssignments: [],
    rollbackVocabTerms: [{ _id: "style-old" }],
    rollbackTagLinks: [{ _id: "a1--style-old" }],
    rollbackArtistLinks: [],
    targetVocabTerms: [{ _id: "style-old" }, { _id: "style-new" }],
    targetTagLinks: [{ _id: "a1--style-old" }, { _id: "a1--style-new" }],
    targetArtistLinks: [{ _id: "a1--p1" }],
  });
  assert.equal(result.safe_to_write, true);
  assert.equal(result.artworks_already_migrated, 1);
  assert.equal(result.vocab_ids.remaining, 0);
  assert.equal(result.artist_link_ids.added, 1);
});
