#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  atomicWrite,
  MAX_CANDIDATES_PER_ARTIST,
  normalizeUrl,
  readJsonl,
  sha256,
  stringValue,
} from "./portrait-candidate-lib.mjs";

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(argv = []) {
  const options = {
    inputDir: path.resolve("outputs", "artist-portraits", "20260726T064155Z-task3"),
    output: "",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--input-dir") options.inputDir = path.resolve(required(argv, ++index, arg));
    else if (arg === "--output") options.output = path.resolve(required(argv, ++index, arg));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.output) options.output = path.join(options.inputDir, "candidate-audit.json");
  return options;
}

function usage() {
  return `Usage:
  node scripts/artist-portraits/audit-portrait-candidates.mjs \
    --input-dir outputs/artist-portraits/20260726T064155Z-task3
`;
}

function fileKey(candidate) {
  const sha1 = stringValue(candidate.sha1).toLowerCase();
  if (sha1) return `sha1:${sha1}`;
  const url = normalizeUrl(candidate.original_download_url || candidate.preview_url);
  return url ? `url:${url}` : "";
}

export function auditCandidates(candidates, manualSearch = [], expectedArtistIds = []) {
  const errors = [];
  const warnings = [];
  const candidateIds = new Set();
  const files = new Map();
  const artistCounts = new Map();
  const searchArtistIds = new Set(manualSearch.map((row) => row.artist_id));
  const coveredArtistIds = new Set([
    ...candidates.map((candidate) => candidate.artist_id),
    ...manualSearch.map((record) => record.artist_id),
  ]);

  for (const candidate of candidates) {
    const id = stringValue(candidate.candidate_id);
    if (!id) errors.push({ candidate_id: "", code: "candidate_id_missing" });
    else if (candidateIds.has(id))
      errors.push({ candidate_id: id, code: "candidate_id_duplicate" });
    candidateIds.add(id);

    const artistId = stringValue(candidate.artist_id);
    artistCounts.set(artistId, (artistCounts.get(artistId) || 0) + 1);
    if (!artistId) errors.push({ candidate_id: id, code: "artist_id_missing" });
    if (!stringValue(candidate.source_page_url)) {
      const rejected = candidate.automated_assessment?.rejection_reasons?.includes(
        "source_description_page_missing",
      );
      if (!rejected) errors.push({ candidate_id: id, code: "missing_source_not_rejected" });
    }
    if (candidate.review_status === "approved" || candidate.reviewer_decision === "approved") {
      errors.push({ candidate_id: id, code: "pipeline_must_not_approve" });
    }
    if (candidate.candidate_origin === "project_artwork") {
      if (!stringValue(candidate.artwork_id)) {
        errors.push({ candidate_id: id, code: "project_artwork_id_missing" });
      }
      if (candidate.identity_evidence?.artist_id !== artistId) {
        errors.push({ candidate_id: id, code: "project_identity_trace_mismatch" });
      }
    } else if (candidate.candidate_origin === "wikimedia_commons") {
      if (!stringValue(candidate.wikidata_qid) || candidate.identity_evidence?.property !== "P18") {
        errors.push({ candidate_id: id, code: "commons_p18_trace_missing" });
      }
      if (!stringValue(candidate.commons_file_name)) {
        errors.push({ candidate_id: id, code: "commons_file_name_missing" });
      }
    } else {
      errors.push({ candidate_id: id, code: "candidate_origin_invalid" });
    }

    const dedupe = fileKey(candidate);
    if (!dedupe) warnings.push({ candidate_id: id, code: "dedupe_key_missing" });
    else if (files.has(dedupe)) {
      errors.push({
        candidate_id: id,
        code: "duplicate_file",
        duplicate_of: files.get(dedupe),
      });
    } else files.set(dedupe, id);

    if (!candidate.automated_assessment?.status) {
      errors.push({ candidate_id: id, code: "automated_assessment_missing" });
    }
    if (
      candidate.automated_assessment?.eligible_for_manual_review &&
      candidate.automated_assessment?.rejection_reasons?.length
    ) {
      errors.push({ candidate_id: id, code: "eligible_candidate_has_rejections" });
    }
  }
  for (const [artistId, count] of artistCounts) {
    if (count > MAX_CANDIDATES_PER_ARTIST) {
      errors.push({ artist_id: artistId, code: "artist_candidate_limit_exceeded", count });
    }
  }
  for (const record of manualSearch) {
    if (!Array.isArray(record.queries) || record.queries.length !== 5) {
      errors.push({ artist_id: record.artist_id, code: "manual_queries_incomplete" });
    }
  }
  const missingArtistIds = expectedArtistIds.filter((artistId) => !coveredArtistIds.has(artistId));
  const unexpectedArtistIds = [...coveredArtistIds].filter(
    (artistId) => expectedArtistIds.length && !expectedArtistIds.includes(artistId),
  );
  for (const artistId of missingArtistIds) {
    errors.push({ artist_id: artistId, code: "processed_artist_not_covered" });
  }
  for (const artistId of unexpectedArtistIds) {
    errors.push({ artist_id: artistId, code: "candidate_outside_processed_scope" });
  }

  return {
    status: errors.length ? "failed" : "passed",
    read_only: true,
    production_writes: 0,
    summary: {
      candidates: candidates.length,
      artists_with_candidates: artistCounts.size,
      manual_search_artists: searchArtistIds.size,
      expected_artists: expectedArtistIds.length,
      covered_artists: coveredArtistIds.size,
      errors: errors.length,
      warnings: warnings.length,
    },
    acceptance: {
      candidate_ids_unique: !errors.some((item) => item.code === "candidate_id_duplicate"),
      candidate_limit_respected: !errors.some(
        (item) => item.code === "artist_candidate_limit_exceeded",
      ),
      files_deduplicated: !errors.some((item) => item.code === "duplicate_file"),
      traceability_complete: !errors.some((item) => /trace|_id_missing|p18/u.test(item.code)),
      no_automatic_approvals: !errors.some((item) => item.code === "pipeline_must_not_approve"),
      api_or_metadata_gaps_not_passed: !errors.some(
        (item) => item.code === "eligible_candidate_has_rejections",
      ),
      every_processed_artist_covered:
        missingArtistIds.length === 0 && unexpectedArtistIds.length === 0,
    },
    errors,
    warnings,
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return null;
  }
  const candidatePath = path.join(options.inputDir, "portrait-candidates.jsonl");
  if (!fs.existsSync(candidatePath)) throw new Error(`Missing ${candidatePath}`);
  const candidates = readJsonl(candidatePath);
  const manualSearch = readJsonl(path.join(options.inputDir, "portrait-manual-search.jsonl"));
  const summaryPath = path.join(options.inputDir, "candidate-summary.json");
  const candidateSummary = fs.existsSync(summaryPath)
    ? JSON.parse(fs.readFileSync(summaryPath, "utf8"))
    : {};
  const report = {
    generated_at: new Date().toISOString(),
    input_sha256: sha256(fs.readFileSync(candidatePath)),
    ...auditCandidates(candidates, manualSearch, candidateSummary.processed_artist_ids || []),
  };
  atomicWrite(options.output, `${JSON.stringify(report, null, 2)}\n`);
  const artifactNames = [
    "portrait-candidates.jsonl",
    "portrait-manual-search.jsonl",
    "portrait-candidate-failures.jsonl",
    "candidate-summary.json",
    "candidate-manifest.json",
    "portrait-review-sheet.csv",
    "portrait-manual-search.csv",
    "portrait-candidate-contact-sheet.html",
    path.basename(options.output),
  ];
  const manifest = {
    generated_at: new Date().toISOString(),
    read_only: true,
    production_writes: 0,
    audit_status: report.status,
    files: artifactNames
      .map((name) => ({ name, filePath: path.join(options.inputDir, name) }))
      .filter((item) => fs.existsSync(item.filePath))
      .map((item) => {
        const content = fs.readFileSync(item.filePath);
        return {
          name: item.name,
          bytes: content.byteLength,
          sha256: sha256(content),
        };
      }),
  };
  atomicWrite(
    path.join(options.inputDir, "task3-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    JSON.stringify(
      {
        output: options.output,
        status: report.status,
        summary: report.summary,
      },
      null,
      2,
    ),
  );
  if (report.status !== "passed") process.exitCode = 1;
  return report;
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
