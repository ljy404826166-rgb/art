#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_COLLECTION = "artworks";
const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), "csv", "cloudbase");
const COS_RE = /masterpiece-1437223579\.cos\.ap-beijing\.myqcloud\.com\/ppaintings\//i;
const SUPABASE_STORAGE_RE = /supabase\.co\/storage\/v1\/object\/public\/artwork\//i;

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
    envId: process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID || DEFAULT_ENV_ID,
    collection: DEFAULT_COLLECTION,
    reportDir: DEFAULT_REPORT_DIR,
    sampleHead: 5,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-id") options.envId = required(argv, (index += 1), arg);
    else if (arg === "--collection") options.collection = required(argv, (index += 1), arg);
    else if (arg === "--report-dir") options.reportDir = path.resolve(required(argv, (index += 1), arg));
    else if (arg === "--sample-head") options.sampleHead = positiveInt(required(argv, (index += 1), arg), arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
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

async function queryAll(database, collection) {
  const rows = [];
  const pageSize = 1000;
  for (let skip = 0; ; skip += pageSize) {
    const result = await database.runCommands({
      MgoCommands: [{
        TableName: collection,
        CommandType: "QUERY",
        Command: JSON.stringify({ find: collection, filter: {}, skip, limit: pageSize }),
      }],
    });
    const batch = parseCommandRows(result.Data?.[0]);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function imageUrl(row) {
  return row.display_url || row.thumbnail_url || row.download_url || "";
}

async function head(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return { url, status: response.status, content_type: response.headers.get("content-type") || "" };
  } catch (error) {
    return { url, error: error.message };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  fs.mkdirSync(options.reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const reportPath = path.join(options.reportDir, `cloudbase-audit-${timestamp}.json`);

  const app = createClient(options, env());
  const rows = await queryAll(app.database, options.collection);
  const missingImages = rows.filter((row) => !row.thumbnail_url && !row.display_url);
  const oldSupabase = rows.filter((row) => [row.thumbnail_url, row.display_url, row.download_url].some((value) => SUPABASE_STORAGE_RE.test(String(value || ""))));
  const cosRows = rows.filter((row) => [row.thumbnail_url, row.display_url, row.download_url].some((value) => COS_RE.test(String(value || ""))));
  const missingTags = rows.filter((row) => !Array.isArray(row.tag_keys) || row.tag_keys.length === 0);
  const duplicateIds = rows.map((row) => row._id).filter((id, index, ids) => id && ids.indexOf(id) !== index);
  const samples = cosRows.slice(0, options.sampleHead).map(imageUrl).filter(Boolean);
  const sampleChecks = [];
  for (const url of samples) sampleChecks.push(await head(url));

  const report = {
    env_id: options.envId,
    collection: options.collection,
    total: rows.length,
    cos_url_records: cosRows.length,
    old_supabase_storage_records: oldSupabase.length,
    missing_image_records: missingImages.length,
    missing_tag_records: missingTags.length,
    duplicate_id_count: duplicateIds.length,
    old_supabase_sample: oldSupabase.slice(0, 20).map((row) => ({ _id: row._id, image_id: row.image_id, display_url: row.display_url })),
    missing_image_sample: missingImages.slice(0, 20).map((row) => ({ _id: row._id, title_cn: row.title_cn, title_en: row.title_en })),
    sample_checks: sampleChecks,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, report_path: reportPath }, null, 2));
  if (oldSupabase.length || missingImages.length || duplicateIds.length || sampleChecks.some((check) => check.status !== 200)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
