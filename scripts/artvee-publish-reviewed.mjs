#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { tencentCosObjectKey, tencentCosPublicUrl } from "./artvee-ingest.mjs";
import { buildArtworkSearchTerms } from "./cloudbase/artwork-search-terms.mjs";

const require = createRequire(import.meta.url);
const COS = require("cos-nodejs-sdk-v5");

const DEFAULT_COS_BUCKET = "masterpiece-1437223579";
const DEFAULT_COS_REGION = "ap-beijing";
const DEFAULT_COS_PREFIX = "ppaintings";
const DEFAULT_COS_DOMAIN = "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com";
const DEFAULT_CLOUDBASE_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_CLOUDBASE_COLLECTION = "artworks";
const REQUIRED_REVIEW_FIELDS = [
  "title_cn",
  "title_en",
  "artist",
  "location",
  "year_and_place",
  "medium",
  "dimensions",
  "description",
  "tags",
];

function resolveCliPath(value) {
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    return value;
  }
  return path.resolve(value);
}

export function parsePublishArgs(argv) {
  const options = {
    run: false,
    input: "",
    reportDir: path.resolve(process.cwd(), "csv", "reviewed-publish"),
    cosUpload: false,
    cloudbaseDb: false,
    concurrency: 1,
    offset: 0,
    limit: 0,
    status: "published",
    cosBucket: process.env.TENCENT_COS_BUCKET || DEFAULT_COS_BUCKET,
    cosRegion: process.env.TENCENT_COS_REGION || DEFAULT_COS_REGION,
    cosPrefix: process.env.TENCENT_COS_PREFIX || DEFAULT_COS_PREFIX,
    cosDomain: process.env.TENCENT_COS_DOMAIN || DEFAULT_COS_DOMAIN,
    cosSecretId:
      process.env.TENCENT_SECRET_ID ||
      process.env.TENCENT_CLOUD_SECRET_ID ||
      process.env.TENCENTCLOUD_SECRETID ||
      "",
    cosSecretKey:
      process.env.TENCENT_SECRET_KEY ||
      process.env.TENCENT_CLOUD_SECRET_KEY ||
      process.env.TENCENTCLOUD_SECRETKEY ||
      "",
    cosSessionToken: process.env.TENCENT_SESSION_TOKEN || "",
    cloudbaseEnvId:
      process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID || DEFAULT_CLOUDBASE_ENV_ID,
    cloudbaseCollection: process.env.CLOUDBASE_COLLECTION || DEFAULT_CLOUDBASE_COLLECTION,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") {
      options.run = true;
      continue;
    }
    if (arg === "--cos-upload") {
      options.cosUpload = true;
      continue;
    }
    if (arg === "--cloudbase-db") {
      options.cloudbaseDb = true;
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

    if (name === "input") options.input = resolveCliPath(value);
    else if (name === "report-dir") options.reportDir = resolveCliPath(value);
    else if (name === "status") options.status = value;
    else if (name === "cos-bucket") options.cosBucket = value;
    else if (name === "cos-region") options.cosRegion = value;
    else if (name === "cos-prefix") options.cosPrefix = value.replace(/^\/+|\/+$/g, "");
    else if (name === "cos-domain") options.cosDomain = value.replace(/\/+$/g, "");
    else if (name === "cloudbase-env-id") options.cloudbaseEnvId = value;
    else if (name === "cloudbase-collection") options.cloudbaseCollection = value;
    else if (name === "concurrency") options.concurrency = Number(value);
    else if (name === "offset") options.offset = Number(value);
    else if (name === "limit") options.limit = Number(value);
    else throw new Error(`Unknown option: --${name}`);
  }

  if (!options.input) throw new Error("--input is required.");
  if (!["draft", "published", "archived"].includes(options.status)) {
    throw new Error("--status must be draft, published, or archived.");
  }
  if (
    !Number.isSafeInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > 12
  ) {
    throw new Error("--concurrency must be an integer from 1 to 12.");
  }
  if (!Number.isSafeInteger(options.offset) || options.offset < 0) {
    throw new Error("--offset must be a non-negative integer.");
  }
  if (options.limit && (!Number.isSafeInteger(options.limit) || options.limit < 1)) {
    throw new Error("--limit must be a positive integer.");
  }
  return options;
}

export function parseReviewedRecordsFromText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const records = trimmed.startsWith("[")
    ? JSON.parse(trimmed)
    : trimmed
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
  for (const [index, record] of records.entries()) {
    validateReviewedRecord(record, index + 1);
  }
  return records;
}

