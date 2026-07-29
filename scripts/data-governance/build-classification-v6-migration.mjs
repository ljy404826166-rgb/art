#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildClassificationV6Migration } from "./classification-v6-relations.mjs";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_VOCAB_PATH = path.resolve(
  process.cwd(),
  "outputs",
  "recommendation-system",
  "task-02",
  "controlled-vocabulary-v1.json",
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  process.cwd(),
  "outputs",
  "recommendation-system",
  "task-03",
);

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) return;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) return;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      result[match[1]] = value;
    });
  return result;
}

function environment() {
  return {
    ...parseEnvFile(path.resolve(process.cwd(), ".env")),
    ...parseEnvFile(path.resolve(process.cwd(), ".env.local")),
    ...process.env,
  };
}

function createClient(envId, config) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error("Missing Tencent Cloud credentials.");
  return CloudBase.init({ envId, secretId, secretKey });
}

function normalizeExtendedJson(value) {
  if (Array.isArray(value)) return value.map(normalizeExtendedJson);
  if (!value || typeof value !== "object") return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$numberInt") return Number(value.$numberInt);
  if (keys.length === 1 && keys[0] === "$numberLong") return Number(value.$numberLong);
  if (keys.length === 1 && keys[0] === "$numberDouble") return Number(value.$numberDouble);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeExtendedJson(child)]),
  );
}

function parseCommandRows(data) {
  const outer = JSON.parse(data || "[]");
  return outer.map((row) => normalizeExtendedJson(JSON.parse(row)));
}

async function queryCollection(database, collection, projection = {}) {
  const rows = [];
  const pageSize = 1000;
  for (let skip = 0; ; skip += pageSize) {
    let result;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        result = await database.runCommands({
          MgoCommands: [
            {
              TableName: collection,
              CommandType: "QUERY",
              Command: JSON.stringify({
                find: collection,
                filter: {},
                projection,
                skip,
                limit: pageSize,
              }),
            },
          ],
        });
        break;
      } catch (error) {
        lastError = error;
        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 500));
        }
      }
    }
    if (!result) throw lastError;
    const batch = parseCommandRows(result.Data?.[0]);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

async function loadCloudData({ envId }) {
  const app = createClient(envId, environment());
  const [artworks, artists, existingTagLinks, existingArtistLinks] = await Promise.all([
    queryCollection(app.database, "artworks", {
      _id: 1,
      status: 1,
      review_status: 1,
      publish_status: 1,
      artist: 1,
      artist_display: 1,
      raw_artist_text: 1,
      primary_artist_id: 1,
      artist_ids: 1,
      artist_labels: 1,
      artist_relation_roles: 1,
      title_cn: 1,
      title: 1,
      title_en: 1,
      description: 1,
      medium: 1,
      year: 1,
      creation_year: 1,
      created_year: 1,
      creation_date: 1,
      date: 1,
      period: 1,
      year_and_place: 1,
      tags_text: 1,
      classification_version: 1,
      taxonomy_version: 1,
      classification_ids: 1,
      tag_ids: 1,
      tag_keys: 1,
      tags: 1,
      tag_labels: 1,
      style_ids: 1,
      subject_ids: 1,
      medium_ids: 1,
      technique_ids: 1,
      support_ids: 1,
      format_ids: 1,
      period_ids: 1,
      decade_ids: 1,
      series_ids: 1,
      region_ids: 1,
      country_ids: 1,
      rights_ids: 1,
      recommendation_term_ids: 1,
    }),
    queryCollection(app.database, "artists", {
      _id: 1,
      name_zh: 1,
      nameZh: 1,
      name_en: 1,
      nameEn: 1,
      display_name: 1,
      aliases: 1,
      review_status: 1,
      entity_type: 1,
      identity_status: 1,
    }),
    queryCollection(app.database, "artwork_tag_links"),
    queryCollection(app.database, "artwork_artist_links"),
  ]);
  return {
    artworks,
    artists,
    existingTagLinks,
    existingArtistLinks,
  };
}

