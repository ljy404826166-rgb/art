import fs from "node:fs";
import path from "node:path";
import CloudBase from "@cloudbase/manager-node";

const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const OUTPUT_FILE = path.resolve("outputs/recommendation-system/task-06/task-06-query-smoke.json");
const QUERY_DIMENSIONS = [
  { id: "recommendation_pool", queryField: "" },
  { id: "artist", queryField: "artist_ids" },
  { id: "classification", queryField: "classification_ids" },
  { id: "tag", queryField: "tag_ids" },
  { id: "signal", queryField: "recommendation_signal_ids" },
];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
      }),
  );
}

function environment() {
  return {
    ...parseEnvFile(path.resolve(".env")),
    ...parseEnvFile(path.resolve(".env.local")),
    ...process.env,
  };
}

function client(envId, config = environment()) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error("Missing Tencent Cloud credentials.");
  }
  return CloudBase.init({ envId, secretId, secretKey });
}

function normalizeExtendedJson(value) {
  if (Array.isArray(value)) return value.map(normalizeExtendedJson);
  if (!value || typeof value !== "object") return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$numberInt") {
    return Number(value.$numberInt);
  }
  if (keys.length === 1 && keys[0] === "$numberLong") {
    return Number(value.$numberLong);
  }
  if (keys.length === 1 && keys[0] === "$numberDouble") {
    return Number(value.$numberDouble);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeExtendedJson(child)]),
  );
}

function parseRows(data) {
  return JSON.parse(data || "[]").map((row) => normalizeExtendedJson(JSON.parse(row)));
}

async function withRetry(operation, label, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 750));
      }
    }
  }
  throw new Error(`${label} failed: ${lastError.message}`, {
    cause: lastError,
  });
}

async function query(database, collection, { filter = {}, sort = {}, limit = 8 } = {}) {
  const result = await withRetry(
    () =>
      database.runCommands({
        MgoCommands: [
          {
            TableName: collection,
            CommandType: "QUERY",
            Command: JSON.stringify({
              find: collection,
              filter,
              sort,
              limit,
            }),
          },
        ],
      }),
    `query ${collection}`,
  );
  return parseRows(result.Data?.[0]);
}

export async function runQuerySmoke({ envId = PRODUCTION_ENV_ID, outputFile = OUTPUT_FILE } = {}) {
  const app = client(envId);
  const channels = await query(app.database, "recommendation_channels", {
    filter: { channel_status: "published" },
    sort: { priority_score: -1, _id: 1 },
    limit: 500,
  });
  const samples = [];

  for (const dimension of QUERY_DIMENSIONS) {
    const queryField = dimension.queryField;
    if (!queryField) {
      const artworks = await query(app.database, "artworks", {
        filter: {
          status: "published",
          recommendation_status: "eligible",
        },
        sort: { random_bucket: 1, _id: 1 },
        limit: 8,
      });
      samples.push({
        dimension: dimension.id,
        returned_count: artworks.length,
        artwork_ids: artworks.map((item) => item._id),
        ok: artworks.length > 0,
      });
      continue;
    }
    const channel = channels.find(
      (item) =>
        item.auto_feature_eligible === true && item.query_field === queryField && item.query_value,
    );
    if (!channel) {
      samples.push({
        dimension: dimension.id,
        query_field: queryField,
        ok: false,
        error: "No active auto-feature channel found.",
      });
      continue;
    }
    const artworks = await query(app.database, "artworks", {
      filter: {
        status: "published",
        recommendation_status: "eligible",
        [queryField]: channel.query_value,
      },
      sort: { random_bucket: 1, _id: 1 },
      limit: 8,
    });
    samples.push({
      dimension: dimension.id,
      query_field: queryField,
      query_value: channel.query_value,
      channel_id: channel._id,
      channel_title: channel.title,
      declared_artwork_count: channel.artwork_count,
      returned_count: artworks.length,
      artwork_ids: artworks.map((item) => item._id),
      ok: artworks.length > 0,
    });
  }

  const report = {
    generated_at: new Date().toISOString(),
    env_id: envId,
    active_channels_read: channels.length,
    samples,
    ok: samples.length === QUERY_DIMENSIONS.length && samples.every((sample) => sample.ok),
  };
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

runQuerySmoke()
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
