import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCosV3Version,
  isMissingObjectError,
  parseArgs,
  verifyCosLifecycle,
} from "./cos-sdk-v3-smoke.mjs";

function fakeCos({ corruptRead = false } = {}) {
  const objects = new Map();
  const calls = [];
  const client = {
    putObject(params, callback) {
      calls.push(["putObject", params.Key]);
      objects.set(params.Key, Buffer.from(params.Body));
      callback(null, { ETag: '"upload-etag"' });
    },
    headObject(params, callback) {
      calls.push(["headObject", params.Key]);
      const body = objects.get(params.Key);
      if (!body) {
        callback(Object.assign(new Error("NoSuchKey"), { statusCode: 404, code: "NoSuchKey" }));
        return;
      }
      callback(null, { headers: { etag: '"head-etag"', "content-length": body.length } });
    },
    getObject(params, callback) {
      calls.push(["getObject", params.Key]);
      const body = objects.get(params.Key);
      callback(null, { Body: corruptRead ? Buffer.from("corrupt") : Buffer.from(body) });
    },
    deleteObject(params, callback) {
      calls.push(["deleteObject", params.Key]);
      objects.delete(params.Key);
      callback(null, {});
    },
  };
  return { client, calls, objects };
}

test("COS smoke is dry-run by default and requires exact live confirmation", () => {
  const dryRun = parseArgs([]);
  assert.equal(dryRun.run, false);
  assert.equal(dryRun.confirmBucket, "");
  assert.match(dryRun.envFile, /[\\/]\.env\.local$/u);
  assert.equal(dryRun.prefix, "healthchecks/masterpiece-task4");
  const live = parseArgs(["--run", "--confirm-bucket", "bucket-123", "--prefix", "/checks/"]);
  assert.equal(live.run, true);
  assert.equal(live.confirmBucket, "bucket-123");
  assert.equal(live.prefix, "checks");
});

test("installed Tencent COS SDK satisfies the 3.x contract", () => {
  assert.match(assertCosV3Version(), /^3\./u);
  assert.throws(() => assertCosV3Version("2.15.4"), /3\.x/u);
});

test("COS lifecycle uploads, reads, and removes only its temporary object", async () => {
  const { client, calls, objects } = fakeCos();
  const result = await verifyCosLifecycle(client, {
    bucket: "bucket-123",
    region: "ap-test",
    key: "healthchecks/task4.txt",
    payload: Buffer.from("Masterpiece"),
  });

  assert.deepEqual(result, {
    upload: true,
    head: true,
    read: true,
    content_length: 11,
    etag: "head-etag",
  });
  assert.deepEqual(
    calls.map(([method]) => method),
    ["putObject", "headObject", "getObject", "deleteObject", "headObject"],
  );
  assert.equal(objects.size, 0);
});

test("COS lifecycle rolls back the temporary upload when read verification fails", async () => {
  const { client, calls, objects } = fakeCos({ corruptRead: true });
  await assert.rejects(
    verifyCosLifecycle(client, {
      bucket: "bucket-123",
      region: "ap-test",
      key: "healthchecks/task4-failure.txt",
      payload: Buffer.from("Masterpiece"),
    }),
    /content different/u,
  );
  assert.ok(calls.some(([method]) => method === "deleteObject"));
  assert.equal(objects.size, 0);
});

test("COS missing-object recognition covers status, code, and XML-derived messages", () => {
  assert.equal(isMissingObjectError({ statusCode: 404 }), true);
  assert.equal(isMissingObjectError({ code: "NoSuchKey" }), true);
  assert.equal(isMissingObjectError(new Error("Not Found")), true);
  assert.equal(isMissingObjectError({ statusCode: 500, message: "InternalError" }), false);
});
