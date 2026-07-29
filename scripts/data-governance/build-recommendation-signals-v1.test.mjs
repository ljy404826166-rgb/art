import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runBuild } from "./build-recommendation-signals-v1.mjs";
import {
  buildControlledVocabulary,
  CONTROLLED_VOCABULARY_VERSION,
} from "./controlled-vocabulary-v1.mjs";

function writeJsonl(filePath, rows) {
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

test("builds signal assignments, artist channels, eligibility, and rollback artifacts", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "recommendation-signals-"));
  const task3Dir = path.join(root, "task-03");
  const outputDir = path.join(root, "task-04");
  const vocabularyPath = path.join(root, "controlled-vocabulary-v1.json");
  fs.mkdirSync(task3Dir, { recursive: true });
  fs.writeFileSync(
    vocabularyPath,
    JSON.stringify({
      version: CONTROLLED_VOCABULARY_VERSION,
      terms: buildControlledVocabulary(),
    }),
    "utf8",
  );
  const normalized = Array.from({ length: 8 }, (_, index) => ({
    _id: `artwork-${index}`,
    classification_ids: ["style-impressionism"],
    tag_ids: ["style-impressionism", "medium-oil-painting"],
    recommendation_term_ids: ["style-impressionism", "medium-oil-painting"],
    artist_ids: ["claude-monet"],
  }));
  writeJsonl(path.join(task3Dir, "classification-v6-artworks.jsonl"), normalized);
  writeJsonl(path.join(task3Dir, "classification-v6-tag-review-queue.jsonl"), [
    ...normalized.map((artwork) => ({
      artwork_id: artwork._id,
      source_tag_text: "自然",
      reason: "recommendation_signal_candidate",
    })),
    {
      artwork_id: normalized[0]._id,
      source_tag_text: "subject-floral",
      reason: "ambiguous_compound_subject_requires_artwork_review",
    },
    {
      artwork_id: normalized[0]._id,
      source_tag_text: "莫奈",
      reason: "recommendation_signal_candidate",
    },
    {
      artwork_id: normalized[1]._id,
      source_tag_text: "19世纪末",
      reason: "recommendation_signal_candidate",
    },
  ]);

  const { report, patches, channels } = await runBuild({
    envId: "fixture",
    task3Dir,
    outputDir,
    vocabularyPath,
    generatedAt: "2026-07-28T00:00:00.000Z",
    dataProvider: async () => ({
      artworks: normalized.map((artwork) => ({
        _id: artwork._id,
        status: "published",
        title_cn: artwork._id,
        thumbnail_url: "https://example.test/image.webp",
        artist:
          artwork._id === normalized[1]._id
            ? "未知（通常认为与19世纪末艺术有关）"
            : "克劳德·莫奈 (Claude Monet)",
      })),
      artists: [
        {
          _id: "claude-monet",
          name_zh: "克洛德·莫奈",
          entity_type: "person",
          review_status: "reviewed",
        },
      ],
    }),
  });

  assert.equal(report.cloud_writes_performed, false);
  assert.equal(report.validation.ok, true);
  assert.equal(report.signal_counts.total, 88);
  assert.equal(report.signal_counts.ignored_artist_labels, 1);
  assert.deepEqual(
    patches.find((patch) => patch._id === normalized[1]._id).recommendation_signal_ids,
    ["signal-era-late-19th-century", "signal-setting-nature"],
  );
  assert.equal(
    patches.every((patch) => patch.recommendation_status === "eligible"),
    true,
  );
  assert.equal(
    channels.find((channel) => channel.channel_key === "artist:claude-monet").auto_feature_eligible,
    true,
  );
  assert.equal(
    channels.find((channel) => channel.channel_key === "signal:signal-setting-nature").channel_mode,
    "artist_focus",
  );
  assert.equal(
    channels.find((channel) => channel.channel_key === "signal:signal-setting-nature")
      .display_title,
    "自然",
  );
  assert.equal(
    channels.every((channel) => channel.display_title === channel.title),
    true,
  );
  assert.equal(
    channels.find((channel) => channel.channel_key === "artist:claude-monet").source_type,
    "artist",
  );
  assert.equal(
    channels.find((channel) => channel.channel_key === "signal:signal-setting-nature").source_type,
    "recommendation_signal",
  );
  const draftTermChannel = channels.find(
    (channel) => channel.channel_key === "term:medium-oil-painting",
  );
  assert.equal(draftTermChannel.source_type, "controlled_metadata");
  assert.equal(draftTermChannel.channel_status, "candidate");
  assert.equal(draftTermChannel.auto_feature_eligible, false);
  assert.equal(report.validation.unmapped_signal_labels, 0);
  [
    "recommendation-signals-v1.json",
    "recommendation-channels-v1.json",
    "recommendation-artwork-patches.jsonl",
    "artwork-recommendation-signal-links.jsonl",
    "rollback-recommendation-artwork-fields.jsonl",
    "task-04-report.json",
    "task-04-report.md",
  ].forEach((name) => assert.equal(fs.existsSync(path.join(outputDir, name)), true, name));
});
