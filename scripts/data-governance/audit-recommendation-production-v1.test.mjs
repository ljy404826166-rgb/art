import assert from "node:assert/strict";
import test from "node:test";

import { auditRecommendationProduction } from "./audit-recommendation-production-v1.mjs";

function fixture() {
  const artworks = [
    {
      _id: "artwork-1",
      status: "published",
      classification_version: "classification-v7",
      taxonomy_version: "controlled-vocabulary-v2",
      classification_ids: ["subject-landscape"],
      tag_ids: ["subject-landscape"],
      artist_ids: ["artist-1"],
      recommendation_signal_ids: ["signal-calm"],
      recommendation_status: "eligible",
      recommendation_signal_version: "recommendation-signals-v1",
      recommendation_random_version: "fnv1a-v1",
      random_bucket: 42,
      release_version: "recommendation-system-v1",
    },
  ];
  const artists = [
    {
      _id: "artist-1",
      entity_type: "person",
      review_status: "reviewed",
    },
  ];
  const vocabTerms = [{ _id: "subject-landscape" }];
  const tagLinks = [
    {
      _id: "tag-link-1",
      artwork_id: "artwork-1",
      tag_id: "subject-landscape",
    },
  ];
  const artistLinks = [
    {
      _id: "artist-link-1",
      artwork_id: "artwork-1",
      artist_id: "artist-1",
    },
  ];
  const signals = [{ _id: "signal-calm", classification_filter: false }];
  const channels = [
    {
      _id: "channel-artist-1",
      kind: "artist",
      source_type: "artist",
      title: "画家一",
      display_title: "画家一",
      query_field: "artist_ids",
      query_value: "artist-1",
      artwork_count: 1,
      auto_feature_eligible: false,
    },
    {
      _id: "channel-signal-calm",
      kind: "signal",
      source_type: "recommendation_signal",
      title: "宁静",
      display_title: "宁静",
      query_field: "recommendation_signal_ids",
      query_value: "signal-calm",
      artwork_count: 1,
      auto_feature_eligible: false,
    },
  ];
  const signalLinks = [
    {
      _id: "signal-link-1",
      artwork_id: "artwork-1",
      signal_id: "signal-calm",
    },
  ];
  const release = {
    artworks,
    vocabTerms,
    tagLinks,
    artistLinks,
    signals,
    channels,
    signalLinks,
  };
  return {
    artworks,
    artists,
    vocabTerms,
    tagLinks,
    artistLinks,
    signals,
    channels,
    signalLinks,
    release,
    indexes: {
      artworks: [
        "status_recommendation_random_id",
        "status_signal_random_id",
        "status_artist_random_id",
        "status_tag_random_id",
        "status_classification_created_id",
      ],
      recommendation_channels: ["status_auto_priority"],
    },
    permissions: {
      recommendation_signals: "READONLY",
      recommendation_channels: "READONLY",
      artwork_recommendation_signal_links: "PRIVATE",
    },
    clientSource: `
      async function fetchRecommendationChannels() {
        for (let skip = 0; skip < 200; skip += 20) {
          query.skip(skip);
        }
      }
      const title = { title: channel.title };
      fetchRecommendationChannels({ limit: 200 }).catch(() => []);
    `,
  };
}

test("accepts a normalized release with separate artist and tag titles", () => {
  const result = auditRecommendationProduction(fixture());

  assert.equal(result.ok, true);
  assert.equal(result.checks.channel_title_mismatches.length, 0);
  assert.equal(result.checks.invalid_channel_source_types.length, 0);
  assert.equal(result.checks.recommendation_signals_in_classification.length, 0);
  assert.equal(result.checks.missing_artist_channels.length, 0);
});

test("rejects recommendation channels that blur strict classification boundaries", () => {
  const data = fixture();
  data.channels[1] = {
    ...data.channels[1],
    source_type: "classification",
  };
  data.signals[0] = {
    ...data.signals[0],
    classification_filter: true,
  };
  data.release = {
    ...data.release,
    channels: data.channels,
    signals: data.signals,
  };

  const result = auditRecommendationProduction(data);

  assert.equal(result.ok, false);
  assert.deepEqual(result.checks.invalid_channel_source_types, ["channel-signal-calm"]);
  assert.deepEqual(result.checks.recommendation_signals_in_classification, ["signal-calm"]);
});

test("rejects composite titles and missing artist dimensions", () => {
  const data = fixture();
  data.channels = [
    {
      ...data.channels[1],
      display_title: "画家一 · 宁静",
    },
  ];
  data.release = {
    ...data.release,
    channels: data.channels,
  };

  const result = auditRecommendationProduction(data);

  assert.equal(result.ok, false);
  assert.deepEqual(result.checks.channel_title_mismatches, ["channel-signal-calm"]);
  assert.deepEqual(result.checks.missing_artist_channels, ["artist-1"]);
});
