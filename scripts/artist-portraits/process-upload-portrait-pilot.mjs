#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, copyFile, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { atomicWrite, jsonlText, readJsonl, stringValue } from "./portrait-candidate-lib.mjs";

const require = createRequire(import.meta.url);
const COS = require("cos-nodejs-sdk-v5");

const DEFAULT_INPUT_DIR = path.resolve(
  "outputs",
  "artist-portraits",
  "20260726T064155Z-task4-pilot",
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  "outputs",
  "artist-portraits",
  "20260726T064155Z-task5-pilot",
);
const DEFAULT_PREFIX = "artist-portraits";
const OUTPUT_SIZE = 512;
const DEFAULT_MAX_OUTPUT_BYTES = 120 * 1024;
const MAX_SOURCE_BYTES = 160 * 1024 * 1024;
const CACHE_CONTROL = "public, max-age=31536000, immutable";
let lastDownloadRequestAt = 0;
const CORE_OUTPUTS = [
  "task5-processing.jsonl",
  "upload-manifest.jsonl",
  "upload-dry-run.json",
  "upload-report.json",
  "task5-contact-sheet.html",
  "task5-contact-sheet.png",
  "task5-audit.json",
];

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(argv = [], env = process.env) {
  const options = {
    run: false,
    offline: false,
    inputDir: DEFAULT_INPUT_DIR,
    outputDir: DEFAULT_OUTPUT_DIR,
    prefix: env.ARTIST_PORTRAIT_COS_PREFIX || DEFAULT_PREFIX,
    bucket: env.TENCENT_COS_BUCKET || "",
    region: env.TENCENT_COS_REGION || "",
    domain: env.TENCENT_COS_DOMAIN || "",
    secretId:
      env.TENCENT_SECRET_ID || env.TENCENT_CLOUD_SECRET_ID || env.TENCENTCLOUD_SECRETID || "",
    secretKey:
      env.TENCENT_SECRET_KEY || env.TENCENT_CLOUD_SECRET_KEY || env.TENCENTCLOUD_SECRETKEY || "",
    sessionToken: env.TENCENT_SESSION_TOKEN || "",
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
    expectedCount: 19,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--input-dir") options.inputDir = path.resolve(required(argv, ++index, arg));
    else if (arg === "--output-dir") options.outputDir = path.resolve(required(argv, ++index, arg));
    else if (arg === "--prefix") options.prefix = required(argv, ++index, arg);
    else if (arg === "--bucket") options.bucket = required(argv, ++index, arg);
    else if (arg === "--region") options.region = required(argv, ++index, arg);
    else if (arg === "--domain") options.domain = required(argv, ++index, arg);
    else if (arg === "--expected-count") {
      options.expectedCount = Number(required(argv, ++index, arg));
    } else if (arg === "--max-output-bytes") {
      options.maxOutputBytes = Number(required(argv, ++index, arg));
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isSafeInteger(options.maxOutputBytes) || options.maxOutputBytes < 32 * 1024) {
    throw new Error("--max-output-bytes must be an integer of at least 32768.");
  }
  if (!Number.isSafeInteger(options.expectedCount) || options.expectedCount < 1) {
    throw new Error("--expected-count must be a positive integer.");
  }
  options.prefix = stringValue(options.prefix).replace(/^\/+|\/+$/gu, "");
  if (!options.prefix || options.prefix !== DEFAULT_PREFIX) {
    throw new Error(`Task 5 prefix must remain ${DEFAULT_PREFIX}.`);
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/artist-portraits/process-upload-portrait-pilot.mjs
  node scripts/artist-portraits/process-upload-portrait-pilot.mjs --run

Default mode downloads and processes the 19 approved pilot images, then performs a
read-only COS preflight. --run uploads missing immutable objects and verifies each
public object. No production database write is performed.
`;
}

function parseEnvFile(text = "") {
  const env = {};
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^["']|["']$/gu, "");
  }
  return env;
}

async function loadEnv() {
  for (const fileName of [".env.local", ".env"]) {
    try {
      const parsed = parseEnvFile(await readFile(path.resolve(fileName), "utf8"));
      for (const [key, value] of Object.entries(parsed)) {
        if (process.env[key] === undefined) process.env[key] = value;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function requireCosOptions(options) {
  const missing = [];
  if (!options.bucket) missing.push("TENCENT_COS_BUCKET");
  if (!options.region) missing.push("TENCENT_COS_REGION");
  if (!options.domain) missing.push("TENCENT_COS_DOMAIN");
  if (!options.secretId) missing.push("TENCENT_SECRET_ID");
  if (!options.secretKey) missing.push("TENCENT_SECRET_KEY");
  if (missing.length) throw new Error(`Missing Tencent COS config: ${missing.join(", ")}`);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

export function detectImageMime(buffer) {
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return "image/jpeg";
  return "";
}

function extensionForMime(mime) {
  if (mime === "image/webp") return ".webp";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  throw new Error(`Unsupported source MIME: ${mime || "missing"}`);
}

export function focusedSquareBounds(width, height, focusX, focusY, zoom = 1) {
  if (!(width > 0) || !(height > 0)) throw new Error("Image dimensions must be positive.");
  if (!(focusX >= 0 && focusX <= 1) || !(focusY >= 0 && focusY <= 1)) {
    throw new Error("Crop focus must be between 0 and 1.");
  }
  if (!(zoom >= 1 && zoom <= 4)) throw new Error("Crop zoom must be between 1 and 4.");
  const side = Math.max(1, Math.round(Math.min(width, height) / zoom));
  const centerX = Math.round(width * focusX);
  const centerY = Math.round(height * focusY);
  return {
    left: Math.max(0, Math.min(width - side, centerX - Math.round(side / 2))),
    top: Math.max(0, Math.min(height - side, centerY - Math.round(side / 2))),
    width: side,
    height: side,
  };
}

function assertArtistId(artistId) {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(artistId)) {
    throw new Error(`Unsafe artist_id for object key: ${artistId}`);
  }
}

export function objectKeyFor(artistId, prefix = DEFAULT_PREFIX) {
  assertArtistId(artistId);
  const normalized = stringValue(prefix).replace(/^\/+|\/+$/gu, "");
  if (normalized !== DEFAULT_PREFIX) throw new Error("Unexpected portrait prefix.");
  return `${normalized}/${artistId}/v1/portrait-512.webp`;
}

function encodeKey(key) {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function publicUrlFor(key, options) {
  const base = options.domain
    ? options.domain.replace(/\/+$/gu, "")
    : `https://${options.bucket}.cos.${options.region}.myqcloud.com`;
  return `${base}/${encodeKey(key)}`;
}

function cosCall(cos, method, params) {
  return new Promise((resolve, reject) => {
    cos[method](params, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

function isMissingObjectError(error) {
  return (
    ["403", "404"].includes(String(error?.statusCode || "")) ||
    /forbidden|not found|NoSuchKey/iu.test(String(error?.message || ""))
  );
}

async function headObject(cos, params) {
  try {
    const response = await cosCall(cos, "headObject", params);
    return { exists: true, response };
  } catch (error) {
    if (isMissingObjectError(error)) return { exists: false, response: null };
    throw error;
  }
}

async function safeUnlink(filePath, attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await unlink(filePath);
      return;
    } catch (error) {
      if (error.code === "ENOENT") return;
      if (!["EBUSY", "EPERM"].includes(error.code) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 120));
    }
  }
}

async function downloadToFile(url, filePath, options = {}) {
  const attempts = options.attempts || 5;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const temporary = `${filePath}.part`;
    try {
      await safeUnlink(temporary);
      const waitForRequestSlot = Math.max(0, 900 - (Date.now() - lastDownloadRequestAt));
      if (waitForRequestSlot) {
        await new Promise((resolve) => setTimeout(resolve, waitForRequestSlot));
      }
      lastDownloadRequestAt = Date.now();
      const response = await fetch(url, {
        headers: {
          "user-agent": "ArtArchivePortraitTask5/1.0 (approved asset processing)",
        },
      });
      if (!response.ok || !response.body) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        const retryAfter = Number(response.headers.get("retry-after") || 0);
        error.retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : 0;
        throw error;
      }
      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > MAX_SOURCE_BYTES) {
        throw new Error(`Source exceeds ${MAX_SOURCE_BYTES} bytes.`);
      }
      await mkdir(path.dirname(filePath), { recursive: true });
      let received = 0;
      const limiter = new TransformStream({
        transform(chunk, controller) {
          received += chunk.byteLength;
          if (received > MAX_SOURCE_BYTES) {
            throw new Error(`Source exceeds ${MAX_SOURCE_BYTES} bytes.`);
          }
          controller.enqueue(chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body.pipeThrough(limiter)),
        createWriteStream(temporary, { flags: "wx" }),
      );
      await rename(temporary, filePath);
      return {
        downloaded: true,
        http_content_type: stringValue(response.headers.get("content-type")).split(";")[0],
        http_content_length: contentLength || received,
      };
    } catch (error) {
      lastError = error;
      await safeUnlink(temporary);
      if (attempt < attempts) {
        const backoff = Math.max(Number(error.retryAfterMs || 0), 1500 * 2 ** (attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, Math.min(backoff, 30000)));
      }
    }
  }
  throw lastError;
}

async function validateSource(filePath, expectedMime) {
  const handle = await fs.promises.open(filePath, "r");
  const header = Buffer.alloc(16);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  const signatureMime = detectImageMime(header);
  if (!signatureMime) throw new Error(`Unsupported image signature: ${path.basename(filePath)}`);
  const metadata = await sharp(filePath, { limitInputPixels: false }).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Source dimensions unavailable.");
  const fileStat = await stat(filePath);
  return {
    signature_mime: signatureMime,
    candidate_mime: expectedMime,
    mime_matches_candidate: !expectedMime || signatureMime === expectedMime,
    width: metadata.width,
    height: metadata.height,
    bytes: fileStat.size,
    sha256: await sha256File(filePath),
  };
}

async function renderProcessed(filePath, outputPath, crop, maxOutputBytes) {
  const metadata = await sharp(filePath, { limitInputPixels: false }).rotate().metadata();
  const bounds = focusedSquareBounds(
    Number(metadata.width),
    Number(metadata.height),
    Number(crop.crop_focus_x),
    Number(crop.crop_focus_y),
    Number(crop.crop_zoom || 1),
  );
  let quality = 84;
  let buffer;
  do {
    buffer = await sharp(filePath, { limitInputPixels: false })
      .rotate()
      .extract(bounds)
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "fill", kernel: sharp.kernel.lanczos3 })
      .webp({ quality, effort: 6, smartSubsample: true })
      .toBuffer();
    if (buffer.length <= maxOutputBytes || quality <= 52) break;
    quality -= 4;
  } while (quality >= 52);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporary, buffer);
  await rename(temporary, outputPath);
  const outputMetadata = await sharp(buffer).metadata();
  if (
    outputMetadata.format !== "webp" ||
    outputMetadata.width !== OUTPUT_SIZE ||
    outputMetadata.height !== OUTPUT_SIZE
  ) {
    throw new Error(`Invalid processed output: ${path.basename(outputPath)}`);
  }
  if (buffer.length > maxOutputBytes) {
    throw new Error(`Processed output exceeds ${maxOutputBytes} bytes.`);
  }
  return {
    crop: bounds,
    quality,
    bytes: buffer.length,
    sha256: sha256(buffer),
    width: outputMetadata.width,
    height: outputMetadata.height,
    mime: "image/webp",
  };
}

