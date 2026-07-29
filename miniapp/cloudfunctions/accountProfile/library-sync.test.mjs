import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { syncLibrary } = require("./lib/library-sync.js");
const { createAccountProfileHandler, profileDocumentId } = require("./lib/account-profile.js");

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
            if (index < 0) {
              const error = new Error("document not found");
              error.code = "DATABASE_DOCUMENT_NOT_FOUND";
              throw error;
            }
            rows[index] = {
              ...rows[index],
              ...data,
            };
            return { updated: 1 };
          },
          async remove() {
            const index = rows.findIndex((row) => row._id === id);
            if (index >= 0) rows.splice(index, 1);
            return { deleted: index >= 0 ? 1 : 0 };
          },
        };
      },
      where(filter) {
        let skip = 0;
        let limit = 100;
        let orderField = "";
        let orderDirection = "asc";
        const query = {
          orderBy(field, direction) {
            orderField = field;
            orderDirection = direction;
            return query;
          },
          skip(value) {
            skip = value;
            return query;
          },
          limit(value) {
            limit = value;
            return query;
          },
          async get() {
            let result = rows.filter((row) =>
              Object.entries(filter).every(([key, value]) => row[key] === value),
            );
            if (orderField) {
              result = result.slice().sort((left, right) => {
                const delta = Number(left[orderField] || 0) - Number(right[orderField] || 0);
                return orderDirection === "desc" ? -delta : delta;
              });
            }
            return { data: result.slice(skip, skip + limit) };
          },
        };
        return query;
      },
    };
  }

  return {
    database: { collection },
    collections,
  };
}

function event(deviceId, overrides = {}) {
  return {
    device_id: deviceId,
    favorites: [],
    followed_artists: [],
    history: [],
    ...overrides,
  };
}

test("repeating the same batch is idempotent", async () => {
  const fake = createFakeDatabase();
  const request = event("dev_device_a123", {
    favorites: [
      {
        id: "art-1",
        updated_at_ms: 1000,
        deleted: false,
        snapshot: { _id: "art-1", titleCn: "睡莲" },
      },
    ],
    history: [
      {
        id: "art-1",
        updated_at_ms: 2000,
        viewed_at_ms: 2000,
        device_view_count: 2,
        deleted: false,
        snapshot: { _id: "art-1", titleCn: "睡莲" },
      },
    ],
  });

  const options = {
    database: fake.database,
    openid: "openid-a",
    deviceId: request.device_id,
    event: request,
    serverDate: () => "server-date",
    now: 5000,
  };
  await syncLibrary(options);
  const repeated = await syncLibrary(options);

  assert.equal(repeated.favorites.length, 1);
  assert.equal(repeated.history.length, 1);
  assert.equal(repeated.history[0].view_count, 2);
  assert.equal(repeated.history[0].device_view_count, 2);
});

test("different devices receive a union and history counts are merged once", async () => {
  const fake = createFakeDatabase();
  await syncLibrary({
    database: fake.database,
    openid: "openid-a",
    deviceId: "dev_device_a123",
    event: event("dev_device_a123", {
      favorites: [
        {
          id: "art-a",
          updated_at_ms: 1000,
          deleted: false,
          snapshot: { _id: "art-a" },
        },
      ],
      history: [
        {
          id: "art-h",
          updated_at_ms: 2000,
          viewed_at_ms: 2000,
          device_view_count: 2,
          deleted: false,
          snapshot: { _id: "art-h" },
        },
      ],
    }),
    serverDate: () => "server-date",
    now: 5000,
  });
  const merged = await syncLibrary({
    database: fake.database,
    openid: "openid-a",
    deviceId: "dev_device_b123",
    event: event("dev_device_b123", {
      favorites: [
        {
          id: "art-b",
          updated_at_ms: 3000,
          deleted: false,
          snapshot: { _id: "art-b" },
        },
      ],
      history: [
        {
          id: "art-h",
          updated_at_ms: 3000,
          viewed_at_ms: 3000,
          device_view_count: 1,
          deleted: false,
          snapshot: { _id: "art-h" },
        },
      ],
    }),
    serverDate: () => "server-date",
    now: 6000,
  });

  assert.deepEqual(merged.favorites.map((row) => row.id).sort(), ["art-a", "art-b"]);
  assert.equal(merged.history[0].view_count, 3);
  assert.equal(merged.history[0].device_view_count, 1);
  assert.equal("_openid" in merged.history[0], false);
});

