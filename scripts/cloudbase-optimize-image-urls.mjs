#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_COLLECTION = "artworks";
const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), "csv", "cloudbase");
const DEFAULT_COS_HOST = "masterpiece-1437223579.cos.ap-beijing.myqcloud.com";
const DEFAULT_COS_PREFIX = "/ppaintings/";
const THUMB_PATH_PREFIX = "/ppaintings/derivatives/thumb/";
const DISPLAY_PATH_PREFIX = "/ppaintings/derivatives/display/";

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
    envId: process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID || DEFAULT_ENV_ID,
    collection: DEFAULT_COLLECTION,
    reportDir: DEFAULT_REPORT_DIR,
    batchSize: 20,
    limit: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = true;
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

function createClient(options, config) {
  const secretId = config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey = config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error("Missing Tencent credentials. Set TENCENT_SECRET_ID and TENCENT_SECRET_KEY.");
  return CloudBase.init({ envId: options.envId, secretId, secretKey });
}

function parseCommandRows(data) {
  const outer = JSON.parse(data || "[]");
  return outer.map((row) => JSON.parse(row));
}

async function queryAll(database, collection, limit) {
  const rows = [];
  const pageSize = 1000;
  for (let skip = 0; ; skip += pageSize) {
    const result = await database.runCommands({
      MgoCommands: [{
        TableName: collection,
        CommandType: "QUERY",
        Command: JSON.stringify({
          find: collection,
          filter: {},
          projection: { _id: 1, image_id: 1, thumbnail_url: 1, display_url: 1, download_url: 1 },
          skip,
          limit: pageSize,
        }),
      }],
    });
    const batch = parseCommandRows(result.Data?.[0]);
    rows.push(...batch);
    if (limit && rows.length >= limit) return rows.slice(0, limit);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function originalCosImageUrl(row) {
  const candidates = [row.download_url, row.display_url, row.thumbnail_url].filter(Boolean);
  for (const value of candidates) {
    try {
      const url = new URL(value);
      if (url.hostname !== DEFAULT_COS_HOST) continue;
      if (!url.pathname.startsWith(DEFAULT_COS_PREFIX)) continue;
      if (!/\.jpe?g$/i.test(url.pathname)) continue;
      url.search = "";
      return url.toString();
    } catch {
      // Ignore malformed values.
    }
  }
  return "";
}

function imageIdFromBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  return path.basename(url.pathname, path.extname(url.pathname));
}

function derivativeUrl(baseUrl, kind) {
  const url = new URL(baseUrl);
  const imageId = imageIdFromBaseUrl(baseUrl);
  url.search = "";
  url.pathname = kind === "thumb"
    ? `${THUMB_PATH_PREFIX}${imageId}.webp`
    : `${DISPLAY_PATH_PREFIX}${imageId}.webp`;
  return url.toString();
}

function optimizeRow(row) {
  const baseUrl = originalCosImageUrl(row);
  if (!baseUrl) return null;
  const imageId = imageIdFromBaseUrl(baseUrl);
  const hasGeneratedDerivative = /^\d+_standard$/i.test(imageId);
  const thumbnailUrl = hasGeneratedDerivative ? derivativeUrl(baseUrl, "thumb") : baseUrl;
  const displayUrl = hasGeneratedDerivative ? derivativeUrl(baseUrl, "display") : baseUrl;
  const patch = {
    thumbnail_url: thumbnailUrl,
    display_url: displayUrl,
    download_url: baseUrl,
    image_optimized_at: new Date().toISOString(),
    image_optimization: {
      thumbnail: hasGeneratedDerivative ? THUMB_PATH_PREFIX : "original",
      display: hasGeneratedDerivative ? DISPLAY_PATH_PREFIX : "original",
      original: baseUrl,
    },
  };
  const unchanged =
    row.thumbnail_url === patch.thumbnail_url
    && row.display_url === patch.display_url
    && row.download_url === patch.download_url;
  return unchanged ? null : { _id: row._id, image_id: row.image_id, patch };
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function updateBatch(database, collection, updates) {
  return database.runCommands({
    MgoCommands: [{
      TableName: collection,
      CommandType: "UPDATE",
      Command: JSON.stringify({
        update: collection,
        updates: updates.map((item) => ({ q: { _id: item._id }, u: { $set: item.patch }, upsert: false })),
      }),
    }],
  });
}

function log(message) {
  console.log(`[cloudbase-image-optimize] ${message}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const reportPath = path.join(options.reportDir, `cloudbase-image-optimize-${timestamp}.json`);
  const app = createClient(options, env());
  const rows = await queryAll(app.database, options.collection, options.limit);
  const updates = rows.map(optimizeRow).filter(Boolean);
  const summary = {
    dry_run: !options.run,
    env_id: options.envId,
    collection: options.collection,
    scanned: rows.length,
    to_update: updates.length,
    batches: Math.ceil(updates.length / options.batchSize),
    updated_batches: 0,
    failures: [],
    sample: updates.slice(0, 5).map((item) => ({ _id: item._id, image_id: item.image_id, ...item.patch })),
  };

  log(`${options.run ? "Run" : "Dry-run"}: ${updates.length}/${rows.length} records need optimized image URLs`);
  if (options.run) {
    for (const updateChunk of chunk(updates, options.batchSize)) {
      try {
        await updateBatch(app.database, options.collection, updateChunk);
        summary.updated_batches += 1;
      } catch (error) {
        summary.failures.push({ first_id: updateChunk[0]?._id, count: updateChunk.length, error: error.message });
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
