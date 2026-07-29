#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  atomicWrite,
  csvText,
  jsonlText,
  readJsonl,
  stringValue,
} from "./portrait-candidate-lib.mjs";

const DEFAULT_INPUT_DIR = path.resolve(
  "outputs",
  "artist-portraits",
  "20260726T064155Z-task4-pilot",
);
const DEFAULT_DECISIONS = path.resolve("scripts", "artist-portraits", "pilot-20-decisions.json");

const REVIEW_COLUMNS = [
  "artist_id",
  "name_zh",
  "name_en",
  "cohort",
  "case",
  "entity_type",
  "selected_candidate_id",
  "alternate_candidate_id",
  "final_status",
  "portrait_kind",
  "portrait_artwork_id",
  "representation_review",
  "identity_review",
  "content_review",
  "relationship_review",
  "rights_review",
  "quality_review",
  "style_review",
  "crop_focus_x",
  "crop_focus_y",
  "crop_zoom",
  "portrait_source_url",
  "portrait_license",
  "portrait_license_url",
  "portrait_credit",
  "representation_evidence_urls",
  "identity_evidence_urls",
  "rejection_reasons",
  "review_notes",
];

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(argv = []) {
  const options = {
    inputDir: DEFAULT_INPUT_DIR,
    decisions: DEFAULT_DECISIONS,
    expectedCount: 20,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--input-dir") options.inputDir = path.resolve(required(argv, ++index, arg));
    else if (arg === "--decisions") options.decisions = path.resolve(required(argv, ++index, arg));
    else if (arg === "--expected-count") {
      options.expectedCount = Number(required(argv, ++index, arg));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isSafeInteger(options.expectedCount) || options.expectedCount < 1) {
    throw new Error("--expected-count must be a positive integer.");
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/artist-portraits/finalize-portrait-pilot.mjs

Applies reviewed decisions, builds decision-aware crop previews, and audits all 20 records.
No image upload or production write is performed.
`;
}

function escapeHtml(value) {
  return stringValue(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function resolveLicense(candidate, decision) {
  const fallback =
    stringValue(candidate?.license_name) ||
    (/public domain/iu.test(candidate?.rights_status || "") ? "Public domain" : "");
  return stringValue(decision.license_override || fallback);
}

function resolveLicenseUrl(candidate, decision) {
  return stringValue(
    decision.license_url_override || candidate?.license_url || candidate?.source_page_url,
  );
}

function resolveCredit(candidate, decision) {
  return stringValue(decision.credit_override || candidate?.credit || candidate?.author);
}

export function mergeReviewRecords(scopeArtists, candidates, decisionFile) {
  const scopeById = new Map(scopeArtists.map((artist) => [artist.artist_id, artist]));
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  return decisionFile.decisions.map((decision) => {
    const artist = scopeById.get(decision.artist_id);
    if (!artist) throw new Error(`Decision artist missing from pilot scope: ${decision.artist_id}`);
    const selected = decision.selected_candidate_id
      ? candidateById.get(decision.selected_candidate_id)
      : undefined;
    if (decision.selected_candidate_id && !selected) {
      throw new Error(`Selected candidate missing: ${decision.selected_candidate_id}`);
    }
    const alternate = decision.alternate_candidate_id
      ? candidateById.get(decision.alternate_candidate_id)
      : undefined;
    if (decision.alternate_candidate_id && !alternate) {
      throw new Error(`Alternate candidate missing: ${decision.alternate_candidate_id}`);
    }
    if (selected && selected.artist_id !== decision.artist_id) {
      throw new Error(`Selected candidate belongs to another artist: ${selected.candidate_id}`);
    }
    return {
      artist_id: artist.artist_id,
      name_zh: artist.name_zh,
      name_en: artist.name_en,
      cohort: artist.cohort,
      case: artist.case,
      entity_type: artist.entity_type,
      identity_status: artist.identity_status,
      selected_candidate_id: decision.selected_candidate_id,
      alternate_candidate_id: decision.alternate_candidate_id,
      final_status: decision.final_status,
      portrait_kind: decision.portrait_kind,
      portrait_artwork_id: selected?.artwork_id || "",
      representation_review:
        decision.representation_review ||
        (decision.identity_review?.startsWith("pass")
          ? "pass_person_depiction"
          : decision.identity_review),
      identity_review: decision.identity_review,
      content_review: decision.content_review,
      relationship_review: decision.relationship_review,
      rights_review: decision.rights_review,
      quality_review: decision.quality_review,
      style_review: decision.style_review,
      crop_focus_x: Number(decision.crop_focus_x),
      crop_focus_y: Number(decision.crop_focus_y),
      crop_zoom: Number(decision.crop_zoom || 1),
      portrait_source_url: selected?.source_page_url || "",
      portrait_original_url: selected?.original_download_url || "",
      portrait_preview_url: selected?.preview_url || "",
      portrait_license: selected ? resolveLicense(selected, decision) : "",
      portrait_license_url: selected ? resolveLicenseUrl(selected, decision) : "",
      portrait_credit: selected ? resolveCredit(selected, decision) : "",
      representation_evidence_urls:
        decision.representation_evidence_urls || decision.identity_evidence_urls || [],
      identity_evidence_urls: decision.identity_evidence_urls || [],
      rejection_reasons: decision.rejection_reasons || [],
      review_notes: decision.review_notes,
      selected_candidate: selected || null,
      alternate_candidate: alternate || null,
    };
  });
}

export function buildCandidateDispositions(candidates, reviewRecords) {
  const reviewByArtist = new Map(reviewRecords.map((record) => [record.artist_id, record]));
  return candidates.map((candidate) => {
    const review = reviewByArtist.get(candidate.artist_id);
    let decision = "rejected";
    let reasons = candidate.automated_assessment?.rejection_reasons || [];
    if (candidate.candidate_id === review?.selected_candidate_id) {
      decision = "selected";
      reasons = [];
    } else if (candidate.candidate_id === review?.alternate_candidate_id) {
      decision = "alternate";
      reasons = [];
    } else if (!reasons.length) {
      reasons =
        review?.final_status === "selected"
          ? ["not_preferred_after_visual_review"]
          : review?.rejection_reasons || ["artist_has_no_eligible_asset"];
    }
    return {
      candidate_id: candidate.candidate_id,
      artist_id: candidate.artist_id,
      candidate_origin: candidate.candidate_origin,
      automated_status: candidate.automated_assessment?.status || "",
      review_decision: decision,
      rejection_reasons: reasons,
      source_page_url: candidate.source_page_url,
      license_name: candidate.license_name,
      width: candidate.width,
      height: candidate.height,
    };
  });
}

export function auditReview(reviewRecords, candidates, expectedCount = reviewRecords.length) {
  const errors = [];
  if (reviewRecords.length !== expectedCount) {
    errors.push({
      code: "review_record_count_mismatch",
      expected: expectedCount,
      actual: reviewRecords.length,
    });
  }
  const ids = new Set();
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  for (const record of reviewRecords) {
    if (ids.has(record.artist_id))
      errors.push({
        artist_id: record.artist_id,
        code: "duplicate_artist_decision",
      });
    ids.add(record.artist_id);
    if (!["selected", "no_eligible_asset", "non_person_entity"].includes(record.final_status)) {
      errors.push({ artist_id: record.artist_id, code: "final_status_invalid" });
    }
    if (record.final_status === "selected") {
      const candidate = candidateById.get(record.selected_candidate_id);
      const representationReview =
        record.representation_review ||
        (record.identity_review?.startsWith("pass")
          ? "pass_person_depiction"
          : record.identity_review) ||
        "";
      if (!candidate)
        errors.push({ artist_id: record.artist_id, code: "selected_candidate_missing" });
      if (!candidate?.automated_assessment?.eligible_for_manual_review) {
        errors.push({
          artist_id: record.artist_id,
          code: "automatically_blocked_candidate_selected",
        });
      }
      if (!representationReview.startsWith("pass")) {
        errors.push({ artist_id: record.artist_id, code: "representation_not_passed" });
      }
      if (record.content_review !== "pass") {
        errors.push({ artist_id: record.artist_id, code: "content_not_passed" });
      }
      if (
        record.rights_review !== "pass" ||
        !record.portrait_source_url ||
        !record.portrait_license ||
        !record.portrait_license_url ||
        !record.portrait_credit
      ) {
        errors.push({ artist_id: record.artist_id, code: "rights_evidence_incomplete" });
      }
      if (!record.quality_review.startsWith("pass") || record.style_review !== "pass") {
        errors.push({ artist_id: record.artist_id, code: "visual_review_not_passed" });
      }
      if (
        candidate?.candidate_origin === "project_artwork" &&
        (!record.portrait_artwork_id || record.relationship_review !== "pass")
      ) {
        errors.push({ artist_id: record.artist_id, code: "project_relation_not_passed" });
      }
      if (
        !(record.crop_focus_x >= 0 && record.crop_focus_x <= 1) ||
        !(record.crop_focus_y >= 0 && record.crop_focus_y <= 1) ||
        !(record.crop_zoom >= 1 && record.crop_zoom <= 4)
      ) {
        errors.push({ artist_id: record.artist_id, code: "crop_focus_invalid" });
      }
    } else if (!record.rejection_reasons.length) {
      errors.push({ artist_id: record.artist_id, code: "fallback_reason_missing" });
    }
    if (record.entity_type !== "person" && record.final_status === "selected") {
      errors.push({ artist_id: record.artist_id, code: "non_person_selected" });
    }
  }
  const selected = reviewRecords.filter((record) => record.final_status === "selected");
  const fallback = reviewRecords.filter((record) => record.final_status === "no_eligible_asset");
  const boundary = reviewRecords.filter((record) => record.final_status === "non_person_entity");
  return {
    status: errors.length ? "failed" : "passed",
    read_only: true,
    production_writes: 0,
    summary: {
      records: reviewRecords.length,
      selected: selected.length,
      no_eligible_asset: fallback.length,
      non_person_entity: boundary.length,
      selected_project_artwork: selected.filter(
        (record) => record.selected_candidate?.candidate_origin === "project_artwork",
      ).length,
      selected_external: selected.filter(
        (record) => record.selected_candidate?.candidate_origin === "wikimedia_commons",
      ).length,
      errors: errors.length,
    },
    acceptance: {
      expected_record_count: expectedCount,
      all_expected_records_present: reviewRecords.length === expectedCount,
      all_records_concluded: !errors.some((error) => error.code === "final_status_invalid"),
      selected_association_verified: !errors.some(
        (error) => error.code === "representation_not_passed",
      ),
      selected_rights_complete: !errors.some(
        (error) => error.code === "rights_evidence_incomplete",
      ),
      selected_visual_review_passed: !errors.some(
        (error) => error.code === "visual_review_not_passed",
      ),
      no_blocked_or_non_person_candidate_selected: !errors.some(
        (error) =>
          error.code === "automatically_blocked_candidate_selected" ||
          error.code === "non_person_selected",
      ),
      production_untouched: true,
    },
    errors,
  };
}

async function focusedSquare(filePath, focusX, focusY, zoom, size) {
  const image = sharp(filePath).rotate();
  const metadata = await image.metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  const side = Math.max(1, Math.round(Math.min(width, height) / zoom));
  const centerX = Math.round(width * focusX);
  const centerY = Math.round(height * focusY);
  const left = Math.max(0, Math.min(width - side, centerX - Math.round(side / 2)));
  const top = Math.max(0, Math.min(height - side, centerY - Math.round(side / 2)));
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`,
  );
  return image
    .extract({ left, top, width: side, height: side })
    .resize(size, size)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function buildFinalVisualSheet(reviewRecords, inputDir) {
  const columns = 4;
  const tileWidth = 300;
  const tileHeight = 300;
  const canvas = sharp({
    create: {
      width: columns * tileWidth,
      height: Math.ceil(reviewRecords.length / columns) * tileHeight,
      channels: 4,
      background: "#f4f1ec",
    },
  });
  const composites = [];
  for (let index = 0; index < reviewRecords.length; index += 1) {
    const record = reviewRecords[index];
    const x = (index % columns) * tileWidth;
    const y = Math.floor(index / columns) * tileHeight;
    const selected = record.selected_candidate;
    if (selected?.local_preview_path) {
      const filePath = path.join(inputDir, selected.local_preview_path);
      const detail = await focusedSquare(
        filePath,
        record.crop_focus_x,
        record.crop_focus_y,
        record.crop_zoom,
        160,
      );
      const list = await focusedSquare(
        filePath,
        record.crop_focus_x,
        record.crop_focus_y,
        record.crop_zoom,
        64,
      );
      composites.push(
        { input: detail, left: x + 18, top: y + 14 },
        { input: list, left: x + 210, top: y + 62 },
      );
    }
    const statusColor = record.final_status === "selected" ? "#27633a" : "#973f34";
    const label = Buffer.from(`<svg width="${tileWidth}" height="116">
<rect width="100%" height="100%" fill="#ffffff"/>
<text x="14" y="25" font-family="Microsoft YaHei, sans-serif" font-size="16" font-weight="700" fill="#292522">${escapeHtml(`${index + 1}. ${record.name_zh}`)}</text>
<text x="14" y="49" font-family="Segoe UI, sans-serif" font-size="12" fill="${statusColor}">${escapeHtml(record.final_status)}</text>
<text x="14" y="70" font-family="Segoe UI, sans-serif" font-size="11" fill="#6f655e">${escapeHtml(record.portrait_kind || record.rejection_reasons.join(" / "))}</text>
<text x="14" y="90" font-family="Segoe UI, sans-serif" font-size="10" fill="#766d66">${escapeHtml(record.selected_candidate_id.slice(0, 48))}</text>
<text x="14" y="108" font-family="Segoe UI, sans-serif" font-size="10" fill="#766d66">${escapeHtml(`focus ${record.crop_focus_x.toFixed(2)}, ${record.crop_focus_y.toFixed(2)} · zoom ${record.crop_zoom.toFixed(2)}`)}</text>
</svg>`);
    composites.push({ input: label, left: x, top: y + 184 });
  }
  const output = path.join(inputDir, "pilot-final-visual-sheet.png");
  await canvas.composite(composites).png().toFile(output);
  return output;
}

function buildReviewHtml(records) {
  const sections = records
    .map((record, index) => {
      const evidence = record.representation_evidence_urls
        .map((url) => `<li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`)
        .join("");
      return `<article>
<h2>${index + 1}. ${escapeHtml(record.name_zh)} <small>${escapeHtml(record.name_en)}</small></h2>
<p class="${record.final_status === "selected" ? "selected" : "fallback"}">${escapeHtml(record.final_status)}</p>
<dl>
<dt>主候选</dt><dd>${escapeHtml(record.selected_candidate_id || "无")}</dd>
<dt>备选</dt><dd>${escapeHtml(record.alternate_candidate_id || "无")}</dd>
<dt>审核</dt><dd>代表关联 ${escapeHtml(record.representation_review)}；身份 ${escapeHtml(record.identity_review)}；权利 ${escapeHtml(record.rights_review)}；质量 ${escapeHtml(record.quality_review)}</dd>
<dt>许可/署名</dt><dd>${escapeHtml(record.portrait_license)}；${escapeHtml(record.portrait_credit)}</dd>
<dt>拒绝原因</dt><dd>${escapeHtml(record.rejection_reasons.join("、"))}</dd>
<dt>备注</dt><dd>${escapeHtml(record.review_notes)}</dd>
</dl><ul>${evidence}</ul>
</article>`;
    })
    .join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>首批 20 位肖像审核结论</title><style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f1ec;color:#292522;padding:24px}main{max-width:1100px;margin:auto}article{background:white;padding:18px;border-radius:14px;margin:0 0 14px;border:1px solid #ddd5ca}h2{margin:0 0 8px}small{font-size:14px;font-weight:400;color:#746a63}.selected{color:#27633a}.fallback{color:#973f34}dl{display:grid;grid-template-columns:90px 1fr;gap:7px;font-size:13px}dt{color:#756a62}dd{margin:0;overflow-wrap:anywhere}a{color:#704e39}
</style></head><body><main><h1>首批 20 位肖像审核结论</h1>${sections}</main></body></html>`;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return null;
  }
  const scope = JSON.parse(
    fs.readFileSync(path.join(options.inputDir, "pilot-scope.json"), "utf8"),
  );
  const candidates = readJsonl(path.join(options.inputDir, "pilot-candidates.jsonl"));
  const decisions = JSON.parse(fs.readFileSync(options.decisions, "utf8"));
  const reviewRecords = mergeReviewRecords(scope.artists, candidates, decisions);
  const dispositions = buildCandidateDispositions(candidates, reviewRecords);
  const audit = {
    generated_at: new Date().toISOString(),
    pilot_id: decisions.pilot_id,
    ...auditReview(reviewRecords, candidates, options.expectedCount),
  };
  if (audit.status !== "passed") {
    atomicWrite(
      path.join(options.inputDir, "pilot-final-audit.json"),
      `${JSON.stringify(audit, null, 2)}\n`,
    );
    throw new Error(`Pilot audit failed with ${audit.errors.length} errors.`);
  }
  const visualSheet = await buildFinalVisualSheet(reviewRecords, options.inputDir);
  const files = new Map([
    [
      "pilot-final-review.jsonl",
      jsonlText(
        reviewRecords.map((record) => {
          const { selected_candidate, alternate_candidate, ...serializable } = record;
          return serializable;
        }),
      ),
    ],
    ["pilot-final-review.csv", csvText(reviewRecords, REVIEW_COLUMNS)],
    ["pilot-candidate-dispositions.jsonl", jsonlText(dispositions)],
    ["pilot-final-review.html", buildReviewHtml(reviewRecords)],
    ["pilot-final-audit.json", `${JSON.stringify(audit, null, 2)}\n`],
  ]);
  for (const [name, content] of files) {
    atomicWrite(path.join(options.inputDir, name), content);
  }
  const manifestNames = [
    ...files.keys(),
    path.basename(visualSheet),
    "pilot-scope.json",
    "pilot-candidates.jsonl",
  ];
  const manifest = {
    generated_at: new Date().toISOString(),
    pilot_id: decisions.pilot_id,
    read_only: true,
    production_writes: 0,
    audit_status: audit.status,
    files: manifestNames.map((name) => {
      const content = fs.readFileSync(path.join(options.inputDir, name));
      return { name, bytes: content.byteLength, sha256: sha256(content) };
    }),
  };
  atomicWrite(
    path.join(options.inputDir, "task4-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        output_dir: options.inputDir,
        audit_status: audit.status,
        summary: audit.summary,
        acceptance: audit.acceptance,
        visual_sheet: visualSheet,
        production_writes: 0,
      },
      null,
      2,
    ),
  );
  return { reviewRecords, dispositions, audit, manifest };
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
