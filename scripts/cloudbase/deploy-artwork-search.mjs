#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SEARCH_SOURCE_FIELDS, buildArtworkSearchTerms } from "./artwork-search-terms.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const MANIFEST_PATH = path.join(PROJECT_ROOT, "cloudbase", "artwork-search.json");
const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";

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
    ) {
      value = value.slice(1, -1);
    }
    result[match[1]] = value;
  }
  return result;
}

function environment() {
  return {
    ...parseEnvFile(path.join(PROJECT_ROOT, ".env")),
    ...parseEnvFile(path.join(PROJECT_ROOT, ".env.local")),
    ...process.env,
  };
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv = []) {
  const options = {
    envId: PRODUCTION_ENV_ID,
    run: false,
    confirmation: "",
    batchSize: 20,
    indexesOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--indexes-only") options.indexesOnly = true;
    else if (arg === "--env-id") {
      options.envId = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--confirm-production") {
      options.confirmation = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--batch-size") {
      options.batchSize = Number(requiredValue(argv, (index += 1), arg));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isSafeInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 50) {
    throw new Error("--batch-size must be an integer between 1 and 50.");
  }
  if (options.run && options.envId !== PRODUCTION_ENV_ID) {
    throw new Error(`Writes are restricted to ${PRODUCTION_ENV_ID}.`);
  }
  if (options.run && options.confirmation !== PRODUCTION_ENV_ID) {
    throw new Error(`--run requires --confirm-production ${PRODUCTION_ENV_ID}.`);
  }
  return options;
}

function createClient(envId, config = environment()) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error("Missing Tencent Cloud credentials.");
  }
  return CloudBase.init({ envId, secretId, secretKey });
}

function normalizeExtendedJson(value) {
  if (Array.isArray(value)) return value.map(normalizeExtendedJson);
  if (!value || typeof value !== "object") return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$numberInt") {
    return Number(value.$numberInt);
  }
  if (keys.length === 1 && keys[0] === "$numberLong") {
    return Number(value.$numberLong);
  }
  if (keys.length === 1 && keys[0] === "$numberDouble") {
    return Number(value.$numberDouble);
  }
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
  throw new Error(`${label} failed: ${lastError.message}`, { cause: lastError });
}

