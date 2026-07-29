import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  checkHeadSamples,
  compareAuditReports,
  executeAudit,
  isRetryableError,
  parseArgs,
  queryAll,
  redactSensitiveText,
  safeUrl,
  withRetry,
} from "./cloudbase-audit-artworks.mjs";

function tempCheckpoint() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cloudbase-audit-"));
  return {
    directory,
    checkpointPath: path.join(directory, "checkpoint.json"),
  };
}

function commandRows(rows, requestId = "request-test") {
  return {
    Data: [JSON.stringify(rows.map((row) => JSON.stringify(row)))],
    RequestId: requestId,
  };
}

function requestedSkip(request) {
  return JSON.parse(request.MgoCommands[0].Command).skip;
}

function baseQueryOptions(checkpointPath, overrides = {}) {
  return {
    envId: "env-test",
    collection: "artworks",
    checkpointPath,
    pageSize: 2,
    maxAttempts: 3,
    baseDelayMs: 0,
    maxDelayMs: 0,
    jitterRatio: 0,
    sleep: async () => {},
    random: () => 0,
    ...overrides,
  };
}

test("audit CLI exposes retry, checkpoint, resume, concurrency, and comparison controls", () => {
  const options = parseArgs(
    [
      "--env-id",
      "env-test",
      "--collection",
      "paintings",
      "--report-dir",
      "./tmp-reports",
      "--sample-head",
      "7",
      "--head-concurrency",
      "3",
      "--head-timeout-ms",
      "2500",
      "--max-attempts",
      "5",
      "--base-delay-ms",
      "10",
      "--max-delay-ms",
      "100",
      "--jitter-ratio",
      "0.5",
      "--checkpoint",
      "./checkpoint.json",
      "--compare",
      "./previous.json",
      "--resume",
    ],
    {},
  );
  assert.equal(options.envId, "env-test");
  assert.equal(options.collection, "paintings");
  assert.equal(options.sampleHead, 7);
  assert.equal(options.headConcurrency, 3);
  assert.equal(options.headTimeoutMs, 2500);
  assert.equal(options.maxAttempts, 5);
  assert.equal(options.baseDelayMs, 10);
  assert.equal(options.maxDelayMs, 100);
  assert.equal(options.jitterRatio, 0.5);
  assert.equal(options.resume, true);
  assert.match(options.checkpointPath, /checkpoint\.json$/u);
  assert.match(options.comparePath, /previous\.json$/u);
});

test("retry completes when the first two attempts fail and the third succeeds", async () => {
  let calls = 0;
  const delays = [];
  const result = await withRetry(
    async () => {
      calls += 1;
      if (calls < 3) {
        throw Object.assign(new Error("temporary internal error"), {
          statusCode: 500,
          requestId: `request-${calls}`,
        });
      }
      return "complete";
    },
    {
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      jitterRatio: 0,
      sleep: async (delay) => delays.push(delay),
    },
  );
  assert.equal(result, "complete");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [100, 200]);
});

test("permission and parameter errors fail immediately without retry", async () => {
  let calls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        calls += 1;
        throw Object.assign(new Error("permission denied"), {
          statusCode: 403,
          code: "PermissionDenied",
        });
      },
      { maxAttempts: 4, sleep: async () => {} },
    ),
    /permission denied/u,
  );
  assert.equal(calls, 1);
  assert.equal(isRetryableError({ statusCode: 503 }), true);
  assert.equal(
    isRetryableError(new Error("FetchError: invalid response body: read ECONNRESET")),
    true,
  );
  assert.equal(isRetryableError({ statusCode: 403 }), false);
});

test("exhausted pagination writes a partial checkpoint without losing completed pages", async () => {
  const { checkpointPath } = tempCheckpoint();
  let secondPageCalls = 0;
  const database = {
    async runCommands(request) {
      const skip = requestedSkip(request);
      if (skip === 0) {
        return commandRows([{ _id: "a1" }, { _id: "a2" }], "request-page-0");
      }
      secondPageCalls += 1;
      throw Object.assign(new Error("internal error"), {
        statusCode: 500,
        requestId: `request-page-1-${secondPageCalls}`,
      });
    },
  };
  const result = await queryAll(database, baseQueryOptions(checkpointPath, { maxAttempts: 2 }));
  assert.equal(result.status, "partial");
  assert.deepEqual(
    result.rows.map((row) => row._id),
    ["a1", "a2"],
  );
  assert.equal(result.next_skip, 2);
  assert.equal(result.pages.length, 1);
  assert.equal(result.failures[0].attempts, 2);
  assert.equal(result.failures[0].request_id, "request-page-1-2");

  const saved = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
  assert.equal(saved.status, "partial");
  assert.equal(saved.rows.length, 2);
});

