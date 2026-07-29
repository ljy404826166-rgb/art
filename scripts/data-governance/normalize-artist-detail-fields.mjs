#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const NORMALIZATION_VERSION = "artist-style-normalization-v1";
const DEFAULT_OUTPUT_DIR = path.resolve("outputs", "artist-detail-field-fix");
const DEFAULT_EVIDENCE_DIR = path.resolve("outputs", "artist-enrichment", "authority-evidence");

function loadCategoryCatalog() {
  const filename = fileURLToPath(
    new URL("../../miniapp/data/category-catalog.js", import.meta.url),
  );
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
    },
    { filename },
  );
  return module.exports;
}

const { CATEGORY_GROUPS } = loadCategoryCatalog();
const STYLE_TAGS = CATEGORY_GROUPS.find((group) => group.key === "style").tags;
const STYLE_LABEL_BY_ID = new Map(STYLE_TAGS.map((tag) => [tag.id, tag.label]));
const STYLE_ID_BY_TERM = new Map();

function normalizeTerm(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function registerStyleAliases(id, aliases) {
  for (const alias of aliases) STYLE_ID_BY_TERM.set(normalizeTerm(alias), id);
}

for (const tag of STYLE_TAGS) registerStyleAliases(tag.id, [tag.label]);
registerStyleAliases("style-impressionism", [
  "Impressionism",
  "Impressionist",
  "印象主义",
  "印象派",
  "印象主義",
]);
registerStyleAliases("style-post-impressionism", [
  "Post-Impressionism",
  "Post Impressionism",
  "后印象主义",
  "后印象派",
  "後印象主義",
  "後印象派",
]);
registerStyleAliases("style-expressionism", [
  "Expressionism",
  "Expressionist",
  "表现主义",
  "表現主義",
]);
registerStyleAliases("style-modernism", ["Modernism", "Modernist", "现代主义", "現代主義"]);
registerStyleAliases("style-art-nouveau", ["Art Nouveau", "新艺术运动", "新藝術運動"]);
registerStyleAliases("style-neoclassicism", [
  "Neoclassicism",
  "Neoclassical",
  "新古典主义",
  "新古典主義",
]);
registerStyleAliases("style-renaissance", ["Renaissance", "文艺复兴", "文藝復興"]);
registerStyleAliases("style-northern-renaissance", [
  "Northern Renaissance",
  "北方文艺复兴",
  "北方文藝復興",
]);
registerStyleAliases("style-realism", ["Realism", "Realist", "现实主义", "現實主義"]);
registerStyleAliases("style-ukiyo-e", ["Ukiyo-e", "Ukiyoe", "浮世绘", "浮世繪"]);
registerStyleAliases("style-baroque", ["Baroque", "巴洛克", "巴洛克艺术"]);
registerStyleAliases("style-romanticism", ["Romanticism", "Romanticist", "浪漫主义", "浪漫主義"]);
registerStyleAliases("style-symbolism", ["Symbolism", "Symbolist", "象征主义", "象徵主義"]);
registerStyleAliases("style-academicism", ["Academicism", "Academic art", "学院派", "學院派"]);
registerStyleAliases("style-rococo", ["Rococo", "洛可可"]);
registerStyleAliases("style-fauvism", ["Fauvism", "Fauvist", "野兽派", "野獸派"]);
registerStyleAliases("style-viennese-modernism", [
  "Viennese Modernism",
  "Vienna Modernism",
  "维也纳现代主义",
  "維也納現代主義",
]);
registerStyleAliases("style-vienna-secession", [
  "Vienna Secession",
  "Viennese Secession",
  "维也纳分离派",
  "維也納分離派",
]);
registerStyleAliases("style-historicism", ["Historicism", "历史主义", "歷史主義"]);
registerStyleAliases("style-dutch-golden-age", [
  "Dutch Golden Age",
  "Dutch Golden Age painting",
  "荷兰黄金时代",
  "荷蘭黃金時代",
]);
registerStyleAliases("style-commercial-art", ["Commercial art", "商业美术", "商業美術"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sameArray(left, right) {
  return JSON.stringify(asArray(left)) === JSON.stringify(asArray(right));
}

function styleIdsFromTerms(terms) {
  return unique(
    asArray(terms).map(
      (term) =>
        STYLE_ID_BY_TERM.get(normalizeTerm(typeof term === "object" ? term.label : term)) || "",
    ),
  );
}

export function buildStyleNormalization(record, authorityRecord = {}) {
  const existingIds = unique(
    asArray(record.style_ids)
      .map((id) => String(id || "").trim())
      .filter((id) => STYLE_LABEL_BY_ID.has(id)),
  );
  const movementIds = existingIds.length ? [] : styleIdsFromTerms(authorityRecord.movements);
  const styleIds = unique([...existingIds, ...movementIds]).slice(0, 5);
  const styles = styleIds.map((id) => STYLE_LABEL_BY_ID.get(id)).filter(Boolean);
  let evidenceType = "unresolved";
  if (existingIds.length) evidenceType = "existing_controlled_ids";
  else if (movementIds.length) evidenceType = "wikidata_explicit_movement";

  return {
    artist_id: String(record._id),
    style_ids: styleIds,
    styles,
    evidence_type: evidenceType,
    evidence_url:
      evidenceType === "wikidata_explicit_movement"
        ? String(authorityRecord.wikidata_url || "")
        : "",
    evidence_terms:
      evidenceType === "wikidata_explicit_movement"
        ? asArray(authorityRecord.movements)
            .map((item) => item.label)
            .filter(Boolean)
        : [],
    changed: !sameArray(record.style_ids, styleIds) || !sameArray(record.styles, styles),
  };
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        let value = line.slice(index + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        )
          value = value.slice(1, -1);
        return [line.slice(0, index).trim(), value];
      }),
  );
}

