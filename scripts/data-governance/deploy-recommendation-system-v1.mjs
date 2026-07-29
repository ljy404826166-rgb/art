#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const RELEASE_VERSION = "recommendation-system-v1";
const DEFAULT_RELEASE_DIR = path.resolve("outputs", "recommendation-system", "task-05");
const DEFAULT_TASK3_DIR = path.resolve("outputs", "recommendation-system", "task-03");
const DEFAULT_TASK4_DIR = path.resolve("outputs", "recommendation-system", "task-04");
const DEFAULT_REPORT_DIR = path.resolve(
  "outputs",
  "recommendation-system",
  "task-05",
  "deployment",
);
const COLLECTIONS = {
  artworks: "artworks",
  vocabTerms: "vocab_terms",
  tagLinks: "artwork_tag_links",
  artistLinks: "artwork_artist_links",
  signals: "recommendation_signals",
  channels: "recommendation_channels",
  signalLinks: "artwork_recommendation_signal_links",
};
const PILOT_COLLECTIONS = Object.fromEntries(
  Object.entries(COLLECTIONS).map(([key, value]) => [key, `${value}_v1_pilot_20260728`]),
);
const WRITE_CONCURRENCY = 4;

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) return;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) return;
      let value = match[2].trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      result[match[1]] = value;
    });
  return result;
}

