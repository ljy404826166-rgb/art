#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const NORMALIZATION_VERSION = "artist-representative-works-zh-v1";
const DEFAULT_OUTPUT_DIR = path.resolve("outputs", "artist-representative-works");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function sameArray(left, right) {
  return JSON.stringify(asArray(left)) === JSON.stringify(asArray(right));
}

export function chineseTitleForArtwork(record = {}) {
  const value = String(
    record.title_cn || record.title_zh || record.titleCn || record.titleZh || "",
  ).trim();
  return /[\u3400-\u9fff]/.test(value) ? value : "";
}

export function buildRepresentativeWorkNormalization(artist, artworkById) {
  const candidates = unique(
    asArray(artist.representative_artwork_ids).map((id) => String(id || "").trim()),
  );
  const selected = [];
  const missingChineseTitleIds = [];
  for (const artworkId of candidates) {
    if (selected.length >= 2) break;
    const artwork = artworkById.get(artworkId);
    const title = chineseTitleForArtwork(artwork);
    if (!title) {
      missingChineseTitleIds.push(artworkId);
      continue;
    }
    selected.push({ id: artworkId, title });
  }
  const representativeArtworkIds = selected.map((item) => item.id);
  const representativeWorks = selected.map((item) => item.title);
  return {
    artist_id: String(artist._id),
    representative_artwork_ids: representativeArtworkIds,
    representative_works: representativeWorks,
    missing_chinese_title_ids: missingChineseTitleIds,
    changed:
      !sameArray(artist.representative_artwork_ids, representativeArtworkIds) ||
      !sameArray(artist.representative_works, representativeWorks),
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
    outputDir: DEFAULT_OUTPUT_DIR,
    batchSize: 20,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--env-id") options.envId = required(argv, (index += 1), arg);
    else if (arg === "--confirm-production") {
      options.confirmation = required(argv, (index += 1), arg);
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
                  $set: {
                    representative_artwork_ids: row.representative_artwork_ids,
                    representative_works: row.representative_works,
                    ...(governance
                      ? {
                          representative_works_normalization: {
                            version: NORMALIZATION_VERSION,
                            language: "zh-CN",
                            maximum_items: 2,
                            normalized_at: updatedAt,
                          },
                        }
                      : {}),
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

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const app = createClient(options.envId, env());
  const database = app.database;
  const [artists, artworks, allGovernance] = await Promise.all([
    queryCollection(database, "artists", {
      review_status: "reviewed",
      public_visibility: "visible",
    }),
    queryCollection(
      database,
      "artworks",
      { status: "published" },
      {
        _id: 1,
        title_cn: 1,
        title_zh: 1,
        titleCn: 1,
        titleZh: 1,
      },
    ),
    queryCollection(database, "artist_profile_governance"),
  ]);
  const artistIds = new Set(artists.map((row) => String(row._id)));
  const governance = allGovernance.filter((row) => artistIds.has(String(row._id)));
  const artworkById = new Map(artworks.map((row) => [String(row._id), row]));
  const normalized = artists.map((artist) =>
    buildRepresentativeWorkNormalization(artist, artworkById),
  );
  const changed = normalized.filter((row) => row.changed);
  const generatedAt = new Date().toISOString();
  const token = timestamp();
  fs.mkdirSync(options.outputDir, { recursive: true });

  let backupFile = "";
  if (options.run) {
    backupFile = path.join(options.outputDir, `artist-representative-works-backup-${token}.json`);
    fs.writeFileSync(
      backupFile,
      `${JSON.stringify(
        {
          generated_at: generatedAt,
          env_id: options.envId,
          normalization_version: NORMALIZATION_VERSION,
          collections: {
            artists,
            artist_profile_governance: governance,
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

  const verified = options.run
    ? await queryCollection(
        database,
        "artists",
        {
          review_status: "reviewed",
          public_visibility: "visible",
        },
        {
          _id: 1,
          representative_artwork_ids: 1,
          representative_works: 1,
        },
      )
    : [];
  const verifiedById = new Map(verified.map((row) => [String(row._id), row]));
  const mismatches = options.run
    ? normalized
        .filter((expected) => {
          const actual = verifiedById.get(expected.artist_id);
          return (
            !actual ||
            !sameArray(actual.representative_artwork_ids, expected.representative_artwork_ids) ||
            !sameArray(actual.representative_works, expected.representative_works)
          );
        })
        .map((row) => row.artist_id)
    : [];
  if (mismatches.length) {
    throw new Error(`Production verification failed for: ${mismatches.join(", ")}`);
  }

  const unresolved = normalized.filter(
    (row) => !row.representative_works.length || row.missing_chinese_title_ids.length,
  );
  const report = {
    generated_at: generatedAt,
    dry_run: !options.run,
    env_id: options.envId,
    normalization_version: NORMALIZATION_VERSION,
    policy: {
      title_fields: ["title_cn", "title_zh", "titleCn", "titleZh"],
      english_title_fallback: false,
      maximum_items: 2,
    },
    totals: {
      public_reviewed_artists: artists.length,
      published_artworks: artworks.length,
      governance_records_matched: governance.length,
      changed_records: changed.length,
      artists_with_one_work: normalized.filter((row) => row.representative_works.length === 1)
        .length,
      artists_with_two_works: normalized.filter((row) => row.representative_works.length === 2)
        .length,
      artists_without_chinese_representative_work: normalized.filter(
        (row) => !row.representative_works.length,
      ).length,
      missing_chinese_title_links: normalized.reduce(
        (total, row) => total + row.missing_chinese_title_ids.length,
        0,
      ),
    },
    unresolved,
    changes: changed,
    write: {
      backup_file: backupFile,
      verification_mismatches: mismatches,
    },
  };
  const reportFile = path.join(
    options.outputDir,
    `artist-representative-works-${options.run ? "write" : "dry-run"}-${token}.json`,
  );
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        report: reportFile,
        dry_run: report.dry_run,
        totals: report.totals,
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
