import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  achievementMetricsFromLibrary,
  automaticAchievementIds,
  ensureAchievementAccount,
  grantAutomaticAchievements,
  grantManualAchievement,
  unregisterAchievementAccount,
} = require("./lib/achievement-engine.js");
const { profileDocumentId } = require("./lib/account-profile.js");

function createFakeDatabase() {
  const collections = new Map();

  function rowsFor(name) {
    if (!collections.has(name)) collections.set(name, []);
    return collections.get(name);
  }

  function collection(name) {
    const rows = rowsFor(name);
    return {
      doc(id) {
        return {
          async get() {
            return {
              data: rows.find((row) => row._id === id) || null,
            };
          },
          async set({ data }) {
            const index = rows.findIndex((row) => row._id === id);
            const next = { ...data, _id: id };
            if (index >= 0) rows[index] = next;
            else rows.push(next);
            return { _id: id };
          },
          async update({ data }) {
            const index = rows.findIndex((row) => row._id === id);
            if (index < 0) throw new Error("document not found");
            rows[index] = { ...rows[index], ...data };
            return { updated: 1 };
          },
        };
      },
      where(filter) {
        return {
          limit() {
            return {
              async get() {
                return {
                  data: rows.filter((row) =>
                    Object.entries(filter).every(([key, value]) => row[key] === value),
                  ),
                };
              },
            };
          },
        };
      },
    };
  }

  const database = {
    collection,
    async runTransaction(handler) {
      return handler(database);
    },
  };
  return { collections, database, rowsFor };
}

function seedUser(fake, openid = "openid-user") {
  const id = profileDocumentId(openid);
  fake.rowsFor("users").push({
    _id: id,
    _openid: openid,
    account_status: "active",
    achievement_registered: false,
    equipped_title_id: "ordinary_user",
  });
  return { id, openid };
}

const serverDate = () => "server-date";

test("account registration grants the default title and counts the user once", async () => {
  const fake = createFakeDatabase();
  const user = seedUser(fake);

  const first = await ensureAchievementAccount({
    database: fake.database,
    openid: user.openid,
    userId: user.id,
    serverDate,
  });
  const repeated = await ensureAchievementAccount({
    database: fake.database,
    openid: user.openid,
    userId: user.id,
    serverDate,
  });

  assert.equal(first.registered, true);
  assert.equal(repeated.registered, false);
  assert.equal(fake.rowsFor("user_achievements").length, 1);
  const [statistics] = fake.rowsFor("achievement_statistics");
  assert.equal(statistics.active_user_count, 1);
  assert.equal(statistics.unlocked_counts.ordinary_user, 1);
  assert.equal("_id" in statistics, true);
});

test("statistics normalization never writes database identity fields back as data", () => {
  const { normalizeStatistics } = require("./lib/achievement-engine.js");
  const normalized = normalizeStatistics(
    {
      _id: "global",
      _openid: "must-not-survive",
      active_user_count: 3,
      unlocked_counts: { ordinary_user: 3 },
      created_at: "created",
    },
    "updated",
  );

  assert.equal("_id" in normalized, false);
  assert.equal("_openid" in normalized, false);
  assert.equal(normalized.active_user_count, 3);
  assert.equal(normalized.created_at, "created");
  assert.equal(normalized.updated_at, "updated");
});

test("automatic rules use unique active library rows and grant idempotently", async () => {
  const fake = createFakeDatabase();
  const user = seedUser(fake);
  const library = {
    favorites: Array.from({ length: 20 }, (_, index) => ({
      id: `art-favorite-${index}`,
      deleted: false,
    })),
    followed_artists: Array.from({ length: 10 }, (_, index) => ({
      id: `artist-${index}`,
      deleted: false,
    })),
    history: [
      ...Array.from({ length: 50 }, (_, index) => ({
        id: `art-history-${index}`,
        deleted: false,
      })),
      { id: "deleted-history", deleted: true },
    ],
  };

  const metrics = achievementMetricsFromLibrary(library);
  assert.deepEqual(metrics, {
    favorite_unique_count: 20,
    followed_artist_unique_count: 10,
    history_unique_count: 50,
  });
  assert.deepEqual(automaticAchievementIds(metrics), [
    "first_masterpiece",
    "treasure_with_care",
    "artist_confidant",
    "art_wanderer",
  ]);

  const first = await grantAutomaticAchievements({
    database: fake.database,
    openid: user.openid,
    userId: user.id,
    library,
    serverDate,
  });
  const repeated = await grantAutomaticAchievements({
    database: fake.database,
    openid: user.openid,
    userId: user.id,
    library,
    serverDate,
  });

  assert.deepEqual(first.newly_unlocked, [
    "first_masterpiece",
    "treasure_with_care",
    "artist_confidant",
    "art_wanderer",
  ]);
  assert.deepEqual(repeated.newly_unlocked, []);
  assert.equal(fake.rowsFor("user_achievements").length, 5);
  const [statistics] = fake.rowsFor("achievement_statistics");
  assert.equal(statistics.unlocked_counts.first_masterpiece, 1);
  assert.equal(statistics.unlocked_counts.treasure_with_care, 1);
  assert.equal(statistics.unlocked_counts.artist_confidant, 1);
  assert.equal(statistics.unlocked_counts.art_wanderer, 1);
});

test("manual grants accept only reviewed manual titles with an audit reference", async () => {
  const fake = createFakeDatabase();
  const user = seedUser(fake);

  const granted = await grantManualAchievement({
    database: fake.database,
    openid: user.openid,
    userId: user.id,
    achievementId: "learned_all_ages",
    grantReference: "support-case-2026-18",
    serverDate,
  });
  const repeated = await grantManualAchievement({
    database: fake.database,
    openid: user.openid,
    userId: user.id,
    achievementId: "learned_all_ages",
    grantReference: "support-case-2026-18",
    serverDate,
  });

  assert.equal(granted.granted, true);
  assert.equal(repeated.granted, false);
  assert.equal(
    fake.rowsFor("user_achievements").find((item) => item.achievement_id === "learned_all_ages")
      .grant_reference,
    "support-case-2026-18",
  );
  await assert.rejects(
    () =>
      grantManualAchievement({
        database: fake.database,
        openid: user.openid,
        userId: user.id,
        achievementId: "first_masterpiece",
        grantReference: "forged",
        serverDate,
      }),
    { code: "ACHIEVEMENT_MANUAL_ONLY" },
  );
});

test("unregistering a user decrements active and unlocked counters once", async () => {
  const fake = createFakeDatabase();
  const user = seedUser(fake);
  await grantManualAchievement({
    database: fake.database,
    openid: user.openid,
    userId: user.id,
    achievementId: "learned_all_ages",
    grantReference: "support-case-2026-19",
    serverDate,
  });

  const first = await unregisterAchievementAccount({
    database: fake.database,
    openid: user.openid,
    userId: user.id,
    serverDate,
  });
  const repeated = await unregisterAchievementAccount({
    database: fake.database,
    openid: user.openid,
    userId: user.id,
    serverDate,
  });

  assert.equal(first.unregistered, true);
  assert.equal(repeated.unregistered, false);
  const [statistics] = fake.rowsFor("achievement_statistics");
  assert.equal(statistics.active_user_count, 0);
  assert.equal(statistics.unlocked_counts.ordinary_user, 0);
  assert.equal(statistics.unlocked_counts.learned_all_ages, 0);
});
