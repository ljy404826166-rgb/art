#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_CATALOG_VERSION,
  DEFAULT_ACHIEVEMENT_ID,
  findAchievementDefinition,
} = require("../../miniapp/cloudfunctions/accountProfile/lib/achievement-catalog");
const {
  ACHIEVEMENT_SCHEMA_VERSION,
  achievementDocumentId,
  normalizeEquippedTitleId,
} = require("../../miniapp/cloudfunctions/accountProfile/lib/achievement-store");

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..", "..");
const PRODUCTION_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_ENV_ID = PRODUCTION_ENV_ID;

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const output = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    output[match[1]] = value;
  }
  return output;
}

function environment() {
  return {
    ...parseEnvFile(path.join(PROJECT_ROOT, ".env")),
    ...parseEnvFile(path.join(PROJECT_ROOT, ".env.local")),
    ...process.env,
  };
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseArgs(argv, config = environment()) {
  const options = {
    envId: config.CLOUDBASE_ENV_ID || config.TCB_ENV_ID || DEFAULT_ENV_ID,
    run: false,
    allowProduction: false,
    confirmation: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--env-id") {
      options.envId = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--run") {
      options.run = true;
    } else if (arg === "--allow-production") {
      options.allowProduction = true;
    } else if (arg === "--confirm-env") {
      options.confirmation = requiredValue(argv, (index += 1), arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.envId === PRODUCTION_ENV_ID && !options.allowProduction) {
    throw new Error("Production migration requires --allow-production.");
  }
  if (options.run && options.confirmation !== options.envId) {
    throw new Error(`--run requires --confirm-env ${options.envId}.`);
  }
  return options;
}

function createClient(envId, config = environment()) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error("Missing Tencent deployment credentials.");
  }
  return CloudBase.init({ envId, secretId, secretKey });
}

function parseCommandRows(data) {
  const rows = JSON.parse(data || "[]");
  return rows.map((row) => JSON.parse(row));
}

async function withRetry(operation, label, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
  }
  throw new Error(`${label} failed: ${lastError.message}`, {
    cause: lastError,
  });
}

