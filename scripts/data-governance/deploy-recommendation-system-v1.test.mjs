import assert from "node:assert/strict";
import test from "node:test";

import { buildPreflight, parseArgs, pilotRelease } from "./deploy-recommendation-system-v1.mjs";

test("requires exact confirmation for full production writes", () => {
  assert.throws(() => parseArgs(["--run", "--full"]), /confirm-production/);
  assert.equal(
    parseArgs(["--run", "--full", "--confirm-production", "cloudbase-d6gvny27ib05e0ede"]).mode,
    "full",
  );
  assert.equal(parseArgs(["--run", "--pilot"]).mode, "pilot");
  assert.equal(parseArgs(["--pilot", "--pilot-size", "1500"]).pilotSize, 1500);
  assert.throws(() => parseArgs(["--pilot", "--pilot-size", "1501"]), /between 1 and 1500/);
});

test("preflight accepts the exact rollback state and rejects drift", () => {
  const previousClassification = [
    {
      _id: "artwork-1",
      classification_version: "classification-v5",
      classification_ids: ["style-a"],
      tag_ids: ["style-a"],
      artist_ids: ["artist-1"],
    },
  ];
  const previousRecommendation = [
    {
      _id: "artwork-1",
      recommendation_signal_ids: [],
      recommendation_status: null,
      recommendation_ineligibility_reasons: [],
      recommendation_quality_score: null,
      random_bucket: null,
      recommendation_signal_version: null,
      recommendation_random_version: null,
    },
  ];
  const target = {
    _id: "artwork-1",
    classification_version: "classification-v6",
    taxonomy_version: "controlled-vocabulary-v1",
    classification_ids: ["style-a"],
    tag_ids: ["style-a"],
    artist_ids: ["artist-1"],
    recommendation_signal_ids: ["signal-a"],
    recommendation_status: "eligible",
    recommendation_ineligibility_reasons: [],
    recommendation_quality_score: 0.9,
    random_bucket: 1,
    recommendation_signal_version: "recommendation-signals-v1",
    recommendation_random_version: "fnv1a-v1",
  };
  const release = {
    artworks: [target],
    vocabTerms: [{ _id: "style-a" }],
    tagLinks: [{ _id: "tag-link" }],
    artistLinks: [{ _id: "artist-link" }],
    signals: [{ _id: "signal-a" }],
    channels: [{ _id: "channel-a" }],
    signalLinks: [{ _id: "signal-link" }],
    previousClassification,
    previousRecommendation,
    previousTagLinks: [{ _id: "old-tag-link" }],
    previousArtistLinks: [{ _id: "old-artist-link" }],
  };
  const base = {
    currentArtworks: [
      {
        ...previousClassification[0],
        ...previousRecommendation[0],
      },
    ],
    currentVocabTerms: [{ _id: "style-a" }],
    currentTagLinks: [{ _id: "old-tag-link" }],
    currentArtistLinks: [{ _id: "old-artist-link" }],
    currentSignals: [],
    currentChannels: [],
    currentSignalLinks: [],
    release,
  };

  const preflight = buildPreflight(base);
  assert.equal(preflight.safe_to_write, true);
  assert.deepEqual(preflight.pending_artwork_ids, ["artwork-1"]);
  assert.equal(
    buildPreflight({
      ...base,
      currentSignals: [{ _id: "signal-old" }],
      currentChannels: [{ _id: "channel-old" }],
      currentSignalLinks: [{ _id: "signal-link-old" }],
    }).safe_to_write,
    true,
  );
  assert.equal(
    buildPreflight({
      ...base,
      currentArtworks: [{ ...base.currentArtworks[0], random_bucket: 999 }],
    }).safe_to_write,
    false,
  );
});

test("pilot prioritizes pending artworks before deterministic filler", () => {
  const artworks = [
    { _id: "artwork-a", random_bucket: 1 },
    { _id: "artwork-b", random_bucket: 2 },
    { _id: "artwork-c", random_bucket: 3 },
  ];
  const release = {
    artworks,
    vocabTerms: [],
    tagLinks: artworks.map((artwork) => ({
      _id: `tag-${artwork._id}`,
      artwork_id: artwork._id,
    })),
    artistLinks: [],
    signals: [],
    channels: [],
    signalLinks: artworks.map((artwork) => ({
      _id: `signal-${artwork._id}`,
      artwork_id: artwork._id,
    })),
  };

  const pilot = pilotRelease(release, 2, {
    preferredArtworkIds: ["artwork-c"],
  });
  assert.deepEqual(
    pilot.artworks.map((artwork) => artwork._id),
    ["artwork-c", "artwork-a"],
  );
  assert.deepEqual(
    pilot.tagLinks.map((link) => link.artwork_id),
    ["artwork-a", "artwork-c"],
  );
  assert.throws(
    () =>
      pilotRelease(release, 1, {
        preferredArtworkIds: ["artwork-b", "artwork-c"],
      }),
    /cannot cover 2 pending artworks/,
  );
});
