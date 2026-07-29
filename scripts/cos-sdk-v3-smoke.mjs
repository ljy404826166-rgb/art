import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import COS from "cos-nodejs-sdk-v5";

const require = createRequire(import.meta.url);
const { version: COS_SDK_VERSION } = require("cos-nodejs-sdk-v5/package.json");

function readOptionValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

export function parseArgs(args) {
  const options = {
    run: false,
    confirmBucket: "",
    envFile: path.resolve(".env.local"),
    prefix: "healthchecks/masterpiece-task4",
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--run") options.run = true;
    else if (argument === "--confirm-bucket") {
      options.confirmBucket = readOptionValue(args, index, argument);
      index += 1;
    } else if (argument === "--env-file") {
      options.envFile = path.resolve(readOptionValue(args, index, argument));
      index += 1;
    } else if (argument === "--prefix") {
      options.prefix = readOptionValue(args, index, argument).replace(/^\/+|\/+$/gu, "");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

export function loadEnvFile(filePath, target = process.env) {
  if (!existsSync(filePath)) return target;
  for (const sourceLine of readFileSync(filePath, "utf8").split(/\r?\n/gu)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match || target[match[1]]) continue;
    const rawValue = match[2].trim();
    target[match[1]] = rawValue.replace(/^(['"])(.*)\1$/u, "$2");
  }
  return target;
}

export function assertCosV3Version(version = COS_SDK_VERSION) {
  const major = Number.parseInt(String(version).split(".")[0], 10);
  if (!Number.isFinite(major) || major < 3) {
    throw new Error(`Tencent COS SDK 3.x or newer is required; received ${version}.`);
  }
  return version;
}

export function callCos(client, method, params) {
  if (!client || typeof client[method] !== "function") {
    return Promise.reject(new Error(`COS client does not implement ${method}.`));
  }
  return new Promise((resolve, reject) => {
    client[method](params, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

export function isMissingObjectError(error) {
  const status = String(error?.statusCode || error?.status || "");
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return (
    ["403", "404"].includes(status) ||
    /NoSuchKey|NotFound|Not Found|forbidden/iu.test(`${code} ${message}`)
  );
}

function bodyAsBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === "string") return Buffer.from(body);
  throw new Error("COS getObject returned an unsupported Body value.");
}

export async function verifyCosLifecycle(client, { bucket, region, key, payload }) {
  const params = { Bucket: bucket, Region: region, Key: key };
  let uploaded = false;
  let result;
  let operationError;
  try {
    await callCos(client, "putObject", {
      ...params,
      Body: payload,
      ContentLength: payload.length,
      ContentType: "text/plain; charset=utf-8",
      CacheControl: "no-store",
    });
    uploaded = true;

    const head = await callCos(client, "headObject", params);
    const downloaded = await callCos(client, "getObject", params);
    const downloadedBody = bodyAsBuffer(downloaded?.Body);
    if (!downloadedBody.equals(payload)) {
      throw new Error("COS lifecycle verification received content different from the upload.");
    }

    result = {
      upload: true,
      head: true,
      read: true,
      content_length: payload.length,
      etag: String(head?.headers?.etag || head?.ETag || "").replaceAll('"', ""),
    };
  } catch (error) {
    operationError = error;
  }

  let rollbackError;
  if (uploaded) {
    try {
      await callCos(client, "deleteObject", params);
      try {
        await callCos(client, "headObject", params);
        throw new Error("COS rollback verification found the temporary object after deletion.");
      } catch (error) {
        if (!isMissingObjectError(error)) throw error;
      }
    } catch (error) {
      rollbackError = error;
    }
  }

  if (rollbackError && operationError) {
    throw new AggregateError(
      [operationError, rollbackError],
      "COS lifecycle operation and rollback both failed.",
    );
  }
  if (rollbackError) throw rollbackError;
  if (operationError) throw operationError;
  return result;
}

function requiredConfiguration(env) {
  const configuration = {
    bucket: env.TENCENT_COS_BUCKET || "",
    region: env.TENCENT_COS_REGION || "",
    secretId: env.TENCENT_SECRET_ID || "",
    secretKey: env.TENCENT_SECRET_KEY || "",
    sessionToken: env.TENCENT_SESSION_TOKEN || "",
  };
  const missing = Object.entries(configuration)
    .filter(([name, value]) => name !== "sessionToken" && !value)
    .map(([name]) => name);
  return { configuration, missing };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  loadEnvFile(options.envFile);
  const sdkVersion = assertCosV3Version();
  const { configuration, missing } = requiredConfiguration(process.env);

  if (!options.run) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          sdk_version: sdkVersion,
          configuration_ready: missing.length === 0,
          missing,
          planned_prefix: options.prefix,
          mutation: false,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (missing.length) throw new Error(`Missing Tencent COS configuration: ${missing.join(", ")}`);
  if (options.confirmBucket !== configuration.bucket) {
    throw new Error(
      "Live COS smoke requires --confirm-bucket to exactly match TENCENT_COS_BUCKET.",
    );
  }

  const key = `${options.prefix}/${Date.now()}-${randomUUID()}.txt`;
  const payload = Buffer.from(`Masterpiece COS SDK v3 lifecycle ${new Date().toISOString()}`);
  const client = new COS({
    SecretId: configuration.secretId,
    SecretKey: configuration.secretKey,
    SecurityToken: configuration.sessionToken || undefined,
    Timeout: 30_000,
  });
  const checks = await verifyCosLifecycle(client, {
    bucket: configuration.bucket,
    region: configuration.region,
    key,
    payload,
  });
  console.log(
    JSON.stringify(
      {
        mode: "live",
        sdk_version: sdkVersion,
        bucket: configuration.bucket,
        region: configuration.region,
        temporary_key: key,
        checks: { ...checks, rollback_delete: true, rollback_absence: true },
      },
      null,
      2,
    ),
  );
}

const isDirectRun =
  process.argv[1] &&
  path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url));
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