function selectedInputs(inputDir, expectedCount = 19) {
  const reviews = readJsonl(path.join(inputDir, "pilot-final-review.jsonl"));
  const candidates = readJsonl(path.join(inputDir, "pilot-candidates.jsonl"));
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidate_id, candidate]));
  const selected = reviews.filter((record) => record.final_status === "selected");
  if (selected.length !== expectedCount) {
    throw new Error(
      `Task 5 requires exactly ${expectedCount} selected records; found ${selected.length}.`,
    );
  }
  return selected.map((review) => {
    const candidate = candidateById.get(review.selected_candidate_id);
    if (!candidate) throw new Error(`Missing candidate ${review.selected_candidate_id}.`);
    if (!candidate.automated_assessment?.eligible_for_manual_review) {
      throw new Error(`Selected candidate is automatically blocked: ${candidate.candidate_id}`);
    }
    return { review, candidate };
  });
}

function safePreviewName(value) {
  return stringValue(value)
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .slice(0, 140);
}

async function ensureOriginal(item, inputDir, outputDir, offline) {
  const expectedMime = stringValue(item.candidate.mime);
  const expectedPath = path.join(
    outputDir,
    "originals",
    `${item.review.artist_id}${extensionForMime(expectedMime)}`,
  );
  const possiblePaths = [
    ...new Set([
      expectedPath,
      path.join(outputDir, "originals", `${item.review.artist_id}.jpg`),
      path.join(outputDir, "originals", `${item.review.artist_id}.png`),
      path.join(outputDir, "originals", `${item.review.artist_id}.webp`),
    ]),
  ];
  let originalPath = possiblePaths.find((filePath) => fs.existsSync(filePath)) || expectedPath;
  let download = {
    downloaded: false,
    http_content_type: "",
    http_content_length: 0,
  };
  let sourceDelivery = "original";
  let downloadUrlUsed = item.review.portrait_original_url;
  try {
    const existing = await stat(originalPath);
    if (!existing.size) throw new Error("Existing source is empty.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const cachedPreviewPath = path.join(
      inputDir,
      "previews",
      `${safePreviewName(item.candidate.candidate_id)}.webp`,
    );
    if (fs.existsSync(cachedPreviewPath)) {
      await mkdir(path.dirname(originalPath), { recursive: true });
      await copyFile(cachedPreviewPath, originalPath);
      sourceDelivery = "official_preview_fallback";
      downloadUrlUsed = item.candidate.preview_url || item.review.portrait_original_url;
    } else {
      if (offline) throw new Error(`Offline source missing: ${originalPath}`);
      try {
        download = await downloadToFile(item.review.portrait_original_url, originalPath, {
          attempts: 2,
        });
      } catch (downloadError) {
        const status = Number(downloadError.status || 0);
        const transientFailure = !status || status === 429 || status >= 500;
        if (!transientFailure || !item.candidate.preview_url) {
          throw downloadError;
        }
        sourceDelivery = "official_preview_fallback";
        downloadUrlUsed = item.candidate.preview_url;
        download = await downloadToFile(downloadUrlUsed, originalPath, { attempts: 4 });
      }
    }
  }
  const source = await validateSource(originalPath, expectedMime);
  if (
    Number(source.width) !== Number(item.candidate.width) ||
    Number(source.height) !== Number(item.candidate.height)
  ) {
    sourceDelivery = "official_preview_fallback";
    downloadUrlUsed = item.candidate.preview_url || downloadUrlUsed;
  }
  const actualPath = path.join(
    outputDir,
    "originals",
    `${item.review.artist_id}${extensionForMime(source.signature_mime)}`,
  );
  if (actualPath !== originalPath) {
    if (fs.existsSync(actualPath)) {
      const existingSource = await validateSource(actualPath, expectedMime);
      if (existingSource.sha256 !== source.sha256) {
        throw new Error(`Conflicting downloaded originals for ${item.review.artist_id}.`);
      }
    } else {
      // Copy-then-unlink is more reliable than rename on Windows when an
      // antivirus/indexer briefly holds a newly validated image handle.
      await copyFile(originalPath, actualPath);
    }
    originalPath = actualPath;
  }
  return {
    originalPath,
    download,
    source,
    sourceDelivery,
    downloadUrlUsed,
  };
}

