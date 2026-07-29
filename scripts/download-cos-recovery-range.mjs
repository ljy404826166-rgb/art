#!/usr/bin/env node

import COS from "cos-nodejs-sdk-v5";
import fs from "node:fs";
import path from "node:path";

const START = 1997;
const END = 2596;
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 4;
const DEFAULT_OUTPUT = path.resolve("recovery", "cos-1997-2596", "originals");

function parseArgs(argv) {
  const options = {
    confirmed: false,
    output: DEFAULT_OUTPUT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--confirmed") {
      options.confirmed = true;
    } else if (arg === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--out requires a directory.");
      }
      options.output = path.resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.confirmed) {
    throw new Error("继续下载可能消耗流量。确认后请传入 --confirmed。");
  }
  return options;
}

function cosCall(cos, method, params) {
  return new Promise((resolve, reject) => {
    cos[method](params, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

async function listObjects(cos, options) {
  const objects = new Map();
  let marker = "";
  do {
    const data = await cosCall(cos, "getBucket", {
      Bucket: options.bucket,
      Region: options.region,
      Prefix: options.prefix,
      Marker: marker,
      MaxKeys: 1000,
    });
    for (const object of data.Contents || []) {
      objects.set(object.Key, object);
    }
    if (String(data.IsTruncated).toLowerCase() !== "true") break;
    marker = data.NextMarker || data.Contents?.at(-1)?.Key || "";
    if (!marker) {
      throw new Error("COS listing was truncated without a next marker.");
    }
  } while (marker);
  return objects;
}

function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function downloadObject(cos, item, options) {
  const destination = path.join(options.output, item.file_name);
  const partial = `${destination}.part`;

  if (fs.existsSync(destination)) {
    const size = fs.statSync(destination).size;
    if (size === item.size) {
      return { status: "skipped_existing", destination, size };
    }
    const invalidPath = `${destination}.invalid-${Date.now()}`;
    fs.renameSync(destination, invalidPath);
  }

  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      if (fs.existsSync(partial)) fs.rmSync(partial);
      const output = fs.createWriteStream(partial, { flags: "wx" });
      await cosCall(cos, "getObject", {
        Bucket: options.bucket,
        Region: options.region,
        Key: item.key,
        Output: output,
      });
      const size = fs.statSync(partial).size;
      if (size !== item.size) {
        throw new Error(`size mismatch: received ${size}, expected ${item.size}`);
      }
      fs.renameSync(partial, destination);
      return { status: "downloaded", destination, size, attempt };
    } catch (error) {
      lastError = error;
      if (fs.existsSync(partial)) fs.rmSync(partial);
      if (attempt < MAX_ATTEMPTS) {
        await delay(Math.min(1000 * 2 ** (attempt - 1), 8000));
      }
    }
  }
  throw lastError;
}

async function main() {
  const cli = parseArgs(process.argv.slice(2));
  const secretId = process.env.TENCENT_SECRET_ID;
  const secretKey = process.env.TENCENT_SECRET_KEY;
  const bucket = process.env.TENCENT_COS_BUCKET;
  const region = process.env.TENCENT_COS_REGION;
  const configuredPrefix = String(process.env.TENCENT_COS_PREFIX || "").replace(/^\/+|\/+$/g, "");
  if (!secretId || !secretKey || !bucket || !region) {
    throw new Error("Missing Tencent COS configuration.");
  }

  const workspace = path.resolve(".");
  const relativeOutput = path.relative(workspace, cli.output);
  if (
    relativeOutput === ".." ||
    relativeOutput.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeOutput)
  ) {
    throw new Error("Recovery output must stay inside the current workspace.");
  }

  const prefix = configuredPrefix ? `${configuredPrefix}/` : "";
  const options = {
    ...cli,
    bucket,
    region,
    prefix,
  };
  fs.mkdirSync(options.output, { recursive: true });

  const cos = new COS({
    SecretId: secretId,
    SecretKey: secretKey,
    SecurityToken: process.env.TENCENT_SESSION_TOKEN || undefined,
  });
  const objects = await listObjects(cos, options);
  const items = [];
  for (let number = START; number <= END; number += 1) {
    const imageId = `${number}_standard`;
    const key = `${prefix}${imageId}.jpg`;
    const object = objects.get(key);
    if (!object) throw new Error(`COS object is missing: ${key}`);
    items.push({
      image_id: imageId,
      file_name: `${imageId}.jpg`,
      key,
      size: Number(object.Size),
      etag: String(object.ETag || "").replace(/^"|"$/g, ""),
      last_modified: object.LastModified,
      status: "pending",
    });
  }

  const reportPath = path.resolve(options.output, "..", "download-report.json");
  const report = {
    bucket,
    region,
    prefix,
    range: { start: START, end: END, expected: items.length },
    output: options.output,
    concurrency: CONCURRENCY,
    started_at: new Date().toISOString(),
    completed_at: null,
    total_bytes: items.reduce((total, item) => total + item.size, 0),
    downloaded: 0,
    skipped_existing: 0,
    failed: 0,
    items,
  };
  atomicWriteJson(reportPath, report);

  let cursor = 0;
  let completed = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      try {
        const result = await downloadObject(cos, item, options);
        Object.assign(item, result);
        report[result.status] += 1;
      } catch (error) {
        item.status = "failed";
        item.error = error.message;
        report.failed += 1;
      }
      completed += 1;
      atomicWriteJson(reportPath, report);
      if (completed % 10 === 0 || completed === items.length) {
        process.stdout.write(
          `[cos-recovery] ${completed}/${items.length}; downloaded=${report.downloaded}; existing=${report.skipped_existing}; failed=${report.failed}\n`,
        );
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => worker()));
  report.completed_at = new Date().toISOString();
  atomicWriteJson(reportPath, report);
  process.stdout.write(
    `${JSON.stringify(
      {
        output: options.output,
        report: reportPath,
        expected: items.length,
        downloaded: report.downloaded,
        skipped_existing: report.skipped_existing,
        failed: report.failed,
        total_bytes: report.total_bytes,
      },
      null,
      2,
    )}\n`,
  );
  if (report.failed) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
