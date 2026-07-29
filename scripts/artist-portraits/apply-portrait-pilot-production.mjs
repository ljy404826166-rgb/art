#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { atomicWrite, jsonlText, readJsonl, stringValue } from "./portrait-candidate-lib.mjs";

const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const COLLECTION = "artists";
const ARTWORK_COLLECTION = "artworks";
const LINK_COLLECTION = "artwork_artist_links";
const DEFAULT_TASK4_DIR = path.resolve(
  "outputs",
  "artist-portraits",
  "20260726T064155Z-task4-pilot",
);
const DEFAULT_TASK5_DIR = path.resolve(
  "outputs",
  "artist-portraits",
  "20260726T064155Z-task5-pilot",
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  "outputs",
  "artist-portraits",
  "20260726T064155Z-task6-pilot",
);
const PORTRAIT_FIELDS = [
  "portrait_url",
  "portrait_source",
  "portrait_license",
  "portrait_credit",
  "portrait_kind",
  "portrait_artwork_id",
  "portrait_status",
  "portrait_updated_at",
];
const REQUIRED_DISPLAY_FIELDS = [
  "portrait_url",
  "portrait_source",
  "portrait_license",
  "portrait_credit",
  "portrait_kind",
  "portrait_status",
  "portrait_updated_at",
];
const CORE_OUTPUTS = [
  "production-backup.jsonl",
  "production-backup-meta.json",
  "production-portrait-baseline.json",
  "database-dry-run.json",
  "rollback-manifest.jsonl",
  "database-write-report.json",
  "verification-report.json",
  "task6-audit.json",
];

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
    task4Dir: DEFAULT_TASK4_DIR,
    task5Dir: DEFAULT_TASK5_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    expectedCount: 19,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--env-id") options.envId = required(argv, ++index, arg);
    else if (arg === "--confirm-production") {
      options.confirmation = required(argv, ++index, arg);
    } else if (arg === "--task4-dir") {
      options.task4Dir = path.resolve(required(argv, ++index, arg));
    } else if (arg === "--task5-dir") {
      options.task5Dir = path.resolve(required(argv, ++index, arg));
    } else if (arg === "--output-dir") {
      options.outputDir = path.resolve(required(argv, ++index, arg));
    } else if (arg === "--expected-count") {
      options.expectedCount = Number(required(argv, ++index, arg));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isSafeInteger(options.expectedCount) || options.expectedCount < 1) {
    throw new Error("--expected-count must be a positive integer.");
  }
  if (options.envId !== PRODUCTION_ENV_ID) {
    throw new Error(`Task 6 is restricted to ${PRODUCTION_ENV_ID}.`);
  }
  if (options.run && options.confirmation !== PRODUCTION_ENV_ID) {
    throw new Error(`--run requires --confirm-production ${PRODUCTION_ENV_ID}.`);
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/artist-portraits/apply-portrait-pilot-production.mjs
  node scripts/artist-portraits/apply-portrait-pilot-production.mjs --run \\
    --confirm-production ${PRODUCTION_ENV_ID}

Dry-run is the default. The tool updates only the eight portrait display fields
for the 19 approved pilot artists and never changes collection permissions.
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

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function sameValue(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function sha256Text(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function sha256Buffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function own(record, field) {
  return Object.prototype.hasOwnProperty.call(record || {}, field);
}

export function portraitFields(record = {}) {
  return Object.fromEntries(
    PORTRAIT_FIELDS.filter((field) => own(record, field)).map((field) => [field, record[field]]),
  );
}

function withoutPortraitFields(record = {}) {
  return Object.fromEntries(
    Object.entries(record).filter(([field]) => !PORTRAIT_FIELDS.includes(field)),
  );
}

function recordsById(records) {
  return new Map(records.map((record) => [String(record._id || record.artist_id), record]));
}

function exactIdSet(actual, expectedIds) {
  const actualIds = new Set(actual.map((record) => String(record._id || record.artist_id)));
  return actualIds.size === expectedIds.size && [...expectedIds].every((id) => actualIds.has(id));
}

export function buildDesiredPortraits(
  reviews,
  uploadManifest,
  uploadReport,
  expectedCount = reviews.length,
  fallbackUpdatedAt = "",
) {
  const selected = reviews.filter((record) => record.final_status === "selected");
  const uploadsById = recordsById(uploadManifest);
  const reportObjects = uploadReport.objects || [];
  const reportById = recordsById(reportObjects);
  if (reviews.length !== expectedCount) {
    throw new Error(`Task 6 requires ${expectedCount} reviewed records; found ${reviews.length}.`);
  }
  if (selected.length !== uploadManifest.length || selected.length !== reportObjects.length) {
    throw new Error(
      "Task 6 requires one Task 5 upload and verified object for each selected review.",
    );
  }
  const updatedAt = stringValue(uploadReport.generated_at || fallbackUpdatedAt);
  if (!updatedAt || (selected.length && uploadReport.mode !== "uploaded")) {
    throw new Error("Task 5 upload report is not a completed upload.");
  }
  return reviews.map((review) => {
    if (review.final_status !== "selected") {
      if (!["no_eligible_asset", "non_person_entity"].includes(review.final_status)) {
        throw new Error(`Unsupported final portrait status: ${review.artist_id}`);
      }
      return {
        _id: review.artist_id,
        portrait_status: review.final_status,
        portrait_updated_at: updatedAt,
      };
    }
    const upload = uploadsById.get(review.artist_id);
    const remote = reportById.get(review.artist_id);
    if (!upload || !remote?.verified) {
      throw new Error(`Missing verified Task 5 upload: ${review.artist_id}`);
    }
    if (
      upload.public_url !== remote.public_url ||
      upload.sha256 !== remote.remote_sha256 ||
      upload.content_type !== "image/webp" ||
      remote.remote_content_type !== "image/webp" ||
      Number(remote.remote_width) !== 512 ||
      Number(remote.remote_height) !== 512
    ) {
      throw new Error(`Task 5 upload evidence mismatch: ${review.artist_id}`);
    }
    const desired = {
      _id: review.artist_id,
      portrait_url: upload.public_url,
      portrait_source: review.portrait_source_url,
      portrait_license: review.portrait_license,
      portrait_credit: review.portrait_credit,
      portrait_kind: review.portrait_kind,
      portrait_status: "approved",
      portrait_updated_at: updatedAt,
    };
    if (review.portrait_artwork_id) {
      desired.portrait_artwork_id = review.portrait_artwork_id;
    }
    for (const field of REQUIRED_DISPLAY_FIELDS) {
      if (!stringValue(desired[field])) {
        throw new Error(`Missing ${field}: ${review.artist_id}`);
      }
    }
    return desired;
  });
}

export function buildPatch(current, desired) {
  const set = Object.fromEntries(
    PORTRAIT_FIELDS.filter((field) => own(desired, field)).map((field) => [field, desired[field]]),
  );
  const unset = Object.fromEntries(
    PORTRAIT_FIELDS.filter((field) => !own(desired, field) && own(current, field)).map((field) => [
      field,
      "",
    ]),
  );
  return {
    artist_id: desired._id,
    set,
    unset,
    differences: PORTRAIT_FIELDS.flatMap((field) => {
      const beforeExists = own(current, field);
      const afterExists = own(desired, field);
      const before = beforeExists ? current[field] : null;
      const after = afterExists ? desired[field] : null;
      return beforeExists === afterExists && sameValue(before, after)
        ? []
        : [{ field, before_exists: beforeExists, before, after_exists: afterExists, after }];
    }),
  };
}

export function buildRollbackRecord(current) {
  return {
    artist_id: String(current._id),
    restore_set: portraitFields(current),
    restore_unset: PORTRAIT_FIELDS.filter((field) => !own(current, field)),
    original_document_sha256: sha256Text(JSON.stringify(stableValue(current))),
  };
}

function portraitStateIsBlank(record) {
  return PORTRAIT_FIELDS.every((field) => !stringValue(record[field]));
}

function samePortraitState(record, desired) {
  return PORTRAIT_FIELDS.every((field) => {
    const actualExists = own(record, field);
    const desiredExists = own(desired, field);
    return (
      actualExists === desiredExists && (!actualExists || sameValue(record[field], desired[field]))
    );
  });
}

function validateCurrentTargets(currentTargets, desiredRecords, backupRecords = []) {
  const errors = [];
  const desiredById = recordsById(desiredRecords);
  const backupById = recordsById(backupRecords);
  for (const current of currentTargets) {
    const id = String(current._id);
    const desired = desiredById.get(id);
    const backup = backupById.get(id);
    if (!desired) {
      errors.push({ artist_id: id, code: "target_not_in_desired_records" });
      continue;
    }
    if (current.review_status !== "reviewed" || current.public_visibility !== "visible") {
      errors.push({ artist_id: id, code: "target_not_production_visible" });
    }
    const allowed =
      samePortraitState(current, desired) ||
      (backup ? samePortraitState(current, backup) : portraitStateIsBlank(current));
    if (!allowed) errors.push({ artist_id: id, code: "unexpected_existing_portrait_state" });
  }
  return errors;
}

async function verifyRemoteObjects(desiredRecords, uploadManifest) {
  const uploadsById = recordsById(uploadManifest);
  const results = [];
  for (const desired of desiredRecords.filter((record) => record.portrait_status === "approved")) {
    const upload = uploadsById.get(desired._id);
    const separator = upload.public_url.includes("?") ? "&" : "?";
    const response = await fetch(`${upload.public_url}${separator}task6=${Date.now()}`, {
      cache: "no-store",
      headers: { "user-agent": "ArtArchivePortraitTask6/1.0 (production preflight)" },
    });
    if (!response.ok)
      throw new Error(`Portrait URL returned HTTP ${response.status}: ${desired._id}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    results.push({
      artist_id: desired._id,
      public_url: upload.public_url,
      status: response.status,
      content_type: stringValue(response.headers.get("content-type")).split(";")[0],
      bytes: buffer.length,
      sha256: sha256Buffer(buffer),
      expected_bytes: Number(upload.bytes),
      expected_sha256: upload.sha256,
      verified:
        stringValue(response.headers.get("content-type")).split(";")[0] === "image/webp" &&
        buffer.length === Number(upload.bytes) &&
        sha256Buffer(buffer) === upload.sha256,
    });
  }
  return results;
}

function relationPassed(desiredRecords, artworks, links) {
  const projectPortraits = desiredRecords.filter(
    (record) => record.portrait_status === "approved" && record.portrait_artwork_id,
  );
  const artworkById = recordsById(artworks);
  return projectPortraits.every((record) => {
    const artwork = artworkById.get(record.portrait_artwork_id) || {};
    const artworkRelation =
      String(artwork.primary_artist_id || "") === record._id ||
      (artwork.artist_ids || []).map(String).includes(record._id);
    const stableLink = links.some(
      (link) =>
        String(link.artwork_id) === record.portrait_artwork_id &&
        String(link.artist_id) === record._id,
    );
    return artworkRelation && stableLink;
  });
}

async function updatePortraits(database, patches) {
  const result = await withRetry(
    () =>
      database.runCommands({
        MgoCommands: [
          {
            TableName: COLLECTION,
            CommandType: "UPDATE",
            Command: JSON.stringify({
              update: COLLECTION,
              updates: patches.map((patch) => {
                const update = { $set: patch.set };
                if (Object.keys(patch.unset).length) update.$unset = patch.unset;
                return { q: { _id: patch.artist_id }, u: update, upsert: false };
              }),
            }),
          },
        ],
      }),
    "update artist portraits",
  );
  return {
    request_id: stringValue(result.RequestId || result.requestId),
    command_results: Array.isArray(result.Data) ? result.Data.length : 0,
  };
}

function compareNonTargets(before, after, targetIds) {
  const afterById = recordsById(after);
  return before
    .filter((record) => !targetIds.has(String(record._id)))
    .filter(
      (record) =>
        !sameValue(portraitFields(record), portraitFields(afterById.get(String(record._id)) || {})),
    )
    .map((record) => String(record._id));
}

function compareTargetNonPortraitFields(before, after) {
  const afterById = recordsById(after);
  return before
    .filter(
      (record) =>
        !sameValue(
          withoutPortraitFields(record),
          withoutPortraitFields(afterById.get(String(record._id)) || {}),
        ),
    )
    .map((record) => String(record._id));
}

function writeJson(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function manifestEntry(outputDir, name) {
  const buffer = fs.readFileSync(path.join(outputDir, name));
  return { name, bytes: buffer.length, sha256: sha256Buffer(buffer) };
}

function writeManifest(outputDir, audit) {
  const files = CORE_OUTPUTS.filter((name) => fs.existsSync(path.join(outputDir, name)));
  writeJson(path.join(outputDir, "task6-manifest.json"), {
    generated_at: new Date().toISOString(),
    env_id: PRODUCTION_ENV_ID,
    status: audit.status,
    mode: audit.mode,
    collections_modified: audit.collections_modified,
    permission_changes: 0,
    files: files.map((name) => manifestEntry(outputDir, name)),
  });
}

function buildAudit({
  run,
  allArtistsBefore,
  desiredRecords,
  currentTargets,
  patches,
  remoteResults,
  relationOk,
  preflightErrors,
  verification,
  expectedCount,
}) {
  const errors = [...preflightErrors];
  if (allArtistsBefore.length !== 117)
    errors.push({
      code: "production_artist_count_drift",
      actual: allArtistsBefore.length,
    });
  if (
    desiredRecords.length !== expectedCount ||
    currentTargets.length !== expectedCount ||
    patches.length !== expectedCount
  ) {
    errors.push({
      code: "target_count_mismatch",
      expected: expectedCount,
      desired: desiredRecords.length,
      current: currentTargets.length,
      patches: patches.length,
    });
  }
  if (!remoteResults.every((record) => record.verified)) {
    errors.push({ code: "remote_portrait_verification_failed" });
  }
  if (!relationOk) errors.push({ code: "project_artwork_relation_failed" });
  if (run && !verification?.passed) errors.push({ code: "production_readback_failed" });
  return {
    generated_at: new Date().toISOString(),
    env_id: PRODUCTION_ENV_ID,
    status: errors.length ? "failed" : "passed",
    mode: run ? "production_write" : "dry_run",
    collections_modified: run ? [COLLECTION] : [],
    permission_changes: 0,
    summary: {
      production_artists_before: allArtistsBefore.length,
      target_artists: desiredRecords.length,
      changed_records: patches.filter((patch) => patch.differences.length).length,
      already_idempotent: patches.filter((patch) => !patch.differences.length).length,
      remote_portraits_verified: remoteResults.filter((record) => record.verified).length,
      project_artwork_portraits: desiredRecords.filter((record) => record.portrait_artwork_id)
        .length,
      production_records_verified: verification?.verified_records || 0,
      database_updates: run ? desiredRecords.length : 0,
      errors: errors.length,
    },
    acceptance: {
      expected_target_count: expectedCount,
      all_expected_targets_present:
        desiredRecords.length === expectedCount && currentTargets.length === expectedCount,
      all_targets_visible_and_safe: !preflightErrors.length,
      all_cos_objects_verified: remoteResults.every((record) => record.verified),
      project_artwork_relation_verified: relationOk,
      only_artists_collection_modified: run ? verification?.only_target_portraits_changed : null,
      production_readback_passed: run ? Boolean(verification?.passed) : null,
      permission_changes_zero: true,
    },
    errors,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  fs.mkdirSync(options.outputDir, { recursive: true });
  const reviews = readJsonl(path.join(options.task4Dir, "pilot-final-review.jsonl"));
  const uploadManifest = readJsonl(path.join(options.task5Dir, "upload-manifest.jsonl"));
  const uploadReportPath = path.join(options.task5Dir, "upload-report.json");
  const task4ManifestPath = path.join(options.task4Dir, "task4-manifest.json");
  const task4Manifest = fs.existsSync(task4ManifestPath)
    ? JSON.parse(fs.readFileSync(task4ManifestPath, "utf8"))
    : {};
  const uploadReport = fs.existsSync(uploadReportPath)
    ? JSON.parse(fs.readFileSync(uploadReportPath, "utf8"))
    : { mode: "not_required", objects: [] };
  const desiredRecords = buildDesiredPortraits(
    reviews,
    uploadManifest,
    uploadReport,
    options.expectedCount,
    task4Manifest.generated_at,
  );
  const targetIds = new Set(desiredRecords.map((record) => record._id));
  const projectArtworkIds = desiredRecords
    .map((record) => record.portrait_artwork_id)
    .filter(Boolean);
  const app = createClient(options.envId, environment());
  const [allArtistsBefore, currentTargets, projectArtworks, projectLinks, remoteResults] =
    await Promise.all([
      queryCollection(app.database, COLLECTION),
      queryCollection(app.database, COLLECTION, { _id: { $in: [...targetIds] } }),
      queryCollection(app.database, ARTWORK_COLLECTION, {
        _id: { $in: projectArtworkIds },
      }),
      queryCollection(app.database, LINK_COLLECTION, {
        artwork_id: { $in: projectArtworkIds },
        artist_id: { $in: [...targetIds] },
      }),
      verifyRemoteObjects(desiredRecords, uploadManifest),
    ]);
  if (!exactIdSet(currentTargets, targetIds)) {
    throw new Error("Production preflight failed: target artist IDs are incomplete.");
  }

  const backupPath = path.join(options.outputDir, "production-backup.jsonl");
  let backupRecords = [];
  if (fs.existsSync(backupPath)) {
    backupRecords = readJsonl(backupPath);
    if (!exactIdSet(backupRecords, targetIds)) {
      throw new Error("Existing Task 6 backup does not contain the exact target IDs.");
    }
  } else {
    backupRecords = [...currentTargets].sort((a, b) => String(a._id).localeCompare(String(b._id)));
    atomicWrite(backupPath, jsonlText(backupRecords));
  }
  writeJson(path.join(options.outputDir, "production-backup-meta.json"), {
    generated_at: new Date().toISOString(),
    env_id: options.envId,
    collection: COLLECTION,
    records: backupRecords.length,
    backup_sha256: sha256Buffer(fs.readFileSync(backupPath)),
    portrait_fields: PORTRAIT_FIELDS,
  });

  const preflightErrors = validateCurrentTargets(currentTargets, desiredRecords, backupRecords);
  const currentById = recordsById(currentTargets);
  const patches = desiredRecords.map((desired) =>
    buildPatch(currentById.get(desired._id) || {}, desired),
  );
  const rollbackRecords = backupRecords.map(buildRollbackRecord);
  atomicWrite(path.join(options.outputDir, "rollback-manifest.jsonl"), jsonlText(rollbackRecords));
  const relationOk = relationPassed(desiredRecords, projectArtworks, projectLinks);
  const approvedBefore = allArtistsBefore.filter(
    (record) => record.portrait_status === "approved" && stringValue(record.portrait_url),
  );
  writeJson(path.join(options.outputDir, "production-portrait-baseline.json"), {
    generated_at: new Date().toISOString(),
    env_id: options.envId,
    production_artists: allArtistsBefore.length,
    approved_portraits_before: approvedBefore.length,
    approved_portrait_ids_before: approvedBefore.map((record) => String(record._id)).sort(),
    target_ids: [...targetIds].sort(),
    non_target_portrait_state_sha256: sha256Text(
      JSON.stringify(
        stableValue(
          allArtistsBefore
            .filter((record) => !targetIds.has(String(record._id)))
            .map((record) => ({ _id: record._id, ...portraitFields(record) }))
            .sort((a, b) => String(a._id).localeCompare(String(b._id))),
        ),
      ),
    ),
  });
  const dryRun = {
    generated_at: new Date().toISOString(),
    env_id: options.envId,
    collection: COLLECTION,
    dry_run: true,
    target_records: desiredRecords.length,
    records_with_changes: patches.filter((patch) => patch.differences.length).length,
    already_idempotent: patches.filter((patch) => !patch.differences.length).length,
    project_artwork_relation_verified: relationOk,
    remote_portraits_verified: remoteResults.filter((record) => record.verified).length,
    preflight_errors: preflightErrors,
    production_database_writes: 0,
    patches,
  };
  writeJson(path.join(options.outputDir, "database-dry-run.json"), dryRun);
  if (preflightErrors.length || !relationOk || !remoteResults.every((item) => item.verified)) {
    throw new Error("Task 6 production preflight failed; no database write was performed.");
  }

  let writeReport = {
    generated_at: new Date().toISOString(),
    mode: "dry_run_not_written",
    env_id: options.envId,
    collection: COLLECTION,
    records_requested: 0,
    permission_changes: 0,
  };
  let verification = null;
  if (options.run) {
    const writeResult = await updatePortraits(app.database, patches);
    const [allArtistsAfter, verifiedTargets] = await Promise.all([
      queryCollection(app.database, COLLECTION),
      queryCollection(app.database, COLLECTION, { _id: { $in: [...targetIds] } }),
    ]);
    const verifiedById = recordsById(verifiedTargets);
    const fieldMismatches = desiredRecords
      .filter((desired) => !samePortraitState(verifiedById.get(desired._id) || {}, desired))
      .map((record) => record._id);
    const nonTargetPortraitMismatches = compareNonTargets(
      allArtistsBefore,
      allArtistsAfter,
      targetIds,
    );
    const targetNonPortraitMismatches = compareTargetNonPortraitFields(
      currentTargets,
      verifiedTargets,
    );
    const approvedAfter = allArtistsAfter.filter(
      (record) => record.portrait_status === "approved" && stringValue(record.portrait_url),
    );
    const nonApprovedWithUrl = allArtistsAfter
      .filter((record) => stringValue(record.portrait_url) && record.portrait_status !== "approved")
      .map((record) => String(record._id));
    const projectFieldIds = verifiedTargets
      .filter((record) => stringValue(record.portrait_artwork_id))
      .map((record) => String(record._id));
    verification = {
      generated_at: new Date().toISOString(),
      env_id: options.envId,
      collection: COLLECTION,
      production_artists_after: allArtistsAfter.length,
      verified_records: verifiedTargets.length,
      field_mismatches: fieldMismatches,
      non_target_portrait_mismatches: nonTargetPortraitMismatches,
      target_non_portrait_mismatches: targetNonPortraitMismatches,
      approved_portraits_after: approvedAfter.length,
      approved_portrait_ids_after: approvedAfter.map((record) => String(record._id)).sort(),
      non_approved_records_with_portrait_url: nonApprovedWithUrl,
      portrait_artwork_id_artist_ids: projectFieldIds,
      expected_portrait_artwork_id_artist_ids: desiredRecords
        .filter((record) => record.portrait_artwork_id)
        .map((record) => record._id),
      only_target_portraits_changed:
        nonTargetPortraitMismatches.length === 0 && targetNonPortraitMismatches.length === 0,
      permissions_modified: false,
    };
    verification.passed =
      allArtistsAfter.length === allArtistsBefore.length &&
      verifiedTargets.length === options.expectedCount &&
      fieldMismatches.length === 0 &&
      nonTargetPortraitMismatches.length === 0 &&
      targetNonPortraitMismatches.length === 0 &&
      nonApprovedWithUrl.length === 0 &&
      sameValue(
        projectFieldIds.sort(),
        verification.expected_portrait_artwork_id_artist_ids.sort(),
      );
    writeReport = {
      generated_at: new Date().toISOString(),
      mode: "production_write",
      env_id: options.envId,
      collection: COLLECTION,
      records_requested: desiredRecords.length,
      records_verified: verifiedTargets.length,
      request_id: writeResult.request_id,
      command_results: writeResult.command_results,
      permission_changes: 0,
      passed: verification.passed,
    };
    writeJson(path.join(options.outputDir, "verification-report.json"), verification);
    if (!verification.passed) {
      writeJson(path.join(options.outputDir, "database-write-report.json"), writeReport);
      throw new Error(`Production verification failed; use ${backupPath} for rollback.`);
    }
  } else {
    writeJson(path.join(options.outputDir, "verification-report.json"), {
      generated_at: new Date().toISOString(),
      mode: "pending_production_write",
      passed: null,
      production_database_writes: 0,
    });
  }
  writeJson(path.join(options.outputDir, "database-write-report.json"), writeReport);
  const audit = buildAudit({
    run: options.run,
    allArtistsBefore,
    desiredRecords,
    currentTargets,
    patches,
    remoteResults,
    relationOk,
    preflightErrors,
    verification,
    expectedCount: options.expectedCount,
  });
  writeJson(path.join(options.outputDir, "task6-audit.json"), audit);
  writeManifest(options.outputDir, audit);
  console.log(
    JSON.stringify(
      {
        output_dir: options.outputDir,
        mode: audit.mode,
        status: audit.status,
        summary: audit.summary,
        acceptance: audit.acceptance,
        production_database_writes: options.run ? desiredRecords.length : 0,
        permission_changes: 0,
      },
      null,
      2,
    ),
  );
  return { audit, verification, writeReport };
}

if (
  process.argv[1] &&
  fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(`[portrait-task6] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
