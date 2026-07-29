#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BIO_MAX_CHARACTERS,
  BIO_MIN_CHARACTERS,
  countBiographyCharacters,
  hasAuthorityId,
  inferArtistEntityType,
  isPlaceholderValue,
} from "./artist-enrichment.mjs";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "outputs", "artist-enrichment");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = rawLine.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
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
  return JSON.parse(data || "[]").map((row) => normalizeExtendedJson(JSON.parse(row)));
}

async function queryArtists(database) {
  const rows = [];
  const pageSize = 1000;
  for (let skip = 0; ; skip += pageSize) {
    const result = await database.runCommands({
      MgoCommands: [
        {
          TableName: "artists",
          CommandType: "QUERY",
          Command: JSON.stringify({
            find: "artists",
            filter: {},
            projection: {},
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

function nonEmptyArray(value) {
  return Array.isArray(value) && value.some((item) => String(item || "").trim());
}

function validYear(value) {
  return Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function sourceDomains(sources) {
  const result = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    try {
      result.push(new URL(source.url).hostname.replace(/^www\./, ""));
    } catch {
      // Local provenance paths remain valid evidence but have no network domain.
    }
  }
  return [...new Set(result)].sort();
}

function proposedIdentityStatus(artist, entityType) {
  if (artist.review_status === "rejected") return "unresolved";
  if (entityType === "anonymous") return "unresolved";
  if (entityType === "unresolved") return "unresolved";
  if (artist.review_status === "reviewed" && hasAuthorityId(artist.authority_ids)) {
    return "verified";
  }
  return "provisional";
}

function gapsFor(artist, entityType, bioLength) {
  const gaps = [];
  if (!artist.entity_type) gaps.push("entity_type");
  if (!artist.identity_status) gaps.push("identity_status");
  if (!artist.country_code) gaps.push("country_code");
  if (!nonEmptyArray(artist.occupations_zh)) gaps.push("occupations_zh");
  if (!artist.bio_facts) gaps.push("bio_facts");
  if (!Array.isArray(artist.representative_artwork_ids)) {
    gaps.push("representative_artwork_ids");
  }
  if (bioLength < BIO_MIN_CHARACTERS || bioLength > BIO_MAX_CHARACTERS) {
    gaps.push("bio_length");
  }
  if (entityType === "person" && !hasAuthorityId(artist.authority_ids)) {
    gaps.push("authority_ids");
  }
  if (isPlaceholderValue(artist.country)) gaps.push("country_placeholder");
  if (isPlaceholderValue(artist.region)) gaps.push("region_placeholder");
  if (isPlaceholderValue(artist.lifespan_text)) gaps.push("lifespan_placeholder");
  if (entityType === "person" && !validYear(artist.birth_year)) gaps.push("birth_year");
  if (entityType === "person" && !validYear(artist.death_year)) gaps.push("death_year");
  if (!Number.isSafeInteger(Number(artist.artwork_count))) gaps.push("artwork_count");
  return [...new Set(gaps)];
}

function researchPriority(artist, entityType, gaps) {
  if (
    artist.review_status === "candidate" ||
    ["unresolved", "anonymous", "attribution", "workshop", "organization"].includes(entityType)
  )
    return "P0";
  if (gaps.includes("bio_length") || gaps.some((gap) => gap.endsWith("_placeholder"))) {
    return "P1";
  }
  return "P2";
}

export function auditArtist(artist) {
  const entityType = inferArtistEntityType(artist);
  const identityStatus = proposedIdentityStatus(artist, entityType);
  const bioLength = countBiographyCharacters(artist.bio_zh);
  const gaps = gapsFor(artist, entityType, bioLength);
  return {
    _id: artist._id,
    name_zh: artist.name_zh || "",
    name_en: artist.name_en || "",
    review_status: artist.review_status || "",
    inferred_entity_type: entityType,
    proposed_identity_status: identityStatus,
    birth_year: Number(artist.birth_year || 0) || null,
    death_year: Number(artist.death_year || 0) || null,
    country: artist.country || "",
    region: artist.region || "",
    authority_ids: artist.authority_ids || {},
    source_domains: sourceDomains(artist.sources),
    bio_char_count: bioLength,
    classification_version: artist.classification_version || "",
    classified_artwork_count: Number(artist.classified_artwork_count || 0),
    gaps,
    research_priority: researchPriority(artist, entityType, gaps),
  };
}

function summarize(rows) {
  const countBy = (field) =>
    Object.fromEntries(
      [...new Set(rows.map((row) => row[field]))]
        .map((value) => [value, rows.filter((row) => row[field] === value).length])
        .sort(
          (left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])),
        ),
    );
  const gapCounts = {};
  for (const row of rows) {
    for (const gap of row.gaps) gapCounts[gap] = (gapCounts[gap] || 0) + 1;
  }
  return {
    artists_total: rows.length,
    entity_types: countBy("inferred_entity_type"),
    identity_statuses: countBy("proposed_identity_status"),
    priorities: countBy("research_priority"),
    biographies_in_range: rows.filter(
      (row) => row.bio_char_count >= BIO_MIN_CHARACTERS && row.bio_char_count <= BIO_MAX_CHARACTERS,
    ).length,
    gap_counts: Object.fromEntries(
      Object.entries(gapCounts).sort(
        (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
      ),
    ),
  };
}

function csvCell(value) {
  const text = Array.isArray(value)
    ? value.join("|")
    : typeof value === "object" && value
      ? JSON.stringify(value)
      : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows) {
  const fields = [
    "_id",
    "name_zh",
    "name_en",
    "review_status",
    "inferred_entity_type",
    "proposed_identity_status",
    "birth_year",
    "death_year",
    "country",
    "region",
    "authority_ids",
    "source_domains",
    "bio_char_count",
    "classification_version",
    "classified_artwork_count",
    "gaps",
    "research_priority",
  ];
  return [
    fields.map(csvCell).join(","),
    ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(",")),
  ].join("\n");
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export async function main() {
  const app = createClient(DEFAULT_ENV_ID, env());
  const artists = await queryArtists(app.database);
  const rows = artists
    .map(auditArtist)
    .sort(
      (left, right) =>
        left.research_priority.localeCompare(right.research_priority) ||
        left.name_en.localeCompare(right.name_en),
    );
  const generatedAt = new Date().toISOString();
  const report = {
    generated_at: generatedAt,
    env_id: DEFAULT_ENV_ID,
    dry_run: true,
    bio_policy: {
      min_characters: BIO_MIN_CHARACTERS,
      max_characters: BIO_MAX_CHARACTERS,
      character_count: "non-whitespace Unicode code points",
      required_facets: ["lifespan", "title", "career", "standing"],
    },
    summary: summarize(rows),
    artists: rows,
  };
  const suffix = timestamp();
  fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
  const jsonPath = path.join(DEFAULT_OUTPUT_DIR, `artist-enrichment-audit-${suffix}.json`);
  const csvPath = path.join(DEFAULT_OUTPUT_DIR, `artist-enrichment-research-queue-${suffix}.csv`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(csvPath, `\uFEFF${toCsv(rows)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        report: jsonPath,
        research_queue: csvPath,
        ...report.summary,
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
