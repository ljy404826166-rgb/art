import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCTION_ENV_ID,
  buildMigrationPlan,
  parseArgs,
} from "./migrate-achievement-accounts.mjs";

function source(overrides = {}) {
  return {
    users: [
      {
        _id: "user-a",
        _openid: "openid-a",
        account_status: "active",
        achievement_registered: false,
      },
      {
        _id: "user-b",
        _openid: "openid-b",
        account_status: "active",
        achievement_registered: false,
      },
      {
        _id: "user-deleted",
        _openid: "openid-deleted",
        account_status: "deleted",
      },
    ],
    favorites: [
      { _openid: "openid-a", artwork_id: "art-1" },
      { _openid: "openid-a", artwork_id: "art-2", deleted: true },
    ],
    followedArtists: [],
    history: [],
    achievements: [],
    ...overrides,
  };
}

test("migration grants controlled defaults and eligible automatic titles", () => {
  const plan = buildMigrationPlan(source());

  assert.equal(plan.summary.active_users, 2);
  assert.equal(plan.summary.pending_user_updates, 2);
  assert.equal(plan.summary.achievement_records_to_add, 3);
  assert.equal(plan.summary.additions_by_achievement.ordinary_user, 2);
  assert.equal(plan.summary.additions_by_achievement.first_masterpiece, 1);
  assert.equal(plan.statistics.active_user_count, 2);
  assert.equal(plan.statistics.unlocked_counts.ordinary_user, 2);
  assert.equal(plan.statistics.unlocked_counts.first_masterpiece, 1);
  assert.equal(plan.statistics.unlocked_counts.learned_all_ages, 0);
});

test("migration preserves an existing manual title and is idempotent", () => {
  const first = buildMigrationPlan(source());
  const achievements = first.additions.map((item) => ({
    _openid: item._openid,
    achievement_id: item.achievement_id,
  }));
  achievements.push({
    _openid: "openid-b",
    achievement_id: "learned_all_ages",
  });
  const users = source().users.map((user) =>
    user.account_status === "active"
      ? {
          ...user,
          achievement_registered: true,
          achievement_schema_version: { $numberInt: "1" },
          equipped_title_id: user._openid === "openid-b" ? "learned_all_ages" : "ordinary_user",
        }
      : user,
  );
  const verified = buildMigrationPlan(source({ users, achievements }));

  assert.equal(verified.summary.pending_user_updates, 0);
  assert.equal(verified.summary.achievement_records_to_add, 0);
  assert.equal(verified.statistics.unlocked_counts.learned_all_ages, 1);
});

test("production migration requires both explicit safeguards", () => {
  assert.throws(() => parseArgs(["--env-id", PRODUCTION_ENV_ID], {}), /allow-production/);
  assert.throws(
    () => parseArgs(["--env-id", PRODUCTION_ENV_ID, "--allow-production", "--run"], {}),
    /confirm-env/,
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
  assert.equal(options.run, true);
});
