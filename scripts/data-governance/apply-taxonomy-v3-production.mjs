#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const VERSION = "classification-v5";
const WRITE_CONCURRENCY = 4;
const COLLECTIONS = {
  artworks: "artworks",
  artists: "artists",
  vocabTerms: "vocab_terms",
  artworkTagLinks: "artwork_tag_links",
  artworkArtistLinks: "artwork_artist_links",
};
const DEFAULT_MANIFEST_DIR = path.resolve(process.cwd(), "outputs", "taxonomy-v5", "migration");
const DEFAULT_REPORT_DIR = path.resolve(
  process.cwd(),
  "outputs",
  "taxonomy-v5",
  "production-write",
);

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
    envId: PRODUCTION_ENV_ID,
    confirmation: "",
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
    else if (arg === "--confirm-production") {
      options.confirmation = required(argv, (index += 1), arg);
    } else if (arg === "--manifest-dir") {
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
  node scripts/data-governance/apply-taxonomy-v3-production.mjs
  node scripts/data-governance/apply-taxonomy-v3-production.mjs --run \\
    --confirm-production ${PRODUCTION_ENV_ID}

Dry-run is the default. Production writes require the exact environment confirmation.
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

async function withRetry(operation, label, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
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

async function writeBatch(database, collection, documents, upsert) {
  return withRetry(
    () =>
      database.runCommands({
        MgoCommands: [
          {
            TableName: collection,
            CommandType: "UPDATE",
            Command: JSON.stringify({
              update: collection,
              updates: documents.map((document) => {
                const { _id, ...fields } = document;
                return {
                  q: { _id },
                  u: { $set: fields },
                  upsert,
                };
              }),
            }),
          },
        ],
      }),
    `write ${collection}`,
  );
}

async function deleteDataset(database, collection, ids, batchSize, report) {
  const entry = {
    intended: ids.length,
    batches: Math.ceil(ids.length / batchSize),
    completed_batches: 0,
    deleted: 0,
  };
  report.write.deletions ||= {};
  report.write.deletions[collection] = entry;
  for (const batch of chunks(ids, batchSize)) {
    await withRetry(
      () =>
        database.runCommands({
          MgoCommands: [
            {
              TableName: collection,
              CommandType: "DELETE",
              Command: JSON.stringify({
                delete: collection,
                deletes: batch.map((_id) => ({ q: { _id }, limit: 1 })),
              }),
            },
          ],
        }),
      `delete stale ${collection}`,
    );
    entry.completed_batches += 1;
    entry.deleted += batch.length;
  }
}

function artworkSnapshot(row = {}) {
  return {
    classification_version: row.classification_version || "",
    classification_ids: Array.isArray(row.classification_ids) ? row.classification_ids : [],
    tag_ids: Array.isArray(row.tag_ids) ? row.tag_ids : [],
    artist_ids: Array.isArray(row.artist_ids) ? row.artist_ids : [],
    primary_artist_id: row.primary_artist_id || "",
  };
}

function artistSnapshot(row = {}) {
  return {
    classification_version: row.classification_version || "",
    region_id: row.region_id || "",
    style_ids: Array.isArray(row.style_ids) ? row.style_ids : [],
    subject_ids: Array.isArray(row.subject_ids) ? row.subject_ids : [],
    decade_ids: Array.isArray(row.decade_ids) ? row.decade_ids : [],
    classified_artwork_count: Number(row.classified_artwork_count || 0),
  };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function idSetCheck(current, expected) {
  const currentIds = new Set(current.map((row) => String(row._id)));
  const expectedIds = new Set(expected.map((row) => String(row._id)));
  return {
    current: currentIds.size,
    expected: expectedIds.size,
    missing: [...expectedIds].filter((id) => !currentIds.has(id)).slice(0, 20),
    extra: [...currentIds].filter((id) => !expectedIds.has(id)).slice(0, 20),
    matches:
      currentIds.size === expectedIds.size && [...expectedIds].every((id) => currentIds.has(id)),
  };
}

function transitionIdSetCheck(current, before, after) {
  const currentIds = new Set(current.map((row) => String(row._id)));
  const beforeIds = new Set(before.map((row) => String(row._id)));
  const afterIds = new Set(after.map((row) => String(row._id)));
  const missingBaseline = [...beforeIds]
    .filter((id) => afterIds.has(id) && !currentIds.has(id))
    .slice(0, 20);
  const unexpected = [...currentIds]
    .filter((id) => !beforeIds.has(id) && !afterIds.has(id))
    .slice(0, 20);
  return {
    current: currentIds.size,
    before: beforeIds.size,
    after: afterIds.size,
    added: [...currentIds].filter((id) => !beforeIds.has(id)).length,
    remaining: [...afterIds].filter((id) => !currentIds.has(id)).length,
    missing_baseline: missingBaseline,
    unexpected,
    valid_transition: missingBaseline.length === 0 && unexpected.length === 0,
  };
}

export function buildPreflight({
  currentArtworks,
  currentArtists,
  currentVocabTerms,
  currentTagLinks,
  currentArtistLinks,
  artworkAssignments,
  artistAssignments,
  rollbackVocabTerms,
  rollbackTagLinks,
  rollbackArtistLinks,
  targetVocabTerms = rollbackVocabTerms,
  targetTagLinks = rollbackTagLinks,
  targetArtistLinks = rollbackArtistLinks,
}) {
  const artworkById = new Map(currentArtworks.map((row) => [String(row._id), row]));
  const artistById = new Map(currentArtists.map((row) => [String(row._id), row]));
  const artworkIds = idSetCheck(currentArtworks, artworkAssignments);
  const artistIds = idSetCheck(currentArtists, artistAssignments);
  const artworkStates = artworkAssignments.map((assignment) => {
    const current = artworkSnapshot(artworkById.get(String(assignment._id)));
    return {
      id: assignment._id,
      previous: same(current, artworkSnapshot(assignment.previous)),
      target: same(current, artworkSnapshot(assignment)),
    };
  });
  const artistStates = artistAssignments.map((assignment) => {
    const current = artistSnapshot(artistById.get(String(assignment._id)));
    return {
      id: assignment._id,
      previous: same(current, artistSnapshot(assignment.previous)),
      target: same(current, artistSnapshot(assignment)),
    };
  });
  const artworkStateMismatches = artworkStates
    .filter((state) => !state.previous && !state.target)
    .map((state) => state.id)
    .slice(0, 20);
  const artistStateMismatches = artistStates
    .filter((state) => !state.previous && !state.target)
    .map((state) => state.id)
    .slice(0, 20);
  const checks = {
    artwork_ids: artworkIds,
    artist_ids: artistIds,
    artworks_already_migrated: artworkStates.filter((state) => state.target).length,
    artworks_pending: artworkStates.filter((state) => state.previous && !state.target).length,
    artists_already_migrated: artistStates.filter((state) => state.target).length,
    artists_pending: artistStates.filter((state) => state.previous && !state.target).length,
    artwork_state_mismatches: artworkStateMismatches,
    artist_state_mismatches: artistStateMismatches,
    vocab_ids: transitionIdSetCheck(currentVocabTerms, rollbackVocabTerms, targetVocabTerms),
    tag_link_ids: transitionIdSetCheck(currentTagLinks, rollbackTagLinks, targetTagLinks),
    artist_link_ids: transitionIdSetCheck(
      currentArtistLinks,
      rollbackArtistLinks,
      targetArtistLinks,
    ),
  };
  checks.safe_to_write =
    artworkIds.matches &&
    artistIds.matches &&
    artworkStateMismatches.length === 0 &&
    artistStateMismatches.length === 0 &&
    checks.vocab_ids.valid_transition &&
    checks.tag_link_ids.valid_transition &&
    checks.artist_link_ids.valid_transition;
  return checks;
}

function artworkPatch(row, migratedAt, migrationBatch) {
  return {
    _id: row._id,
    classification_version: row.classification_version,
    classification_ids: row.classification_ids,
    tag_ids: row.tag_ids,
    artist_ids: row.artist_ids,
    primary_artist_id: row.primary_artist_id,
    classification_updated_at: migratedAt,
    classification_migration_batch: migrationBatch,
  };
}

function artistPatch(row, migratedAt, migrationBatch) {
  return {
    _id: row._id,
    classification_version: row.classification_version,
    region_id: row.region_id,
    style_ids: row.style_ids,
    subject_ids: row.subject_ids,
    decade_ids: row.decade_ids,
    classified_artwork_count: row.classified_artwork_count,
    classification_updated_at: migratedAt,
    classification_migration_batch: migrationBatch,
  };
}

async function writeDataset(database, collection, documents, batchSize, upsert, report) {
  await withRetry(
    () => database.createCollectionIfNotExists(collection),
    `create collection ${collection}`,
  );
  const entry = {
    intended: documents.length,
    batches: Math.ceil(documents.length / batchSize),
    completed_batches: 0,
    written: 0,
  };
  report.write.collections[collection] = entry;
  const batches = chunks(documents, batchSize);
  let nextIndex = 0;
  async function worker() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= batches.length) return;
      await writeBatch(database, collection, batches[index], upsert);
      entry.completed_batches += 1;
      entry.written += batches[index].length;
      if (entry.completed_batches % 25 === 0 || entry.completed_batches === batches.length) {
        console.log(`[${collection}] ${entry.completed_batches}/${batches.length} batches`);
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(WRITE_CONCURRENCY, batches.length) }, () => worker()),
  );
}

