#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const REQUIRED_FIELDS = [
  "_id",
  "name_zh",
  "name_en",
  "birth_year",
  "death_year",
  "lifespan_text",
  "country",
  "region",
  "styles",
  "periods",
  "active_period",
  "representative_works",
  "aliases",
  "bio_zh",
  "tags",
  "avatar_text",
  "authority_ids",
  "sources",
  "review_status",
  "reviewed_at",
  "updated_at",
];

const ARRAY_FIELDS = ["styles", "periods", "representative_works", "aliases", "tags", "sources"];
const NON_EMPTY_ARRAY_FIELDS = ["styles", "periods", "aliases", "sources"];
const NON_EMPTY_STRING_FIELDS = ["_id", "name_zh", "name_en", "lifespan_text", "country", "region", "active_period", "bio_zh", "avatar_text", "review_status", "updated_at"];
const REVIEW_STATUSES = new Set(["candidate", "reviewed", "rejected"]);
const LOCAL_SOURCE_RE = /^(?:miniapp\/data\/|\.\/miniapp\/data\/|Current WeChat Cloud artworks export$|Local candidate seed$)/i;
const LOCAL_URL_RE = /^(?:miniapp\/data\/|\.\/miniapp\/data\/)/i;

const allowedAliasCollisions = new Set([
  // Add explicit values here only after manual review.
]);

function usage() {
  return `
Validate artist JSON Lines data.

Usage:
  node scripts/validate-artists-data.mjs <path-to-artists.jsonl>

Rules:
  - One JSON object per line.
  - Required artist fields must be present.
  - _id values must be unique.
  - aliases must be unique across artists unless allow-listed.
  - reviewed records must include at least one non-local authority source URL.
  - birth_year must be before death_year when both years are set.
`;
}

function main() {
  const input = process.argv[2];
  if (!input || input === "--help" || input === "-h") {
    console.log(usage().trim());
    process.exit(input ? 0 : 1);
  }

  const absoluteInput = path.resolve(input);
  const result = validateFile(absoluteInput);
  printResult(result);
  if (result.errors.length > 0) process.exit(1);
}

function validateFile(filePath) {
  const errors = [];
  const rows = readJsonLines(filePath, errors);
  if (errors.length > 0) return summary(rows, errors);

  validateRows(rows, errors);
  return summary(rows, errors);
}

function readJsonLines(filePath, errors) {
  if (!fs.existsSync(filePath)) {
    errors.push({ line: 0, message: `file not found: ${filePath}` });
    return [];
  }

  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw) continue;
    try {
      const value = JSON.parse(raw);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        errors.push({ line: index + 1, message: "line must be a JSON object" });
        continue;
      }
      rows.push({ line: index + 1, value });
    } catch (error) {
      errors.push({ line: index + 1, message: `invalid JSON: ${error.message}` });
    }
  }
  return rows;
}

function validateRows(rows, errors) {
  const ids = new Map();
  const aliases = new Map();

  for (const row of rows) {
    const artist = row.value;
    validateRequiredFields(row.line, artist, errors);
    validateFieldTypes(row.line, artist, errors);
    validateReviewStatus(row.line, artist, errors);
    validateReviewedSources(row.line, artist, errors);
    validateYears(row.line, artist, errors);
    validateId(row.line, artist, ids, errors);
    validateAliases(row.line, artist, aliases, errors);
  }
}

function validateRequiredFields(line, artist, errors) {
  for (const field of REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(artist, field)) {
      errors.push({ line, message: `missing required field "${field}"` });
    }
  }
}

function validateFieldTypes(line, artist, errors) {
  for (const field of NON_EMPTY_STRING_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(artist, field)) continue;
    if (typeof artist[field] !== "string" || artist[field].trim() === "") {
      errors.push({ line, message: `"${field}" must be a non-empty string` });
    }
  }

  for (const field of ARRAY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(artist, field)) continue;
    if (!Array.isArray(artist[field])) {
      errors.push({ line, message: `"${field}" must be an array` });
    }
  }

  for (const field of NON_EMPTY_ARRAY_FIELDS) {
    if (!Array.isArray(artist[field])) continue;
    if (artist[field].map((value) => String(value || "").trim()).filter(Boolean).length === 0) {
      errors.push({ line, message: `"${field}" must contain at least one non-empty value` });
    }
  }

  for (const field of ["birth_year", "death_year"]) {
    if (!Object.prototype.hasOwnProperty.call(artist, field)) continue;
    if (!Number.isInteger(artist[field]) || artist[field] < 0) {
      errors.push({ line, message: `"${field}" must be a non-negative integer` });
    }
  }

  if (artist.authority_ids === null || typeof artist.authority_ids !== "object" || Array.isArray(artist.authority_ids)) {
    errors.push({ line, message: '"authority_ids" must be an object' });
  }

  if (Array.isArray(artist.sources)) {
    artist.sources.forEach((source, index) => validateSource(line, source, index, errors));
  }
}

