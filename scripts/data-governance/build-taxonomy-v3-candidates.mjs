#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeTaxonomy, buildPilot } from "./taxonomy-v3.mjs";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "outputs", "taxonomy-v3");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

function env() {
  return { ...parseEnvFile(".env"), ...parseEnvFile(".env.local"), ...process.env };
}

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function positiveInteger(value, flag) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${flag} must be positive.`);
  return number;
}

export function parseArgs(argv = []) {
  const options = {
    envId: process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID || DEFAULT_ENV_ID,
    artworksCollection: "artworks",
    artistsCollection: "artists",
    outputDir: DEFAULT_OUTPUT_DIR,
    pilotPerCohort: 100,
    minStyleCount: 3,
    minSubjectCount: 5,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--env-id") options.envId = required(argv, (index += 1), arg);
    else if (arg === "--artworks") options.artworksCollection = required(argv, (index += 1), arg);
    else if (arg === "--artists") options.artistsCollection = required(argv, (index += 1), arg);
    else if (arg === "--output-dir")
      options.outputDir = path.resolve(required(argv, (index += 1), arg));
    else if (arg === "--pilot-per-cohort") {
      options.pilotPerCohort = positiveInteger(required(argv, (index += 1), arg), arg);
    } else if (arg === "--min-style-count") {
      options.minStyleCount = positiveInteger(required(argv, (index += 1), arg), arg);
    } else if (arg === "--min-subject-count") {
      options.minSubjectCount = positiveInteger(required(argv, (index += 1), arg), arg);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/data-governance/build-taxonomy-v3-candidates.mjs [options]

Read-only classification-v3 candidate analysis. This script never updates CloudBase.
`;
}

function createClient(options, config) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error("Missing Tencent Cloud credentials.");
  return CloudBase.init({ envId: options.envId, secretId, secretKey });
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

