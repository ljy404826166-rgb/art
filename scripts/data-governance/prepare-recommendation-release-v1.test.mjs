import assert from "node:assert/strict";
import test from "node:test";

import { buildRelease } from "./prepare-recommendation-release-v1.mjs";

test("promotes reviewed draft terms and combines classification and recommendation patches", () => {
  const release = buildRelease({
    vocabulary: {
      terms: [
        {
          _id: "medium-oil",
          review_status: "reviewed",
          publish_status: "draft",
        },
      ],
    },
    classificationArtworks: [
      {
        _id: "artwork-1",
        classification_version: "classification-v6",
        classification_ids: ["style-a"],
        tag_ids: ["medium-oil"],
        artist_ids: ["artist-1"],
        previous: {},
        changed: true,
      },
    ],
    tagLinks: [
      {
        _id: "artwork-1--medium-oil",
        artwork_id: "artwork-1",
        tag_id: "medium-oil",
        term_publish_status: "draft",
      },
    ],
    artistLinks: [
      {
        _id: "artwork-1--creator--artist-1",
        artwork_id: "artwork-1",
        artist_id: "artist-1",
      },
    ],
    recommendationPatches: [
      {
        _id: "artwork-1",
        recommendation_signal_ids: ["signal-color"],
        recommendation_status: "eligible",
        random_bucket: 123,
        previous: {},
      },
    ],
    signals: [{ _id: "signal-color" }],
    channels: [
      {
        _id: "channel-medium-oil",
        kind: "controlled_term",
        query_value: "medium-oil",
        source_publish_status: "draft",
        capacity_ready: true,
        diversity_ready: true,
        channel_status: "candidate",
        auto_feature_eligible: false,
      },
    ],
    signalLinks: [
      {
        _id: "artwork-1--signal-color",
        artwork_id: "artwork-1",
        signal_id: "signal-color",
      },
    ],
    releasedAt: "2026-07-28T00:00:00.000Z",
  });

  assert.equal(release.terms[0].publish_status, "published");
  assert.equal(release.tagLinks[0].term_publish_status, "published");
  assert.equal(release.channels[0].channel_status, "published");
  assert.equal(release.channels[0].auto_feature_eligible, true);
  assert.equal(release.artworks[0].random_bucket, 123);
  assert.equal(Object.hasOwn(release.artworks[0], "previous"), false);
  assert.equal(release.checks.ok, true);
});