async function processSelected(items, options) {
  const results = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const { originalPath, download, source, sourceDelivery, downloadUrlUsed } =
      await ensureOriginal(item, options.inputDir, options.outputDir, options.offline);
    const processedPath = path.join(
      options.outputDir,
      "processed",
      item.review.artist_id,
      "v1",
      "portrait-512.webp",
    );
    const processed = await renderProcessed(
      originalPath,
      processedPath,
      item.review,
      options.maxOutputBytes,
    );
    results.push({
      artist_id: item.review.artist_id,
      name_zh: item.review.name_zh,
      name_en: item.review.name_en,
      selected_candidate_id: item.review.selected_candidate_id,
      portrait_kind: item.review.portrait_kind,
      source_page_url: item.review.portrait_source_url,
      source_download_url: item.review.portrait_original_url,
      source_download_url_used: downloadUrlUsed,
      source_delivery: sourceDelivery,
      license: item.review.portrait_license,
      license_url: item.review.portrait_license_url,
      credit: item.review.portrait_credit,
      original_path: path.relative(options.outputDir, originalPath).replace(/\\/gu, "/"),
      original_downloaded: download.downloaded,
      original_http_content_type: download.http_content_type,
      original_http_content_length: download.http_content_length,
      original_mime: source.signature_mime,
      candidate_mime: source.candidate_mime,
      candidate_mime_matches_signature: source.mime_matches_candidate,
      original_width: source.width,
      original_height: source.height,
      original_bytes: source.bytes,
      original_sha256: source.sha256,
      crop_focus_x: Number(item.review.crop_focus_x),
      crop_focus_y: Number(item.review.crop_focus_y),
      crop_zoom: Number(item.review.crop_zoom || 1),
      crop_bounds: processed.crop,
      processed_path: path.relative(options.outputDir, processedPath).replace(/\\/gu, "/"),
      processed_mime: processed.mime,
      processed_width: processed.width,
      processed_height: processed.height,
      processed_bytes: processed.bytes,
      processed_quality: processed.quality,
      processed_sha256: processed.sha256,
      object_key: objectKeyFor(item.review.artist_id, options.prefix),
      public_url: publicUrlFor(objectKeyFor(item.review.artist_id, options.prefix), options),
    });
    console.log(
      `[portrait-task5] Processed ${index + 1}/${items.length}: ${item.review.artist_id}`,
    );
  }
  return results;
}

