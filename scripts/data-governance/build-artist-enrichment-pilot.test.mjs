import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildArtistEnrichmentPilotPackage,
  discoverBatchFiles,
} from "./build-artist-enrichment-pilot.mjs";

function validRecord(id, name) {
  const bio = `${name}（1900—1970）是用于测试的画家与艺术研究对象，生于测试城市，卒于测试城市。其生涯涵盖学院学习、独立创作、公共展览与艺术教育，并持续研究人物、风景和静物等题材。作品以稳定构图、清晰造型和审慎用色见长，在所属地区的现代艺术发展中承担承前启后的角色。其创作既保存了传统训练，也回应了20世纪视觉文化变化，并通过展览、教学和公共收藏产生影响。今天的研究主要关注其艺术语言、职业网络、代表作品及历史地位，是理解相关时期艺术生态的重要个案。`;
  return {
    _id: id,
    entity_type: "person",
    identity_status: "verified",
    name_zh: name,
    name_en: name,
    aliases: [],
    birth_year: 1900,
    death_year: 1970,
    occupations_zh: ["画家"],
    bio_zh: bio,
    bio_facts: {
      lifespan: "1900年出生，1970年去世",
      title: "画家",
      career: "从事绘画、展览与教学",
      standing: "相关时期艺术生态的重要个案",
    },
    sources: [{ title: "Authority", url: "https://example.com/artist" }],
    review_status: "candidate",
  };
}

test("pilot package merges patches and keeps relationship changes deterministic", () => {
  const record = validRecord("artist-1", "测试画家");
  const result = buildArtistEnrichmentPilotPackage(
    [
      {
        __file: "batch-1.json",
        records: [record],
        relationship_corrections: [{ artwork_id: "art-1", set_role: "creator" }],
      },
      {
        __file: "batch-2.json",
        record_dispositions: [
          {
            _id: "artist-1",
            record_action: "retain",
          },
        ],
      },
    ],
    "2026-07-25T00:00:00.000Z",
  );

  assert.equal(result.artist_patches.length, 1);
  assert.equal(result.artist_patches[0].record_action, "retain");
  assert.equal(result.summary.full_enrichment_records, 1);
  assert.equal(result.summary.structural_dispositions, 0);
  assert.equal(result.summary.relationship_changes, 1);
  assert.match(result.relationship_changes[0]._id, /^artist-enrichment-001-/);
});

test("pilot package rejects invalid full enrichment records", () => {
  assert.throws(
    () => buildArtistEnrichmentPilotPackage([{ records: [{ _id: "bad" }] }]),
    /Invalid full enrichment records: bad/,
  );
});

test("pilot batch discovery includes future batches in numeric order", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "artist-enrichment-batches-"));
  fs.writeFileSync(path.join(directory, "artist-enrichment-candidates-batch-10.json"), "{}");
  fs.writeFileSync(path.join(directory, "artist-enrichment-dispositions-batch-03.json"), "{}");
  fs.writeFileSync(path.join(directory, "artist-enrichment-candidates-batch-04.json"), "{}");
  fs.writeFileSync(path.join(directory, "ignore.json"), "{}");
  assert.deepEqual(discoverBatchFiles(directory), [
    "artist-enrichment-dispositions-batch-03.json",
    "artist-enrichment-candidates-batch-04.json",
    "artist-enrichment-candidates-batch-10.json",
  ]);
});