test("a newer tombstone is not resurrected by an older add", async () => {
  const fake = createFakeDatabase();
  const base = {
    database: fake.database,
    openid: "openid-a",
    serverDate: () => "server-date",
  };
  await syncLibrary({
    ...base,
    deviceId: "dev_device_a123",
    event: event("dev_device_a123", {
      favorites: [
        {
          id: "art-1",
          updated_at_ms: 3000,
          deleted: true,
        },
      ],
    }),
    now: 5000,
  });
  const result = await syncLibrary({
    ...base,
    deviceId: "dev_device_b123",
    event: event("dev_device_b123", {
      favorites: [
        {
          id: "art-1",
          updated_at_ms: 2000,
          deleted: false,
          snapshot: { _id: "art-1" },
        },
      ],
    }),
    now: 6000,
  });

  assert.equal(result.favorites[0].deleted, true);
});

test("automatic sync does not require a previous manual opt-in", async () => {
  const fake = createFakeDatabase();
  const handler = createAccountProfileHandler({
    database: fake.database,
    getContext: () => ({ OPENID: "openid-auto" }),
    serverDate: () => "server-date",
    now: () => 5000,
    checkNickname: async () => ({ result: { suggest: "pass" } }),
    logger: { error() {} },
  });

  const legacyState = await handler({
    action: "setSyncEnabled",
    enabled: false,
  });
  assert.equal(legacyState.data.profile.sync_enabled, false);

  const result = await handler({
    action: "syncLibrary",
    device_id: "dev_device_auto123",
    favorites: [
      {
        id: "art-auto",
        updated_at_ms: 1000,
        deleted: false,
        snapshot: { _id: "art-auto", titleCn: "自动同步作品" },
      },
    ],
    followed_artists: [],
    history: [],
    download_summary: {
      count: 0,
      updated_at_ms: 1000,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.sync_enabled, true);
  assert.equal(result.data.library.favorites[0].id, "art-auto");
  assert.deepEqual(result.data.achievements.newly_unlocked, ["first_masterpiece"]);
});

test("account deactivation deletes cloud personal data and blocks future reads", async () => {
  const fake = createFakeDatabase();
  const deletedFiles = [];
  const handler = createAccountProfileHandler({
    database: fake.database,
    getContext: () => ({ OPENID: "openid-delete" }),
    serverDate: () => "server-date",
    now: () => 5000,
    checkNickname: async () => ({ result: { suggest: "pass" } }),
    deleteFiles: async (fileList) => {
      deletedFiles.push(...fileList);
      return {
        fileList: fileList.map((fileID) => ({
          fileID,
          status: 0,
        })),
      };
    },
    logger: { error() {} },
  });
  const profileId = profileDocumentId("openid-delete");
  const avatarUrl = `cloud://production/user-avatars/${profileId}/avatar.jpg`;

  const profileResult = await handler({
    action: "updateProfile",
    profile: {
      nickname: "待注销用户",
      avatar_url: avatarUrl,
    },
  });
  assert.equal(profileResult.ok, true);
  await handler({
    action: "syncLibrary",
    device_id: "dev_delete_device123",
    favorites: [
      {
        id: "art-delete",
        updated_at_ms: 1000,
        deleted: false,
        snapshot: { _id: "art-delete", titleCn: "待删除作品" },
      },
    ],
    followed_artists: [
      {
        id: "artist-delete",
        updated_at_ms: 1000,
        deleted: false,
        snapshot: { id: "artist-delete", nameZh: "待删除画家" },
      },
    ],
    history: [
      {
        id: "art-delete",
        updated_at_ms: 1000,
        viewed_at_ms: 1000,
        device_view_count: 1,
        deleted: false,
        snapshot: { _id: "art-delete", titleCn: "待删除作品" },
      },
    ],
  });
  const result = await handler({ action: "deactivateAccount" });

  assert.equal(result.ok, true);
  assert.equal(result.data.deactivated, true);
  assert.deepEqual(deletedFiles, [avatarUrl]);
  assert.equal(fake.collections.get("user_favorites").length, 0);
  assert.equal(fake.collections.get("user_followed_artists").length, 0);
  assert.equal(fake.collections.get("user_history").length, 0);
  assert.equal(fake.collections.get("user_achievements").length, 0);
  assert.equal(result.data.deleted_counts.user_achievements, 2);
  const [statistics] = fake.collections.get("achievement_statistics");
  assert.equal(statistics.active_user_count, 0);
  assert.equal(statistics.unlocked_counts.ordinary_user, 0);
  assert.equal(statistics.unlocked_counts.first_masterpiece, 0);
  const [tombstone] = fake.collections.get("users");
  assert.equal(tombstone.account_status, "deleted");
  assert.equal(tombstone.nickname, "");
  assert.equal(tombstone.avatar_url, "");

  const afterDeletion = await handler({
    action: "getOrCreateProfile",
  });
  assert.equal(afterDeletion.ok, false);
  assert.equal(afterDeletion.error.code, "ACCOUNT_DEACTIVATED");
});
