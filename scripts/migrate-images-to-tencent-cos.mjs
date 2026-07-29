#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const COS = require("cos-nodejs-sdk-v5");

const DEFAULT_SOURCE_DIR = path.resolve(process.cwd(), "csv", "images");
const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), "csv", "cos-migration");
const JPG_PATTERN = /^\d+_standard\.jpg$/i;

function parseEnvFile(text = "") {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
  return env;
}

async function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      const parsed = parseEnvFile(await readFile(path.resolve(process.cwd(), file), "utf8"));
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function parseArgs(argv) {
  const options = {
    run: false,
    sourceDir: DEFAULT_SOURCE_DIR,
    reportDir: DEFAULT_REPORT_DIR,
    prefix: process.env.TENCENT_COS_PREFIX || "",
    bucket: process.env.TENCENT_COS_BUCKET || "",
    region: process.env.TENCENT_COS_REGION || "",
    secretId: process.env.TENCENT_SECRET_ID || process.env.TENCENT_CLOUD_SECRET_ID || "",
    secretKey: process.env.TENCENT_SECRET_KEY || process.env.TENCENT_CLOUD_SECRET_KEY || "",
    sessionToken: process.env.TENCENT_SESSION_TOKEN || "",
    publicDomain: process.env.TENCENT_COS_DOMAIN || "",
    concurrency: Number(process.env.TENCENT_COS_CONCURRENCY || 4),
    overwrite: false,
    limit: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") {
      options.run = true;
      continue;
    }
    if (arg === "--overwrite") {
      options.overwrite = true;
      continue;
    }
    const [name, inlineValue] =
      arg.startsWith("--") && arg.includes("=")
        ? arg.slice(2).split(/=(.*)/s, 2)
        : [arg.startsWith("--") ? arg.slice(2) : "", undefined];
    if (!name) throw new Error(`Unknown argument: ${arg}`);
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      throw new Error(`Missing value for --${name}`);
    if (inlineValue === undefined) index += 1;

    if (name === "source-dir") options.sourceDir = path.resolve(value);
    else if (name === "report-dir") options.reportDir = path.resolve(value);
    else if (name === "prefix") options.prefix = value;
    else if (name === "bucket") options.bucket = value;
    else if (name === "region") options.region = value;
    else if (name === "secret-id") options.secretId = value;
    else if (name === "secret-key") options.secretKey = value;
    else if (name === "session-token") options.sessionToken = value;
    else if (name === "public-domain") options.publicDomain = value;
    else if (name === "concurrency") options.concurrency = Number(value);
    else if (name === "limit") options.limit = Number(value);
    else throw new Error(`Unknown option: --${name}`);
  }

  if (
    !Number.isSafeInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > 16
  ) {
    throw new Error("--concurrency must be an integer from 1 to 16.");
  }
  if (options.limit && (!Number.isSafeInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }
  options.prefix = options.prefix.replace(/^\/+|\/+$/g, "");
  return options;
}

function requireCosOptions(options) {
  const missing = [];
  if (!options.bucket) missing.push("TENCENT_COS_BUCKET or --bucket");
  if (!options.region) missing.push("TENCENT_COS_REGION or --region");
  if (!options.secretId) missing.push("TENCENT_SECRET_ID or --secret-id");
  if (!options.secretKey) missing.push("TENCENT_SECRET_KEY or --secret-key");
  if (missing.length) throw new Error(`Missing Tencent COS config: ${missing.join(", ")}`);
}

async function imageFiles(sourceDir, limit) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && JPG_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort(
      (left, right) => Number(left.match(/^\d+/)?.[0] || 0) - Number(right.match(/^\d+/)?.[0] || 0),
    );
  return (limit ? files.slice(0, limit) : files).map((name) => path.join(sourceDir, name));
}

function objectKey(filePath, options) {
  const name = path.basename(filePath);
  return options.prefix ? `${options.prefix}/${name}` : name;
}

function encodeKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