function validateReviewedRecord(record, lineNumber) {
  if (record.review_status !== "approved") {
    throw new Error(`Record ${lineNumber} is not approved.`);
  }
  const metadata = record.reviewed_metadata || {};
  for (const field of REQUIRED_REVIEW_FIELDS) {
    const value = metadata[field];
    if (field === "tags") {
      if (!Array.isArray(value) || value.length < 4) {
        throw new Error(
          `Record ${lineNumber} reviewed_metadata.tags must contain at least 4 tags.`,
        );
      }
    } else if (!String(value || "").trim()) {
      throw new Error(`Record ${lineNumber} reviewed_metadata.${field} is required.`);
    }
  }
  if (!record.image?.asset_name)
    throw new Error(`Record ${lineNumber} image.asset_name is required.`);
}

export function reviewedRecordToCloudbaseDocument(record, publicUrl, options = {}) {
  const metadata = record.reviewed_metadata || {};
  const assetName = record.image?.asset_name || "";
  const imageId = assetName.replace(/\.[^.]+$/, "");
  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : String(metadata.tags || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
  const now = new Date().toISOString();
  const source = record.source || {};
  const raw = record.raw || {};

  const document = {
    _id: `artwork_${imageId}`,
    id: imageId,
    source_name: source.name || "Artvee",
    source_record_id: source.record_id || "",
    source_url: source.url || "",
    slug: `artvee-${source.record_id || imageId}`,
    title_cn: metadata.title_cn,
    title_en: metadata.title_en,
    title: metadata.title_cn || metadata.title_en || "Untitled",
    artist: metadata.artist,
    artist_display: metadata.artist,
    location: metadata.location,
    year_and_place: metadata.year_and_place,
    medium: metadata.medium,
    dimensions: metadata.dimensions,
    description: metadata.description,
    license: raw.license || "",
    is_public_domain: String(raw.license || "")
      .toLowerCase()
      .includes("public domain"),
    status: options.status || "published",
    image_id: imageId,
    thumbnail_url: tencentCosPublicUrl(
      tencentCosObjectKey(`derivatives/thumb/${imageId}.webp`, options),
      options,
    ),
    display_url: tencentCosPublicUrl(
      tencentCosObjectKey(`derivatives/display/${imageId}.webp`, options),
      options,
    ),
    download_url: publicUrl,
    original_url: publicUrl,
    tags,
    tag_keys: tags,
    sync_target: "cloudbase",
    review_status: record.review_status,
    review_notes: record.review_notes || "",
    migrated_at: now,
    synced_at: now,
    updated_at: now,
  };
  document.search_terms = buildArtworkSearchTerms(document);
  document.search_terms_version = "search-terms-v1";
  return document;
}

function parseEnvFile(text = "") {
  const env = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

async function loadEnvironment() {
  for (const fileName of [".env.local", ".env"]) {
    try {
      const env = parseEnvFile(await readFile(path.resolve(process.cwd(), fileName), "utf8"));
      for (const [key, value] of Object.entries(env)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function requireTencentOptions(options) {
  const missing = [];
  if (!options.cosBucket) missing.push("TENCENT_COS_BUCKET");
  if (!options.cosRegion) missing.push("TENCENT_COS_REGION");
  if (!options.cosSecretId) missing.push("TENCENT_SECRET_ID");
  if (!options.cosSecretKey) missing.push("TENCENT_SECRET_KEY");
  if (missing.length) throw new Error(`Missing Tencent config: ${missing.join(", ")}`);
}

function createCosClient(options) {
  requireTencentOptions(options);
  return new COS({
    SecretId: options.cosSecretId,
    SecretKey: options.cosSecretKey,
    SecurityToken: options.cosSessionToken || undefined,
  });
}

function createCloudbaseApp(options) {
  requireTencentOptions(options);
  if (!options.cloudbaseEnvId) throw new Error("Missing CloudBase config: CLOUDBASE_ENV_ID");
  return CloudBase.init({
    envId: options.cloudbaseEnvId,
    secretId: options.cosSecretId,
    secretKey: options.cosSecretKey,
  });
}

function cosCall(cos, method, params) {
  return new Promise((resolve, reject) => {
    cos[method](params, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

async function uploadReviewedImage(cos, record, options) {
  const assetName = record.image.asset_name;
  const key = tencentCosObjectKey(assetName, options);
  const localPath = record.image.local_path;
  if (!localPath) throw new Error(`Missing local image path for ${assetName}.`);
  const params = {
    Bucket: options.cosBucket,
    Region: options.cosRegion,
    Key: key,
  };
  try {
    await cosCall(cos, "headObject", params);
    return {
      publicUrl: tencentCosPublicUrl(key, options),
      status: "skipped_existing",
    };
  } catch (error) {
    if (
      !["403", "404"].includes(String(error?.statusCode || "")) &&
      !/forbidden|not found|NoSuchKey/i.test(String(error?.message || ""))
    ) {
      throw error;
    }
  }
  const buffer = await readFile(localPath);
  await cosCall(cos, "putObject", {
    ...params,
    Body: buffer,
    ContentLength: buffer.length,
    ContentType: contentTypeFor(assetName),
    CacheControl: "public, max-age=31536000, immutable",
  });
  return {
    publicUrl: tencentCosPublicUrl(key, options),
    status: "uploaded",
  };
}

function contentTypeFor(fileName) {
  if (/\.webp$/i.test(fileName)) return "image/webp";
  if (/\.png$/i.test(fileName)) return "image/png";
  return "image/jpeg";
}

async function upsertCloudbaseArtwork(database, collection, doc) {
  return database.runCommands({
    MgoCommands: [
      {
        TableName: collection,
        CommandType: "UPDATE",
        Command: JSON.stringify({
          update: collection,
          updates: [{ q: { _id: doc._id }, u: { $set: doc }, upsert: true }],
        }),
      },
    ],
  });
}

function log(message) {
  console.log(`[artvee-publish] ${message}`);
}

async function runPool(items, concurrency, worker) {
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
}

async function main() {
  await loadEnvironment();
  const options = parsePublishArgs(process.argv.slice(2));
  const allRecords = parseReviewedRecordsFromText(await readFile(options.input, "utf8"));
  const records = allRecords.slice(
    options.offset,
    options.limit ? options.offset + options.limit : undefined,
  );
  await mkdir(options.reportDir, { recursive: true });

  const summary = {
    dry_run: !options.run,
    input: options.input,
    input_records: allRecords.length,
    offset: options.offset,
    records: records.length,
    cos_upload: options.cosUpload,
    cloudbase_db: options.cloudbaseDb,
    uploaded: 0,
    skipped_existing: 0,
    upserted: 0,
    completed: 0,
    failures: [],
  };
  const reportPath = path.join(
    options.reportDir,
    `artvee-reviewed-publish-${new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z")}.json`,
  );

  log(`${options.run ? "Run" : "Dry-run"}: ${records.length} approved records.`);
  if (options.run && !options.cosUpload && !options.cloudbaseDb) {
    throw new Error("Nothing to publish. Pass --cos-upload and/or --cloudbase-db.");
  }

  const cos = options.run && options.cosUpload ? createCosClient(options) : null;
  const cloudbase = options.run && options.cloudbaseDb ? createCloudbaseApp(options) : null;
  if (cloudbase) await cloudbase.database.createCollectionIfNotExists(options.cloudbaseCollection);

  await runPool(records, options.concurrency, async (record) => {
    try {
      const fallbackKey = tencentCosObjectKey(record.image.asset_name, options);
      const upload = cos
        ? await uploadReviewedImage(cos, record, options)
        : {
            publicUrl: record.image.public_url || tencentCosPublicUrl(fallbackKey, options),
            status: "not_requested",
          };
      if (upload.status === "uploaded") summary.uploaded += 1;
      if (upload.status === "skipped_existing") summary.skipped_existing += 1;

      if (cloudbase) {
        const doc = reviewedRecordToCloudbaseDocument(record, upload.publicUrl, options);
        await upsertCloudbaseArtwork(cloudbase.database, options.cloudbaseCollection, doc);
        summary.upserted += 1;
      }
    } catch (error) {
      summary.failures.push({
        asset_name: record.image?.asset_name || "",
        source_url: record.source?.url || "",
        error: error.message,
      });
    }
    summary.completed += 1;
    if (summary.completed % 10 === 0 || summary.completed === records.length) {
      await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      log(
        `Progress ${summary.completed}/${records.length}; uploaded=${summary.uploaded}, existing=${summary.skipped_existing}, upserted=${summary.upserted}, failed=${summary.failures.length}`,
      );
    }
  });

  await writeFile(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  log(`Report: ${reportPath}`);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failures.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[artvee-publish] ${error.message}`);
    process.exit(1);
  });
}