async function queryAll(database, collection, projection) {
  const rows = [];
  const pageSize = 500;
  for (let skip = 0; ; skip += pageSize) {
    const result = await withRetry(
      () =>
        database.runCommands({
          MgoCommands: [
            {
              TableName: collection,
              CommandType: "QUERY",
              Command: JSON.stringify({
                find: collection,
                filter: {},
                projection,
                skip,
                limit: pageSize,
              }),
            },
          ],
        }),
      `query ${collection}`,
    );
    const batch = parseCommandRows(result.Data?.[0]);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function activeUser(user) {
  const status = String((user && user.account_status) || "active");
  return status !== "deleted" && status !== "deleting";
}

function numericValue(value) {
  if (value && typeof value === "object") {
    return Number(value.$numberInt ?? value.$numberLong ?? value.$numberDouble ?? 0);
  }
  return Number(value || 0);
}

function uniqueActiveCount(rows, openid, key) {
  return new Set(
    rows
      .filter((row) => row && row._openid === openid && row.deleted !== true && row[key])
      .map((row) => row[key]),
  ).size;
}

function automaticIds(metrics) {
  return ACHIEVEMENT_CATALOG.filter((item) => {
    if (item.id === DEFAULT_ACHIEVEMENT_ID) return true;
    return (
      item.grant_type === "automatic" &&
      item.rule_type === "threshold" &&
      Number(metrics[item.metric] || 0) >= item.threshold
    );
  }).map((item) => item.id);
}

function emptyUnlockedCounts() {
  return Object.fromEntries(ACHIEVEMENT_CATALOG.map((item) => [item.id, 0]));
}

function buildMigrationPlan({
  users = [],
  favorites = [],
  followedArtists = [],
  history = [],
  achievements = [],
}) {
  const activeUsers = users.filter(activeUser);
  const activeOpenids = new Set(activeUsers.map((user) => user._openid));
  const existingKeys = new Set(
    achievements.map((row) => `${row._openid}\u0000${row.achievement_id}`),
  );
  const additions = [];
  const userUpdates = [];
  const ownedByUser = new Map();

  for (const row of achievements) {
    if (!activeOpenids.has(row._openid)) continue;
    if (!findAchievementDefinition(row.achievement_id)) continue;
    if (!ownedByUser.has(row._openid)) {
      ownedByUser.set(row._openid, new Set());
    }
    ownedByUser.get(row._openid).add(row.achievement_id);
  }

  for (const user of activeUsers) {
    if (!user._id || !user._openid) continue;
    const metrics = {
      favorite_unique_count: uniqueActiveCount(favorites, user._openid, "artwork_id"),
      followed_artist_unique_count: uniqueActiveCount(followedArtists, user._openid, "artist_id"),
      history_unique_count: uniqueActiveCount(history, user._openid, "artwork_id"),
    };
    const owned = ownedByUser.get(user._openid) || new Set();
    ownedByUser.set(user._openid, owned);
    for (const achievementId of automaticIds(metrics)) {
      const key = `${user._openid}\u0000${achievementId}`;
      owned.add(achievementId);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      const definition = findAchievementDefinition(achievementId);
      additions.push({
        _id: achievementDocumentId(user._openid, achievementId),
        _openid: user._openid,
        user_id: user._id,
        achievement_id: achievementId,
        grant_type: definition.grant_type,
      });
    }
    const requestedTitle = normalizeEquippedTitleId(user.equipped_title_id);
    const equippedTitleId = owned.has(requestedTitle) ? requestedTitle : DEFAULT_ACHIEVEMENT_ID;
    if (
      user.achievement_registered !== true ||
      user.equipped_title_id !== equippedTitleId ||
      numericValue(user.achievement_schema_version) !== ACHIEVEMENT_SCHEMA_VERSION
    ) {
      userUpdates.push({
        _id: user._id,
        achievement_registered: true,
        equipped_title_id: equippedTitleId,
        achievement_schema_version: ACHIEVEMENT_SCHEMA_VERSION,
      });
    }
  }

  const unlockedCounts = emptyUnlockedCounts();
  for (const owned of ownedByUser.values()) {
    for (const achievementId of owned) {
      if (Object.hasOwn(unlockedCounts, achievementId)) {
        unlockedCounts[achievementId] += 1;
      }
    }
  }

  return {
    additions,
    userUpdates,
    statistics: {
      active_user_count: activeUsers.length,
      unlocked_counts: unlockedCounts,
    },
    summary: {
      active_users: activeUsers.length,
      pending_user_updates: userUpdates.length,
      achievement_records_to_add: additions.length,
      additions_by_achievement: Object.fromEntries(
        ACHIEVEMENT_CATALOG.map((item) => [
          item.id,
          additions.filter((addition) => addition.achievement_id === item.id).length,
        ]),
      ),
      projected_unlocked_counts: unlockedCounts,
    },
  };
}

function chunks(values, size = 100) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

async function runUpdate(database, tableName, updates, label) {
  for (const batch of chunks(updates)) {
    await withRetry(
      () =>
        database.runCommands({
          MgoCommands: [
            {
              TableName: tableName,
              CommandType: "UPDATE",
              Command: JSON.stringify({
                update: tableName,
                updates: batch,
              }),
            },
          ],
        }),
      label,
    );
  }
}

async function applyMigration(database, plan) {
  const now = new Date().toISOString();
  await runUpdate(
    database,
    "user_achievements",
    plan.additions.map((item) => ({
      q: { _id: item._id },
      u: {
        $setOnInsert: {
          ...item,
          grant_reference: "",
          catalog_version: ACHIEVEMENT_CATALOG_VERSION,
          schema_version: ACHIEVEMENT_SCHEMA_VERSION,
        },
        $currentDate: {
          unlocked_at: true,
          created_at: true,
          updated_at: true,
        },
      },
      upsert: true,
    })),
    "upsert achievement records",
  );
  await runUpdate(
    database,
    "users",
    plan.userUpdates.map(({ _id, ...fields }) => ({
      q: { _id },
      u: {
        $set: fields,
        $currentDate: { updated_at: true },
      },
      upsert: false,
    })),
    "update achievement account fields",
  );
  await runUpdate(
    database,
    "achievement_statistics",
    [
      {
        q: { _id: "global" },
        u: {
          $set: {
            kind: "global",
            ...plan.statistics,
            catalog_version: ACHIEVEMENT_CATALOG_VERSION,
            schema_version: ACHIEVEMENT_SCHEMA_VERSION,
          },
          $setOnInsert: { created_at: now },
          $currentDate: {
            updated_at: true,
            reconciled_at: true,
          },
        },
        upsert: true,
      },
    ],
    "reconcile achievement statistics",
  );
}

async function readSource(database) {
  const [users, favorites, followedArtists, history, achievements] = await Promise.all([
    queryAll(database, "users", {
      _id: 1,
      _openid: 1,
      account_status: 1,
      achievement_registered: 1,
      equipped_title_id: 1,
      achievement_schema_version: 1,
    }),
    queryAll(database, "user_favorites", {
      _openid: 1,
      artwork_id: 1,
      deleted: 1,
    }),
    queryAll(database, "user_followed_artists", {
      _openid: 1,
      artist_id: 1,
      deleted: 1,
    }),
    queryAll(database, "user_history", {
      _openid: 1,
      artwork_id: 1,
      deleted: 1,
    }),
    queryAll(database, "user_achievements", {
      _openid: 1,
      achievement_id: 1,
    }),
  ]);
  return { users, favorites, followedArtists, history, achievements };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const app = createClient(options.envId);
  const source = await readSource(app.database);
  const plan = buildMigrationPlan(source);
  process.stdout.write(
    `${JSON.stringify(
      {
        mode: options.run ? "run" : "dry-run",
        env_id: options.envId,
        ...plan.summary,
      },
      null,
      2,
    )}\n`,
  );
  if (!options.run) return;

  await applyMigration(app.database, plan);
  const verified = buildMigrationPlan(await readSource(app.database));
  if (
    verified.summary.pending_user_updates !== 0 ||
    verified.summary.achievement_records_to_add !== 0
  ) {
    throw new Error("Achievement migration verification is incomplete.");
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        env_id: options.envId,
        active_users: verified.summary.active_users,
        unlocked_counts: verified.summary.projected_unlocked_counts,
      },
      null,
      2,
    )}\n`,
  );
}

export { PRODUCTION_ENV_ID, applyMigration, automaticIds, buildMigrationPlan, parseArgs };

if (
  process.argv[1] &&
  path.basename(process.argv[1]).toLowerCase() ===
    path.basename(fileURLToPath(import.meta.url)).toLowerCase()
) {
  main().catch((error) => {
    console.error(`[achievement-migration] ${error.message}`);
    process.exitCode = 1;
  });
}