function publicUrlFor(key, options) {
  if (options.publicDomain) return `${options.publicDomain.replace(/\/+$/g, "")}/${encodeKey(key)}`;
  return `https://${options.bucket}.cos.${options.region}.myqcloud.com/${encodeKey(key)}`;
}

function cosCall(cos, method, params) {
  return new Promise((resolve, reject) => {
    cos[method](params, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

async function headObject(cos, params) {
  try {
    await cosCall(cos, "headObject", params);
    return true;
  } catch (error) {
    if (
      String(error?.statusCode || "") === "403" ||
      String(error?.statusCode || "") === "404" ||
      /forbidden|not found|NoSuchKey/i.test(String(error?.message || ""))
    ) {
      return false;
    }
    throw error;
  }
}

async function uploadOne(cos, filePath, options) {
  const fileStat = await stat(filePath);
  const key = objectKey(filePath, options);
  const baseParams = {
    Bucket: options.bucket,
    Region: options.region,
    Key: key,
  };

  if (!options.overwrite && (await headObject(cos, baseParams))) {
    return {
      status: "skipped",
      file: filePath,
      key,
      size: fileStat.size,
      publicUrl: publicUrlFor(key, options),
      reason: "already_exists",
    };
  }

  await cosCall(cos, "putObject", {
    ...baseParams,
    Body: createReadStream(filePath),
    ContentLength: fileStat.size,
    ContentType: "image/jpeg",
  });

  return {
    status: "uploaded",
    file: filePath,
    key,
    size: fileStat.size,
    publicUrl: publicUrlFor(key, options),
  };
}

async function runPool(items, concurrency, worker) {
  const results = [];
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

function log(message) {
  console.log(`[cos-migrate] ${message}`);
}

async function main() {
  await loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const files = await imageFiles(options.sourceDir, options.limit);
  await mkdir(options.reportDir, { recursive: true });
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const reportPath = path.join(options.reportDir, `tencent-cos-migration-${timestamp}.jsonl`);

  log(`Source images: ${files.length}`);
  log(`Source dir: ${options.sourceDir}`);
  log(`Mode: ${options.run ? "upload" : "dry-run"}`);
  if (!options.run) {
    await writeFile(
      reportPath,
      `${JSON.stringify({
        status: "dry-run",
        files: files.length,
        sourceDir: options.sourceDir,
        prefix: options.prefix,
        createdAt: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
    log(`Dry-run report: ${reportPath}`);
    log("Run again with --run after setting Tencent COS bucket, region, SecretId, and SecretKey.");
    return;
  }

  requireCosOptions(options);
  const cos = new COS({
    SecretId: options.secretId,
    SecretKey: options.secretKey,
    SecurityToken: options.sessionToken || undefined,
  });

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const results = await runPool(files, options.concurrency, async (filePath, index) => {
    try {
      const result = await uploadOne(cos, filePath, options);
      if (result.status === "uploaded") uploaded += 1;
      if (result.status === "skipped") skipped += 1;
      if ((uploaded + skipped + failed) % 25 === 0 || index === files.length - 1) {
        log(
          `Progress ${uploaded + skipped + failed}/${files.length}; uploaded=${uploaded}, skipped=${skipped}, failed=${failed}`,
        );
      }
      return { ...result, index, at: new Date().toISOString() };
    } catch (error) {
      failed += 1;
      const result = {
        status: "failed",
        file: filePath,
        key: objectKey(filePath, options),
        error: error?.message || String(error),
      };
      log(`Failed ${path.basename(filePath)}: ${result.error}`);
      return { ...result, index, at: new Date().toISOString() };
    }
  });
  await writeFile(
    reportPath,
    results.map((result) => JSON.stringify(result)).join("\n") + "\n",
    "utf8",
  );

  log(`Report: ${reportPath}`);
  log(`Done. uploaded=${uploaded}, skipped=${skipped}, failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[cos-migrate] ${error.message}`);
  process.exit(1);
});
