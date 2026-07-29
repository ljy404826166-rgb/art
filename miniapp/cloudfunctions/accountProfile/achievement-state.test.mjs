import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  equipAchievement,
  getAchievementState,
  readAllForUser,
} = require("./lib/achievement-state.js");
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
        let offset = 0;
        const query = {
          skip(value) {
            offset = value;
            return query;
          },
          limit(value) {
            return {
              async get() {
                return {
                  data: rows
                    .filter((row) =>
                      Object.entries(filter).every(([key, expected]) => row[key] === expected),
                    )
                    .slice(offset, offset + value),
                };
              },
            };
          },
        };
        return query;
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

test("achievement state exposes progress, ownership, and two-decimal rates", async () => {
  const fake = createFakeDatabase();
  const user = seedUser(fake);
  fake.rowsFor("user_favorites").push({
    _id: "favorite-1",
    _openid: user.openid,
    artwork_id: "art-1",
    deleted: false,
  });

  const state = await getAchievementState({
    database: fake.database,
    openid: user.openid,
    userId: user.id,
    serverDate,
  });

  assert.equal(state.items.length, 6);
  assert.deepEqual(state.equipped_title, {
    id: "ordinary_user",
    title: "普通用户",
  });
  assert.equal(state.active_user_count, 1);
  const ordinary = state.items.find((item) => item.id === "ordinary_user");
  const first = state.items.find((item) => item.id === "first_masterpiece");
  const collector = state.items.find((item) => item.id === "treasure_with_care");
  assert.equal(ordinary.unlocked, true);
  assert.equal(ordinary.unlock_rate, "100.00%");
  assert.equal(first.unlocked, true);
  assert.equal(first.unlock_rate, "100.00%");
  assert.deepEqual(first.progress, { current: 1, target: 1 });
  assert.equal(collector.unlocked, false);
  assert.deepEqual(collector.progress, { current: 1, target: 20 });
  assert.equal(collector.unlock_rate, "0.00%");
});

test("equipping verifies ownership and persists across state reads", async () => {
  const fake = createFakeDatabase();
  const user = seedUser(fake);
  fake.rowsFor("user_favorites").push({
    _id: "favorite-1",
    _openid: user.openid,
    artwork_id: "art-1",
    deleted: false,
  });
  await getAchievementState({
    database: fake.database,
    openid: user.openid,
    userId: user.id,
    serverDate,
  });

  const equipped = await equipAchievement({
    database: fake.database,
    openid: user.openid,
    userId: user.id,
    achievementId: "first_masterpiece",
    serverDate,
  });

  assert.deepEqual(equipped.equipped_title, {
    id: "first_masterpiece",
    title: "初识名作",
  });
  assert.equal(fake.rowsFor("users")[0].equipped_title_id, "first_masterpiece");
  await assert.rejects(
    () =>
      equipAchievement({
        database: fake.database,
        openid: user.openid,
        userId: user.id,
        achievementId: "art_wanderer",
        serverDate,
      }),
    { code: "ACHIEVEMENT_NOT_UNLOCKED" },
  );
});

test("achievement state queries paginate cloud records without truncation", async () => {
  const fake = createFakeDatabase();
  const openid = "openid-many";
  fake.collections.set(
    "user_history",
    Array.from({ length: 205 }, (_, index) => ({
      _id: `row-${index}`,
      _openid: openid,
    })),
  );

  const rows = await readAllForUser(fake.database, "user_history", openid);

  assert.equal(rows.length, 205);
  assert.equal(new Set(rows.map((item) => item._id)).size, 205);
});
