import assert from "node:assert/strict";
import test from "node:test";

import { buildReconciliation } from "./build-classification-release-reconciliation.mjs";

test("explains strict relation drift without mixing recommendation channel sources", () => {
  const baselineTagLinks = [
    {
      _id: "artwork_3531059a-dabe-49bd-b05b-af23c110b894--subject-botanical",
      artwork_id: "artwork_3531059a-dabe-49bd-b05b-af23c110b894",
      tag_id: "subject-botanical",
    },
  ];
  const candidateTagLinks = [
    {
      _id: "artwork_3531059a-dabe-49bd-b05b-af23c110b894--subject-history-painting",
      artwork_id: "artwork_3531059a-dabe-49bd-b05b-af23c110b894",
      tag_id: "subject-history-painting",
      match_source: "curated-semantic-override",
    },
  ];
  const knownArtworks = [
    {
      _id: "artwork_3531059a-dabe-49bd-b05b-af23c110b894",
      classification_ids: ["subject-history-painting"],
    },
    {
      _id: "artwork_ee780221-c66e-4391-812e-05666eb48ee3",
      classification_ids: ["subject-illustration", "subject-marine-life"],
    },
    {
      _id: "artwork_ba52eef6-3dd1-47af-93ef-f66697875f3b",
      classification_ids: ["subject-figure", "subject-portrait", "subject-interior"],
    },
  ];
  const candidateChannels = [
    {
      _id: "channel-term-subject-history-painting",
      query_field: "classification_ids",
      source_type: "classification",
    },
    {
      _id: "channel-signal-theme-flora-fauna",
      query_field: "recommendation_signal_ids",
      source_type: "recommendation_signal",
    },
  ];

  const report = buildReconciliation({
    baselineTagLinks,
    candidateTagLinks,
    candidateArtworks: knownArtworks,
    candidateChannels,
    productionArtworks: knownArtworks,
  });

  assert.equal(report.ok, true);
  assert.equal(report.counts.additions, 1);
  assert.equal(report.counts.removals, 1);
  assert.equal(report.additions[0].repair_reason, "reviewed_artwork_semantic_override");
  assert.equal(report.removals[0].repair_reason, "reviewed_strict_classification_removal");
  assert.equal(
    report.known_strict_checks.every((row) => row.ok),
    true,
  );
  assert.deepEqual(report.invalid_channel_source_types, []);
});
