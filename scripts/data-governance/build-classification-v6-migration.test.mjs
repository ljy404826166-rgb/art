import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { runBuild } from "./build-classification-v6-migration.mjs";

const fixture = {
  artworks: [
    {
      _id: "artwork-1",
      artist_ids: ["eug-ne-delacroix"],
      classification_ids: ["subject-portrait"],
      tag_keys: ["油画", "暖色氛围"],
    },
  ],
  artists: [
    {
      _id: "eugene-delacroix",
      entity_type: "person",
      name_zh: "欧仁·德拉克罗瓦",
      name_en: "Eugène Delacroix",
      review_status: "reviewed",
    },
  ],
  existingTagLinks: [],
  existingArtistLinks: [],
};

describe("build-classification-v6-migration", () => {
  it("writes dry-run, review, and rollback artifacts without a cloud mutation", async () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "classification-v6-"));
    const vocabularyPath = path.resolve(
      "outputs/recommendation-system/task-02/controlled-vocabulary-v1.json",
    );
    const { report } = await runBuild({
      envId: "fixture",
      vocabularyPath,
      outputDir,
      batchId: "fixture-batch",
      generatedAt: "2026-07-28T00:00:00.000Z",
      dataProvider: async () => structuredClone(fixture),
    });

    assert.equal(report.mode, "read-only-dry-run");
    assert.equal(report.cloud_writes_performed, false);
    assert.equal(report.validation.integrity_ok, true);
    assert.equal(report.validation.production_ready, false);
    assert.deepEqual(report.validation.production_blockers, [
      "tag-review-queue:1",
      "draft-term-links:1",
    ]);
    [
      "classification-v6-artworks.jsonl",
      "classification-v6-artwork-tag-links.jsonl",
      "classification-v6-artwork-artist-links.jsonl",
      "classification-v6-tag-review-queue.jsonl",
      "classification-v6-artist-review-queue.jsonl",
      "artist-reference-repairs.csv",
      "tag-review-summary.csv",
      "rollback-artworks.jsonl",
      "rollback-artwork-tag-links.jsonl",
      "rollback-artwork-artist-links.jsonl",
      "task-03-report.json",
      "task-03-report.md",
    ].forEach((name) => {
      assert.equal(fs.existsSync(path.join(outputDir, name)), true, name);
    });
  });
});