function exactAssignmentMismatches(rows, assignments, snapshot) {
  const rowById = new Map(rows.map((row) => [String(row._id), row]));
  return assignments
    .filter(
      (assignment) => !same(snapshot(rowById.get(String(assignment._id))), snapshot(assignment)),
    )
    .map((assignment) => assignment._id)
    .slice(0, 20);
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function writeReport(reportDir, report) {
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, `${VERSION}-production-write-${timestamp()}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const manifestFiles = {
    artworks: latestFile(options.manifestDir, `${VERSION}-artworks-`, ".jsonl"),
    artists: latestFile(options.manifestDir, `${VERSION}-artists-`, ".jsonl"),
    vocabTerms: latestFile(options.manifestDir, `${VERSION}-vocab-terms-`, ".jsonl"),
    tagLinks: latestFile(options.manifestDir, `${VERSION}-artwork-tag-links-`, ".jsonl"),
    artistLinks: latestFile(options.manifestDir, `${VERSION}-artwork-artist-links-`, ".jsonl"),
    rollbackVocabTerms: latestFile(
      options.manifestDir,
      `${VERSION}-rollback-vocab-terms-`,
      ".jsonl",
    ),
    rollbackTagLinks: latestFile(
      options.manifestDir,
      `${VERSION}-rollback-artwork-tag-links-`,
      ".jsonl",
    ),
    rollbackArtistLinks: latestFile(
      options.manifestDir,
      `${VERSION}-rollback-artwork-artist-links-`,
      ".jsonl",
    ),
  };
  const artworkAssignments = readJsonLines(manifestFiles.artworks);
  const artistAssignments = readJsonLines(manifestFiles.artists);
  const vocabTerms = readJsonLines(manifestFiles.vocabTerms);
  const tagLinks = readJsonLines(manifestFiles.tagLinks);
  const artistLinks = readJsonLines(manifestFiles.artistLinks);
  const rollbackVocabTerms = readJsonLines(manifestFiles.rollbackVocabTerms);
  const rollbackTagLinks = readJsonLines(manifestFiles.rollbackTagLinks);
  const rollbackArtistLinks = readJsonLines(manifestFiles.rollbackArtistLinks);
  const app = createClient(options.envId, env());
  const migratedAt = new Date().toISOString();
  const migrationBatch = `${VERSION}-production-20260727`;
  const report = {
    generated_at: migratedAt,
    dry_run: !options.run,
    env_id: options.envId,
    version: VERSION,
    migration_batch: migrationBatch,
    production_collections_modified: false,
    manifest_files: manifestFiles,
    intended: {
      artworks: artworkAssignments.length,
      artists: artistAssignments.length,
      vocab_terms: vocabTerms.length,
      artwork_tag_links: tagLinks.length,
      artwork_artist_links: artistLinks.length,
    },
    preflight: {},
    write: { collections: {} },
    verification: {},
  };

  try {
    const [
      currentArtworks,
      currentArtists,
      currentVocabTerms,
      currentTagLinks,
      currentArtistLinks,
    ] = await Promise.all([
      queryCollection(app.database, COLLECTIONS.artworks, {
        _id: 1,
        classification_version: 1,
        classification_ids: 1,
        tag_ids: 1,
        artist_ids: 1,
        primary_artist_id: 1,
      }),
      queryCollection(app.database, COLLECTIONS.artists, {
        _id: 1,
        classification_version: 1,
        region_id: 1,
        style_ids: 1,
        subject_ids: 1,
        decade_ids: 1,
        classified_artwork_count: 1,
      }),
      queryCollection(app.database, COLLECTIONS.vocabTerms, { _id: 1 }),
      queryCollection(app.database, COLLECTIONS.artworkTagLinks, { _id: 1 }),
      queryCollection(app.database, COLLECTIONS.artworkArtistLinks, { _id: 1 }),
    ]);
    report.preflight = buildPreflight({
      currentArtworks,
      currentArtists,
      currentVocabTerms,
      currentTagLinks,
      currentArtistLinks,
      artworkAssignments,
      artistAssignments,
      rollbackVocabTerms,
      rollbackTagLinks,
      rollbackArtistLinks,
      targetVocabTerms: vocabTerms,
      targetTagLinks: tagLinks,
      targetArtistLinks: artistLinks,
    });
    if (!report.preflight.safe_to_write) {
      throw new Error("Preflight detected production drift; regenerate manifests before writing.");
    }

    if (options.run) {
      const mark = (row) => ({
        ...row,
        classification_updated_at: migratedAt,
        classification_migration_batch: migrationBatch,
      });
      const staleIds = (current, target) => {
        const targetIds = new Set(target.map((row) => String(row._id)));
        return current.map((row) => String(row._id)).filter((id) => !targetIds.has(id));
      };
      await deleteDataset(
        app.database,
        COLLECTIONS.vocabTerms,
        staleIds(currentVocabTerms, vocabTerms),
        options.batchSize,
        report,
      );
      await deleteDataset(
        app.database,
        COLLECTIONS.artworkArtistLinks,
        staleIds(currentArtistLinks, artistLinks),
        options.batchSize,
        report,
      );
      await deleteDataset(
        app.database,
        COLLECTIONS.artworkTagLinks,
        staleIds(currentTagLinks, tagLinks),
        options.batchSize,
        report,
      );
      await writeDataset(
        app.database,
        COLLECTIONS.vocabTerms,
        vocabTerms.map(mark),
        options.batchSize,
        true,
        report,
      );
      await writeDataset(
        app.database,
        COLLECTIONS.artworkArtistLinks,
        artistLinks.map(mark),
        options.batchSize,
        true,
        report,
      );
      await writeDataset(
        app.database,
        COLLECTIONS.artworkTagLinks,
        tagLinks.map(mark),
        options.batchSize,
        true,
        report,
      );
      await writeDataset(
        app.database,
        COLLECTIONS.artists,
        artistAssignments.map((row) => artistPatch(row, migratedAt, migrationBatch)),
        options.batchSize,
        false,
        report,
      );
      await writeDataset(
        app.database,
        COLLECTIONS.artworks,
        artworkAssignments.map((row) => artworkPatch(row, migratedAt, migrationBatch)),
        options.batchSize,
        false,
        report,
      );
      report.production_collections_modified = true;

      const [artworks, artists, verifiedVocab, verifiedTags, verifiedArtistLinks] =
        await Promise.all([
          queryCollection(app.database, COLLECTIONS.artworks, {
            _id: 1,
            classification_version: 1,
            classification_ids: 1,
            tag_ids: 1,
            artist_ids: 1,
            primary_artist_id: 1,
          }),
          queryCollection(app.database, COLLECTIONS.artists, {
            _id: 1,
            classification_version: 1,
            region_id: 1,
            style_ids: 1,
            subject_ids: 1,
            decade_ids: 1,
            classified_artwork_count: 1,
          }),
          queryCollection(app.database, COLLECTIONS.vocabTerms, { _id: 1 }),
          queryCollection(app.database, COLLECTIONS.artworkTagLinks, { _id: 1 }),
          queryCollection(app.database, COLLECTIONS.artworkArtistLinks, { _id: 1 }),
        ]);
      const artworkMismatches = exactAssignmentMismatches(
        artworks,
        artworkAssignments,
        artworkSnapshot,
      );
      const artistMismatches = exactAssignmentMismatches(
        artists,
        artistAssignments,
        artistSnapshot,
      );
      report.verification = {
        artworks: artworks.length,
        artists: artists.length,
        vocab_terms: verifiedVocab.length,
        artwork_tag_links: verifiedTags.length,
        artwork_artist_links: verifiedArtistLinks.length,
        artworks_without_classification: artworks.filter(
          (row) => !Array.isArray(row.classification_ids) || !row.classification_ids.length,
        ).length,
        artworks_without_artist: artworks.filter(
          (row) => !Array.isArray(row.artist_ids) || !row.artist_ids.length,
        ).length,
        artwork_assignment_mismatches: artworkMismatches,
        artist_assignment_mismatches: artistMismatches,
        vocab_ids: idSetCheck(verifiedVocab, vocabTerms),
        tag_link_ids: idSetCheck(verifiedTags, tagLinks),
        artist_link_ids: idSetCheck(verifiedArtistLinks, artistLinks),
      };
      report.verification.passed =
        artworkMismatches.length === 0 &&
        artistMismatches.length === 0 &&
        report.verification.artworks_without_classification === 0 &&
        report.verification.vocab_ids.matches &&
        report.verification.tag_link_ids.matches &&
        report.verification.artist_link_ids.matches;
      if (!report.verification.passed) {
        throw new Error("Post-write verification failed; use rollback manifests before retrying.");
      }
    }
  } catch (error) {
    report.error = error.message;
    const reportPath = writeReport(options.reportDir, report);
    console.error(JSON.stringify({ report: reportPath, ...report }, null, 2));
    throw error;
  }

  const reportPath = writeReport(options.reportDir, report);
  console.log(JSON.stringify({ report: reportPath, ...report }, null, 2));
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
