#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const ARTIST_COLLECTION = "artists";
const ARTWORK_COLLECTION = "artworks";

function stringValue(value) {
  return String(value ?? "").trim();
}

function jsonl(records) {
  return records.length ? `${records.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, "utf8");
  fs.renameSync(temporary, filePath);
}

function writeJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
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
    outputDir: path.resolve("outputs", "artist-artwork-count-sync", timestamp()),
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--env-id") options.envId = required(argv, ++index, arg);
    else if (arg === "--confirm-production") {
      options.confirmation = required(argv, ++index, arg);
    } else if (arg === "--output-dir") {
      options.outputDir = path.resolve(required(argv, ++index, arg));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.envId !== PRODUCTION_ENV_ID) {
    throw new Error(`Count sync is restricted to ${PRODUCTION_ENV_ID}.`);
  }
  if (options.run && options.confirmation !== PRODUCTION_ENV_ID) {
    throw new Error(`--run requires --confirm-production ${PRODUCTION_ENV_ID}.`);
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/data-governance/sync-artist-artwork-counts-production.mjs
  node scripts/data-governance/sync-artist-artwork-counts-production.mjs --run \\
    --confirm-production ${PRODUCTION_ENV_ID}

Default mode is read-only. Only reviewed, visible artists with at least one
usable name or alias are eligible. Counts mirror the artist detail page:
published artist_ids first, then published tag/name aliases as fallback.
`;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index).trim();
        let value = line.slice(index + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        )
          value = value.slice(1, -1);
        return [key, value];
      }),
  );
}

function environment() {
  return {
    ...parseEnvFile(".env"),
    ...parseEnvFile(".env.local"),
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
  return JSON.parse(data || "[]").map((row) => normalizeExtendedJson(JSON.parse(row)));
}

async function queryCollection(database, collection, filter = {}, projection = {}) {
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
            filter,
            projection,
            skip,
            limit: pageSize,
          }),
        },
      ],
    });
    const page = parseCommandRows(result.Data?.[0]);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function isVisibleArtist(record) {
  return (
    stringValue(record.review_status) === "reviewed" &&
    stringValue(record.public_visibility) !== "hidden"
  );
}

export function buildArtworkCountPlan(artists, artworks) {
  const counts = new Map();
  for (const artwork of artworks) {
    if (stringValue(artwork.status) !== "published") continue;
    const artistIds = new Set(
      (Array.isArray(artwork.artist_ids) ? artwork.artist_ids : [])
        .map(stringValue)
        .filter(Boolean),
    );
    for (const artistId of artistIds) {
      counts.set(artistId, (counts.get(artistId) || 0) + 1);
    }
  }
  const visible = artists.filter(isVisibleArtist);
  const changes = visible
    .flatMap((artist) => {
      const artistId = stringValue(artist._id);
      const normalizedCount = counts.get(artistId) || 0;
      const storedCount = Number(artist.artwork_count || 0);
      const aliases = [
        ...new Set(
          [artist.name_zh, artist.name_en, ...(Array.isArray(artist.aliases) ? artist.aliases : [])]
            .map(stringValue)
            .filter(Boolean),
        ),
      ];
      // Malformed artist rows without any usable identity are not safe write
      // targets even though the detail service would currently return zero.
      if (!aliases.length) return [];
      const aliasPatterns = aliases.map(
        (alias) => new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"),
      );
      const primaryTag = stringValue(artist.name_zh);
      const fallbackCount =
        normalizedCount > 0 || !aliases.length
          ? 0
          : artworks.filter((artwork) => {
              if (stringValue(artwork.status) !== "published") return false;
              const tagMatch =
                primaryTag &&
                (Array.isArray(artwork.tag_keys) ? artwork.tag_keys : [])
                  .map(stringValue)
                  .includes(primaryTag);
              const artistText = stringValue(artwork.artist);
              return tagMatch || aliasPatterns.some((pattern) => pattern.test(artistText));
            }).length;
      // This mirrors countArtworksByArtist(): a positive normalized count wins;
      // otherwise the detail page counts the published tag/alias fallback.
      const detailCount = normalizedCount > 0 ? normalizedCount : fallbackCount;
      if (detailCount === storedCount) return [];
      return [
        {
          artist_id: artistId,
          name_zh: stringValue(artist.name_zh),
          name_en: stringValue(artist.name_en),
          before_artwork_count: storedCount,
          after_artwork_count: detailCount,
          count_path: normalizedCount > 0 ? "normalized_artist_ids" : "published_alias_fallback",
          reason: "match_artist_detail_countArtworksByArtist",
        },
      ];
    })
    .sort((left, right) => left.artist_id.localeCompare(right.artist_id));
  return {
    production_artists: artists.length,
    visible_artists: visible.length,
    artworks: artworks.length,
    artists_with_normalized_relations: visible.filter(
      (artist) => (counts.get(stringValue(artist._id)) || 0) > 0,
    ).length,
    changes,
  };
}

async function updateCounts(database, changes) {
  if (!changes.length) return { request_id: "", command_results: 0 };
  const result = await database.runCommands({
    MgoCommands: [
      {
        TableName: ARTIST_COLLECTION,
        CommandType: "UPDATE",
        Command: JSON.stringify({
          update: ARTIST_COLLECTION,
          updates: changes.map((change) => ({
            q: { _id: change.artist_id },
            u: { $set: { artwork_count: change.after_artwork_count } },
            upsert: false,
          })),
        }),
      },
    ],
  });
  return {
    request_id: stringValue(result.RequestId || result.requestId),
    command_results: Array.isArray(result.Data) ? result.Data.length : 0,
  };
}

