#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";

const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_ARTIFACT_DIR = path.resolve(
  "outputs",
  "recommendation-system",
  "task-06-classification-remediation",
);
const CHANNEL_TERM_IDS = new Set([
  "subject-botanical",
  "subject-floral",
  "subject-animal",
  "subject-architectural-landscape",
]);
const ARRAY_FIELDS = [
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
];
const SCALAR_FIELDS = [
  "classification_version",
  "taxonomy_version",
  "classification_migration_batch",
  "classification_updated_at",
];
const BATCH_SIZE = 20;

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
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
      values[match[1]] = value;
    });
  return values;
}

function environment() {
  return {
    ...parseEnvFile(path.resolve(".env")),
    ...parseEnvFile(path.resolve(".env.local")),
    ...process.env,
  };
}

function parseArgs(argv) {
  const options = {
    run: false,
    envId: PRODUCTION_ENV_ID,
    confirmation: "",
    artifactDir: DEFAULT_ARTIFACT_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--env-id") options.envId = argv[++index];
    else if (arg === "--confirm-production") options.confirmation = argv[++index];
    else if (arg === "--artifact-dir") options.artifactDir = path.resolve(argv[++index]);
    else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  node scripts/data-governance/deploy-classification-remediation.mjs
  node scripts/data-governance/deploy-classification-remediation.mjs --run \\
    --confirm-production ${PRODUCTION_ENV_ID}`);
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.run) {
    if (options.envId !== PRODUCTION_ENV_ID) {
      throw new Error(`Production writes are restricted to ${PRODUCTION_ENV_ID}.`);
    }
    if (options.confirmation !== PRODUCTION_ENV_ID) {
      throw new Error(`--run requires --confirm-production ${PRODUCTION_ENV_ID}.`);
    }
  }
  return options;
}

function createClient(envId) {
  const config = environment();
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

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function writeJsonl(filePath, rows) {
  fs.writeFileSync(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
}

function chunks(values, size = BATCH_SIZE) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function command(database, collection, type, payload) {
  return database.runCommands({
    MgoCommands: [
      {
        TableName: collection,
        CommandType: type,
        Command: JSON.stringify(payload),
      },
    ],
  });
}

async function queryByIds(database, collection, field, ids) {
  const rows = [];
  for (const batch of chunks(ids, 40)) {
    const result = await command(database, collection, "QUERY", {
      find: collection,
      filter: { [field]: { $in: batch } },
      limit: 1000,
    });
    rows.push(...parseCommandRows(result.Data?.[0]));
  }
  return rows;
}

function classificationSnapshot(row = {}) {
  return Object.fromEntries([
    ...ARRAY_FIELDS.map((field) => [field, Array.isArray(row[field]) ? row[field] : []]),
    ...SCALAR_FIELDS.slice(0, 2).map((field) => [field, row[field] ?? null]),
  ]);
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function artworkPatch(row) {
  return Object.fromEntries([
    ["_id", row._id],
    ...ARRAY_FIELDS.map((field) => [field, Array.isArray(row[field]) ? row[field] : []]),
    ...SCALAR_FIELDS.map((field) => [field, row[field] ?? null]),
  ]);
}

async function updateDocuments(database, collection, rows) {
  for (const batch of chunks(rows)) {
    await command(database, collection, "UPDATE", {
      update: collection,
      updates: batch.map((row) => {
        const { _id, ...fields } = row;
        return {
          q: { _id },
          u: { $set: fields },
          upsert: false,
        };
      }),
    });
  }
}

async function upsertDocuments(database, collection, rows) {
  for (const batch of chunks(rows)) {
    await command(database, collection, "UPDATE", {
      update: collection,
      updates: batch.map((row) => {
        const { _id, ...fields } = row;
        return {
          q: { _id },
          u: { $set: fields },
          upsert: true,
        };
      }),
    });
  }
}

async function deleteDocuments(database, collection, ids) {
  for (const batch of chunks(ids)) {
    await command(database, collection, "DELETE", {
      delete: collection,
      deletes: batch.map((_id) => ({ q: { _id }, limit: 1 })),
    });
  }
}

function loadArtifacts(artifactDir) {
  const assignments = readJsonl(path.join(artifactDir, "classification-v6-artworks.jsonl")).filter(
    (row) => row.changed,
  );
  const artworkIds = new Set(assignments.map((row) => row._id));
  const tagLinks = readJsonl(
    path.join(artifactDir, "classification-v6-artwork-tag-links.jsonl"),
  ).filter((row) => artworkIds.has(row.artwork_id));
  const channelCatalog = JSON.parse(
    fs.readFileSync(
      path.join(artifactDir, "recommendation-refresh", "recommendation-channels-v1.json"),
      "utf8",
    ),
  );
  const channels = channelCatalog.channels.filter((row) => CHANNEL_TERM_IDS.has(row.query_value));
  return {
    assignments,
    tagLinks,
    artworkIds,
    channels,
  };
}

function matchesTargetFields(current, target) {
  return Object.entries(target).every(([key, value]) => same(current?.[key], value));
}

async function run(options) {
  const artifacts = loadArtifacts(options.artifactDir);
  if (artifacts.assignments.length !== 57) {
    throw new Error(
      `Expected the reviewed 57-artwork remediation set, got ${artifacts.assignments.length}.`,
    );
  }

  const app = createClient(options.envId);
  const database = app.database;
  const ids = [...artifacts.artworkIds];
  const [currentArtworks, currentTagLinks, currentChannels] = await Promise.all([
    queryByIds(database, "artworks", "_id", ids),
    queryByIds(database, "artwork_tag_links", "artwork_id", ids),
    queryByIds(
      database,
      "recommendation_channels",
      "_id",
      artifacts.channels.map((row) => row._id),
    ),
  ]);
  const currentById = new Map(currentArtworks.map((row) => [row._id, row]));
  let alreadyAppliedArtworks = 0;
  const stateMismatches = artifacts.assignments
    .filter((target) => {
      const current = currentById.get(target._id);
      const matchesPrevious =
        current && same(classificationSnapshot(current), classificationSnapshot(target.previous));
      const matchesTarget =
        current && same(classificationSnapshot(current), classificationSnapshot(target));
      if (matchesTarget) alreadyAppliedArtworks += 1;
      return !matchesPrevious && !matchesTarget;
    })
    .map((row) => row._id);
  if (stateMismatches.length) {
    throw new Error(
      `Production state drift detected for ${stateMismatches.slice(0, 10).join(", ")}.`,
    );
  }

  const targetLinkIds = new Set(artifacts.tagLinks.map((row) => row._id));
  const staleLinkIds = currentTagLinks
    .filter((row) => !targetLinkIds.has(row._id))
    .map((row) => row._id);
  const report = {
    mode: options.run ? "production-write" : "read-only-dry-run",
    env_id: options.envId,
    artifact_dir: options.artifactDir,
    artworks: artifacts.assignments.length,
    current_tag_links: currentTagLinks.length,
    target_tag_links: artifacts.tagLinks.length,
    stale_tag_links: staleLinkIds.length,
    channels: artifacts.channels.length,
    already_applied_artworks: alreadyAppliedArtworks,
    state_mismatches: stateMismatches,
    cloud_writes_performed: false,
  };

  if (!options.run) {
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "");
  const backupDir = path.join(options.artifactDir, "deployment", timestamp);
  fs.mkdirSync(backupDir, { recursive: true });
  writeJsonl(path.join(backupDir, "rollback-artworks.jsonl"), currentArtworks);
  writeJsonl(path.join(backupDir, "rollback-artwork-tag-links.jsonl"), currentTagLinks);
  writeJsonl(path.join(backupDir, "rollback-recommendation-channels.jsonl"), currentChannels);

  await updateDocuments(database, "artworks", artifacts.assignments.map(artworkPatch));
  await upsertDocuments(database, "artwork_tag_links", artifacts.tagLinks);
  await deleteDocuments(database, "artwork_tag_links", staleLinkIds);
  await updateDocuments(database, "recommendation_channels", artifacts.channels);

  const [verifiedArtworks, verifiedLinks, verifiedChannels] = await Promise.all([
    queryByIds(database, "artworks", "_id", ids),
    queryByIds(database, "artwork_tag_links", "artwork_id", ids),
    queryByIds(
      database,
      "recommendation_channels",
      "_id",
      artifacts.channels.map((row) => row._id),
    ),
  ]);
  const verifiedById = new Map(verifiedArtworks.map((row) => [row._id, row]));
  const artworkVerificationFailures = artifacts.assignments
    .filter(
      (target) =>
        !same(classificationSnapshot(verifiedById.get(target._id)), classificationSnapshot(target)),
    )
    .map((row) => row._id);
  const verifiedLinkIds = new Set(verifiedLinks.map((row) => row._id));
  const linkVerificationFailures = [
    ...[...targetLinkIds].filter((id) => !verifiedLinkIds.has(id)),
    ...[...verifiedLinkIds].filter((id) => !targetLinkIds.has(id)),
  ];
  const verifiedChannelById = new Map(verifiedChannels.map((row) => [row._id, row]));
  const channelVerificationFailures = artifacts.channels
    .filter((target) => !matchesTargetFields(verifiedChannelById.get(target._id), target))
    .map((row) => row._id);
  if (
    artworkVerificationFailures.length ||
    linkVerificationFailures.length ||
    channelVerificationFailures.length
  ) {
    throw new Error(
      `Verification failed: artworks=${artworkVerificationFailures.length}, ` +
        `tag_links=${linkVerificationFailures.length}, ` +
        `channels=${channelVerificationFailures.length}. Rollback files: ${backupDir}`,
    );
  }

  report.cloud_writes_performed = true;
  report.backup_dir = backupDir;
  report.verified_artworks = verifiedArtworks.length;
  report.verified_tag_links = verifiedLinks.length;
  report.verified_channels = verifiedChannels.length;
  report.artwork_verification_failures = artworkVerificationFailures;
  report.tag_link_verification_failures = linkVerificationFailures;
  report.channel_verification_failures = channelVerificationFailures;
  fs.writeFileSync(
    path.join(backupDir, "deployment-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  console.log(JSON.stringify(report, null, 2));
  return report;
}

const options = parseArgs(process.argv.slice(2));
run(options).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
