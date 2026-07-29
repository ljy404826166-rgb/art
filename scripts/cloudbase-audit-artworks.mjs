#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_COLLECTION = "artworks";
const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), "csv", "cloudbase");
const DEFAULT_PAGE_SIZE = 500;
const COS_RE = /masterpiece-1437223579\.cos\.ap-beijing\.myqcloud\.com\/ppaintings\//iu;
const SUPABASE_STORAGE_RE = /supabase\.co\/storage\/v1\/object\/public\/artwork\//iu;
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENETDOWN",
  "ENETRESET",
  "ENETUNREACH",
  "ETIMEDOUT",
  "InternalError",
  "RequestLimitExceeded",
  "ServiceUnavailable",
  "Throttling",
  "TooManyRequests",
]);
const NON_RETRYABLE_CODES = new Set([
  "AuthFailure",
  "InvalidParameter",
  "InvalidParameterValue",
  "PermissionDenied",
  "UnauthorizedOperation",
]);
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/gu)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function env() {
  return { ...parseEnvFile(".env"), ...parseEnvFile(".env.local"), ...process.env };
}

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function positiveInt(value, flag) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return number;
}

function nonNegativeInt(value, flag) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${flag} must be a non-negative integer.`);
  }
  return number;
}

function ratio(value, flag) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${flag} must be between 0 and 1.`);
  }
  return number;
}

function safeSegment(value) {
  return String(value || "unknown").replace(/[^A-Za-z0-9_-]+/gu, "-");
}

export function parseArgs(argv, environment = process.env) {
  const options = {
    envId: environment.CLOUDBASE_ENV_ID || environment.TCB_ENV_ID || DEFAULT_ENV_ID,
    collection: DEFAULT_COLLECTION,
    reportDir: DEFAULT_REPORT_DIR,
    sampleHead: 5,
    headConcurrency: 4,
    headTimeoutMs: 15_000,
    maxAttempts: 4,
    baseDelayMs: 500,
    maxDelayMs: 8_000,
    jitterRatio: 0.25,
    resume: false,
    checkpointPath: "",
    comparePath: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-id") options.envId = required(argv, (index += 1), arg);
    else if (arg === "--collection") options.collection = required(argv, (index += 1), arg);
    else if (arg === "--report-dir") {
      options.reportDir = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--sample-head") {
      options.sampleHead = positiveInt(required(argv, (index += 1), arg), arg);
    } else if (arg === "--head-concurrency") {
      options.headConcurrency = positiveInt(required(argv, (index += 1), arg), arg);
    } else if (arg === "--head-timeout-ms") {
      options.headTimeoutMs = positiveInt(required(argv, (index += 1), arg), arg);
    } else if (arg === "--max-attempts") {
      options.maxAttempts = positiveInt(required(argv, (index += 1), arg), arg);
    } else if (arg === "--base-delay-ms") {
      options.baseDelayMs = nonNegativeInt(required(argv, (index += 1), arg), arg);
    } else if (arg === "--max-delay-ms") {
      options.maxDelayMs = nonNegativeInt(required(argv, (index += 1), arg), arg);
    } else if (arg === "--jitter-ratio") {
      options.jitterRatio = ratio(required(argv, (index += 1), arg), arg);
    } else if (arg === "--checkpoint") {
      options.checkpointPath = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--compare") {
      options.comparePath = path.resolve(required(argv, (index += 1), arg));
    } else if (arg === "--resume") options.resume = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.checkpointPath) {
    options.checkpointPath = path.join(
      options.reportDir,
      `.cloudbase-audit-${safeSegment(options.envId)}-${safeSegment(options.collection)}.checkpoint.json`,
    );
  }
  return options;
}

export function createClient(options, config) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error("Missing Tencent credentials. Set TENCENT_SECRET_ID and TENCENT_SECRET_KEY.");
  }
  return CloudBase.init({ envId: options.envId, secretId, secretKey });
}

export function parseCommandRows(data) {
  try {
    const outer = JSON.parse(data || "[]");
    if (!Array.isArray(outer)) throw new Error("CloudBase query Data must be an array.");
    return outer.map((row) => (typeof row === "string" ? JSON.parse(row) : row));
  } catch (error) {
    error.code = error.code || "MALFORMED_RESPONSE";
    throw error;
  }
}

