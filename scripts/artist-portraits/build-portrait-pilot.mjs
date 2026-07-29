#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  atomicWrite,
  buildCommonsCandidate,
  csvText,
  jsonlText,
  readJsonl,
  stringValue,
} from "./portrait-candidate-lib.mjs";
import { fetchCommonsPages, fetchWikidataEntities } from "./fetch-portrait-candidates.mjs";

const DEFAULT_SCOPE_DIR = path.resolve("outputs", "artist-portraits", "20260726T064155Z");
const DEFAULT_CANDIDATE_DIR = path.resolve("outputs", "artist-portraits", "20260726T064155Z-task3");
const DEFAULT_OUTPUT_DIR = path.resolve(
  "outputs",
  "artist-portraits",
  "20260726T064155Z-task4-pilot",
);
const DEFAULT_CONFIG = path.resolve("scripts", "artist-portraits", "pilot-20.json");

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(argv = []) {
  const options = {
    scopeDir: DEFAULT_SCOPE_DIR,
    candidateDir: DEFAULT_CANDIDATE_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    config: DEFAULT_CONFIG,
    cacheDir: path.resolve("outputs", "artist-portraits", ".cache"),
    requestDelayMs: 150,
    offline: false,
    skipDownloads: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--scope-dir") options.scopeDir = path.resolve(required(argv, ++index, arg));
    else if (arg === "--candidate-dir") {
      options.candidateDir = path.resolve(required(argv, ++index, arg));
    } else if (arg === "--output-dir") {
      options.outputDir = path.resolve(required(argv, ++index, arg));
    } else if (arg === "--config") options.config = path.resolve(required(argv, ++index, arg));
    else if (arg === "--cache-dir") options.cacheDir = path.resolve(required(argv, ++index, arg));
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--skip-downloads") options.skipDownloads = true;
    else if (arg === "--request-delay-ms") {
      options.requestDelayMs = Number(required(argv, ++index, arg));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/artist-portraits/build-portrait-pilot.mjs [options]

Builds the fixed 20-artist pilot workspace and downloads preview derivatives only.
It never uploads files or writes production data.
`;
}

function syntheticP18Entity(qid, fileName) {
  return {
    id: qid,
    claims: {
      P18: [
        {
          rank: "normal",
          mainsnak: { datavalue: { value: fileName } },
        },
      ],
    },
  };
}

export function buildSupplementalCandidate(artist, supplemental, page) {
  const candidate = buildCommonsCandidate({
    artist,
    entity: syntheticP18Entity(artist.wikidata_qid, supplemental.file_name),
    fileName: supplemental.file_name,
    commonsPage: page,
    apiError: page ? "" : "commons_metadata_missing",
  });
  const hasDocumentedRepresentativeAssociation = Boolean(
    supplemental.identity_source_url && supplemental.identity_note && candidate.source_page_url,
  );
  const rejectionReasons = candidate.automated_assessment.rejection_reasons.filter(
    (reason) => !(reason === "identity_evidence_missing" && hasDocumentedRepresentativeAssociation),
  );
  const automatedAssessment = {
    ...candidate.automated_assessment,
    status: rejectionReasons.length ? "auto_rejected" : "eligible_for_manual_review",
    eligible_for_manual_review: rejectionReasons.length === 0,
    rejection_reasons: rejectionReasons,
    checks: {
      ...candidate.automated_assessment.checks,
      identity: hasDocumentedRepresentativeAssociation
        ? "pass_representative_association"
        : candidate.automated_assessment.checks.identity,
    },
  };
  return {
    ...candidate,
    candidate_id: `${artist.artist_id}--commons-manual-${candidate.candidate_id.split("-").at(-1)}`,
    candidate_reason: "targeted_manual_commons_search",
    rank_score: 295 + (automatedAssessment.eligible_for_manual_review ? 50 : 0),
    automated_assessment: automatedAssessment,
    identity_evidence: {
      type: "commons_description_and_institution_record",
      artist_id: artist.artist_id,
      wikidata_qid: artist.wikidata_qid,
      commons_file_name: supplemental.file_name,
      commons_description_url: candidate.source_page_url,
      institution_source_url: supplemental.identity_source_url,
      note: supplemental.identity_note,
    },
  };
}

function safeName(value) {
  return stringValue(value)
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .slice(0, 140);
}

async function requestBuffer(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "ArtArchivePortraitPilot/1.0 (visual review preview)",
        },
      });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        error.retryAfterMs = Number(response.headers.get("retry-after") || 0) * 1000;
        throw error;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        const delay =
          error.status === 429 ? Math.max(error.retryAfterMs || 0, attempt * 3000) : attempt * 750;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

function reviewPreviewUrl(candidate) {
  const original = stringValue(candidate.original_download_url);
  const preview = stringValue(candidate.preview_url);
  if (!/upload\.wikimedia\.org/iu.test(original || preview)) return preview || original;
  try {
    const url = new URL(preview || original);
    if (/\/thumb\//u.test(url.pathname)) {
      url.pathname = url.pathname.replace(/\/\d+px-([^/]+)$/u, "/500px-$1");
      return url.toString();
    }
    const originalUrl = new URL(original || preview);
    const parts = originalUrl.pathname.split("/");
    const fileName = parts.at(-1);
    originalUrl.pathname = originalUrl.pathname
      .replace("/wikipedia/commons/", "/wikipedia/commons/thumb/")
      .concat(`/500px-${fileName}`);
    return originalUrl.toString();
  } catch {
    return preview || original;
  }
}

async function writePreview(candidate, outputDir) {
  const url = reviewPreviewUrl(candidate);
  if (!url) return { error: "preview_url_missing" };
  const relativePath = path.join("previews", `${safeName(candidate.candidate_id)}.webp`);
  const filePath = path.join(outputDir, relativePath);
  if (fs.existsSync(filePath)) return { relativePath: relativePath.replace(/\\/gu, "/") };
  try {
    const buffer = await requestBuffer(url);
    const image = sharp(buffer, { failOn: "warning" });
    const metadata = await image.metadata();
    const normalized = await image
      .rotate()
      .resize({ width: 960, height: 960, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, normalized);
    return {
      relativePath: relativePath.replace(/\\/gu, "/"),
      sourceWidth: metadata.width || 0,
      sourceHeight: metadata.height || 0,
    };
  } catch (error) {
    return { error: error.message };
  }
}

function escapeHtml(value) {
  return stringValue(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

export function buildPilotHtml(records, candidates) {
  const candidatesByArtist = new Map();
  for (const candidate of candidates) {
    const values = candidatesByArtist.get(candidate.artist_id) || [];
    values.push(candidate);
    candidatesByArtist.set(candidate.artist_id, values);
  }
  const sections = records
    .map((record, artistIndex) => {
      const values = candidatesByArtist.get(record.artist_id) || [];
      const cards = values
        .map((candidate) => {
          const image = candidate.local_preview_path
            ? `<img src="${escapeHtml(candidate.local_preview_path)}" alt="">`
            : "<span>无预览</span>";
          return `<article class="candidate">
  <div class="views">
    <div class="original">${image}</div>
    <div class="detail">${image}</div>
    <div class="list">${image}</div>
  </div>
  <p><b>${escapeHtml(candidate.candidate_origin)}</b> · ${escapeHtml(candidate.automated_assessment?.status)}</p>
  <p>${escapeHtml(candidate.candidate_id)}</p>
  <p>${escapeHtml(candidate.license_name || candidate.rights_status)} · ${Number(candidate.width || 0)}×${Number(candidate.height || 0)}</p>
  <p>${escapeHtml((candidate.automated_assessment?.rejection_reasons || []).join("、"))}</p>
</article>`;
        })
        .join("");
      return `<section>
  <h2>${artistIndex + 1}. ${escapeHtml(record.name_zh)} <small>${escapeHtml(record.name_en)}</small></h2>
  <p>${escapeHtml(record.cohort)} · ${escapeHtml(record.case)} · ${escapeHtml(record.entity_type)}</p>
  <div class="candidates">${cards || '<p class="empty">无人物候选，验证文字头像回退。</p>'}</div>
</section>`;
    })
    .join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>首批 20 位画家肖像视觉审核</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:24px;background:#f4f1ec;color:#292522}
main{max-width:1400px;margin:auto}section{background:#fff;border:1px solid #ddd5ca;border-radius:18px;padding:18px;margin:0 0 18px}
h1,h2,p{margin-top:0}h2 small{font-size:14px;font-weight:400;color:#746a63}.candidates{display:flex;gap:16px;flex-wrap:wrap}.candidate{width:310px;border:1px solid #e5dfd8;border-radius:12px;padding:12px}.candidate p{font-size:12px;overflow-wrap:anywhere}.views{display:flex;align-items:flex-end;gap:10px;height:190px}.views div{background:#e8e3dc;overflow:hidden;display:grid;place-items:center}.views img{width:100%;height:100%;object-fit:cover;object-position:50% 38%}.original{width:120px;height:180px;border-radius:8px}.detail{width:120px;height:120px;border-radius:50%}.list{width:56px;height:56px;border-radius:50%}.empty{color:#895c47}
</style></head>
<body><main><h1>首批 20 位画家肖像视觉审核</h1><p>左：原始纵向预览；中：详情尺寸圆形裁切；右：列表尺寸圆形裁切。</p>${sections}</main></body>
</html>`;
}

function svgText(value) {
  return escapeHtml(value).replace(/&quot;/gu, "&#34;");
}

async function circularPreview(filePath, size) {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`,
  );
  return sharp(filePath)
    .rotate()
    .resize({ width: size, height: size, fit: "cover", position: "attention" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

export async function buildVisualSheets(records, candidates, outputDir) {
  const artistById = new Map(
    records.map((record, index) => [record.artist_id, { ...record, pilot_index: index + 1 }]),
  );
  const visualCandidates = candidates
    .filter((candidate) => candidate.local_preview_path)
    .map((candidate) => ({
      ...candidate,
      artist: artistById.get(candidate.artist_id),
    }));
  const pageSize = 16;
  const columns = 4;
  const tileWidth = 280;
  const tileHeight = 300;
  const pages = [];
  for (let start = 0; start < visualCandidates.length; start += pageSize) {
    const rows = visualCandidates.slice(start, start + pageSize);
    const height = Math.ceil(rows.length / columns) * tileHeight;
    const canvas = sharp({
      create: {
        width: columns * tileWidth,
        height,
        channels: 4,
        background: "#f4f1ec",
      },
    });
    const composites = [];
    for (let index = 0; index < rows.length; index += 1) {
      const candidate = rows[index];
      const x = (index % columns) * tileWidth;
      const y = Math.floor(index / columns) * tileHeight;
      const filePath = path.join(outputDir, candidate.local_preview_path);
      const original = await sharp(filePath)
        .rotate()
        .resize({ width: 104, height: 176, fit: "contain", background: "#e7e1d9" })
        .png()
        .toBuffer();
      const detail = await circularPreview(filePath, 120);
      const list = await circularPreview(filePath, 56);
      const eligible = candidate.automated_assessment?.eligible_for_manual_review;
      const label = Buffer.from(`<svg width="${tileWidth}" height="110">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="12" y="23" font-family="Microsoft YaHei, sans-serif" font-size="15" font-weight="700" fill="#292522">${svgText(`${candidate.artist?.pilot_index || "?"}. ${candidate.name_zh}`)}</text>
<text x="12" y="44" font-family="Segoe UI, sans-serif" font-size="11" fill="#6f655e">${svgText(candidate.candidate_origin)} · ${svgText(candidate.review_rank || "补充")}</text>
<text x="12" y="64" font-family="Segoe UI, sans-serif" font-size="11" fill="${eligible ? "#27633a" : "#9a352d"}">${svgText(candidate.automated_assessment?.status)}</text>
<text x="12" y="83" font-family="Segoe UI, sans-serif" font-size="10" fill="#6f655e">${svgText(`${candidate.width || 0}×${candidate.height || 0} · ${candidate.license_name || candidate.rights_status}`)}</text>
<text x="12" y="101" font-family="Segoe UI, sans-serif" font-size="9" fill="#857971">${svgText(candidate.candidate_id.slice(0, 46))}</text>
</svg>`);
      composites.push(
        { input: original, left: x + 12, top: y + 10 },
        { input: detail, left: x + 138, top: y + 10 },
        { input: list, left: x + 170, top: y + 142 },
        { input: label, left: x, top: y + 190 },
      );
    }
    const name = `pilot-visual-sheet-${String(pages.length + 1).padStart(2, "0")}.png`;
    await canvas.composite(composites).png().toFile(path.join(outputDir, name));
    pages.push(name);
  }
  return pages;
}

const REVIEW_COLUMNS = [
  "artist_id",
  "name_zh",
  "name_en",
  "cohort",
  "case",
  "entity_type",
  "identity_status",
  "selected_candidate_id",
  "alternate_candidate_id",
  "final_status",
  "portrait_kind",
  "identity_review",
  "content_review",
  "relationship_review",
  "rights_review",
  "quality_review",
  "style_review",
  "portrait_source_url",
  "portrait_license",
  "portrait_license_url",
  "portrait_credit",
  "rejection_reasons",
  "review_notes",
];

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return null;
  }
  const config = JSON.parse(fs.readFileSync(options.config, "utf8"));
  const scope = JSON.parse(fs.readFileSync(path.join(options.scopeDir, "scope.json"), "utf8"));
  const task3Candidates = readJsonl(path.join(options.candidateDir, "portrait-candidates.jsonl"));
  const scopeById = new Map(scope.queue.map((artist) => [artist.artist_id, artist]));
  const selectedIds = new Set(config.artists.map((record) => record.artist_id));
  const missing = [...selectedIds].filter((artistId) => !scopeById.has(artistId));
  if (missing.length) throw new Error(`Pilot artists missing from scope: ${missing.join(", ")}`);

  const pilotArtists = config.artists.map((selection) => ({
    ...scopeById.get(selection.artist_id),
    ...selection,
  }));
  const candidateRows = task3Candidates.filter((candidate) => selectedIds.has(candidate.artist_id));
  const supplementalNames = config.supplemental_commons_candidates.map((item) => item.file_name);
  const commons = await fetchCommonsPages(supplementalNames, options);
  const qids = config.supplemental_commons_candidates
    .map((item) => scopeById.get(item.artist_id)?.wikidata_qid)
    .filter(Boolean);
  await fetchWikidataEntities(qids, options);
  for (const supplemental of config.supplemental_commons_candidates) {
    const artist = scopeById.get(supplemental.artist_id);
    const page = commons.pages.get(supplemental.file_name);
    candidateRows.push(buildSupplementalCandidate(artist, supplemental, page));
  }

  const previewFailures = [];
  for (const candidate of candidateRows) {
    const existingRelativePath = path.join("previews", `${safeName(candidate.candidate_id)}.webp`);
    if (fs.existsSync(path.join(options.outputDir, existingRelativePath))) {
      candidate.local_preview_path = existingRelativePath.replace(/\\/gu, "/");
      continue;
    }
    if (!options.skipDownloads) {
      const preview = await writePreview(candidate, options.outputDir);
      if (preview.error) {
        previewFailures.push({
          candidate_id: candidate.candidate_id,
          error: preview.error,
        });
      } else {
        candidate.local_preview_path = preview.relativePath;
      }
      await new Promise((resolve) => setTimeout(resolve, options.requestDelayMs));
    }
  }
  const reviewRecords = pilotArtists.map((artist) => ({
    artist_id: artist.artist_id,
    name_zh: artist.name_zh,
    name_en: artist.name_en,
    cohort: artist.cohort,
    case: artist.case,
    entity_type: artist.entity_type,
    identity_status: artist.identity_status,
    selected_candidate_id: "",
    alternate_candidate_id: "",
    final_status: "pending_manual_review",
    portrait_kind: "",
    identity_review: "",
    content_review: "",
    relationship_review: "",
    rights_review: "",
    quality_review: "",
    style_review: "",
    portrait_source_url: "",
    portrait_license: "",
    portrait_license_url: "",
    portrait_credit: "",
    rejection_reasons: [],
    review_notes: "",
  }));

  fs.mkdirSync(options.outputDir, { recursive: true });
  atomicWrite(
    path.join(options.outputDir, "pilot-scope.json"),
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        pilot_id: config.pilot_id,
        read_only: true,
        production_writes: 0,
        selection_rule: config.selection_rule,
        artists: pilotArtists,
      },
      null,
      2,
    )}\n`,
  );
  atomicWrite(path.join(options.outputDir, "pilot-candidates.jsonl"), jsonlText(candidateRows));
  atomicWrite(path.join(options.outputDir, "pilot-review.jsonl"), jsonlText(reviewRecords));
  atomicWrite(
    path.join(options.outputDir, "pilot-review.csv"),
    csvText(reviewRecords, REVIEW_COLUMNS),
  );
  atomicWrite(
    path.join(options.outputDir, "pilot-visual-review.html"),
    buildPilotHtml(reviewRecords, candidateRows),
  );
  atomicWrite(
    path.join(options.outputDir, "pilot-preview-failures.jsonl"),
    jsonlText(previewFailures),
  );
  const visualSheets = await buildVisualSheets(reviewRecords, candidateRows, options.outputDir);
  console.log(
    JSON.stringify(
      {
        output_dir: options.outputDir,
        artists: pilotArtists.length,
        natural_people: pilotArtists.filter((artist) => artist.entity_type === "person").length,
        boundary_records: pilotArtists.filter((artist) => artist.entity_type !== "person").length,
        candidates: candidateRows.length,
        supplemental_candidates: config.supplemental_commons_candidates.length,
        preview_failures: previewFailures.length,
        visual_sheets: visualSheets,
        production_writes: 0,
      },
      null,
      2,
    ),
  );
  return { pilotArtists, candidateRows, reviewRecords, previewFailures };
}

const isMain =
  process.argv[1] &&
  path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