async function queryCollection(database, collection, projection) {
  const rows = [];
  const pageSize = 1000;
  for (let skip = 0; ; skip += pageSize) {
    const result = await database.runCommands({
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
    const batch = parseCommandRows(result.Data?.[0]);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function markdownSummary(report, pilot) {
  const lines = [
    "# classification-v3 候选报告",
    "",
    `- 生成时间：${report.generated_at}`,
    `- 生产作品：${report.summary.artworks}`,
    `- 当前受控标签：${report.summary.current_terms}`,
    `- 建议直接新增标签：${report.summary.recommended_new_terms}`,
    `- 建议 v3 标签总数：${report.summary.recommended_total_terms}`,
    `- 仍需人工决定的候选：${report.summary.review_candidate_terms}`,
    `- 同义词合并组：${report.summary.alias_merge_groups}`,
    `- 排除噪声种类：${report.summary.excluded_signal_count}`,
    `- 仍需审核文本：${report.summary.review_signal_count}`,
    `- 试分类：${pilot.checks.total} 件`,
    `- 试分类未匹配画家：${pilot.checks.rows_without_artist_match} 件`,
    `- 试分类无任何分类：${pilot.checks.rows_without_any_classification} 件`,
    "",
    "## 建议直接新增标签",
    "",
    "| 维度 | ID | 标签 | 作品数 | 状态 |",
    "| --- | --- | --- | ---: | --- |",
    ...report.proposed_new_terms
      .filter((term) => term.status === "new_candidate")
      .map(
        (term) =>
          `| ${term.dimension} | ${term.id} | ${term.label} | ${term.count} | ${term.status} |`,
      ),
    "",
    "## 待人工决定的标签",
    "",
    "| 维度 | 临时候选 ID | 标签 | 作品数 |",
    "| --- | --- | --- | ---: |",
    ...report.proposed_new_terms
      .filter((term) => term.status === "review_candidate")
      .map((term) => `| ${term.dimension} | ${term.id} | ${term.label} | ${term.count} |`),
    "",
    "## 高频待审核文本（前 50）",
    "",
    "| 文本 | 作品数 |",
    "| --- | ---: |",
    ...report.review_signals
      .slice(0, 50)
      .map((entry) => `| ${entry.label.replace(/\|/g, "\\|")} | ${entry.count} |`),
  ];
  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const app = createClient(options, env());
  const [artworks, artists] = await Promise.all([
    queryCollection(app.database, options.artworksCollection, {
      _id: 1,
      title: 1,
      title_cn: 1,
      title_zh: 1,
      title_en: 1,
      artist: 1,
      artist_display: 1,
      raw_artist_text: 1,
      artist_labels: 1,
      artist_ids: 1,
      primary_artist_id: 1,
      classification_ids: 1,
      tag_ids: 1,
      tag_keys: 1,
      tags: 1,
      tag_labels: 1,
      tags_text: 1,
      subject: 1,
      genre: 1,
      style: 1,
      medium: 1,
      medium_text: 1,
      year: 1,
      creation_year: 1,
      created_year: 1,
      creation_date: 1,
      date: 1,
      period: 1,
      year_and_place: 1,
    }),
    queryCollection(app.database, options.artistsCollection, {
      _id: 1,
      id: 1,
      name_zh: 1,
      nameZh: 1,
      name_en: 1,
      nameEn: 1,
      aliases: 1,
      style_ids: 1,
    }),
  ]);
  const artistLabels = artists.flatMap((artist) => [
    artist.name_zh,
    artist.nameZh,
    artist.name_en,
    artist.nameEn,
    ...(Array.isArray(artist.aliases) ? artist.aliases : []),
  ]);
  const analysis = analyzeTaxonomy(artworks, { ...options, artistLabels });
  const pilot = buildPilot(artworks, artists, analysis, options.pilotPerCohort);
  const generatedAt = new Date().toISOString();
  const report = {
    generated_at: generatedAt,
    dry_run: true,
    env_id: options.envId,
    collections: {
      artworks: options.artworksCollection,
      artists: options.artistsCollection,
    },
    policy: {
      dimensions: ["style", "subject", "decade"],
      min_style_count: options.minStyleCount,
      min_subject_count: options.minSubjectCount,
      original_fields_preserved: true,
      production_writes: false,
    },
    ...analysis,
    artwork_suggestions: undefined,
  };
  const acceptedNewTerms = report.proposed_new_terms.filter(
    (term) => term.status === "new_candidate",
  );
  const draftCatalog = {
    version: "classification-v3-draft",
    based_on: report.current_version,
    generated_at: generatedAt,
    status: "review",
    terms: [
      ...report.current_terms.map((term) => ({
        id: term.id,
        dimension: term.dimension,
        label: term.label,
        status: "retain",
        current_usage: term.current_usage,
        raw_support: term.raw_support,
      })),
      ...acceptedNewTerms.map((term) => ({
        id: term.id,
        dimension: term.dimension,
        label: term.label,
        status: "new_candidate",
        count: term.count,
        aliases: term.aliases,
      })),
    ],
    review_candidates: report.proposed_new_terms.filter(
      (term) => term.status === "review_candidate",
    ),
    summary: {
      retained: report.current_terms.length,
      new_candidates: acceptedNewTerms.length,
      total: report.current_terms.length + acceptedNewTerms.length,
      review_candidates: report.summary.review_candidate_terms,
    },
  };
  fs.mkdirSync(options.outputDir, { recursive: true });
  const suffix = timestamp();
  const reportPath = path.join(options.outputDir, `taxonomy-v3-candidates-${suffix}.json`);
  const pilotPath = path.join(options.outputDir, `taxonomy-v3-pilot-200-${suffix}.json`);
  const markdownPath = path.join(options.outputDir, `taxonomy-v3-summary-${suffix}.md`);
  const catalogPath = path.join(options.outputDir, `taxonomy-v3-draft-catalog-${suffix}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(pilotPath, `${JSON.stringify(pilot, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, markdownSummary(report, pilot), "utf8");
  fs.writeFileSync(catalogPath, `${JSON.stringify(draftCatalog, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        report: reportPath,
        pilot: pilotPath,
        summary: markdownPath,
        catalog: catalogPath,
        ...report.summary,
        pilot_checks: pilot.checks,
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
