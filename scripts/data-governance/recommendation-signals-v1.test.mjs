import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChannelStats,
  buildRecommendationSignalCatalog,
  buildRecommendationSignalIndex,
  deriveChannelPolicy,
  deriveRecommendationArtwork,
  stableRecommendationBucket,
} from "./recommendation-signals-v1.mjs";

test("builds a unique 88-signal recommendation-only catalog", () => {
  const signals = buildRecommendationSignalCatalog();
  assert.equal(signals.length, 88);
  assert.equal(new Set(signals.map((signal) => signal._id)).size, 88);
  assert.equal(new Set(signals.map((signal) => signal.label_zh)).size, 88);
  assert.equal(
    signals.every((signal) => signal.classification_filter === false),
    true,
  );
  assert.deepEqual(buildRecommendationSignalIndex(signals).get("色彩"), ["signal-visual-color"]);
  assert.deepEqual(buildRecommendationSignalIndex(signals).get("花鸟虫兽"), [
    "signal-theme-flora-fauna",
  ]);
  assert.deepEqual(buildRecommendationSignalIndex(signals).get("西班牙浪漫主义"), [
    "signal-theme-spanish-romanticism",
  ]);
  assert.deepEqual(buildRecommendationSignalIndex(signals).get("英国浪漫主义"), [
    "signal-theme-british-romanticism",
  ]);
});

test("stable random buckets are deterministic and bounded", () => {
  const first = stableRecommendationBucket("artwork-1");
  assert.equal(first, stableRecommendationBucket("artwork-1"));
  assert.equal(first >= 0 && first < 10000, true);
  assert.notEqual(first, stableRecommendationBucket("artwork-2"));
});

test("derives recommendation eligibility without changing strict classifications", () => {
  const normalizedArtwork = {
    classification_ids: ["style-impressionism"],
    tag_ids: ["medium-oil-painting"],
    artist_ids: ["claude-monet"],
  };
  const result = deriveRecommendationArtwork({
    artwork: {
      _id: "artwork-1",
      status: "published",
      title_cn: "睡莲",
      thumbnail_url: "https://example.test/image.webp",
      description: "description",
    },
    normalizedArtwork,
    signalIds: ["signal-setting-nature"],
  });

  assert.equal(result.recommendation_status, "eligible");
  assert.deepEqual(result.recommendation_signal_ids, ["signal-setting-nature"]);
  assert.equal(result.recommendation_quality_score, 1);
  assert.deepEqual(normalizedArtwork.classification_ids, ["style-impressionism"]);
});

test("blocks unpublished or imageless records from recommendation pools", () => {
  const result = deriveRecommendationArtwork({
    artwork: { _id: "draft", status: "draft" },
    normalizedArtwork: { classification_ids: [], tag_ids: [], artist_ids: [] },
  });
  assert.equal(result.recommendation_status, "ineligible");
  assert.deepEqual(result.recommendation_ineligibility_reasons, [
    "not_published",
    "missing_image",
    "missing_recommendation_dimensions",
  ]);
});

test("distinguishes cross-artist and artist-focus channel policies", () => {
  const artworkById = new Map([
    ["a", { artist_ids: ["artist-1"] }],
    ["b", { artist_ids: ["artist-1"] }],
    ["c", { artist_ids: ["artist-2"] }],
    ["d", { artist_ids: ["artist-3"] }],
  ]);
  const stats = buildChannelStats(["a", "b", "c", "d"], artworkById);
  assert.equal(stats.unique_artist_count, 3);
  assert.equal(stats.top_artist_share, 0.5);
  assert.equal(deriveChannelPolicy(stats).channel_mode, "cross_artist");

  const focusedStats = buildChannelStats(["a", "b", "a", "b", "a", "b", "a", "b"], artworkById);
  const policy = deriveChannelPolicy(focusedStats);
  assert.equal(policy.channel_mode, "artist_focus");
  assert.equal(policy.artist_scope_id, "artist-1");
  assert.equal(policy.auto_feature_eligible, true);
});
