#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const COS = require("cos-nodejs-sdk-v5");

const DEFAULT_SOURCE_DIR = path.resolve(process.cwd(), "csv", "images");
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "csv", "image-derivatives");
const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), "csv", "cloudbase");
const JPG_PATTERN = /^\d+_standard\.jpg$/i;
const DERIVATIVES = [
  { kind: "thumb", width: 480, quality: 74 },
  { kind: "display", width: 1280, quality: 82 },
];

function parseEnvFile(text = "") {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
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
    outputDir: DEFAULT_OUTPUT_DIR,
    reportDir: DEFAULT_REPORT_DIR,
    prefix: process.env.TENCENT_COS_PREFIX || "ppaintings",
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
    const [name, inlineValue] = arg.startsWith("--") && arg.includes("=")
      ? arg.slice(2).split(/=(.*)/s, 2)
      : [arg.startsWith("--") ? arg.slice(2) : "", undefined];
    if (!name) throw new Error(`Unknown argument: ${arg}`);
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
    if (inlineValue === undefined) index += 1;

    if (name === "source-dir") options.sourceDir = path.resolve(value);
    else if (name === "output-dir") options.outputDir = path.resolve(value);
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

  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 12) {
    throw new Error("--concurrency must be an integer from 1 to 12.");
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
    .sort((left, right) => Number(left.match(/^\d+/)?.[0] || 0) - Number(right.match(/^\d+/)?.[0] || 0));
  return (limit ? files.slice(0, limit) : files).map((name) => path.join(sourceDir, name));
}

function baseName(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function derivativePath(filePath, derivative, options) {
  return path.join(options.outputDir, derivative.kind, `${baseName(filePath)}.webp`);
}

function derivativeKey(filePath, derivative, options) {
  const key = `derivatives/${derivative.kind}/${baseName(filePath)}.webp`;
  return options.prefix ? `${options.prefix}/${key}` : key;
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
      String(error?.statusCode || "") === "403"
      || String(error?.statusCode || "") === "404"
      || /forbidden|not found|NoSuchKey/i.test(String(error?.message || ""))
    ) {
      return false;
    }
    throw error;
  }
}

async function ensureDerivative(filePath, derivative, options) {
  const outputPath = derivativePath(filePath, derivative, options);
  await mkdir(path.dirname(outputPath), { recursive: true });
  if (!options.overwrite) {
    try {
      const outputStat = await stat(outputPath);
      if (outputStat.size > 0) return { outputPath, generated: false, size: outputStat.size };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  await sharp(filePath, { limitInputPixels: false })
    .rotate()
    .resize({ width: derivative.width, withoutEnlargement: true })
    .webp({ quality: derivative.quality })
    .toFile(outputPath);
  const outputStat = await stat(outputPath);
  return { outputPath, generated: true, size: outputStat.size };
}

async function uploadDerivative(cos, filePath, derivative, derivativeInfo, options) {
  const key = derivativeKey(filePath, derivative, options);
  const params = { Bucket: options.bucket, Region: options.region, Key: key };
  if (!options.overwrite && await headObject(cos, params)) {
    return { status: "skipped", key, publicUrl: publicUrlFor(key, options), size: derivativeInfo.size };
  }
  await cosCall(cos, "putObject", {
    ...params,
    Body: createReadStream(derivativeInfo.outputPath),
    ContentLength: derivativeInfo.size,
    ContentType: "image/webp",
    CacheControl: "public, max-age=31536000, immutable",
  });
  return { status: "uploaded", key, publicUrl: publicUrlFor(key, options), size: derivativeInfo.size };
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
  console.log(`[cos-derivatives] ${message}`);
}

async function main() {
  await loadEnv();
  const options = parseArgs(process.argv.slice(2));
  const files = await imageFiles(options.sourceDir, options.limit);
  await mkdir(options.reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const reportPath = path.join(options.reportDir, `cos-derivatives-${timestamp}.jsonl`);

  log(`Source images: ${files.length}`);
  log(`Mode: ${options.run ? "generate+upload" : "dry-run"}`);
  if (!options.run) {
    await writeFile(reportPath, `${JSON.stringify({ status: "dry-run", files: files.length, derivatives: DERIVATIVES.map((item) => item.kind) })}\n`, "utf8");
    log(`Dry-run report: ${reportPath}`);
    return;
  }

  requireCosOptions(options);
  const cos = new COS({
    SecretId: options.secretId,
    SecretKey: options.secretKey,
    SecurityToken: options.sessionToken || undefined,
  });

  let generated = 0;
  let reused = 0;
  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  const results = await runPool(files, options.concurrency, async (filePath, index) => {
    const output = { file: filePath, imageId: baseName(filePath), derivatives: [], index, at: new Date().toISOString() };
    try {
      for (const derivative of DERIVATIVES) {
        const info = await ensureDerivative(filePath, derivative, options);
        if (info.generated) generated += 1;
        else reused += 1;
        const upload = await uploadDerivative(cos, filePath, derivative, info, options);
        if (upload.status === "uploaded") uploaded += 1;
        else skipped += 1;
        output.derivatives.push({ kind: derivative.kind, generated: info.generated, ...upload });
      }
      if ((index + 1) % 25 === 0 || index === files.length - 1) {
        log(`Progress ${index + 1}/${files.length}; generated=${generated}, reused=${reused}, uploaded=${uploaded}, skipped=${skipped}, failed=${failed}`);
      }
    } catch (error) {
      failed += 1;
      output.error = error.message;
      log(`Failed ${path.basename(filePath)}: ${error.message}`);
    }
    return output;
  });

  await writeFile(reportPath, results.map((result) => JSON.stringify(result)).join("\n") + "\n", "utf8");
  log(`Report: ${reportPath}`);
  log(`Done. generated=${generated}, reused=${reused}, uploaded=${uploaded}, skipped=${skipped}, failed=${failed}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`[cos-derivatives] ${error.message}`);
  process.exit(1);
});
