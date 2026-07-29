#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(process.cwd());
const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_COLLECTION = "artworks";

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function config() {
  return {
    ...parseEnvFile(path.join(ROOT, ".env")),
    ...parseEnvFile(path.join(ROOT, ".env.local")),
    ...process.env,
  };
}

function parseArgs(argv) {
  const options = {
    out: path.resolve(ROOT, "csv", "cloudbase", "artworks-dedupe-index.json"),
    envId: "",
    collection: DEFAULT_COLLECTION,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token.startsWith("--") || !value || value.startsWith("--"))
      throw new Error(`Invalid argument: ${token}`);
    index += 1;
    if (token === "--out") options.out = path.resolve(value);
    else if (token === "--env-id") options.envId = value;
    else if (token === "--collection") options.collection = value;
    else throw new Error(`Unknown option: ${token}`);
  }
  return options;
}

function parseRows(data) {
  return JSON.parse(data || "[]").map((row) => JSON.parse(row));
}

async function retry(worker, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await worker();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw lastError;
}

async function queryPage(database, collection, skip, limit) {
  const response = await retry(() =>
    database.runCommands({
      MgoCommands: [
        {
          TableName: collection,
          CommandType: "QUERY",
          Command: JSON.stringify({
            find: collection,
            filter: {},
            projection: {
              _id: 1,
              image_id: 1,
              title_cn: 1,
              title_en: 1,
              artist: 1,
              source_url: 1,
              source_record_id: 1,
            },
            sort: { _id: 1 },
            skip,
            limit,
          }),
        },
      ],
    }),
  );
  return parseRows(response.Data?.[0]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const cfg = config();
  const secretId =
    cfg.TENCENT_SECRET_ID || cfg.TENCENTCLOUD_SECRETID || cfg.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    cfg.TENCENT_SECRET_KEY || cfg.TENCENTCLOUD_SECRETKEY || cfg.TENCENT_CLOUD_SECRET_KEY;
  const envId = options.envId || cfg.CLOUDBASE_ENV_ID || cfg.TCB_ENV_ID || DEFAULT_ENV_ID;
  if (!secretId || !secretKey) throw new Error("Missing Tencent Cloud credentials.");
  const app = CloudBase.init({ envId, secretId, secretKey });
  const artworks = [];
  const limit = 100;
  for (let skip = 0; ; skip += limit) {
    const rows = await queryPage(app.database, options.collection, skip, limit);
    artworks.push(...rows);
    process.stdout.write(`[cloudbase-dedupe] ${artworks.length}\n`);
    if (rows.length < limit) break;
  }
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(
    options.out,
    `${JSON.stringify(
      {
        schema_version: 1,
        environment_id: envId,
        collection: options.collection,
        exported_at: new Date().toISOString(),
        count: artworks.length,
        artworks,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  process.stdout.write(
    `[cloudbase-dedupe] Wrote ${artworks.length} read-only records to ${options.out}\n`,
  );
}

await main();