function validateSource(line, source, index, errors) {
  const label = `sources[${index}]`;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    errors.push({ line, message: `${label} must be an object` });
    return;
  }
  for (const field of ["title", "url", "fields"]) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) {
      errors.push({ line, message: `${label} missing "${field}"` });
    }
  }
  if (typeof source.title !== "string" || source.title.trim() === "") {
    errors.push({ line, message: `${label}.title must be a non-empty string` });
  }
  if (typeof source.url !== "string" || source.url.trim() === "") {
    errors.push({ line, message: `${label}.url must be a non-empty string` });
  }
  if (!Array.isArray(source.fields) || source.fields.map((value) => String(value || "").trim()).filter(Boolean).length === 0) {
    errors.push({ line, message: `${label}.fields must contain at least one value` });
  }
}

function validateReviewStatus(line, artist, errors) {
  if (!REVIEW_STATUSES.has(artist.review_status)) {
    errors.push({ line, message: '"review_status" must be candidate, reviewed, or rejected' });
  }
}

function validateReviewedSources(line, artist, errors) {
  if (artist.review_status !== "reviewed") return;
  if (!Array.isArray(artist.sources)) return;
  const hasAuthoritySource = artist.sources.some((source) => {
    const title = String(source?.title || "").trim();
    const url = String(source?.url || "").trim();
    return url && /^https?:\/\//i.test(url) && !LOCAL_SOURCE_RE.test(title) && !LOCAL_URL_RE.test(url);
  });
  if (!hasAuthoritySource) {
    errors.push({ line, message: "reviewed record must include at least one authority source URL" });
  }
}

function validateYears(line, artist, errors) {
  const birth = artist.birth_year;
  const death = artist.death_year;
  if (!Number.isInteger(birth) || !Number.isInteger(death)) return;
  if (birth > 0 && death > 0 && birth >= death) {
    errors.push({ line, message: "birth_year must be before death_year for deceased artists" });
  }
}

function validateId(line, artist, ids, errors) {
  const id = typeof artist._id === "string" ? artist._id.trim() : "";
  if (!id) return;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    errors.push({ line, message: `_id "${id}" must be kebab-case lowercase ASCII` });
  }
  if (ids.has(id)) {
    errors.push({ line, message: `duplicate _id "${id}" also appears on line ${ids.get(id)}` });
  } else {
    ids.set(id, line);
  }
}

function validateAliases(line, artist, aliases, errors) {
  if (!Array.isArray(artist.aliases)) return;
  const localAliases = new Set();
  for (const rawAlias of artist.aliases) {
    const alias = normalizeAlias(rawAlias);
    if (!alias) {
      errors.push({ line, message: "aliases must not contain empty values" });
      continue;
    }
    if (localAliases.has(alias)) {
      errors.push({ line, message: `duplicate alias "${rawAlias}" within record` });
      continue;
    }
    localAliases.add(alias);

    if (aliases.has(alias) && !allowedAliasCollisions.has(alias)) {
      const previous = aliases.get(alias);
      errors.push({ line, message: `duplicate alias "${rawAlias}" also appears in ${previous.id}` });
    } else {
      aliases.set(alias, { id: artist._id || `line ${line}`, line });
    }
  }
}

function normalizeAlias(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function summary(rows, errors) {
  const counts = {
    records: rows.length,
    reviewed: 0,
    candidate: 0,
    rejected: 0,
  };
  for (const row of rows) {
    if (row.value.review_status === "reviewed") counts.reviewed += 1;
    else if (row.value.review_status === "candidate") counts.candidate += 1;
    else if (row.value.review_status === "rejected") counts.rejected += 1;
  }
  return { rows, counts, errors };
}

function printResult(result) {
  if (result.errors.length > 0) {
    console.error("artists reviewed data invalid");
    for (const error of result.errors) {
      const prefix = error.line > 0 ? `line ${error.line}` : "file";
      console.error(`${prefix}: ${error.message}`);
    }
    return;
  }

  console.log("artists reviewed data ok");
  console.log(`Records: ${result.counts.records}`);
  console.log(`Reviewed: ${result.counts.reviewed}`);
  console.log(`Candidates: ${result.counts.candidate}`);
  console.log(`Rejected: ${result.counts.rejected}`);
}

main();
