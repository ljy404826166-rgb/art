#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_MANIFEST_DIR = path.resolve(process.cwd(), "outputs", "taxonomy-v3", "migration");
const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), "outputs", "taxonomy-v3", "pilot-write");
const PILOT_COLLECTIONS = {
  artworks: "artworks_classification_v3_pilot_20260724",
  artists: "artists_classification_v3_pilot_20260724",
  vocabTerms: "vocab_terms_classification_v3_pilot_20260724",
  artworkTagLinks: "artwork_tag_links_v3_pilot_20260724",
  artworkArtistLinks: "artwork_artist_links_v3_pilot_20260724",
};

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
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
  node scripts/data-governance/apply-taxonomy-v3-pilot.mjs [--run]

Writes classification-v3 data only to isolated pilot collections.
Without --run, performs a dry-run and writes a local report.
`;
}

function latestFile(directory, prefix, extension) {
  const matches = fs
    .readdirSync(directory)
    .filter((name) => name.startsWith(prefix) && name.endsWith(extension))
    .sort();
  if (!matches.length) throw new Error(`No ${prefix}*${extension} file in ${directory}`);
  return path.join(directory, matches.at(-1));
}

function readJsonLines(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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
  const outer = JSON.parse(data || "[]");
  return outer.map((row) => normalizeExtendedJson(JSON.parse(row)));
}

async function withRetry(operation, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError.message}`, {
    cause: lastError,
  });
}

