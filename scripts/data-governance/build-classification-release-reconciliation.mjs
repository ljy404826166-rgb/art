#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASELINE_RELEASE_DIR = path.resolve("outputs/recommendation-system/task-05");
const DEFAULT_CANDIDATE_RELEASE_DIR = path.resolve(
  "outputs/recommendation-system/task-07-maturity-remediation/release",
);
const DEFAULT_STRICT_SNAPSHOT_DIR = path.resolve(
  "outputs/recommendation-system/task-07-maturity-remediation/strict",
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  "outputs/recommendation-system/task-07-maturity-remediation/reconciliation",
);

const KNOWN_STRICT_EXPECTATIONS = [
  {
    artwork_id: "artwork_ee780221-c66e-4391-812e-05666eb48ee3",
    label: "图谱：海蜥鱼与海雀鹰鱼",
    required: ["subject-marine-life"],
    forbidden: ["subject-botanical"],
  },
  {
    artwork_id: "artwork_3531059a-dabe-49bd-b05b-af23c110b894",
    label: "1808年5月3日",
    required: ["subject-history-painting"],
    forbidden: ["subject-botanical"],
  },
  {
    artwork_id: "artwork_ba52eef6-3dd1-47af-93ef-f66697875f3b",
    label: "宫娥",
    required: ["subject-figure", "subject-portrait", "subject-interior"],
    forbidden: ["subject-botanical"],
  },
];

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function difference(left, right) {
  const rightIds = new Set(right.map((row) => String(row._id)));
  return left.filter((row) => !rightIds.has(String(row._id)));
}

function countBy(rows, field) {
  return rows.reduce((counts, row) => {
    const key = String(row[field] || "unknown");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

export function buildReconciliation({
  baselineTagLinks,
  candidateTagLinks,
  candidateArtworks,
  candidateChannels,
  productionArtworks,
}) {
  const additions = difference(candidateTagLinks, baselineTagLinks).map((row) => ({
    ...row,
    repair_action: "add",
    repair_reason:
      row.match_source === "curated-semantic-override"
        ? "reviewed_artwork_semantic_override"
        : "release_manifest_missing_reviewed_relation",
  }));
  const removals = difference(baselineTagLinks, candidateTagLinks).map((row) => ({
    ...row,
    repair_action: "remove",
    repair_reason: "reviewed_strict_classification_removal",
  }));
  const candidateById = new Map(candidateArtworks.map((row) => [String(row._id), row]));
  const productionById = new Map(productionArtworks.map((row) => [String(row._id), row]));
  const knownStrictChecks = KNOWN_STRICT_EXPECTATIONS.map((expectation) => {
    const artwork =
      productionById.get(expectation.artwork_id) || candidateById.get(expectation.artwork_id) || {};
    const classificationIds = Array.isArray(artwork.classification_ids)
      ? artwork.classification_ids
      : [];
    const missingRequired = expectation.required.filter((id) => !classificationIds.includes(id));
    const presentForbidden = expectation.forbidden.filter((id) => classificationIds.includes(id));
    return {
      ...expectation,
      classification_ids: classificationIds,
      missing_required: missingRequired,
      present_forbidden: presentForbidden,
      ok: missingRequired.length === 0 && presentForbidden.length === 0,
    };
  });
  const sourceTypes = countBy(candidateChannels, "source_type");
  const invalidChannelSources = candidateChannels
    .filter((channel) => {
      const expected = {
        classification_ids: "classification",
        tag_ids: "controlled_metadata",
        artist_ids: "artist",
        recommendation_signal_ids: "recommendation_signal",
      }[channel.query_field];
      return channel.source_type !== expected;
    })
    .map((channel) => channel._id);
  const affectedArtworkIds = [
    ...new Set([...additions, ...removals].map((row) => row.artwork_id)),
  ].sort();
  const report = {
    generated_at: new Date().toISOString(),
    baseline_release_tag_links: baselineTagLinks.length,
    candidate_release_tag_links: candidateTagLinks.length,
    additions,
    removals,
    counts: {
      additions: additions.length,
      removals: removals.length,
      relation_differences: additions.length + removals.length,
      affected_artworks: affectedArtworkIds.length,
      additions_by_tag: countBy(additions, "tag_id"),
      removals_by_tag: countBy(removals, "tag_id"),
      channel_source_types: sourceTypes,
    },
    affected_artwork_ids: affectedArtworkIds,
    known_strict_checks: knownStrictChecks,
    invalid_channel_source_types: invalidChannelSources,
  };
  report.ok =
    report.counts.relation_differences > 0 &&
    knownStrictChecks.every((row) => row.ok) &&
    invalidChannelSources.length === 0;
  return report;
}

function markdown(report) {
  return `# 任务三分类与推荐发布清单对账

生成时间：${report.generated_at}

- 旧发布清单关系：${report.baseline_release_tag_links}
- 新候选发布清单关系：${report.candidate_release_tag_links}
- 新增关系：${report.counts.additions}
- 移除关系：${report.counts.removals}
- 关系差异总数：${report.counts.relation_differences}
- 影响作品：${report.counts.affected_artworks}
- 对账结论：${report.ok ? "通过" : "未通过"}

## 双体系频道

${Object.entries(report.counts.channel_source_types)
  .map(([key, value]) => `- ${key}: ${value}`)
  .join("\n")}

## 已知严格分类样本

${report.known_strict_checks
  .map(
    (row) =>
      `- ${row.label}: ${row.ok ? "通过" : "失败"}；classification_ids=${row.classification_ids.join(",")}`,
  )
  .join("\n")}

新增与移除关系的逐条原因、受影响作品 ID 和频道来源校验保存在同目录 JSON 报告中。
`;
}

export function runBuild({
  baselineReleaseDir = DEFAULT_BASELINE_RELEASE_DIR,
  candidateReleaseDir = DEFAULT_CANDIDATE_RELEASE_DIR,
  strictSnapshotDir = DEFAULT_STRICT_SNAPSHOT_DIR,
  outputDir = DEFAULT_OUTPUT_DIR,
} = {}) {
  const report = buildReconciliation({
    baselineTagLinks: readJsonl(path.join(baselineReleaseDir, "release-artwork-tag-links.jsonl")),
    candidateTagLinks: readJsonl(path.join(candidateReleaseDir, "release-artwork-tag-links.jsonl")),
    candidateArtworks: readJsonl(path.join(candidateReleaseDir, "release-artworks.jsonl")),
    candidateChannels: readJsonl(
      path.join(candidateReleaseDir, "release-recommendation-channels.jsonl"),
    ),
    productionArtworks: readJsonl(path.join(strictSnapshotDir, "rollback-artworks.jsonl")),
  });
  fs.mkdirSync(outputDir, { recursive: true });
  writeJson(path.join(outputDir, "task-03-release-reconciliation.json"), report);
  fs.writeFileSync(
    path.join(outputDir, "task-03-release-reconciliation.md"),
    markdown(report),
    "utf8",
  );
  if (!report.ok) throw new Error("Classification release reconciliation failed.");
  return report;
}

const isMain =
  process.argv[1] &&
  path.basename(path.resolve(process.argv[1])) === path.basename(fileURLToPath(import.meta.url));

if (isMain) {
  try {
    console.log(JSON.stringify(runBuild(), null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