test("resume continues from the checkpoint instead of reading completed pages again", async () => {
  const { checkpointPath } = tempCheckpoint();
  const firstRunDatabase = {
    async runCommands(request) {
      if (requestedSkip(request) === 0) {
        return commandRows([{ _id: "a1" }, { _id: "a2" }]);
      }
      throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    },
  };
  const first = await queryAll(
    firstRunDatabase,
    baseQueryOptions(checkpointPath, { maxAttempts: 1 }),
  );
  assert.equal(first.status, "partial");

  const resumedSkips = [];
  const resumeDatabase = {
    async runCommands(request) {
      const skip = requestedSkip(request);
      resumedSkips.push(skip);
      return commandRows([{ _id: "a3" }], "request-resume");
    },
  };
  const resumed = await queryAll(
    resumeDatabase,
    baseQueryOptions(checkpointPath, { resume: true }),
  );
  assert.equal(resumed.status, "complete");
  assert.equal(resumed.resumed, true);
  assert.deepEqual(resumedSkips, [2]);
  assert.deepEqual(
    resumed.rows.map((row) => row._id),
    ["a1", "a2", "a3"],
  );
});

test("empty pages complete normally and duplicate pages produce a partial report", async () => {
  const empty = tempCheckpoint();
  const emptyResult = await queryAll(
    { runCommands: async () => commandRows([]) },
    baseQueryOptions(empty.checkpointPath),
  );
  assert.equal(emptyResult.status, "complete");
  assert.equal(emptyResult.rows.length, 0);

  const duplicate = tempCheckpoint();
  const repeated = [{ _id: "a1" }, { _id: "a2" }];
  const duplicateResult = await queryAll(
    { runCommands: async () => commandRows(repeated) },
    baseQueryOptions(duplicate.checkpointPath),
  );
  assert.equal(duplicateResult.status, "partial");
  assert.equal(duplicateResult.failures[0].code, "PAGINATION_INTEGRITY_ERROR");
  assert.equal(duplicateResult.rows.length, 2);
});

test("HEAD checks use bounded concurrency, retry transient responses, and isolate failures", async () => {
  let active = 0;
  let maximumActive = 0;
  const attempts = new Map();
  const fetchFn = async (url) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    const count = (attempts.get(url) || 0) + 1;
    attempts.set(url, count);
    if (url.endsWith("retry.jpg") && count === 1) {
      return new Response(null, { status: 503 });
    }
    if (url.endsWith("missing.jpg")) return new Response(null, { status: 404 });
    return new Response(null, {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  };
  const result = await checkHeadSamples(
    [
      "https://img.example.test/one.jpg",
      "https://img.example.test/retry.jpg",
      "https://img.example.test/missing.jpg",
      "https://img.example.test/four.jpg",
    ],
    {
      concurrency: 2,
      maxAttempts: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      jitterRatio: 0,
      fetchFn,
      sleep: async () => {},
    },
  );
  assert.ok(maximumActive <= 2);
  assert.equal(result.checks.length, 4);
  assert.equal(result.failures.length, 1);
  assert.equal(result.checks[1].attempts, 2);
  assert.equal(result.failures[0].status, 404);
});

test("HEAD timeouts become an isolated ETIMEDOUT failure", async () => {
  const fetchFn = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  const result = await checkHeadSamples(["https://img.example.test/slow.jpg"], {
    timeoutMs: 5,
    maxAttempts: 1,
    fetchFn,
  });
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].code, "ETIMEDOUT");
});

test("reports redact secrets and signed URL query parameters", async () => {
  const secret = "secret-value-for-test";
  assert.equal(redactSensitiveText(`SecretKey=${secret}`, [secret]), "SecretKey=[REDACTED]");
  assert.equal(
    safeUrl("https://img.example.test/art.jpg?sign=sensitive#fragment"),
    "https://img.example.test/art.jpg",
  );

  const { checkpointPath } = tempCheckpoint();
  const report = await executeAudit(
    {
      async runCommands() {
        throw Object.assign(new Error(`internal error SecretKey=${secret}`), {
          statusCode: 500,
        });
      },
    },
    {
      ...baseQueryOptions(checkpointPath, { maxAttempts: 1 }),
      sampleHead: 1,
      headConcurrency: 1,
      headTimeoutMs: 10,
      comparePath: "",
    },
    { sensitiveValues: [secret], sleep: async () => {} },
  );
  assert.equal(report.status, "failed");
  assert.doesNotMatch(JSON.stringify(report), new RegExp(secret, "u"));
  assert.equal(report.sensitive_values_redacted, true);
});

test("two audit reports expose comparable production state deltas", () => {
  const comparison = compareAuditReports(
    {
      generated_at: "2026-07-29T00:00:00.000Z",
      status: "complete",
      total: 100,
      missing_image_records: 2,
    },
    {
      status: "complete",
      total: 103,
      missing_image_records: 1,
    },
  );
  assert.deepEqual(comparison.changed_fields, ["total", "missing_image_records"]);
  assert.equal(comparison.changes.total.delta, 3);
  assert.equal(comparison.changes.missing_image_records.delta, -1);
});
