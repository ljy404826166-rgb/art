import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  ACHIEVEMENT_SCHEMA_VERSION,
  ACHIEVEMENT_STATISTICS_COLLECTION,
  ACHIEVEMENT_STATISTICS_DOCUMENT_ID,
  USER_ACHIEVEMENTS_COLLECTION,
  achievementDocumentId,
  achievementProfileFields,
  createAchievementStatisticsDocument,
  createUserAchievementDocument,
  normalizeEquippedTitleId,
} = require("./lib/achievement-store.js");

test("achievement collection names and profile defaults are controlled", () => {
  assert.equal(USER_ACHIEVEMENTS_COLLECTION, "user_achievements");
  assert.equal(ACHIEVEMENT_STATISTICS_COLLECTION, "achievement_statistics");
  assert.equal(ACHIEVEMENT_STATISTICS_DOCUMENT_ID, "global");
  assert.equal(ACHIEVEMENT_SCHEMA_VERSION, 1);
  assert.deepEqual(achievementProfileFields(), {
    equipped_title_id: "ordinary_user",
    achievement_schema_version: 1,
  });
  assert.equal(normalizeEquippedTitleId("learned_all_ages"), "learned_all_ages");
  assert.equal(normalizeEquippedTitleId("forged-title"), "ordinary_user");
});

test("achievement document ids are deterministic and hide raw identity", () => {
  const first = achievementDocumentId("openid-user-a", "first_masterpiece");
  const repeated = achievementDocumentId("openid-user-a", "first_masterpiece");
  const other = achievementDocumentId("openid-user-a", "art_wanderer");

  assert.equal(first, repeated);
  assert.notEqual(first, other);
  assert.match(first, /^ach_[a-f0-9]{48}$/);
  assert.doesNotMatch(first, /openid-user-a|first_masterpiece/);
  assert.throws(() => achievementDocumentId("openid-user-a", "forged-title"), /not in the catalog/);
});

test("user achievement documents keep only the controlled grant schema", () => {
  const document = createUserAchievementDocument({
    openid: "openid-user-a",
    userId: "usr_123",
    achievementId: "learned_all_ages",
    grantType: "manual",
    grantReference: "support-case-18",
    now: "server-date",
  });

  assert.deepEqual(document, {
    _openid: "openid-user-a",
    user_id: "usr_123",
    achievement_id: "learned_all_ages",
    grant_type: "manual",
    grant_reference: "support-case-18",
    catalog_version: 1,
    schema_version: 1,
    unlocked_at: "server-date",
    created_at: "server-date",
    updated_at: "server-date",
  });
});

test("initial statistics include every catalog title with zero counts", () => {
  const document = createAchievementStatisticsDocument("server-date");

  assert.equal(document.kind, "global");
  assert.equal(document.active_user_count, 0);
  assert.deepEqual(document.unlocked_counts, {
    ordinary_user: 0,
    first_masterpiece: 0,
    treasure_with_care: 0,
    artist_confidant: 0,
    art_wanderer: 0,
    learned_all_ages: 0,
  });
  assert.equal(document.catalog_version, 1);
  assert.equal(document.created_at, "server-date");
  assert.equal(document.reconciled_at, null);
});