async function queryArtworks(database, collection) {
  const projection = Object.fromEntries(
    ["_id", "status", "search_terms", "search_terms_version", ...SEARCH_SOURCE_FIELDS].map(
      (field) => [field, 1],
    ),
  );
  const rows = [];
  // search_terms can contain hundreds of values. Keep response pages small
  // enough to stay below CloudBase's command response-size ceiling.
  const pageSize = 100;
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

function sameStringArray(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function planUpdates(rows, version) {
  return rows
    .map((row) => {
      const searchTerms = buildArtworkSearchTerms(row);
      if (row.search_terms_version === version && sameStringArray(row.search_terms, searchTerms)) {
        return null;
      }
      return {
        _id: row._id,
        search_terms: searchTerms,
        search_terms_version: version,
      };
    })
    .filter(Boolean);
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function writeUpdates(database, collection, updates, batchSize) {
  let completed = 0;
  for (const batch of chunks(updates, batchSize)) {
    await withRetry(
      () =>
        database.runCommands({
          MgoCommands: [
            {
              TableName: collection,
              CommandType: "UPDATE",
              Command: JSON.stringify({
                update: collection,
                updates: batch.map(({ _id, ...fields }) => ({
                  q: { _id },
                  u: { $set: fields },
                  upsert: false,
                })),
              }),
            },
          ],
        }),
      `update ${collection}`,
    );
    completed += batch.length;
    if (completed % 500 === 0 || completed === updates.length) {
      process.stdout.write(`[artwork-search] backfilled ${completed}/${updates.length}\n`);
    }
  }
  return completed;
}

function indexDefinition(index) {
  return {
    IndexName: index.name,
    MgoKeySchema: {
      MgoIndexKeys: index.keys.map((key) => ({
        Name: key.name,
        Direction: key.direction,
      })),
      MgoIsUnique: index.unique === true,
    },
  };
}

async function inspectIndexes(database, collection, manifest) {
  const detail = await database.describeCollection(collection);
  const existing = new Set((detail.Indexes || []).map((index) => index.Name));
  return manifest.indexes.filter((index) => !existing.has(index.name));
}

async function createMissingIndexes(database, collection, indexes) {
  if (!indexes.length) return [];
  await database.updateCollection(collection, {
    CreateIndexes: indexes.map(indexDefinition),
  });
  return indexes.map((index) => index.name);
}

function writeReport(report) {
  const reportDir = path.join(PROJECT_ROOT, "outputs", "artwork-search");
  fs.mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(reportDir, `deployment-${stamp}.json`);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const app = createClient(options.envId);
  if (options.indexesOnly) {
    const missingIndexes = await inspectIndexes(app.database, manifest.collection, manifest);
    const report = {
      mode: options.run ? "run" : "dry-run",
      env_id: options.envId,
      collection: manifest.collection,
      indexes_only: true,
      indexes_missing: missingIndexes.map((index) => index.name),
    };
    if (options.run) {
      report.indexes_created = await createMissingIndexes(
        app.database,
        manifest.collection,
        missingIndexes,
      );
      report.verification_indexes_missing = (
        await inspectIndexes(app.database, manifest.collection, manifest)
      ).map((index) => index.name);
      report.ok = report.verification_indexes_missing.length === 0;
    }
    const reportPath = writeReport(report);
    process.stdout.write(`${JSON.stringify({ ...report, report_path: reportPath }, null, 2)}\n`);
    if (options.run && !report.ok) process.exitCode = 1;
    return;
  }
  const rows = await queryArtworks(app.database, manifest.collection);
  const updates = planUpdates(rows, manifest.searchTermsVersion);
  const missingIndexes = await inspectIndexes(app.database, manifest.collection, manifest);
  const report = {
    mode: options.run ? "run" : "dry-run",
    env_id: options.envId,
    collection: manifest.collection,
    scanned: rows.length,
    published: rows.filter((row) => row.status === "published").length,
    updates_required: updates.length,
    indexes_missing: missingIndexes.map((index) => index.name),
    search_terms: {
      min: updates.length ? Math.min(...updates.map((item) => item.search_terms.length)) : 0,
      max: updates.length ? Math.max(...updates.map((item) => item.search_terms.length)) : 0,
    },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (options.run) {
    report.updated = await writeUpdates(
      app.database,
      manifest.collection,
      updates,
      options.batchSize,
    );
    report.indexes_created = await createMissingIndexes(
      app.database,
      manifest.collection,
      missingIndexes,
    );
    const verificationRows = await queryArtworks(app.database, manifest.collection);
    report.verification_updates_remaining = planUpdates(
      verificationRows,
      manifest.searchTermsVersion,
    ).length;
    report.verification_indexes_missing = (
      await inspectIndexes(app.database, manifest.collection, manifest)
    ).map((index) => index.name);
    report.ok =
      report.verification_updates_remaining === 0 &&
      report.verification_indexes_missing.length === 0;
  }

  const reportPath = writeReport(report);
  process.stdout.write(`${JSON.stringify({ report_path: reportPath, ok: report.ok ?? true })}\n`);
  if (options.run && !report.ok) process.exitCode = 1;
}

export { PRODUCTION_ENV_ID, indexDefinition, parseArgs, planUpdates, sameStringArray };

if (
  process.argv[1] &&
  path.basename(process.argv[1]).toLowerCase() ===
    path.basename(fileURLToPath(import.meta.url)).toLowerCase()
) {
  main().catch((error) => {
    console.error(`[artwork-search] ${error.message}`);
    process.exitCode = 1;
  });
}
