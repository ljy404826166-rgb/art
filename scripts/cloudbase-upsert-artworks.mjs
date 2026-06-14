#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_COLLECTION = "artworks";
const DEFAULT_INPUT = path.resolve(process.cwd(), "miniapp", "data", "artworks.json");
const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), "csv", "cloudbase");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

function env() {
  return { ...parseEnvFile(".env"), ...parseEnvFile(".env.local"), ...process.env };
}

function parseArgs(argv) {
  const options = {
    run: false,
    pruneStale: false,
    input: DEFAULT_INPUT,
    envId: process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID || DEFAULT_ENV_ID,
    collection: DEFAULT_COLLECTION,
    reportDir: DEFAULT_REPORT_DIR,
    batchSize: 20,
    limit: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--prune-stale") options.pruneStale = true;
    else if (arg === "--in") options.input = path.resolve(required(argv, (index += 1), arg));
    else if (arg === "--env-id") options.envId = required(argv, (index += 1), arg);
    else if (arg === "--collection") options.collection = required(argv, (index += 1), arg);
    else if (arg === "--report-dir") options.reportDir = path.resolve(required(argv, (index += 1), arg));
    else if (arg === "--batch-size") options.batchSize = positiveInt(required(argv, (index += 1), arg), arg);
    else if (arg === "--limit") options.limit = positiveInt(required(argv, (index += 1), arg), arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.batchSize > 50) throw new Error("--batch-size must be <= 50 to keep CloudBase commands small.");
  return options;
}

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function positiveInt(value, flag) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${flag} must be a positive integer.`);
  return number;
}

function readDocuments(filePath, limit) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  const rows = text.startsWith("[") ? JSON.parse(text) : text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const docs = (limit ? rows.slice(0, limit) : rows).map((row) => ({ ...row }));
  for (const doc of docs) {
    if (!doc._id) throw new Error(`Encountered document without _id in ${filePath}`);
    doc.status ||= "published";
    doc.synced_at = new Date().toISOString();
    doc.sync_target = "cloudbase";
  }
  return docs;
}

function createClient(options, config) {
  const secretId = config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey = config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error("Missing Tencent credentials. Set TENCENT_SECRET_ID and TENCENT_SECRET_KEY.");
  return CloudBase.init({ envId: options.envId, secretId, secretKey });
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function parseCommandRows(data) {
  const outer = JSON.parse(data || "[]");
  return outer.map((row) => JSON.parse(row));
}

async function queryExistingIds(database, collection) {
  const ids = [];
  const pageSize = 1000;
  for (let skip = 0; ; skip += pageSize) {
    const result = await database.runCommands({
      MgoCommands: [{
        TableName: collection,
        CommandType: "QUERY",
        Command: JSON.stringify({ find: collection, filter: {}, projection: { _id: 1 }, skip, limit: pageSize }),
      }],
    });
    const rows = parseCommandRows(result.Data?.[0]);
    ids.push(...rows.map((row) => row._id).filter(Boolean));
    if (rows.length < pageSize) break;
  }
  return ids;
}

async function upsertBatch(database, collection, docs) {
  return database.runCommands({
    MgoCommands: [{
      TableName: collection,
      CommandType: "UPDATE",
      Command: JSON.stringify({
        update: collection,
        updates: docs.map((doc) => ({ q: { _id: doc._id }, u: { $set: doc }, upsert: true })),
      }),
    }],
  });
}

async function deleteBatch(database, collection, ids) {
  return database.runCommands({
    MgoCommands: [{
      TableName: collection,
      CommandType: "DELETE",
      Command: JSON.stringify({
        delete: collection,
        deletes: ids.map((id) => ({ q: { _id: id }, limit: 1 })),
      }),
    }],
  });
}

function log(message) {
  console.log(`[cloudbase-upload] ${message}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const docs = readDocuments(options.input, options.limit);
  fs.mkdirSync(options.reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const reportPath = path.join(options.reportDir, `cloudbase-upsert-${timestamp}.json`);

  const app = createClient(options, env());
  await app.database.createCollectionIfNotExists(options.collection);
  const existingIds = options.pruneStale ? await queryExistingIds(app.database, options.collection) : [];
  const inputIds = new Set(docs.map((doc) => doc._id));
  const staleIds = existingIds.filter((id) => !inputIds.has(id));

  const summary = {
    dry_run: !options.run,
    env_id: options.envId,
    collection: options.collection,
    input: options.input,
    documents: docs.length,
    batches: Math.ceil(docs.length / options.batchSize),
    prune_stale: options.pruneStale,
    stale_to_delete: staleIds.length,
    upserted_batches: 0,
    deleted_batches: 0,
    failures: [],
  };

  log(`${options.run ? "Run" : "Dry-run"}: ${docs.length} documents -> ${options.collection}`);
  if (options.pruneStale) log(`Stale documents to delete: ${staleIds.length}`);

  if (options.run) {
    for (const docsChunk of chunk(docs, options.batchSize)) {
      try {
        await upsertBatch(app.database, options.collection, docsChunk);
        summary.upserted_batches += 1;
      } catch (error) {
        summary.failures.push({ action: "upsert", first_id: docsChunk[0]?._id, count: docsChunk.length, error: error.message });
      }
    }
    if (options.pruneStale && staleIds.length) {
      for (const idsChunk of chunk(staleIds, options.batchSize)) {
        try {
          await deleteBatch(app.database, options.collection, idsChunk);
          summary.deleted_batches += 1;
        } catch (error) {
          summary.failures.push({ action: "delete", first_id: idsChunk[0], count: idsChunk.length, error: error.message });
        }
      }
    }
  }

  fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  log(`Report: ${reportPath}`);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
