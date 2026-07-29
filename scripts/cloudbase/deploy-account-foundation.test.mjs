import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_EXPERIENCE_ENV_ID,
  PRODUCTION_ENV_ID,
  ensureCollection,
  indexDefinition,
  parseArgs,
  resolveFunctionEnvironment,
} from "./deploy-account-foundation.mjs";

test("account foundation defaults to the isolated experience environment", () => {
  const options = parseArgs([], {});

  assert.equal(options.envId, DEFAULT_EXPERIENCE_ENV_ID);
  assert.equal(options.run, false);
});

test("write mode requires an exact environment confirmation", () => {
  assert.throws(() => parseArgs(["--run"], {}), /--confirm-env experience-/);

  const options = parseArgs(["--run", "--confirm-env", DEFAULT_EXPERIENCE_ENV_ID], {});
  assert.equal(options.run, true);
});

test("production deployment requires an additional explicit flag", () => {
  assert.throws(
    () =>
      parseArgs(["--env-id", PRODUCTION_ENV_ID, "--run", "--confirm-env", PRODUCTION_ENV_ID], {}),
    /--allow-production/,
  );

  const options = parseArgs(
    [
      "--env-id",
      PRODUCTION_ENV_ID,
      "--allow-production",
      "--run",
      "--confirm-env",
      PRODUCTION_ENV_ID,
    ],
    {},
  );
  assert.equal(options.envId, PRODUCTION_ENV_ID);
  assert.equal(options.allowProduction, true);
});

test("index definitions preserve uniqueness and key order", () => {
  assert.deepEqual(
    indexDefinition({
      name: "openid_unique",
      unique: true,
      keys: [{ name: "_openid", direction: "1" }],
    }),
    {
      IndexName: "openid_unique",
      MgoKeySchema: {
        MgoIndexKeys: [{ Name: "_openid", Direction: "1" }],
        MgoIsUnique: true,
      },
    },
  );
});

test("existing CloudBase collections do not block a function redeploy", async () => {
  let described = 0;
  const database = {
    async createCollectionIfNotExists() {
      throw new Error("[CreateTable] resource exist");
    },
    async describeCollection() {
      described += 1;
      return {
        Indexes: [],
      };
    },
    async updateCollection() {
      throw new Error("unexpected index update");
    },
  };

  const result = await ensureCollection(database, {
    name: "users",
    indexes: [],
  });

  assert.equal(result.created, false);
  assert.equal(described, 1);
});

test("account manifest declares private achievement collections and indexes", () => {
  const manifest = JSON.parse(readFileSync("cloudbase/account-foundation.json", "utf8"));
  const achievements = manifest.collections.find((item) => item.name === "user_achievements");
  const statistics = manifest.collections.find((item) => item.name === "achievement_statistics");

  assert.equal(manifest.version, 2);
  assert.equal(achievements.permission, "ADMINONLY");
  assert.deepEqual(
    achievements.indexes.find((item) => item.name === "openid_achievement_unique"),
    {
      name: "openid_achievement_unique",
      unique: true,
      keys: [
        { name: "_openid", direction: "1" },
        { name: "achievement_id", direction: "1" },
      ],
    },
  );
  assert.equal(statistics.permission, "ADMINONLY");
  assert.equal(statistics.identityConstraint, "fixed_global_document");
  assert.deepEqual(manifest.function.environmentVariables, ["ACHIEVEMENT_ADMIN_OPENIDS"]);
});

test("function environment resolves only declared administrator configuration", () => {
  const definition = {
    environmentVariables: ["ACHIEVEMENT_ADMIN_OPENIDS"],
  };

  assert.deepEqual(
    resolveFunctionEnvironment(definition, {
      ACHIEVEMENT_ADMIN_OPENIDS: "openid-admin-a,openid-admin-b",
      UNRELATED_SECRET: "never-forward",
    }),
    {
      ACHIEVEMENT_ADMIN_OPENIDS: "openid-admin-a,openid-admin-b",
    },
  );
  assert.deepEqual(resolveFunctionEnvironment(definition, {}), {
    ACHIEVEMENT_ADMIN_OPENIDS: "",
  });
});