function escapeHtml(value) {
  return stringValue(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function fileHref(relativePath) {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

function contactSheetHtml(records) {
  const cards = records
    .map(
      (record, index) => `<article>
<h2>${index + 1}. ${escapeHtml(record.name_zh)} <small>${escapeHtml(record.name_en)}</small></h2>
<div class="images">
  <figure><img class="before" src="${fileHref(record.original_path)}" alt=""><figcaption>原图</figcaption></figure>
  <span>→</span>
  <figure><img class="after" src="${fileHref(record.processed_path)}" alt=""><figcaption>512×512 / 圆形预览</figcaption></figure>
</div>
<p>${escapeHtml(record.portrait_kind)}；${record.processed_bytes} bytes；quality ${record.processed_quality}</p>
<p>focus ${record.crop_focus_x}, ${record.crop_focus_y}；zoom ${record.crop_zoom}</p>
<p><a href="${escapeHtml(record.source_page_url)}">来源与授权说明</a></p>
</article>`,
    )
    .join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>任务五处理前后联系表</title><style>
body{margin:0;background:#f4f1ed;color:#2d2926;font:14px/1.45 system-ui,sans-serif}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:16px;padding:20px}
article{background:#fff;border-radius:16px;padding:14px;box-shadow:0 3px 16px #6b58451a}
h2{font-size:17px;margin:0 0 10px}small{font-weight:400;color:#756c66}
.images{display:flex;align-items:center;justify-content:center;gap:12px;height:190px}
figure{margin:0;text-align:center;color:#786f69}.before{width:130px;height:150px;object-fit:contain;background:#eee}
.after{width:128px;height:128px;object-fit:cover;border-radius:50%;background:#eee}
figcaption{margin-top:5px}p{margin:5px 0;color:#635b55}a{color:#76543c}
</style></head><body><main>${cards}</main></body></html>`;
}

function textSvg(width, height, content) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<rect width="100%" height="100%" fill="#fff"/>
<text x="14" y="24" font-family="Segoe UI,Arial,sans-serif" font-size="15" font-weight="600" fill="#292522">${escapeHtml(content)}</text>
</svg>`);
}

async function circleBuffer(filePath, size) {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );
  return sharp(filePath)
    .resize(size, size)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function buildContactSheetPng(records, outputDir) {
  const columns = 4;
  const cellWidth = 300;
  const cellHeight = 260;
  const rows = Math.ceil(records.length / columns);
  const composites = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const x = (index % columns) * cellWidth;
    const y = Math.floor(index / columns) * cellHeight;
    const original = await sharp(path.join(outputDir, record.original_path), {
      limitInputPixels: false,
    })
      .rotate()
      .resize(130, 150, { fit: "contain", background: "#eee9e3" })
      .png()
      .toBuffer();
    const after = await circleBuffer(path.join(outputDir, record.processed_path), 116);
    composites.push(
      {
        input: textSvg(cellWidth - 8, cellHeight - 8, `${index + 1}. ${record.name_en}`),
        left: x + 4,
        top: y + 4,
      },
      { input: original, left: x + 12, top: y + 42 },
      { input: after, left: x + 168, top: y + 58 },
      {
        input: Buffer.from(
          `<svg width="280" height="34"><text x="12" y="22" font-family="Segoe UI,Arial,sans-serif" font-size="12" fill="#756b64">source → 512 WebP · ${record.processed_bytes} B</text></svg>`,
        ),
        left: x + 4,
        top: y + 208,
      },
    );
  }
  const destination = path.join(outputDir, "task5-contact-sheet.png");
  await sharp({
    create: {
      width: columns * cellWidth,
      height: rows * cellHeight,
      channels: 3,
      background: "#f1ede8",
    },
  })
    .composite(composites)
    .png()
    .toFile(destination);
  return destination;
}

async function fetchPublicObject(url) {
  const separator = url.includes("?") ? "&" : "?";
  const response = await fetch(`${url}${separator}verify=${Date.now()}`, {
    cache: "no-store",
    headers: { "user-agent": "ArtArchivePortraitTask5/1.0 (COS verification)" },
  });
  if (!response.ok) throw new Error(`Public COS GET failed: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const metadata = await sharp(buffer).metadata();
  return {
    bytes: buffer.length,
    sha256: sha256(buffer),
    content_type: stringValue(response.headers.get("content-type")).split(";")[0],
    width: metadata.width || 0,
    height: metadata.height || 0,
  };
}

async function preflightUploads(cos, records, options) {
  const plans = [];
  for (const record of records) {
    const params = {
      Bucket: options.bucket,
      Region: options.region,
      Key: record.object_key,
    };
    const head = await headObject(cos, params);
    let action = "upload_missing";
    let existing = null;
    if (head.exists) {
      existing = await fetchPublicObject(record.public_url);
      action =
        existing.sha256 === record.processed_sha256
          ? "skip_identical"
          : "conflict_existing_different_content";
    }
    plans.push({
      artist_id: record.artist_id,
      object_key: record.object_key,
      public_url: record.public_url,
      expected_bytes: record.processed_bytes,
      expected_sha256: record.processed_sha256,
      action,
      existing,
    });
  }
  return plans;
}

async function uploadAndVerify(cos, records, plans, options) {
  const planByArtist = new Map(plans.map((plan) => [plan.artist_id, plan]));
  const conflicts = plans.filter((plan) => plan.action === "conflict_existing_different_content");
  if (conflicts.length) {
    throw new Error(`Refusing to overwrite ${conflicts.length} immutable COS object(s).`);
  }
  const report = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const plan = planByArtist.get(record.artist_id);
    let status = "skipped_identical";
    if (plan.action === "upload_missing") {
      const localPath = path.join(options.outputDir, record.processed_path);
      await cosCall(cos, "putObject", {
        Bucket: options.bucket,
        Region: options.region,
        Key: record.object_key,
        Body: createReadStream(localPath),
        ContentLength: record.processed_bytes,
        ContentType: "image/webp",
        CacheControl: CACHE_CONTROL,
        Headers: {
          "x-cos-meta-sha256": record.processed_sha256,
          "x-cos-meta-artist-id": record.artist_id,
        },
      });
      status = "uploaded";
    }
    const verification = await fetchPublicObject(record.public_url);
    const verified =
      verification.sha256 === record.processed_sha256 &&
      verification.bytes === record.processed_bytes &&
      verification.content_type === "image/webp" &&
      verification.width === OUTPUT_SIZE &&
      verification.height === OUTPUT_SIZE;
    if (!verified) throw new Error(`COS verification failed: ${record.artist_id}`);
    report.push({
      artist_id: record.artist_id,
      object_key: record.object_key,
      public_url: record.public_url,
      status,
      verified,
      expected_sha256: record.processed_sha256,
      remote_sha256: verification.sha256,
      remote_bytes: verification.bytes,
      remote_content_type: verification.content_type,
      remote_width: verification.width,
      remote_height: verification.height,
    });
    console.log(
      `[portrait-task5] Uploaded/verified ${index + 1}/${records.length}: ${record.artist_id}`,
    );
  }
  return report;
}

function buildAudit(records, plans, uploadReport, run, expectedCount = 19) {
  const errors = [];
  if (records.length !== expectedCount) {
    errors.push({
      code: "selected_count_mismatch",
      expected: expectedCount,
      actual: records.length,
    });
  }
  const artistIds = new Set();
  const objectKeys = new Set();
  for (const record of records) {
    if (artistIds.has(record.artist_id))
      errors.push({
        artist_id: record.artist_id,
        code: "duplicate_artist",
      });
    artistIds.add(record.artist_id);
    if (objectKeys.has(record.object_key))
      errors.push({
        artist_id: record.artist_id,
        code: "duplicate_object_key",
      });
    objectKeys.add(record.object_key);
    if (record.processed_width !== OUTPUT_SIZE || record.processed_height !== OUTPUT_SIZE) {
      errors.push({ artist_id: record.artist_id, code: "processed_dimensions_invalid" });
    }
    if (record.processed_mime !== "image/webp") {
      errors.push({ artist_id: record.artist_id, code: "processed_mime_invalid" });
    }
    if (record.processed_bytes > DEFAULT_MAX_OUTPUT_BYTES) {
      errors.push({ artist_id: record.artist_id, code: "processed_size_exceeded" });
    }
  }
  const conflicts = plans.filter((plan) => plan.action === "conflict_existing_different_content");
  if (conflicts.length) errors.push({ code: "immutable_object_conflict", count: conflicts.length });
  if (run) {
    const verified = uploadReport.filter((item) => item.verified);
    if (verified.length !== records.length) {
      errors.push({ code: "remote_verification_incomplete", count: verified.length });
    }
  }
  return {
    generated_at: new Date().toISOString(),
    status: errors.length ? "failed" : "passed",
    mode: run ? "uploaded" : "dry_run",
    production_database_writes: 0,
    summary: {
      records: records.length,
      originals_verified: records.length,
      candidate_mime_mismatches: records.filter(
        (record) => !record.candidate_mime_matches_signature,
      ).length,
      official_preview_fallbacks: records.filter(
        (record) => record.source_delivery === "official_preview_fallback",
      ).length,
      processed: records.length,
      preflight_upload_missing: plans.filter((plan) => plan.action === "upload_missing").length,
      preflight_skip_identical: plans.filter((plan) => plan.action === "skip_identical").length,
      preflight_conflicts: conflicts.length,
      uploaded: uploadReport.filter((item) => item.status === "uploaded").length,
      skipped_identical: uploadReport.filter((item) => item.status === "skipped_identical").length,
      remote_verified: uploadReport.filter((item) => item.verified).length,
      errors: errors.length,
    },
    acceptance: {
      expected_selected_count: expectedCount,
      all_selected_processed: records.length === expectedCount,
      source_signatures_verified: records.length === expectedCount,
      outputs_are_512_webp: !errors.some((error) =>
        ["processed_dimensions_invalid", "processed_mime_invalid"].includes(error.code),
      ),
      outputs_within_size_budget: !errors.some((error) => error.code === "processed_size_exceeded"),
      immutable_keys_conflict_free: conflicts.length === 0,
      public_cos_verified: run
        ? uploadReport.filter((item) => item.verified).length === records.length
        : null,
      production_database_untouched: true,
    },
    errors,
  };
}

function manifestEntry(outputDir, name) {
  const filePath = path.join(outputDir, name);
  const buffer = fs.readFileSync(filePath);
  return { name, bytes: buffer.length, sha256: sha256(buffer) };
}

function writeTask5Manifest(outputDir, audit) {
  const files = CORE_OUTPUTS.filter((name) => fs.existsSync(path.join(outputDir, name)));
  atomicWrite(
    path.join(outputDir, "task5-manifest.json"),
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        status: audit.status,
        mode: audit.mode,
        production_database_writes: 0,
        files: files.map((name) => manifestEntry(outputDir, name)),
      },
      null,
      2,
    )}\n`,
  );
}

async function main() {
  await loadEnv();
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  requireCosOptions(options);
  await mkdir(options.outputDir, { recursive: true });
  const inputs = selectedInputs(options.inputDir, options.expectedCount);
  const records = await processSelected(inputs, options);
  atomicWrite(path.join(options.outputDir, "task5-processing.jsonl"), jsonlText(records));
  atomicWrite(
    path.join(options.outputDir, "upload-manifest.jsonl"),
    jsonlText(
      records.map((record) => ({
        artist_id: record.artist_id,
        local_path: record.processed_path,
        object_key: record.object_key,
        public_url: record.public_url,
        bytes: record.processed_bytes,
        sha256: record.processed_sha256,
        content_type: "image/webp",
        cache_control: CACHE_CONTROL,
        source_page_url: record.source_page_url,
        source_download_url_used: record.source_download_url_used,
        source_delivery: record.source_delivery,
        license: record.license,
        license_url: record.license_url,
        credit: record.credit,
      })),
    ),
  );
  atomicWrite(path.join(options.outputDir, "task5-contact-sheet.html"), contactSheetHtml(records));
  await buildContactSheetPng(records, options.outputDir);

  const cos = new COS({
    SecretId: options.secretId,
    SecretKey: options.secretKey,
    SecurityToken: options.sessionToken || undefined,
  });
  const plans = await preflightUploads(cos, records, options);
  atomicWrite(
    path.join(options.outputDir, "upload-dry-run.json"),
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        bucket: options.bucket,
        region: options.region,
        prefix: options.prefix,
        planned_objects: plans.length,
        upload_missing: plans.filter((plan) => plan.action === "upload_missing").length,
        skip_identical: plans.filter((plan) => plan.action === "skip_identical").length,
        conflicts: plans.filter((plan) => plan.action === "conflict_existing_different_content")
          .length,
        production_database_writes: 0,
        objects: plans,
      },
      null,
      2,
    )}\n`,
  );

  const uploadReport = options.run ? await uploadAndVerify(cos, records, plans, options) : [];
  atomicWrite(
    path.join(options.outputDir, "upload-report.json"),
    `${JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        mode: options.run ? "uploaded" : "dry_run_not_uploaded",
        production_database_writes: 0,
        objects: uploadReport,
      },
      null,
      2,
    )}\n`,
  );
  const audit = buildAudit(records, plans, uploadReport, options.run, options.expectedCount);
  atomicWrite(
    path.join(options.outputDir, "task5-audit.json"),
    `${JSON.stringify(audit, null, 2)}\n`,
  );
  writeTask5Manifest(options.outputDir, audit);
  console.log(
    JSON.stringify(
      {
        output_dir: options.outputDir,
        mode: audit.mode,
        audit_status: audit.status,
        summary: audit.summary,
        contact_sheet: path.join(options.outputDir, "task5-contact-sheet.png"),
        production_database_writes: 0,
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(`[portrait-task5] ${error.stack || error.message}`);
    process.exitCode = 1;
  });
}