function environment() {
  return {
    ...parseEnvFile(path.resolve(".env")),
    ...parseEnvFile(path.resolve(".env.local")),
    ...process.env,
  };
}

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(argv = []) {
  const options = {
    run: false,
    mode: "full",
    envId: PRODUCTION_ENV_ID,
    confirmation: "",
    releaseDir: DEFAULT_RELEASE_DIR,
    task3Dir: DEFAULT_TASK3_DIR,
    task4Dir: DEFAULT_TASK4_DIR,
    reportDir: DEFAULT_REPORT_DIR,
    batchSize: 20,
    pilotSize: 100,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--pilot") options.mode = "pilot";
    else if (arg === "--full") options.mode = "full";
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--env-id") options.envId = required(argv, (index += 1), arg);
    else if (arg === "--confirm-production") {
      options.confirmation = required(argv, (index += 1), arg);
    } else if (arg === "--release-dir") {
      options.releaseDir = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--task3-dir") {
      options.task3Dir = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--task4-dir") {
      options.task4Dir = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--report-dir") {
      options.reportDir = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--batch-size") {
      options.batchSize = Number(required(argv, (index += 1), arg));
    } else if (arg === "--pilot-size") {
      options.pilotSize = Number(required(argv, (index += 1), arg));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 50) {
    throw new Error("--batch-size must be an integer between 1 and 50.");
  }
  if (
    !Number.isSafeInteger(options.pilotSize) ||
    options.pilotSize < 1 ||
    options.pilotSize > 1500
  ) {
    throw new Error("--pilot-size must be an integer between 1 and 1500.");
  }
  if (options.run && options.mode === "full") {
    if (options.envId !== PRODUCTION_ENV_ID) {
      throw new Error(`Production writes are restricted to ${PRODUCTION_ENV_ID}.`);
    }
    if (options.confirmation !== PRODUCTION_ENV_ID) {
      throw new Error(`--run --full requires --confirm-production ${PRODUCTION_ENV_ID}.`);
    }
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/data-governance/deploy-recommendation-system-v1.mjs --pilot
  node scripts/data-governance/deploy-recommendation-system-v1.mjs --run --pilot
  node scripts/data-governance/deploy-recommendation-system-v1.mjs --run --full \\
    --confirm-production ${PRODUCTION_ENV_ID}

Dry-run is the default. Pilot writes use isolated collections. Full production
writes require the exact environment confirmation and create local backups.
`;
}

function createClient(envId, config = environment()) {
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
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 750 * attempt));
      }
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${lastError.message}`, {
    cause: lastError,
  });
}

async function collectionExists(database, collection) {
  try {
    await database.describeCollection(collection);
    return true;
  } catch (error) {
    const message = String(error?.message || error?.errMsg || error || "");
    if (/not exist|not found|resource.*not exist|Db or Table not exist/i.test(message)) {
      return false;
    }
    throw error;
  }
}

async function queryCollection(database, collection, projection = {}, optional = false) {
  if (optional && !(await collectionExists(database, collection))) return [];
  const rows = [];
  const pageSize = 500;
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

function readJsonl(filePath) {
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function loadRelease(options) {
  return {
    artworks: readJsonl(path.join(options.releaseDir, "release-artworks.jsonl")),
    vocabTerms: readJsonl(path.join(options.releaseDir, "release-vocab-terms.jsonl")),
    tagLinks: readJsonl(path.join(options.releaseDir, "release-artwork-tag-links.jsonl")),
    artistLinks: readJsonl(path.join(options.releaseDir, "release-artwork-artist-links.jsonl")),
    signals: readJsonl(path.join(options.releaseDir, "release-recommendation-signals.jsonl")),
    channels: readJsonl(path.join(options.releaseDir, "release-recommendation-channels.jsonl")),
    signalLinks: readJsonl(
      path.join(options.releaseDir, "release-artwork-recommendation-signal-links.jsonl"),
    ),
    previousClassification: readJsonl(path.join(options.task3Dir, "rollback-artworks.jsonl")),
    previousRecommendation: readJsonl(
      path.join(options.task4Dir, "rollback-recommendation-artwork-fields.jsonl"),
    ),
    previousTagLinks: readJsonl(path.join(options.task3Dir, "rollback-artwork-tag-links.jsonl")),
    previousArtistLinks: readJsonl(
      path.join(options.task3Dir, "rollback-artwork-artist-links.jsonl"),
    ),
  };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

const ARTWORK_ARRAY_FIELDS = [
  "classification_ids",
  "tag_ids",
  "style_ids",
  "subject_ids",
  "medium_ids",
  "technique_ids",
  "support_ids",
  "format_ids",
  "period_ids",
  "decade_ids",
  "series_ids",
  "region_ids",
  "country_ids",
  "rights_ids",
  "recommendation_term_ids",
  "artist_ids",
  "artist_labels",
  "artist_relation_roles",
  "recommendation_signal_ids",
  "recommendation_ineligibility_reasons",
];
const ARTWORK_SCALAR_FIELDS = [
  "classification_version",
  "taxonomy_version",
  "primary_artist_id",
  "recommendation_status",
  "recommendation_quality_score",
  "random_bucket",
  "recommendation_signal_version",
  "recommendation_random_version",
];

function artworkSnapshot(row = {}) {
  const result = {};
  ARTWORK_ARRAY_FIELDS.forEach((field) => {
    result[field] = asArray(row[field]);
  });
  ARTWORK_SCALAR_FIELDS.forEach((field) => {
    result[field] = field === "primary_artist_id" ? row[field] || null : (row[field] ?? null);
  });
  return result;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function idSet(rows) {
  return new Set(rows.map((row) => String(row._id)));
}

function transitionCheck(current, previous, target) {
  const currentIds = idSet(current);
  const previousIds = idSet(previous);
  const targetIds = idSet(target);
  const unexpected = [...currentIds].filter((id) => !previousIds.has(id) && !targetIds.has(id));
  const missingBaseline = [...previousIds].filter((id) => targetIds.has(id) && !currentIds.has(id));
  return {
    current: currentIds.size,
    previous: previousIds.size,
    target: targetIds.size,
    unexpected: unexpected.slice(0, 20),
    missing_baseline: missingBaseline.slice(0, 20),
    valid: unexpected.length === 0 && missingBaseline.length === 0,
  };
}

export function buildPreflight({
  currentArtworks,
  currentVocabTerms,
  currentTagLinks,
  currentArtistLinks,
  currentSignals,
  currentChannels,
  currentSignalLinks,
  release,
}) {
  const currentArtworkById = new Map(
    currentArtworks.map((artwork) => [String(artwork._id), artwork]),
  );
  const targetById = new Map(release.artworks.map((artwork) => [String(artwork._id), artwork]));
  const previousClassificationById = new Map(
    release.previousClassification.map((artwork) => [String(artwork._id), artwork]),
  );
  const previousRecommendationById = new Map(
    release.previousRecommendation.map((artwork) => [String(artwork._id), artwork]),
  );
  const currentIds = idSet(currentArtworks);
  const targetIds = idSet(release.artworks);
  const unexpectedArtworkIds = [...currentIds].filter((id) => !targetIds.has(id)).sort();
  const missingArtworkIds = [...targetIds].filter((id) => !currentIds.has(id)).sort();
  const artworkMismatches = [];
  const pendingArtworkIds = [];
  let pending = 0;
  let alreadyApplied = 0;
  targetIds.forEach((id) => {
    const current = currentArtworkById.get(id);
    const target = targetById.get(id);
    const previous = {
      ...previousClassificationById.get(id),
      ...previousRecommendationById.get(id),
    };
    if (same(artworkSnapshot(current), artworkSnapshot(target))) {
      alreadyApplied += 1;
    } else if (same(artworkSnapshot(current), artworkSnapshot(previous))) {
      pending += 1;
      pendingArtworkIds.push(id);
    } else {
      artworkMismatches.push(id);
    }
  });
  const vocabIds = idSet(currentVocabTerms);
  const targetVocabIds = idSet(release.vocabTerms);
  const unexpectedVocab = [...vocabIds].filter((id) => !targetVocabIds.has(id));
  const checks = {
    artwork_ids_match: unexpectedArtworkIds.length === 0 && missingArtworkIds.length === 0,
    current_artworks: currentIds.size,
    target_artworks: targetIds.size,
    unexpected_artwork_ids: unexpectedArtworkIds.slice(0, 20),
    missing_artwork_ids: missingArtworkIds.slice(0, 20),
    artworks_pending: pending,
    pending_artwork_ids: pendingArtworkIds.sort(),
    artworks_already_applied: alreadyApplied,
    artwork_state_mismatches: artworkMismatches.slice(0, 20),
    unexpected_vocab_ids: unexpectedVocab.slice(0, 20),
    tag_links: transitionCheck(currentTagLinks, release.previousTagLinks, release.tagLinks),
    artist_links: transitionCheck(
      currentArtistLinks,
      release.previousArtistLinks,
      release.artistLinks,
    ),
    // These three collections are wholly derived and replaced by this release.
    // Treat the current cloud snapshot as the rollback baseline so a later
    // deterministic rebuild may delete stale generated rows after backing them
    // up. Artwork, vocabulary, tag-link, and artist-link drift remain guarded
    // by their explicit source baselines above.
    signals: transitionCheck(currentSignals, currentSignals, release.signals),
    channels: transitionCheck(currentChannels, currentChannels, release.channels),
    signal_links: transitionCheck(currentSignalLinks, currentSignalLinks, release.signalLinks),
  };
  checks.safe_to_write =
    checks.artwork_ids_match &&
    artworkMismatches.length === 0 &&
    unexpectedVocab.length === 0 &&
    checks.tag_links.valid &&
    checks.artist_links.valid &&
    checks.signals.valid &&
    checks.channels.valid &&
    checks.signal_links.valid;
  return checks;
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

async function writeDataset(database, collection, documents, options, report, upsert = true) {
  await withRetry(
    () => database.createCollectionIfNotExists(collection),
    `create collection ${collection}`,
  );
  const batches = chunks(documents, options.batchSize);
  const entry = {
    intended: documents.length,
    batches: batches.length,
    completed_batches: 0,
    written: 0,
  };
  report.write[collection] = entry;
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= batches.length) return;
      await writeBatch(database, collection, batches[index], upsert);
      entry.completed_batches += 1;
      entry.written += batches[index].length;
      if (entry.completed_batches % 25 === 0 || entry.completed_batches === batches.length) {
        console.log(`[${collection}] ${entry.completed_batches}/${batches.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(WRITE_CONCURRENCY, batches.length) }, worker));
}

async function deleteStale(database, collection, current, target, options, report) {
  const targetIds = idSet(target);
  const staleIds = current.map((row) => String(row._id)).filter((id) => !targetIds.has(id));
  report.deleted[collection] = { intended: staleIds.length, deleted: 0 };
  for (const batch of chunks(staleIds, options.batchSize)) {
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
    report.deleted[collection].deleted += batch.length;
  }
}

function artworkPatch(artwork, migratedAt) {
  const fields = {
    _id: artwork._id,
    release_version: RELEASE_VERSION,
    release_updated_at: migratedAt,
  };
  ARTWORK_ARRAY_FIELDS.forEach((field) => {
    fields[field] = asArray(artwork[field]);
  });
  ARTWORK_SCALAR_FIELDS.forEach((field) => {
    fields[field] = artwork[field] ?? null;
  });
  fields.classification_migration_batch = artwork.classification_migration_batch;
  fields.classification_updated_at = migratedAt;
  fields.recommendation_updated_at = migratedAt;
  return fields;
}

export function pilotRelease(release, size, { preferredArtworkIds = [] } = {}) {
  const sortedArtworks = release.artworks
    .slice()
    .sort(
      (left, right) =>
        left.random_bucket - right.random_bucket || left._id.localeCompare(right._id),
    );
  const preferredIds = new Set(preferredArtworkIds.map(String));
  const preferredArtworks = sortedArtworks.filter((artwork) =>
    preferredIds.has(String(artwork._id)),
  );
  if (preferredArtworks.length > size) {
    throw new Error(
      `Pilot size ${size} cannot cover ${preferredArtworks.length} pending artworks.`,
    );
  }
  const artworks = [
    ...preferredArtworks,
    ...sortedArtworks.filter((artwork) => !preferredIds.has(String(artwork._id))),
  ].slice(0, size);
  const artworkIds = idSet(artworks);
  return {
    artworks,
    vocabTerms: release.vocabTerms,
    tagLinks: release.tagLinks.filter((link) => artworkIds.has(String(link.artwork_id))),
    artistLinks: release.artistLinks.filter((link) => artworkIds.has(String(link.artwork_id))),
    signals: release.signals,
    channels: release.channels,
    signalLinks: release.signalLinks.filter((link) => artworkIds.has(String(link.artwork_id))),
  };
}

function indexDefinition(index) {
  return {
    IndexName: index.name,
    MgoKeySchema: {
      MgoIndexKeys: index.keys.map((key) => ({
        Name: key.name,
        Direction: key.direction,
      })),
      MgoIsUnique: false,
    },
  };
}

const INDEXES = {
  [COLLECTIONS.artworks]: [
    {
      name: "status_recommendation_random_id",
      keys: [
        { name: "status", direction: "1" },
        { name: "recommendation_status", direction: "1" },
        { name: "random_bucket", direction: "1" },
        { name: "_id", direction: "1" },
      ],
    },
    {
      name: "status_signal_random_id",
      keys: [
        { name: "status", direction: "1" },
        { name: "recommendation_signal_ids", direction: "1" },
        { name: "random_bucket", direction: "1" },
        { name: "_id", direction: "1" },
      ],
    },
    {
      name: "status_artist_random_id",
      keys: [
        { name: "status", direction: "1" },
        { name: "artist_ids", direction: "1" },
        { name: "random_bucket", direction: "1" },
        { name: "_id", direction: "1" },
      ],
    },
    {
      name: "status_tag_random_id",
      keys: [
        { name: "status", direction: "1" },
        { name: "tag_ids", direction: "1" },
        { name: "random_bucket", direction: "1" },
        { name: "_id", direction: "1" },
      ],
    },
  ],
  [COLLECTIONS.channels]: [
    {
      name: "status_auto_priority",
      keys: [
        { name: "channel_status", direction: "1" },
        { name: "auto_feature_eligible", direction: "1" },
        { name: "priority_score", direction: "-1" },
      ],
    },
  ],
};

async function ensureIndexes(database, collection, definitions) {
  const detail = await database.describeCollection(collection);
  const existing = new Set((detail.Indexes || []).map((index) => index.Name));
  const missing = definitions.filter((index) => !existing.has(index.name));
  if (missing.length) {
    await database.updateCollection(collection, {
      CreateIndexes: missing.map(indexDefinition),
    });
  }
  return missing.map((index) => index.name);
}

async function ensurePermission(permission, collection, targetPermission) {
  await permission.modifyResourcePermission({
    resourceType: "collection",
    resource: collection,
    permission: targetPermission,
  });
  const result = await permission.describeResourcePermission({
    resourceType: "collection",
    resources: [collection],
  });
  const current = (result.Data?.PermissionList || []).find(
    (item) => item.Resource === collection,
  )?.Permission;
  if (current !== targetPermission) {
    throw new Error(`Permission verification failed for ${collection}`);
  }
  return current;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
}

function writeReport(reportDir, report) {
  fs.mkdirSync(reportDir, { recursive: true });
  const filePath = path.join(reportDir, `${RELEASE_VERSION}-${report.mode}-${timestamp()}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return filePath;
}

async function backupCurrent(reportDir, current, generatedAt) {
  const backupDir = path.join(reportDir, `backup-${generatedAt.replace(/[:.]/g, "-")}`);
  fs.mkdirSync(backupDir, { recursive: true });
  for (const [name, rows] of Object.entries(current)) {
    writeJsonl(path.join(backupDir, `${name}.jsonl`), rows);
  }
  return backupDir;
}

async function loadCurrent(database) {
  const [artworks, vocabTerms, tagLinks, artistLinks, signals, channels, signalLinks] =
    await Promise.all([
      queryCollection(
        database,
        COLLECTIONS.artworks,
        Object.fromEntries(
          ["_id", ...ARTWORK_ARRAY_FIELDS, ...ARTWORK_SCALAR_FIELDS].map((field) => [field, 1]),
        ),
      ),
      queryCollection(database, COLLECTIONS.vocabTerms, {}),
      queryCollection(database, COLLECTIONS.tagLinks, {}),
      queryCollection(database, COLLECTIONS.artistLinks, {}),
      queryCollection(database, COLLECTIONS.signals, {}, true),
      queryCollection(database, COLLECTIONS.channels, {}, true),
      queryCollection(database, COLLECTIONS.signalLinks, {}, true),
    ]);
  return { artworks, vocabTerms, tagLinks, artistLinks, signals, channels, signalLinks };
}

async function verifyDataset(database, collection, expected, projection = { _id: 1 }) {
  const rows = await queryCollection(database, collection, projection);
  const actualIds = idSet(rows);
  const expectedIds = idSet(expected);
  return {
    actual: rows.length,
    expected: expected.length,
    ids_match:
      actualIds.size === expectedIds.size && [...expectedIds].every((id) => actualIds.has(id)),
    rows,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const release = loadRelease(options);
  const app = createClient(options.envId);
  const generatedAt = new Date().toISOString();
  const current = await loadCurrent(app.database);
  const preflight = buildPreflight({
    currentArtworks: current.artworks,
    currentVocabTerms: current.vocabTerms,
    currentTagLinks: current.tagLinks,
    currentArtistLinks: current.artistLinks,
    currentSignals: current.signals,
    currentChannels: current.channels,
    currentSignalLinks: current.signalLinks,
    release,
  });
  const report = {
    generated_at: generatedAt,
    mode: options.mode,
    dry_run: !options.run,
    env_id: options.envId,
    release_version: RELEASE_VERSION,
    production_collections_modified: false,
    preflight,
    intended: Object.fromEntries(
      [
        "artworks",
        "vocabTerms",
        "tagLinks",
        "artistLinks",
        "signals",
        "channels",
        "signalLinks",
      ].map((key) => [key, release[key].length]),
    ),
    write: {},
    deleted: {},
    indexes_created: {},
    permissions: {},
    verification: {},
  };

  try {
    if (!preflight.safe_to_write) {
      throw new Error("Preflight detected production drift; regenerate release artifacts.");
    }
    if (!options.run) {
      const reportPath = writeReport(options.reportDir, report);
      console.log(JSON.stringify({ report: reportPath, ...report }, null, 2));
      return;
    }

    if (options.mode === "pilot") {
      const pilot = pilotRelease(release, options.pilotSize, {
        preferredArtworkIds: preflight.pending_artwork_ids,
      });
      const pilotArtworkIds = idSet(pilot.artworks);
      report.pilot = {
        requested_size: options.pilotSize,
        pending_artworks: preflight.pending_artwork_ids.length,
        pending_artworks_included: preflight.pending_artwork_ids.filter((id) =>
          pilotArtworkIds.has(id),
        ).length,
      };
      for (const [key, documents] of Object.entries(pilot)) {
        const collection = PILOT_COLLECTIONS[key];
        const currentPilot = await queryCollection(app.database, collection);
        await deleteStale(app.database, collection, currentPilot, documents, options, report);
        await writeDataset(app.database, collection, documents, options, report, true);
      }
      for (const [key, documents] of Object.entries(pilot)) {
        const verification = await verifyDataset(app.database, PILOT_COLLECTIONS[key], documents);
        report.verification[PILOT_COLLECTIONS[key]] = {
          actual: verification.actual,
          expected: verification.expected,
          ids_match: verification.ids_match,
        };
      }
      report.verification.passed = Object.values(report.verification)
        .filter((value) => typeof value === "object")
        .every((value) => value.ids_match);
      if (!report.verification.passed) throw new Error("Pilot verification failed.");
    } else {
      report.backup_dir = await backupCurrent(options.reportDir, current, generatedAt);
      for (const collection of Object.values(COLLECTIONS)) {
        await withRetry(
          () => app.database.createCollectionIfNotExists(collection),
          `create ${collection}`,
        );
      }
      await writeDataset(app.database, COLLECTIONS.vocabTerms, release.vocabTerms, options, report);
      await writeDataset(app.database, COLLECTIONS.signals, release.signals, options, report);
      await writeDataset(app.database, COLLECTIONS.channels, release.channels, options, report);
      await writeDataset(app.database, COLLECTIONS.tagLinks, release.tagLinks, options, report);
      await writeDataset(
        app.database,
        COLLECTIONS.artistLinks,
        release.artistLinks,
        options,
        report,
      );
      await writeDataset(
        app.database,
        COLLECTIONS.signalLinks,
        release.signalLinks,
        options,
        report,
      );
      await deleteStale(
        app.database,
        COLLECTIONS.vocabTerms,
        current.vocabTerms,
        release.vocabTerms,
        options,
        report,
      );
      await deleteStale(
        app.database,
        COLLECTIONS.tagLinks,
        current.tagLinks,
        release.tagLinks,
        options,
        report,
      );
      await deleteStale(
        app.database,
        COLLECTIONS.artistLinks,
        current.artistLinks,
        release.artistLinks,
        options,
        report,
      );
      await deleteStale(
        app.database,
        COLLECTIONS.signals,
        current.signals,
        release.signals,
        options,
        report,
      );
      await deleteStale(
        app.database,
        COLLECTIONS.channels,
        current.channels,
        release.channels,
        options,
        report,
      );
      await deleteStale(
        app.database,
        COLLECTIONS.signalLinks,
        current.signalLinks,
        release.signalLinks,
        options,
        report,
      );
      await writeDataset(
        app.database,
        COLLECTIONS.artworks,
        release.artworks.map((artwork) => artworkPatch(artwork, generatedAt)),
        options,
        report,
        false,
      );
      report.production_collections_modified = true;

      report.permissions[COLLECTIONS.signals] = await ensurePermission(
        app.permission,
        COLLECTIONS.signals,
        "READONLY",
      );
      report.permissions[COLLECTIONS.channels] = await ensurePermission(
        app.permission,
        COLLECTIONS.channels,
        "READONLY",
      );
      report.permissions[COLLECTIONS.signalLinks] = await ensurePermission(
        app.permission,
        COLLECTIONS.signalLinks,
        "PRIVATE",
      );
      for (const [collection, definitions] of Object.entries(INDEXES)) {
        report.indexes_created[collection] = await ensureIndexes(
          app.database,
          collection,
          definitions,
        );
      }

      const verifications = await Promise.all([
        verifyDataset(
          app.database,
          COLLECTIONS.artworks,
          release.artworks,
          Object.fromEntries(
            ["_id", ...ARTWORK_ARRAY_FIELDS, ...ARTWORK_SCALAR_FIELDS].map((field) => [field, 1]),
          ),
        ),
        verifyDataset(app.database, COLLECTIONS.vocabTerms, release.vocabTerms),
        verifyDataset(app.database, COLLECTIONS.tagLinks, release.tagLinks),
        verifyDataset(app.database, COLLECTIONS.artistLinks, release.artistLinks),
        verifyDataset(app.database, COLLECTIONS.signals, release.signals),
        verifyDataset(app.database, COLLECTIONS.channels, release.channels),
        verifyDataset(app.database, COLLECTIONS.signalLinks, release.signalLinks),
      ]);
      const keys = [
        "artworks",
        "vocab_terms",
        "artwork_tag_links",
        "artwork_artist_links",
        "recommendation_signals",
        "recommendation_channels",
        "artwork_recommendation_signal_links",
      ];
      keys.forEach((key, index) => {
        const verification = verifications[index];
        report.verification[key] = {
          actual: verification.actual,
          expected: verification.expected,
          ids_match: verification.ids_match,
        };
      });
      const artworkById = new Map(verifications[0].rows.map((row) => [String(row._id), row]));
      const artworkMismatches = release.artworks.filter(
        (artwork) =>
          !same(artworkSnapshot(artworkById.get(String(artwork._id))), artworkSnapshot(artwork)),
      );
      report.verification.artwork_field_mismatches = artworkMismatches
        .slice(0, 20)
        .map((artwork) => artwork._id);
      report.verification.passed =
        Object.values(report.verification)
          .filter((value) => typeof value === "object")
          .every((value) => value.ids_match !== false) && artworkMismatches.length === 0;
      if (!report.verification.passed) {
        throw new Error("Production verification failed; use the generated backup.");
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
