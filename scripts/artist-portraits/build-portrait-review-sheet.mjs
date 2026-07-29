#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, csvText, readJsonl, stringValue } from "./portrait-candidate-lib.mjs";

const REVIEW_COLUMNS = [
  "artist_id",
  "name_zh",
  "name_en",
  "target_priority",
  "review_rank",
  "candidate_id",
  "candidate_origin",
  "automated_status",
  "automatic_rejection_reasons",
  "candidate_reason",
  "candidate_confidence",
  "artwork_id",
  "wikidata_qid",
  "commons_file_name",
  "source_page_url",
  "original_download_url",
  "preview_url",
  "author",
  "license_name",
  "license_url",
  "credit",
  "width",
  "height",
  "mime",
  "sha1",
  "reviewer_decision",
  "reviewer_notes",
];

const SEARCH_COLUMNS = [
  "artist_id",
  "name_zh",
  "name_en",
  "birth_year",
  "death_year",
  "wikidata_qid",
  "reason",
  "queries",
  "directed_sources",
  "review_status",
];

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(argv = []) {
  const options = {
    inputDir: path.resolve("outputs", "artist-portraits", "20260726T064155Z-task3"),
    outputDir: "",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--input-dir") options.inputDir = path.resolve(required(argv, ++index, arg));
    else if (arg === "--output-dir") options.outputDir = path.resolve(required(argv, ++index, arg));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.outputDir) options.outputDir = options.inputDir;
  return options;
}

function usage() {
  return `Usage:
  node scripts/artist-portraits/build-portrait-review-sheet.mjs \
    --input-dir outputs/artist-portraits/20260726T064155Z-task3

Builds a review CSV, manual-search CSV, and local HTML contact sheet.
`;
}

function reviewRow(candidate) {
  return {
    ...candidate,
    automated_status: stringValue(candidate.automated_assessment?.status),
    automatic_rejection_reasons: candidate.automated_assessment?.rejection_reasons || [],
  };
}

function escapeHtml(value) {
  return stringValue(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function safeHttpUrl(value) {
  const text = stringValue(value);
  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

export function buildContactSheet(candidates) {
  const cards = candidates
    .map((candidate) => {
      const preview = safeHttpUrl(candidate.preview_url);
      const source = safeHttpUrl(candidate.source_page_url);
      const license = safeHttpUrl(candidate.license_url);
      const assessment = candidate.automated_assessment || {};
      return `<article class="card" data-artist="${escapeHtml(candidate.artist_id)}">
  <div class="image">${
    preview
      ? `<img src="${escapeHtml(preview)}" alt="${escapeHtml(candidate.name_zh || candidate.name_en)}" loading="lazy">`
      : "<span>无预览</span>"
  }</div>
  <div class="body">
    <div class="rank">#${Number(candidate.review_rank || 0)} · ${escapeHtml(candidate.candidate_origin)}</div>
    <h2>${escapeHtml(candidate.name_zh)} <small>${escapeHtml(candidate.name_en)}</small></h2>
    <p class="status ${assessment.eligible_for_manual_review ? "eligible" : "rejected"}">${escapeHtml(assessment.status)}</p>
    <dl>
      <dt>候选 ID</dt><dd>${escapeHtml(candidate.candidate_id)}</dd>
      <dt>来源</dt><dd>${source ? `<a href="${escapeHtml(source)}">${escapeHtml(candidate.source_name || "说明页")}</a>` : "缺少来源说明页"}</dd>
      <dt>许可</dt><dd>${license ? `<a href="${escapeHtml(license)}">${escapeHtml(candidate.license_name)}</a>` : escapeHtml(candidate.license_name || "未知")}</dd>
      <dt>作者/署名</dt><dd>${escapeHtml(candidate.credit || candidate.author || "待核验")}</dd>
      <dt>尺寸</dt><dd>${Number(candidate.width || 0)} × ${Number(candidate.height || 0)} · ${escapeHtml(candidate.mime)}</dd>
      <dt>自动问题</dt><dd>${escapeHtml((assessment.rejection_reasons || []).join("、") || "无；仍需人工审核")}</dd>
    </dl>
  </div>
</article>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>画家肖像候选联系表</title>
  <style>
    :root{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#2c2927;background:#f5f2ed}
    body{margin:0;padding:24px}.header{max-width:1200px;margin:0 auto 20px}.grid{max-width:1200px;margin:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px}
    .card{background:white;border:1px solid #ded8cf;border-radius:16px;overflow:hidden;box-shadow:0 3px 12px #4b3b2910}.image{aspect-ratio:1;background:#ebe6df;display:grid;place-items:center;color:#776d65}.image img{width:100%;height:100%;object-fit:cover}
    .body{padding:14px}.rank{font-size:12px;color:#836954}h2{font-size:18px;margin:7px 0}h2 small{display:block;font-size:13px;font-weight:400;color:#746d67}.status{display:inline-block;padding:4px 8px;border-radius:999px;font-size:12px}.eligible{background:#e4f4e8;color:#27633a}.rejected{background:#f8e4e1;color:#8b3028}
    dl{display:grid;grid-template-columns:76px 1fr;gap:7px;font-size:12px;line-height:1.45}dt{color:#766b62}dd{margin:0;overflow-wrap:anywhere}a{color:#7c5136}
  </style>
</head>
<body>
  <header class="header"><h1>画家肖像候选联系表</h1><p>仅用于审核。所有候选都必须经过身份、版权、构图与清晰度人工复核后才能上线。</p></header>
  <main class="grid">${cards}</main>
</body>
</html>
`;
}

export function buildReviewArtifacts(candidates, manualSearch) {
  const reviewRows = candidates.map(reviewRow);
  return new Map([
    ["portrait-review-sheet.csv", csvText(reviewRows, REVIEW_COLUMNS)],
    ["portrait-manual-search.csv", csvText(manualSearch, SEARCH_COLUMNS)],
    ["portrait-candidate-contact-sheet.html", buildContactSheet(candidates)],
  ]);
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return null;
  }
  const candidatesPath = path.join(options.inputDir, "portrait-candidates.jsonl");
  const manualSearchPath = path.join(options.inputDir, "portrait-manual-search.jsonl");
  if (!fs.existsSync(candidatesPath)) {
    throw new Error(`Candidate input is missing: ${candidatesPath}`);
  }
  const candidates = readJsonl(candidatesPath);
  const manualSearch = readJsonl(manualSearchPath);
  const artifacts = buildReviewArtifacts(candidates, manualSearch);
  for (const [name, content] of artifacts) {
    atomicWrite(path.join(options.outputDir, name), content);
  }
  console.log(
    JSON.stringify(
      {
        output_dir: options.outputDir,
        candidate_rows: candidates.length,
        manual_search_rows: manualSearch.length,
        files: [...artifacts.keys()],
      },
      null,
      2,
    ),
  );
  return { candidates, manualSearch, artifacts };
}

const isMain =
  process.argv[1] &&
  path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