function recordsById(records) {
  return new Map(records.map((record) => [stringValue(record._id), record]));
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return null;
  }
  fs.mkdirSync(options.outputDir, { recursive: true });
  const app = createClient(options.envId, environment());
  const [artists, artworks] = await Promise.all([
    queryCollection(
      app.database,
      ARTIST_COLLECTION,
      {},
      {
        _id: 1,
        name_zh: 1,
        name_en: 1,
        aliases: 1,
        review_status: 1,
        public_visibility: 1,
        artwork_count: 1,
      },
    ),
    queryCollection(
      app.database,
      ARTWORK_COLLECTION,
      {},
      {
        _id: 1,
        artist_ids: 1,
        artist: 1,
        tag_keys: 1,
        status: 1,
      },
    ),
  ]);
  const plan = buildArtworkCountPlan(artists, artworks);
  const targetIds = new Set(plan.changes.map((change) => change.artist_id));
  const backup = artists
    .filter((artist) => targetIds.has(stringValue(artist._id)))
    .sort((left, right) => stringValue(left._id).localeCompare(stringValue(right._id)));
  const backupPath = path.join(options.outputDir, "production-backup.jsonl");
  atomicWrite(backupPath, jsonl(backup));
  const dryRun = {
    generated_at: new Date().toISOString(),
    env_id: options.envId,
    dry_run: true,
    collection: ARTIST_COLLECTION,
    field: "artwork_count",
    production_database_writes: 0,
    permission_changes: 0,
    summary: {
      production_artists: plan.production_artists,
      visible_artists: plan.visible_artists,
      artworks: plan.artworks,
      artists_with_normalized_relations: plan.artists_with_normalized_relations,
      records_with_changes: plan.changes.length,
    },
    changes: plan.changes,
    backup_sha256: sha256(fs.readFileSync(backupPath)),
  };
  writeJson(path.join(options.outputDir, "count-sync-dry-run.json"), dryRun);

  let verification = {
    generated_at: new Date().toISOString(),
    mode: "pending_production_write",
    passed: null,
    verified_records: 0,
  };
  let writeReport = {
    generated_at: new Date().toISOString(),
    mode: "dry_run_not_written",
    records_requested: 0,
    permission_changes: 0,
  };
  if (options.run) {
    const writeResult = await updateCounts(app.database, plan.changes);
    const [artistsAfter, targetsAfter] = await Promise.all([
      queryCollection(
        app.database,
        ARTIST_COLLECTION,
        {},
        {
          _id: 1,
          artwork_count: 1,
        },
      ),
      queryCollection(
        app.database,
        ARTIST_COLLECTION,
        {
          _id: { $in: [...targetIds] },
        },
        {
          _id: 1,
          artwork_count: 1,
        },
      ),
    ]);
    const afterById = recordsById(targetsAfter);
    const fieldMismatches = plan.changes
      .filter(
        (change) =>
          Number(afterById.get(change.artist_id)?.artwork_count || 0) !==
          change.after_artwork_count,
      )
      .map((change) => change.artist_id);
    const beforeById = recordsById(artists);
    const nonTargetMismatches = artistsAfter
      .filter((artist) => !targetIds.has(stringValue(artist._id)))
      .filter(
        (artist) =>
          Number(artist.artwork_count || 0) !==
          Number(beforeById.get(stringValue(artist._id))?.artwork_count || 0),
      )
      .map((artist) => stringValue(artist._id));
    verification = {
      generated_at: new Date().toISOString(),
      mode: "production_readback",
      production_artists_after: artistsAfter.length,
      verified_records: targetsAfter.length,
      field_mismatches: fieldMismatches,
      non_target_mismatches: nonTargetMismatches,
      permission_changes: 0,
      passed:
        artistsAfter.length === artists.length &&
        targetsAfter.length === plan.changes.length &&
        fieldMismatches.length === 0 &&
        nonTargetMismatches.length === 0,
    };
    writeReport = {
      generated_at: new Date().toISOString(),
      mode: "production_write",
      records_requested: plan.changes.length,
      records_verified: targetsAfter.length,
      request_id: writeResult.request_id,
      command_results: writeResult.command_results,
      permission_changes: 0,
      passed: verification.passed,
    };
    if (!verification.passed) {
      writeJson(path.join(options.outputDir, "verification-report.json"), verification);
      writeJson(path.join(options.outputDir, "database-write-report.json"), writeReport);
      throw new Error(`Production verification failed; use ${backupPath} for rollback.`);
    }
  }
  writeJson(path.join(options.outputDir, "verification-report.json"), verification);
  writeJson(path.join(options.outputDir, "database-write-report.json"), writeReport);
  const audit = {
    generated_at: new Date().toISOString(),
    status: options.run ? (verification.passed ? "passed" : "failed") : "passed",
    mode: options.run ? "production_write" : "dry_run",
    summary: {
      production_artists: plan.production_artists,
      visible_artists: plan.visible_artists,
      target_records: plan.changes.length,
      records_verified: verification.verified_records,
      database_writes: options.run ? plan.changes.length : 0,
      permission_changes: 0,
    },
    acceptance: {
      production_artist_count_stable: plan.production_artists === 117,
      target_backup_complete: backup.length === plan.changes.length,
      only_artwork_count_in_scope: true,
      production_readback_passed: options.run ? verification.passed : null,
      permission_changes_zero: true,
    },
  };
  writeJson(path.join(options.outputDir, "count-sync-audit.json"), audit);
  console.log(
    JSON.stringify(
      {
        output_dir: options.outputDir,
        mode: audit.mode,
        status: audit.status,
        summary: audit.summary,
        changes: plan.changes,
      },
      null,
      2,
    ),
  );
  return { plan, audit, verification };
}

const isMain =
  process.argv[1] &&
  path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(`[artist-count-sync] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