function env() {
  return { ...parseEnvFile(".env"), ...parseEnvFile(".env.local"), ...process.env };
}

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(argv = []) {
  const options = {
    run: false,
    envId: PRODUCTION_ENV_ID,
    confirmation: "",
    evidenceFile: "",
    outputDir: DEFAULT_OUTPUT_DIR,
    batchSize: 20,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--env-id") options.envId = required(argv, (index += 1), arg);
    else if (arg === "--confirm-production") {
      options.confirmation = required(argv, (index += 1), arg);
    } else if (arg === "--evidence-file") {
      options.evidenceFile = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--output-dir") {
      options.outputDir = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--batch-size") {
      options.batchSize = Number(required(argv, (index += 1), arg));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 50) {
    throw new Error("--batch-size must be an integer between 1 and 50.");
  }
  if (options.run && options.envId !== PRODUCTION_ENV_ID) {
    throw new Error(`Production writes are restricted to ${PRODUCTION_ENV_ID}.`);
  }
  if (options.run && options.confirmation !== PRODUCTION_ENV_ID) {
    throw new Error(`--run requires --confirm-production ${PRODUCTION_ENV_ID}.`);
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/data-governance/normalize-artist-detail-fields.mjs
  node scripts/data-governance/normalize-artist-detail-fields.mjs --run \\
    --confirm-production ${PRODUCTION_ENV_ID}

Dry-run is the default. Production writes create a full rollback snapshot first.
`;
}

function latestEvidenceFile(directory) {
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.startsWith("wikidata-artist-evidence-") && name.endsWith(".json"))
    .sort();
  if (!files.length) throw new Error(`No authority evidence file in ${directory}`);
  return path.join(directory, files.at(-1));
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

async function withRetry(operation, label, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError.message}`);
}

async function queryCollection(database, collection, filter = {}, projection = {}) {
  const rows = [];
  const pageSize = 1000;
  for (let skip = 0; ; skip += pageSize) {
    const result = await withRetry(
      () =>
        database.runCommands({
          MgoCommands: [
            {
              TableName: collection,
              CommandType: "QUERY",
              Command: JSON.stringify({
                find: collection,
                filter,
                projection,
                skip,
                limit: pageSize,
              }),
            },
          ],
        }),
      `query ${collection}`,
    );
    const batch = parseCommandRows(result.Data?.[0]);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function createClient(envId, config) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error("Missing Tencent Cloud credentials.");
  return CloudBase.init({ envId, secretId, secretKey });
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function updateBatch(database, collection, rows, updatedAt, governance = false) {
  if (!rows.length) return;
  await withRetry(
    () =>
      database.runCommands({
        MgoCommands: [
          {
            TableName: collection,
            CommandType: "UPDATE",
            Command: JSON.stringify({
              update: collection,
              updates: rows.map((row) => ({
                q: { _id: row.artist_id },
                u: {
                  $set: governance
                    ? {
                        style_ids: row.style_ids,
                        styles: row.styles,
                        style_normalization: {
                          version: NORMALIZATION_VERSION,
                          evidence_type: row.evidence_type,
                          evidence_url: row.evidence_url,
                          evidence_terms: row.evidence_terms,
                          reviewed_at: updatedAt,
                        },
                        updated_at: updatedAt,
                      }
                    : {
                        style_ids: row.style_ids,
                        styles: row.styles,
                        classification_updated_at: updatedAt,
                        updated_at: updatedAt,
                      },
                },
                upsert: false,
              })),
            }),
          },
        ],
      }),
    `update ${collection}`,
  );
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function countBy(rows, key) {
  return Object.fromEntries(
    [
      ...rows
        .reduce((counts, row) => {
          const value = row[key];
          counts.set(value, (counts.get(value) || 0) + 1);
          return counts;
        }, new Map())
        .entries(),
    ].sort(),
  );
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }

  const evidenceFile = options.evidenceFile || latestEvidenceFile(DEFAULT_EVIDENCE_DIR);
  const authorityPayload = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
  const authorityById = new Map(
    asArray(authorityPayload.records).map((row) => [String(row.artist_id), row]),
  );
  const app = createClient(options.envId, env());
  const database = app.database;
  const publicArtists = await queryCollection(database, "artists", {
    review_status: "reviewed",
    public_visibility: "visible",
  });
  const publicIds = new Set(publicArtists.map((row) => String(row._id)));
  const allGovernance = await queryCollection(database, "artist_profile_governance");
  const governanceRecords = allGovernance.filter((row) => publicIds.has(String(row._id)));
  const normalized = publicArtists.map((artist) =>
    buildStyleNormalization(artist, authorityById.get(String(artist._id))),
  );
  const changed = normalized.filter((row) => row.changed);
  const generatedAt = new Date().toISOString();
  const token = timestamp();

  fs.mkdirSync(options.outputDir, { recursive: true });
  let backupFile = "";
  if (options.run) {
    backupFile = path.join(
      options.outputDir,
      `artist-detail-fields-production-backup-${token}.json`,
    );
    fs.writeFileSync(
      backupFile,
      `${JSON.stringify(
        {
          generated_at: generatedAt,
          env_id: options.envId,
          normalization_version: NORMALIZATION_VERSION,
          collections: {
            artists: publicArtists,
            artist_profile_governance: governanceRecords,
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    for (const batch of chunks(changed, options.batchSize)) {
      await updateBatch(database, "artists", batch, generatedAt, false);
      await updateBatch(database, "artist_profile_governance", batch, generatedAt, true);
    }
  }

  const verifiedPublic = options.run
    ? await queryCollection(
        database,
        "artists",
        {
          review_status: "reviewed",
          public_visibility: "visible",
        },
        { _id: 1, style_ids: 1, styles: 1 },
      )
    : [];
  const verifiedById = new Map(verifiedPublic.map((row) => [String(row._id), row]));
  const mismatches = options.run
    ? normalized
        .filter((expected) => {
          const actual = verifiedById.get(expected.artist_id);
          return (
            !actual ||
            !sameArray(actual.style_ids, expected.style_ids) ||
            !sameArray(actual.styles, expected.styles)
          );
        })
        .map((row) => row.artist_id)
    : [];
  if (mismatches.length) {
    throw new Error(`Production verification failed for: ${mismatches.join(", ")}`);
  }

  const report = {
    generated_at: generatedAt,
    dry_run: !options.run,
    env_id: options.envId,
    evidence_file: evidenceFile,
    normalization_version: NORMALIZATION_VERSION,
    policy: {
      existing_controlled_ids_preserved: true,
      authoritative_movement_mapping: true,
      biography_keyword_inference: false,
      occupation_medium_or_decade_inference: false,
      unresolved_display: "待补充",
    },
    totals: {
      public_reviewed_artists: publicArtists.length,
      governance_records_matched: governanceRecords.length,
      changed_records: changed.length,
      resolved_style_records: normalized.filter((row) => row.style_ids.length).length,
      unresolved_style_records: normalized.filter((row) => !row.style_ids.length).length,
      representative_works_present: publicArtists.filter(
        (row) => asArray(row.representative_works).filter(Boolean).length,
      ).length,
      representative_works_missing: publicArtists.filter(
        (row) => !asArray(row.representative_works).filter(Boolean).length,
      ).length,
    },
    evidence_counts: countBy(normalized, "evidence_type"),
    unresolved: normalized
      .filter((row) => !row.style_ids.length)
      .map((row) => {
        const artist = publicArtists.find((item) => String(item._id) === row.artist_id);
        return {
          artist_id: row.artist_id,
          name_zh: artist?.name_zh || "",
          name_en: artist?.name_en || "",
        };
      }),
    changes: changed,
    write: {
      backup_file: backupFile,
      verification_mismatches: mismatches,
    },
  };
  const reportFile = path.join(
    options.outputDir,
    `artist-detail-fields-${options.run ? "write" : "dry-run"}-${token}.json`,
  );
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        report: reportFile,
        dry_run: report.dry_run,
        totals: report.totals,
        evidence_counts: report.evidence_counts,
        backup_file: backupFile,
        verification_mismatches: mismatches,
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
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