export function isRetryableError(error) {
  const status = Number(
    error?.statusCode ||
      error?.status ||
      error?.response?.status ||
      error?.cause?.statusCode ||
      error?.cause?.status ||
      0,
  );
  const code = String(error?.code || error?.Code || error?.cause?.code || "");
  const message = String(error?.message || error?.cause?.message || "");
  if (NON_RETRYABLE_CODES.has(code) || [400, 401, 403, 404].includes(status)) return false;
  return (
    RETRYABLE_STATUS.has(status) ||
    RETRYABLE_CODES.has(code) ||
    code === "MALFORMED_RESPONSE" ||
    /ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENET(?:DOWN|RESET|UNREACH)|ETIMEDOUT|internal error|service unavailable|temporar|timeout|timed out|socket hang up|rate limit/iu.test(
      message,
    )
  );
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function withRetry(
  worker,
  {
    maxAttempts = 4,
    baseDelayMs = 500,
    maxDelayMs = 8_000,
    jitterRatio = 0.25,
    sleep = wait,
    random = Math.random,
    onRetry = () => {},
  } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await worker(attempt);
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      if (!retryable || attempt >= maxAttempts) {
        error.attempts = attempt;
        error.retryable = retryable;
        throw error;
      }
      const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delayMs = Math.round(exponential + exponential * jitterRatio * random());
      onRetry({ attempt, next_attempt: attempt + 1, delay_ms: delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}

export function redactSensitiveText(value, sensitiveValues = []) {
  let output = String(value || "");
  for (const secret of sensitiveValues.filter(Boolean)) {
    output = output.split(String(secret)).join("[REDACTED]");
  }
  return output
    .replace(
      /([?&](?:authorization|credential|key|secret|signature|sign|token)=)[^&\s]+/giu,
      "$1[REDACTED]",
    )
    .replace(/(Secret(?:Id|Key)\s*[:=]\s*)[^\s,;]+/giu, "$1[REDACTED]");
}

export function safeUrl(value) {
  if (!value) return "";
  try {
    const parsed = new URL(String(value));
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return redactSensitiveText(value);
  }
}

function safeError(error, sensitiveValues = []) {
  return {
    name: String(error?.name || "Error"),
    code: String(error?.code || error?.Code || error?.cause?.code || ""),
    status_code:
      Number(
        error?.statusCode ||
          error?.status ||
          error?.response?.status ||
          error?.cause?.statusCode ||
          error?.cause?.status ||
          0,
      ) || null,
    request_id: String(error?.RequestId || error?.requestId || error?.request_id || ""),
    message: redactSensitiveText(error?.message || error, sensitiveValues),
    retryable: Boolean(error?.retryable ?? isRetryableError(error)),
    attempts: Number(error?.attempts || 1),
  };
}

export function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

export function readCheckpoint(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function checkpointIdentity(options) {
  return {
    schema_version: 1,
    env_id: options.envId,
    collection: options.collection,
    page_size: options.pageSize || DEFAULT_PAGE_SIZE,
  };
}

function validateCheckpoint(checkpoint, options) {
  const expected = checkpointIdentity(options);
  for (const key of ["schema_version", "env_id", "collection", "page_size"]) {
    if (checkpoint?.[key] !== expected[key]) {
      throw new Error(`Checkpoint ${key} does not match the requested audit.`);
    }
  }
  if (!Array.isArray(checkpoint.rows) || !Array.isArray(checkpoint.pages)) {
    throw new Error("Checkpoint rows and pages must be arrays.");
  }
}

function pageFingerprint(rows) {
  return createHash("sha256")
    .update(JSON.stringify(rows.map((row) => row?._id || row)))
    .digest("hex");
}

function queryCommand(collection, skip, pageSize) {
  return {
    MgoCommands: [
      {
        TableName: collection,
        CommandType: "QUERY",
        Command: JSON.stringify({
          find: collection,
          filter: {},
          sort: { _id: 1 },
          skip,
          limit: pageSize,
        }),
      },
    ],
  };
}

function paginationFailure(message, details = {}) {
  const error = new Error(message);
  error.code = "PAGINATION_INTEGRITY_ERROR";
  Object.assign(error, details);
  return error;
}

export async function queryAll(
  database,
  {
    envId,
    collection,
    checkpointPath,
    resume = false,
    pageSize = DEFAULT_PAGE_SIZE,
    maxAttempts = 4,
    baseDelayMs = 500,
    maxDelayMs = 8_000,
    jitterRatio = 0.25,
    sleep,
    random,
    onRetry = () => {},
    sensitiveValues = [],
  },
) {
  const identityOptions = { envId, collection, pageSize };
  let checkpoint = resume ? readCheckpoint(checkpointPath) : null;
  if (resume && !checkpoint) throw new Error(`Resume checkpoint not found: ${checkpointPath}`);
  if (checkpoint) validateCheckpoint(checkpoint, identityOptions);
  else {
    checkpoint = {
      ...checkpointIdentity(identityOptions),
      status: "running",
      rows: [],
      pages: [],
      next_skip: 0,
      failures: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    writeJsonAtomic(checkpointPath, checkpoint);
  }
  if (checkpoint.status === "complete") {
    return { ...checkpoint, resumed: resume };
  }

  const rows = [...checkpoint.rows];
  const pages = [...checkpoint.pages];
  const knownIds = new Set(rows.map((row) => row?._id).filter(Boolean));
  const fingerprints = new Set(pages.map((page) => page.fingerprint).filter(Boolean));
  let skip = Number(checkpoint.next_skip || 0);

  for (;;) {
    let attempts = 0;
    try {
      const page = await withRetry(
        async (attempt) => {
          attempts = attempt;
          const result = await database.runCommands(queryCommand(collection, skip, pageSize));
          return {
            result,
            batch: parseCommandRows(result.Data?.[0]),
          };
        },
        {
          maxAttempts,
          baseDelayMs,
          maxDelayMs,
          jitterRatio,
          sleep,
          random,
          onRetry: (event) =>
            onRetry({
              stage: "query",
              collection,
              skip,
              page: Math.floor(skip / pageSize),
              ...event,
              error: safeError(event.error, sensitiveValues),
            }),
        },
      );
      const { result, batch } = page;
      const fingerprint = pageFingerprint(batch);
      const pageIds = batch.map((row) => row?._id).filter(Boolean);
      if (batch.length && fingerprints.has(fingerprint)) {
        throw paginationFailure("CloudBase returned a duplicate page.", { skip });
      }
      const repeatedIds = pageIds.filter((id) => knownIds.has(id));
      if (repeatedIds.length) {
        throw paginationFailure("CloudBase returned records already present in an earlier page.", {
          skip,
          repeated_ids: [...new Set(repeatedIds)].slice(0, 20),
        });
      }

      rows.push(...batch);
      pageIds.forEach((id) => knownIds.add(id));
      fingerprints.add(fingerprint);
      pages.push({
        page: Math.floor(skip / pageSize),
        skip,
        count: batch.length,
        attempts,
        request_id: String(result.RequestId || result.requestId || ""),
        fingerprint,
      });
      skip += pageSize;
      checkpoint = {
        ...checkpoint,
        status: batch.length < pageSize ? "complete" : "running",
        rows,
        pages,
        next_skip: skip,
        failures: checkpoint.failures || [],
        updated_at: new Date().toISOString(),
        completed_at: batch.length < pageSize ? new Date().toISOString() : "",
      };
      writeJsonAtomic(checkpointPath, checkpoint);
      if (batch.length < pageSize) return { ...checkpoint, resumed: resume };
    } catch (error) {
      const failure = {
        stage: "query",
        collection,
        page: Math.floor(skip / pageSize),
        skip,
        ...safeError(error, sensitiveValues),
        repeated_ids: Array.isArray(error?.repeated_ids) ? error.repeated_ids : [],
      };
      checkpoint = {
        ...checkpoint,
        status: rows.length ? "partial" : "failed",
        rows,
        pages,
        next_skip: skip,
        failures: [...(checkpoint.failures || []), failure],
        updated_at: new Date().toISOString(),
      };
      writeJsonAtomic(checkpointPath, checkpoint);
      return { ...checkpoint, resumed: resume };
    }
  }
}

function imageUrl(row) {
  return row.display_url || row.thumbnail_url || row.download_url || "";
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function consume() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => consume()),
  );
  return results;
}

function responseError(response) {
  const error = new Error(`HEAD request returned HTTP ${response.status}.`);
  error.statusCode = response.status;
  error.code = `HTTP_${response.status}`;
  return error;
}

async function fetchHead(fetchFn, url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { method: "HEAD", signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`HEAD request timed out after ${timeoutMs}ms.`);
      timeoutError.code = "ETIMEDOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkHeadSamples(
  urls,
  {
    concurrency = 4,
    timeoutMs = 15_000,
    maxAttempts = 4,
    baseDelayMs = 500,
    maxDelayMs = 8_000,
    jitterRatio = 0.25,
    fetchFn = fetch,
    sleep,
    random,
    sensitiveValues = [],
  } = {},
) {
  const checks = await mapConcurrent(urls, concurrency, async (url) => {
    let attempts = 0;
    try {
      const response = await withRetry(
        async (attempt) => {
          attempts = attempt;
          const current = await fetchHead(fetchFn, url, timeoutMs);
          if (RETRYABLE_STATUS.has(current.status)) throw responseError(current);
          return current;
        },
        { maxAttempts, baseDelayMs, maxDelayMs, jitterRatio, sleep, random },
      );
      return {
        url: safeUrl(url),
        status: response.status,
        content_type: response.headers.get("content-type") || "",
        attempts,
        ok: response.status === 200,
      };
    } catch (error) {
      return {
        url: safeUrl(url),
        ...safeError(error, sensitiveValues),
        attempts: Number(error?.attempts || attempts || 1),
        ok: false,
      };
    }
  });
  return {
    checks,
    failures: checks.filter((check) => !check.ok),
  };
}

function sanitizeSampleUrl(value) {
  return safeUrl(value);
}

export function compareAuditReports(previous, current) {
  const fields = [
    "total",
    "cos_url_records",
    "old_supabase_storage_records",
    "missing_image_records",
    "missing_tag_records",
    "duplicate_id_count",
    "head_failure_count",
  ];
  const changes = Object.fromEntries(
    fields.map((field) => {
      const before = Number(previous?.[field] || 0);
      const after = Number(current?.[field] || 0);
      return [field, { before, after, delta: after - before }];
    }),
  );
  return {
    previous_generated_at: String(previous?.generated_at || ""),
    previous_status: String(previous?.status || ""),
    current_status: String(current?.status || ""),
    changed_fields: Object.entries(changes)
      .filter(([, value]) => value.delta !== 0)
      .map(([field]) => field),
    changes,
  };
}

function auditRows(rows) {
  const missingImages = rows.filter((row) => !row.thumbnail_url && !row.display_url);
  const oldSupabase = rows.filter((row) =>
    [row.thumbnail_url, row.display_url, row.download_url].some((value) =>
      SUPABASE_STORAGE_RE.test(String(value || "")),
    ),
  );
  const cosRows = rows.filter((row) =>
    [row.thumbnail_url, row.display_url, row.download_url].some((value) =>
      COS_RE.test(String(value || "")),
    ),
  );
  const missingTags = rows.filter(
    (row) => !Array.isArray(row.tag_keys) || row.tag_keys.length === 0,
  );
  const duplicateIds = rows
    .map((row) => row._id)
    .filter((id, index, ids) => id && ids.indexOf(id) !== index);
  return { missingImages, oldSupabase, cosRows, missingTags, duplicateIds };
}

export async function executeAudit(
  database,
  options,
  { fetchFn = fetch, sleep, random, sensitiveValues = [], onRetry = () => {} } = {},
) {
  const query = await queryAll(database, {
    ...options,
    sleep,
    random,
    sensitiveValues,
    onRetry,
  });
  const rows = query.rows || [];
  const { missingImages, oldSupabase, cosRows, missingTags, duplicateIds } = auditRows(rows);
  const samples = cosRows.slice(0, options.sampleHead).map(imageUrl).filter(Boolean);
  const headResult = await checkHeadSamples(samples, {
    concurrency: options.headConcurrency,
    timeoutMs: options.headTimeoutMs,
    maxAttempts: options.maxAttempts,
    baseDelayMs: options.baseDelayMs,
    maxDelayMs: options.maxDelayMs,
    jitterRatio: options.jitterRatio,
    fetchFn,
    sleep,
    random,
    sensitiveValues,
  });
  const report = {
    schema_version: 2,
    generated_at: new Date().toISOString(),
    status: query.status,
    env_id: options.envId,
    collection: options.collection,
    total: rows.length,
    cos_url_records: cosRows.length,
    old_supabase_storage_records: oldSupabase.length,
    missing_image_records: missingImages.length,
    missing_tag_records: missingTags.length,
    duplicate_id_count: duplicateIds.length,
    head_failure_count: headResult.failures.length,
    pagination: {
      status: query.status,
      page_size: query.page_size,
      completed_pages: query.pages.length,
      next_skip: query.next_skip,
      resumed: query.resumed,
      pages: query.pages.map(({ fingerprint: _fingerprint, ...page }) => page),
      failures: (query.failures || []).map((failure) => ({
        ...failure,
        recovered: query.status === "complete",
      })),
    },
    old_supabase_sample: oldSupabase.slice(0, 20).map((row) => ({
      _id: row._id,
      image_id: row.image_id,
      display_url: sanitizeSampleUrl(row.display_url),
    })),
    missing_image_sample: missingImages
      .slice(0, 20)
      .map((row) => ({ _id: row._id, title_cn: row.title_cn, title_en: row.title_en })),
    sample_checks: headResult.checks,
    head_failures: headResult.failures,
    sensitive_values_redacted: true,
  };
  if (options.comparePath && fs.existsSync(options.comparePath)) {
    report.comparison = compareAuditReports(
      JSON.parse(fs.readFileSync(options.comparePath, "utf8")),
      report,
    );
  }
  return report;
}

function timestampForFile() {
  return new Date()
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z");
}

function reportHasFindings(report) {
  return (
    report.status !== "complete" ||
    report.old_supabase_storage_records > 0 ||
    report.missing_image_records > 0 ||
    report.duplicate_id_count > 0 ||
    report.head_failure_count > 0
  );
}

export async function main(argv = process.argv.slice(2)) {
  const configuration = env();
  const options = parseArgs(argv, configuration);
  fs.mkdirSync(options.reportDir, { recursive: true });
  const reportPath = path.join(
    options.reportDir,
    `cloudbase-audit-${timestampForFile()}-${randomUUID().slice(0, 8)}.json`,
  );
  const sensitiveValues = [
    configuration.TENCENT_SECRET_ID,
    configuration.TENCENT_SECRET_KEY,
    configuration.TENCENT_SESSION_TOKEN,
  ].filter(Boolean);
  let report;
  try {
    const app = createClient(options, configuration);
    report = await executeAudit(app.database, options, {
      sensitiveValues,
      onRetry: (event) => {
        console.error(JSON.stringify({ event: "audit_retry", ...event }));
      },
    });
  } catch (error) {
    report = {
      schema_version: 2,
      generated_at: new Date().toISOString(),
      status: "failed",
      env_id: options.envId,
      collection: options.collection,
      total: 0,
      failure: safeError(error, sensitiveValues),
      sensitive_values_redacted: true,
    };
  }
  writeJsonAtomic(reportPath, report);
  console.log(
    JSON.stringify(
      {
        ...report,
        report_path: reportPath,
        checkpoint_path: options.checkpointPath,
      },
      null,
      2,
    ),
  );
  if (reportHasFindings(report)) process.exitCode = 1;
  return { report, reportPath };
}

const isDirectRun =
  process.argv[1] &&
  path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url));
if (isDirectRun) {
  main().catch((error) => {
    console.error(redactSensitiveText(error instanceof Error ? error.message : error));
    process.exitCode = 1;
  });
}