async function queryCollection(database, collection, projection) {
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

function assignmentPatch(assignment) {
  return {
    classification_version: assignment.classification_version,
    classification_ids: assignment.classification_ids,
    tag_ids: assignment.tag_ids,
    artist_ids: assignment.artist_ids,
    primary_artist_id: assignment.primary_artist_id,
  };
}

function artistAssignmentPatch(assignment) {
  return {
    classification_version: assignment.classification_version,
    region_id: assignment.region_id,
    style_ids: assignment.style_ids,
    subject_ids: assignment.subject_ids,
    decade_ids: assignment.decade_ids,
    classified_artwork_count: assignment.classified_artwork_count,
  };
}

export function buildPilotDocuments({
  sourceArtworks,
  sourceArtists,
  artworkAssignments,
  artistAssignments,
  pilotBatch,
  syncedAt,
}) {
  const artworkById = new Map(sourceArtworks.map((row) => [String(row._id), row]));
  const artistById = new Map(sourceArtists.map((row) => [String(row._id), row]));
  const artworks = artworkAssignments.map((assignment) => {
    const source = artworkById.get(String(assignment._id));
    if (!source) throw new Error(`Missing source artwork ${assignment._id}`);
    return {
      ...source,
      ...assignmentPatch(assignment),
      pilot_batch: pilotBatch,
      pilot_synced_at: syncedAt,
      pilot_source_collection: "artworks",
    };
  });
  const artists = artistAssignments.map((assignment) => {
    const source = artistById.get(String(assignment._id));
    if (!source) throw new Error(`Missing source artist ${assignment._id}`);
    return {
      ...source,
      ...artistAssignmentPatch(assignment),
      pilot_batch: pilotBatch,
      pilot_synced_at: syncedAt,
      pilot_source_collection: "artists",
    };
  });
  return { artworks, artists };
}

async function writeCollection(database, collection, documents, batchSize, report) {
  await withRetry(
    () => database.createCollectionIfNotExists(collection),
    `create collection ${collection}`,
  );
  report.collections[collection] = {
    intended: documents.length,
    batches: 0,
    written: 0,
    verified: 0,
  };
  for (const batch of chunks(documents, batchSize)) {
    await upsertBatch(database, collection, batch);
    report.collections[collection].batches += 1;
    report.collections[collection].written += batch.length;
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
    if (
      ["artworks", "artists", "vocab_terms", "artwork_tag_links", "artwork_artist_links"].includes(
        collection,
      )
    ) {
      throw new Error(`Refusing to target production collection ${collection}`);
    }
  }

  const manifestFiles = {
    pilotArtworks: latestFile(options.manifestDir, "classification-v3-pilot-artworks-", ".jsonl"),
    pilotArtists: latestFile(options.manifestDir, "classification-v3-pilot-artists-", ".jsonl"),
    vocabTerms: latestFile(options.manifestDir, "classification-v3-vocab-terms-", ".jsonl"),
    tagLinks: latestFile(options.manifestDir, "classification-v3-artwork-tag-links-", ".jsonl"),
    artistLinks: latestFile(
      options.manifestDir,
      "classification-v3-artwork-artist-links-",
      ".jsonl",
    ),
  };
  const artworkAssignments = readJsonLines(manifestFiles.pilotArtworks);
  const artistAssignments = readJsonLines(manifestFiles.pilotArtists);
  const vocabTerms = readJsonLines(manifestFiles.vocabTerms);
  const pilotArtworkIds = new Set(artworkAssignments.map((row) => String(row._id)));
  const tagLinks = readJsonLines(manifestFiles.tagLinks).filter((row) =>
    pilotArtworkIds.has(String(row.artwork_id)),
  );
  const artistLinks = readJsonLines(manifestFiles.artistLinks).filter((row) =>
    pilotArtworkIds.has(String(row.artwork_id)),
  );

  const app = createClient(options.envId, env());
  const [sourceArtworks, sourceArtists] = await Promise.all([
    queryCollection(app.database, "artworks", {}),
    queryCollection(app.database, "artists", {}),
  ]);
  const syncedAt = new Date().toISOString();
  const pilotBatch = "classification-v3-pilot-200-20260724";
  const pilotDocuments = buildPilotDocuments({
    sourceArtworks,
    sourceArtists,
    artworkAssignments,
    artistAssignments,
    pilotBatch,
    syncedAt,
  });
  const markedVocabTerms = vocabTerms.map((row) => ({
    ...row,
    pilot_batch: pilotBatch,
    pilot_synced_at: syncedAt,
  }));
  const markedTagLinks = tagLinks.map((row) => ({
    ...row,
    pilot_batch: pilotBatch,
    pilot_synced_at: syncedAt,
  }));
  const markedArtistLinks = artistLinks.map((row) => ({
    ...row,
    pilot_batch: pilotBatch,
    pilot_synced_at: syncedAt,
  }));
  const datasets = {
    [PILOT_COLLECTIONS.artworks]: pilotDocuments.artworks,
    [PILOT_COLLECTIONS.artists]: pilotDocuments.artists,
    [PILOT_COLLECTIONS.vocabTerms]: markedVocabTerms,
    [PILOT_COLLECTIONS.artworkTagLinks]: markedTagLinks,
    [PILOT_COLLECTIONS.artworkArtistLinks]: markedArtistLinks,
  };
  const report = {
    generated_at: syncedAt,
    dry_run: !options.run,
    env_id: options.envId,
    pilot_batch: pilotBatch,
    production_collections_modified: false,
    manifest_files: manifestFiles,
    collections: {},
    checks: {},
  };

  if (options.run) {
    for (const [collection, documents] of Object.entries(datasets)) {
      await writeCollection(app.database, collection, documents, options.batchSize, report);
    }
    for (const [collection, documents] of Object.entries(datasets)) {
      const rows = await queryCollection(app.database, collection, {
        _id: 1,
        classification_version: 1,
        classification_ids: 1,
        tag_ids: 1,
        artist_ids: 1,
        pilot_batch: 1,
      });
      report.collections[collection].verified = rows.length;
      report.collections[collection].version_mismatches = rows.filter(
        (row) => row.classification_version && row.classification_version !== "classification-v3",
      ).length;
      report.collections[collection].batch_mismatches = rows.filter(
        (row) => row.pilot_batch !== pilotBatch,
      ).length;
      report.collections[collection].count_matches = rows.length === documents.length;
    }
    const verifiedArtworks = await queryCollection(app.database, PILOT_COLLECTIONS.artworks, {
      _id: 1,
      classification_version: 1,
      classification_ids: 1,
      artist_ids: 1,
    });
    report.checks.artworks_without_classification = verifiedArtworks.filter(
      (row) => !Array.isArray(row.classification_ids) || !row.classification_ids.length,
    ).length;
    report.checks.artworks_without_artist = verifiedArtworks.filter(
      (row) => !Array.isArray(row.artist_ids) || !row.artist_ids.length,
    ).length;
    report.checks.all_counts_match = Object.values(report.collections).every(
      (collection) => collection.count_matches,
    );
    report.checks.all_versions_match = Object.values(report.collections).every(
      (collection) => collection.version_mismatches === 0,
    );
    report.checks.all_batches_match = Object.values(report.collections).every(
      (collection) => collection.batch_mismatches === 0,
    );
  } else {
    for (const [collection, documents] of Object.entries(datasets)) {
      report.collections[collection] = { intended: documents.length };
    }
  }

  fs.mkdirSync(options.reportDir, { recursive: true });
  const reportPath = path.join(
    options.reportDir,
    `classification-v3-pilot-write-${timestamp()}.json`,
  );
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ report: reportPath, ...report }, null, 2));

  if (
    options.run &&
    (!report.checks.all_counts_match ||
      !report.checks.all_versions_match ||
      !report.checks.all_batches_match ||
      report.checks.artworks_without_classification)
  )
    process.exitCode = 1;
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
