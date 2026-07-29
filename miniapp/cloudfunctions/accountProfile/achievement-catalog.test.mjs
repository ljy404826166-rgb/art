import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_CATALOG_VERSION,
  ACHIEVEMENT_STATISTICS,
  DEFAULT_ACHIEVEMENT_ID,
  findAchievementDefinition,
  formatUnlockRate,
} = require("./lib/achievement-catalog.js");

test("the first achievement catalog has one default, four automatic, and one manual title", () => {
  assert.equal(ACHIEVEMENT_CATALOG_VERSION, 1);
  assert.equal(ACHIEVEMENT_CATALOG.length, 6);
  assert.equal(ACHIEVEMENT_CATALOG.filter((item) => item.grant_type === "default").length, 1);
  assert.equal(ACHIEVEMENT_CATALOG.filter((item) => item.grant_type === "automatic").length, 4);
  assert.equal(ACHIEVEMENT_CATALOG.filter((item) => item.grant_type === "manual").length, 1);
});

test("catalog ids, titles, ordering, and threshold rules are controlled", () => {
  assert.equal(
    new Set(ACHIEVEMENT_CATALOG.map((item) => item.id)).size,
    ACHIEVEMENT_CATALOG.length,
  );
  assert.equal(
    new Set(ACHIEVEMENT_CATALOG.map((item) => item.display_order)).size,
    ACHIEVEMENT_CATALOG.length,
  );
  assert.equal(
    ACHIEVEMENT_CATALOG.every((item) => Array.from(item.title).length <= 8),
    true,
  );

  const defaultTitle = findAchievementDefinition(DEFAULT_ACHIEVEMENT_ID);
  assert.equal(defaultTitle.title, "普通用户");
  assert.equal(defaultTitle.rule_type, "always");

  assert.equal(findAchievementDefinition("first_masterpiece").threshold, 1);
  assert.equal(findAchievementDefinition("treasure_with_care").threshold, 20);
  assert.equal(findAchievementDefinition("artist_confidant").threshold, 10);
  assert.equal(findAchievementDefinition("art_wanderer").threshold, 50);
  assert.equal(findAchievementDefinition("learned_all_ages").rule_type, "verified_correction");
  assert.equal(findAchievementDefinition("unknown-title"), null);
});

test("unlock rate uses active users and always renders two decimals", () => {
  assert.equal(ACHIEVEMENT_STATISTICS.denominator, "active_user_count");
  assert.equal(ACHIEVEMENT_STATISTICS.decimal_places, 2);
  assert.equal(formatUnlockRate(8, 1000), "0.80%");
  assert.equal(formatUnlockRate(1, 3), "33.33%");
  assert.equal(formatUnlockRate(1000, 1000), "100.00%");
  assert.equal(formatUnlockRate(0, 0), "0.00%");
  assert.equal(formatUnlockRate(1200, 1000), "100.00%");
});
