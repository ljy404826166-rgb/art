#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtistEnrichment } from "./artist-enrichment.mjs";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_MANIFEST_DIR = path.resolve("outputs", "artist-enrichment", "pilot");
const DEFAULT_REPORT_DIR = path.resolve("outputs", "artist-enrichment", "pilot-write");
const PILOT_COLLECTIONS = {
  artists: "artists_enrichment_pilot_20260725",
  relationshipChanges: "artist_relationship_changes_pilot_20260725",
};
const FORBIDDEN_COLLECTIONS = new Set(["artists", "artwork_artist_links", "artworks"]);

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
    envId: process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID || DEFAULT_ENV_ID,
    manifestDir: DEFAULT_MANIFEST_DIR,
    reportDir: DEFAULT_REPORT_DIR,
    batchSize: 20,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--env-id") options.envId = required(argv, (index += 1), arg);
    else if (arg === "--manifest-dir") {
      options.manifestDir = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--report-dir") {
      options.reportDir = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--batch-size") {
      options.batchSize = Number(required(argv, (index += 1), arg));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 50) {
    throw new Error("--batch-size must be an integer between 1 and 50.");
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/data-governance/apply-artist-enrichment-pilot.mjs [--run]

Default mode is local dry-run. --run reads production artists but writes only to:
  ${PILOT_COLLECTIONS.artists}
  ${PILOT_COLLECTIONS.relationshipChanges}
`;
}

function latestManifest(directory) {
  const files = fs
    .readdirSync(directory)
    .filter((name) => name.startsWith("artist-enrichment-pilot-") && name.endsWith(".json"))
    .sort();
  if (!files.length) throw new Error(`No artist enrichment pilot manifest in ${directory}`);
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

async function withRetry(operation, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError.message}`);
}

async function queryCollection(database, collection) {
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
                filter: {},
                projection: {},
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

export function buildPilotArtistDocuments(sourceArtists, manifest, syncedAt) {
  const sourceById = new Map(sourceArtists.map((record) => [String(record._id), record]));
  const fullRecordIds = new Set(
    (manifest.validation || []).filter((row) => row.ok).map((row) => row._id),
  );
  return manifest.artist_patches.map((patch) => {
    const source = sourceById.get(String(patch._id));
    if (!source && patch.record_action !== "create" && !fullRecordIds.has(patch._id)) {
      throw new Error(`Missing production source artist for partial patch ${patch._id}`);
    }
    const document = {
      ...(source || {}),
      ...patch,
      enrichment_pilot_batch: "artist-enrichment-pilot-20260725",
      enrichment_pilot_synced_at: syncedAt,
      enrichment_source_collection: source ? "artists" : "candidate_create",
      enrichment_validation_status: fullRecordIds.has(patch._id)
        ? "full_record_valid"
        : "structural_disposition",
    };
    if (fullRecordIds.has(patch._id)) {
      const validation = validateArtistEnrichment(document);
      if (!validation.ok) {
        throw new Error(`Merged pilot record ${patch._id} failed validation.`);
      }
    }
    return document;
  });
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function upsertBatch(database, collection, documents) {
  return withRetry(
    () =>
      database.runCommands({
        MgoCommands: [
          {
            TableName: collection,
            CommandType: "UPDATE",
            Command: JSON.stringify({
              update: collection,
              updates: documents.map((document) => ({
                q: { _id: document._id },
                u: { $set: document },
                upsert: true,
              })),
            }),
          },
        ],
      }),
    `upsert ${collection}`,
  );
}

async function writeCollection(database, collection, documents, batchSize) {
  await withRetry(() => database.createCollectionIfNotExists(collection), `create ${collection}`);
  for (const batch of chunks(documents, batchSize)) {
    await upsertBatch(database, collection, batch);
  }
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  for (const collection of Object.values(PILOT_COLLECTIONS)) {
    if (FORBIDDEN_COLLECTIONS.has(collection)) {
      throw new Error(`Refusing to target production collection ${collection}`);
    }
  }
  const manifestFile = latestManifest(options.manifestDir);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const syncedAt = new Date().toISOString();
  const report = {
    generated_at: syncedAt,
    dry_run: !options.run,
    env_id: options.envId,
    manifest_file: manifestFile,
    production_collections_modified: false,
    source_reads: options.run ? ["artists"] : [],
    collections: {
      [PILOT_COLLECTIONS.artists]: {
        intended: manifest.artist_patches.length,
        written: 0,
        verified: 0,
      },
      [PILOT_COLLECTIONS.relationshipChanges]: {
        intended: manifest.relationship_changes.length,
        written: 0,
        verified: 0,
      },
    },
  };

  if (options.run) {
    const app = createClient(options.envId, env());
    const sourceArtists = await queryCollection(app.database, "artists");
    const artistDocuments = buildPilotArtistDocuments(sourceArtists, manifest, syncedAt);
    const relationshipDocuments = manifest.relationship_changes.map((change) => ({
      ...change,
      enrichment_pilot_batch: "artist-enrichment-pilot-20260725",
      enrichment_pilot_synced_at: syncedAt,
    }));
    await writeCollection(
      app.database,
      PILOT_COLLECTIONS.artists,
      artistDocuments,
      options.batchSize,
    );
    await writeCollection(
      app.database,
      PILOT_COLLECTIONS.relationshipChanges,
      relationshipDocuments,
      options.batchSize,
    );
    report.collections[PILOT_COLLECTIONS.artists].written = artistDocuments.length;
    report.collections[PILOT_COLLECTIONS.relationshipChanges].written =
      relationshipDocuments.length;
    report.collections[PILOT_COLLECTIONS.artists].verified = (
      await queryCollection(app.database, PILOT_COLLECTIONS.artists)
    ).length;
    report.collections[PILOT_COLLECTIONS.relationshipChanges].verified = (
      await queryCollection(app.database, PILOT_COLLECTIONS.relationshipChanges)
    ).length;
  }

  fs.mkdirSync(options.reportDir, { recursive: true });
  const reportFile = path.join(
    options.reportDir,
    `artist-enrichment-pilot-write-${timestamp()}.json`,
  );
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ report: reportFile, ...report }, null, 2));
  return report;
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