function countBy(rows, key) {
  return rows.reduce((result, row) => {
    const value = row[key] || "unknown";
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

function percent(numerator, denominator) {
  return denominator ? `${((numerator / denominator) * 100).toFixed(2)}%` : "0.00%";
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
}

function csvEscape(value) {
  if (Array.isArray(value)) return csvEscape(value.join("|"));
  const text =
    typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeCsv(filePath, rows) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const lines = [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(",")),
  ];
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function buildArtistRepairSummary(links) {
  const counts = new Map();
  links
    .filter((link) => link.source_artist_id !== link.artist_id)
    .forEach((link) => {
      const key = JSON.stringify([
        link.source_artist_id || "(raw-text-only)",
        link.artist_id,
        link.review_status,
        link.match_source,
      ]);
      if (!counts.has(key)) {
        counts.set(key, {
          source_artist_id: link.source_artist_id || "",
          target_artist_id: link.artist_id,
          target_artist_label: link.artist_label,
          review_status: link.review_status,
          match_source: link.match_source,
          artwork_count: 0,
        });
      }
      counts.get(key).artwork_count += 1;
    });
  return [...counts.values()].sort(
    (left, right) =>
      right.artwork_count - left.artwork_count ||
      left.source_artist_id.localeCompare(right.source_artist_id),
  );
}

function buildTagReviewSummary(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    const key = JSON.stringify([row.source_tag_text, row.reason]);
    if (!counts.has(key)) {
      counts.set(key, {
        source_tag_text: row.source_tag_text,
        reason: row.reason,
        artwork_count: 0,
        candidate_term_ids: row.candidate_term_ids || [],
      });
    }
    counts.get(key).artwork_count += 1;
  });
  return [...counts.values()].sort(
    (left, right) =>
      right.artwork_count - left.artwork_count ||
      left.source_tag_text.localeCompare(right.source_tag_text, "zh-CN"),
  );
}

function buildReport({ migration, envId, generatedAt, data }) {
  const assignments = migration.artworkAssignments;
  const draftTermLinks = migration.artworkTagLinks.filter(
    (link) => link.term_publish_status === "draft",
  );
  const artworkIdsWithDraftTerms = new Set(draftTermLinks.map((link) => link.artwork_id));
  const reviewedArtistLinks = migration.artworkArtistLinks.filter(
    (link) => link.review_status === "reviewed",
  );
  const candidateArtistLinks = migration.artworkArtistLinks.filter(
    (link) => link.review_status === "candidate",
  );
  const changedAssignments = assignments.filter((row) => row.changed);
  const artistRepairSummary = buildArtistRepairSummary(migration.artworkArtistLinks);
  const tagReviewSummary = buildTagReviewSummary(migration.tagReviewQueue);
  const report = {
    generated_at: generatedAt,
    mode: "read-only-dry-run",
    cloud_writes_performed: false,
    env_id: envId,
    classification_version: migration.version,
    vocabulary_version: migration.vocabulary_version,
    batch_id: migration.batch_id,
    source_counts: {
      artworks: data.artworks.length,
      artists: data.artists.length,
      existing_tag_links: data.existingTagLinks.length,
      existing_artist_links: data.existingArtistLinks.length,
    },
    proposed_counts: {
      changed_artworks: changedAssignments.length,
      unchanged_artworks: assignments.length - changedAssignments.length,
      tag_links: migration.artworkTagLinks.length,
      artist_links: migration.artworkArtistLinks.length,
      reviewed_artist_links: reviewedArtistLinks.length,
      candidate_artist_links: candidateArtistLinks.length,
      attribution_entities: migration.attributionCandidates.length,
      tag_review_queue: migration.tagReviewQueue.length,
      artist_review_queue: migration.artistReviewQueue.length,
      ignored_artist_tags: migration.ignoredArtistTags.length,
      draft_term_links: draftTermLinks.length,
      artworks_with_draft_terms: artworkIdsWithDraftTerms.size,
    },
    coverage: {
      classification_ids: percent(
        assignments.filter((row) => row.classification_ids.length > 0).length,
        assignments.length,
      ),
      tag_ids: percent(
        assignments.filter((row) => row.tag_ids.length > 0).length,
        assignments.length,
      ),
      reviewed_artist_ids: percent(
        assignments.filter((row) => row.artist_ids.length > 0).length,
        assignments.length,
      ),
    },
    repair_counts: migration.repairCounts,
    artist_reference_repair_summary: artistRepairSummary,
    tag_link_source_counts: migration.tagLinkSourceCounts,
    top_tag_review_candidates: tagReviewSummary.slice(0, 30),
    validation: {
      integrity_ok: migration.ok,
      checks: migration.checks,
      production_ready:
        migration.ok &&
        migration.checks.artworks_with_classification_ids === migration.checks.artworks_total &&
        migration.artistReviewQueue.length === 0 &&
        migration.tagReviewQueue.length === 0 &&
        draftTermLinks.length === 0,
      production_blockers: [
        ...(migration.ok ? [] : ["referential-integrity-gate-failed"]),
        ...(migration.checks.artworks_with_classification_ids < migration.checks.artworks_total
          ? [
              `unclassified-artworks:${
                migration.checks.artworks_total - migration.checks.artworks_with_classification_ids
              }`,
            ]
          : []),
        ...(migration.artistReviewQueue.length
          ? [`artist-review-queue:${migration.artistReviewQueue.length}`]
          : []),
        ...(migration.tagReviewQueue.length
          ? [`tag-review-queue:${migration.tagReviewQueue.length}`]
          : []),
        ...(draftTermLinks.length ? [`draft-term-links:${draftTermLinks.length}`] : []),
      ],
    },
  };
  return report;
}

function buildMarkdown(report) {
  return `# classification-v6 关系迁移预演（任务三）

生成时间：${report.generated_at}

## 结论

- 本次为只读云端预演，未执行任何云端写入。
- 关系完整性校验：${report.validation.integrity_ok ? "通过" : "未通过"}。
- 生产发布状态：${report.validation.production_ready ? "可发布" : "暂不可发布，需先完成审核队列"}。
- 作品 ${report.source_counts.artworks} 件；拟更新 ${report.proposed_counts.changed_artworks} 件。
- 拟生成作品—词条关系 ${report.proposed_counts.tag_links} 条。
- 拟生成作品—画家关系 ${report.proposed_counts.artist_links} 条，其中 reviewed ${report.proposed_counts.reviewed_artist_links} 条、candidate ${report.proposed_counts.candidate_artist_links} 条。

## 覆盖率

| 字段 | 迁移后覆盖率 |
|---|---:|
| classification_ids | ${report.coverage.classification_ids} |
| tag_ids | ${report.coverage.tag_ids} |
| reviewed artist_ids | ${report.coverage.reviewed_artist_ids} |

## 画家关系修复

${Object.entries(report.repair_counts)
  .map(([key, value]) => `- ${key}: ${value}`)
  .join("\n")}

| 旧引用 | 规范引用 | 作品数 | 关系状态 |
|---|---|---:|---|
${report.artist_reference_repair_summary
  .slice(0, 30)
  .map(
    (row) =>
      `| ${row.source_artist_id || "仅原始文本"} | ${row.target_artist_id} | ${row.artwork_count} | ${row.review_status} |`,
  )
  .join("\n")}

国家画派、匿名和未决作者不会冒充具体人物：它们只生成 candidate 归属关系，不进入公开 \`artist_ids\`。

## 待审核项

- 画家引用：${report.proposed_counts.artist_review_queue}
- 推荐信号候选旧标签：${report.proposed_counts.tag_review_queue}
- 使用 draft 词条的关系：${report.proposed_counts.draft_term_links} 条，影响 ${report.proposed_counts.artworks_with_draft_terms} 件作品
- 画家姓名旧标签已转入画家维度：${report.proposed_counts.ignored_artist_tags}

## 发布门槛

${
  report.validation.production_blockers.length
    ? report.validation.production_blockers.map((item) => `- ${item}`).join("\n")
    : "- 无阻断项"
}

本目录同时包含完整拟迁移记录、关系表、审核队列与原始字段/关系表回滚快照。审核通过前不得执行生产写入。
`;
}

export async function runBuild({
  envId = process.env.CLOUDBASE_ENV_ID || DEFAULT_ENV_ID,
  vocabularyPath = DEFAULT_VOCAB_PATH,
  outputDir = DEFAULT_OUTPUT_DIR,
  batchId = `classification-v6-${new Date().toISOString().slice(0, 10)}`,
  generatedAt = new Date().toISOString(),
  dataProvider = loadCloudData,
} = {}) {
  const vocabulary = JSON.parse(fs.readFileSync(vocabularyPath, "utf8"));
  const data = await dataProvider({ envId });
  const migration = buildClassificationV6Migration({
    ...data,
    terms: vocabulary.terms,
    batchId,
    updatedAt: generatedAt,
  });
  const report = buildReport({
    migration,
    envId,
    generatedAt,
    data,
  });

  fs.mkdirSync(outputDir, { recursive: true });
  writeJsonl(
    path.join(outputDir, "classification-v6-artworks.jsonl"),
    migration.artworkAssignments,
  );
  writeJsonl(
    path.join(outputDir, "classification-v6-artwork-tag-links.jsonl"),
    migration.artworkTagLinks,
  );
  writeJsonl(
    path.join(outputDir, "classification-v6-artwork-artist-links.jsonl"),
    migration.artworkArtistLinks,
  );
  writeJsonl(
    path.join(outputDir, "classification-v6-attribution-candidates.jsonl"),
    migration.attributionCandidates,
  );
  writeJsonl(
    path.join(outputDir, "classification-v6-tag-review-queue.jsonl"),
    migration.tagReviewQueue,
  );
  writeJsonl(
    path.join(outputDir, "classification-v6-artist-review-queue.jsonl"),
    migration.artistReviewQueue,
  );
  writeJsonl(path.join(outputDir, "rollback-artworks.jsonl"), migration.rollback.artworks);
  writeJsonl(
    path.join(outputDir, "rollback-artwork-tag-links.jsonl"),
    migration.rollback.artworkTagLinks,
  );
  writeJsonl(
    path.join(outputDir, "rollback-artwork-artist-links.jsonl"),
    migration.rollback.artworkArtistLinks,
  );
  writeCsv(path.join(outputDir, "tag-review-queue.csv"), migration.tagReviewQueue);
  writeCsv(
    path.join(outputDir, "tag-review-summary.csv"),
    buildTagReviewSummary(migration.tagReviewQueue),
  );
  writeCsv(path.join(outputDir, "artist-review-queue.csv"), migration.artistReviewQueue);
  writeCsv(
    path.join(outputDir, "artist-reference-repairs.csv"),
    buildArtistRepairSummary(migration.artworkArtistLinks),
  );
  writeCsv(path.join(outputDir, "ignored-artist-tags.csv"), migration.ignoredArtistTags);
  writeJson(path.join(outputDir, "task-03-report.json"), report);
  fs.writeFileSync(path.join(outputDir, "task-03-report.md"), buildMarkdown(report), "utf8");

  return { outputDir, report, migration };
}

const isMain =
  process.argv[1] &&
  path.basename(path.resolve(process.argv[1])) === path.basename(fileURLToPath(import.meta.url));

if (isMain) {
  runBuild()
    .then(({ outputDir, report }) => {
      console.log(`classification-v6 dry-run written to ${outputDir}`);
      console.log(JSON.stringify(report, null, 2));
      if (!report.validation.integrity_ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
