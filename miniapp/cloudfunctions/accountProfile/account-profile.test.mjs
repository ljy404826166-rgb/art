import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  createAccountProfileHandler,
  createProfileDocumentIfMissing,
  profileDocumentId,
  sanitizeProfile,
} = require("./lib/account-profile.js");

function createFakeDatabase() {
  const collections = new Map();

  function rowsFor(name) {
    if (!collections.has(name)) collections.set(name, []);
    return collections.get(name);
  }

  function collection(name) {
    const rows = rowsFor(name);
    return {
      where(filter) {
        return {
          limit() {
            return {
              async get() {
                return {
                  data: rows
                    .filter((row) =>
                      Object.entries(filter).every(([key, value]) => row[key] === value),
                    )
                    .slice(0, 100),
                };
              },
            };
          },
        };
      },
      doc(id) {
        return {
          async get() {
            return {
              data: rows.find((row) => row._id === id) || null,
            };
          },
          async set({ data }) {
            const existingIndex = rows.findIndex((row) => row._id === id);
            const row = {
              ...data,
              _id: id,
            };
            if (existingIndex >= 0) {
              rows[existingIndex] = row;
            } else {
              rows.push(row);
            }
            return { _id: id };
          },
          async update({ data }) {
            const existingIndex = rows.findIndex((row) => row._id === id);
            if (existingIndex < 0) {
              const error = new Error("document not found");
              error.code = "DATABASE_DOCUMENT_NOT_FOUND";
              throw error;
            }
            rows[existingIndex] = {
              ...rows[existingIndex],
              ...data,
            };
            return { updated: 1 };
          },
          async remove() {
            const existingIndex = rows.findIndex((row) => row._id === id);
            if (existingIndex >= 0) rows.splice(existingIndex, 1);
            return { deleted: existingIndex >= 0 ? 1 : 0 };
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

  return {
    database,
    collections,
    rows: rowsFor("users"),
  };
}

function createHandler({
  openid = "openid-a",
  database,
  logger,
  isAchievementAdmin = () => false,
  checkNickname = async () => ({ result: { suggest: "pass" } }),
} = {}) {
  return createAccountProfileHandler({
    database,
    getContext: () => ({ OPENID: openid }),
    serverDate: () => "2026-07-26T00:00:00.000Z",
    checkNickname,
    isAchievementAdmin,
    logger: logger || { error() {} },
  });
}

test("getOrCreateProfile is idempotent for the same WeChat user", async () => {
  const fake = createFakeDatabase();
  const handler = createHandler({ database: fake.database });

  const first = await handler({ action: "getOrCreateProfile" });
  const second = await handler({ action: "getOrCreateProfile" });

  assert.equal(first.ok, true);
  assert.equal(first.data.created, true);
  assert.equal(second.ok, true);
  assert.equal(second.data.created, false);
  assert.equal(first.data.profile.id, second.data.profile.id);
  assert.equal(first.data.profile.sync_enabled, true);
  assert.equal(first.data.profile.equipped_title_id, "ordinary_user");
  assert.equal(first.data.profile.achievement_schema_version, 1);
  assert.equal(first.data.profile.schema_version, 2);
  assert.equal(fake.rows.length, 1);
});

test("event identity fields cannot override Cloud.getWXContext identity", async () => {
  const fake = createFakeDatabase();
  const handler = createHandler({
    openid: "trusted-openid",
    database: fake.database,
  });

  const result = await handler({
    action: "getOrCreateProfile",
    _openid: "forged-openid",
    openid: "forged-openid",
    account_status: "admin",
  });

  assert.equal(result.ok, true);
  assert.equal(fake.rows[0]._openid, "trusted-openid");
  assert.equal(fake.rows[0].account_status, "active");
  assert.equal("_openid" in result.data.profile, false);
});

test("different WeChat users receive isolated profile documents", async () => {
  const fake = createFakeDatabase();
  const first = createHandler({ openid: "openid-a", database: fake.database });
  const second = createHandler({ openid: "openid-b", database: fake.database });

  const resultA = await first({ action: "getOrCreateProfile" });
  const resultB = await second({
    action: "getOrCreateProfile",
    id: resultA.data.profile.id,
  });

  assert.notEqual(resultA.data.profile.id, resultB.data.profile.id);
  assert.deepEqual(fake.rows.map((row) => row._openid).sort(), ["openid-a", "openid-b"]);
});

test("missing cloud identity returns a safe unauthenticated response", async () => {
  const fake = createFakeDatabase();
  const handler = createHandler({ openid: "", database: fake.database });

  const result = await handler({ action: "getOrCreateProfile" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ACCOUNT_UNAUTHENTICATED");
  assert.equal(fake.rows.length, 0);
});

test("unsupported actions are rejected before any database access", async () => {
  const fake = createFakeDatabase();
  const handler = createHandler({ database: fake.database });

  const result = await handler({ action: "deleteEveryUser" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ACCOUNT_ACTION_UNSUPPORTED");
  assert.equal(fake.rows.length, 0);
});

test("manual achievement grants fail closed unless the caller is allowlisted", async () => {
  const fake = createFakeDatabase();
  const target = createHandler({
    openid: "target-openid",
    database: fake.database,
  });
  const targetResult = await target({ action: "getOrCreateProfile" });
  const forbidden = createHandler({
    openid: "ordinary-openid",
    database: fake.database,
  });

  const denied = await forbidden({
    action: "adminGrantAchievement",
    target_user_id: targetResult.data.profile.id,
    achievement_id: "learned_all_ages",
    grant_reference: "support-case-18",
  });

  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "ACHIEVEMENT_ADMIN_FORBIDDEN");
  assert.equal(
    fake.collections
      .get("user_achievements")
      .filter((item) => item.achievement_id === "learned_all_ages").length,
    0,
  );
});

test("an allowlisted operator can grant a reviewed manual achievement once", async () => {
  const fake = createFakeDatabase();
  const target = createHandler({
    openid: "target-openid",
    database: fake.database,
  });
  const targetResult = await target({ action: "getOrCreateProfile" });
  const admin = createHandler({
    openid: "admin-openid",
    database: fake.database,
    isAchievementAdmin: (openid) => openid === "admin-openid",
  });
  const request = {
    action: "adminGrantAchievement",
    target_user_id: targetResult.data.profile.id,
    achievement_id: "learned_all_ages",
    grant_reference: "support-case-19",
  };

  const first = await admin(request);
  const repeated = await admin(request);

  assert.equal(first.ok, true);
  assert.equal(first.data.granted, true);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.data.granted, false);
});

test("achievement state and equip actions return server-controlled title data", async () => {
  const fake = createFakeDatabase();
  const handler = createHandler({
    openid: "achievement-openid",
    database: fake.database,
  });
  const account = await handler({ action: "getOrCreateProfile" });
  fake.collections.set("user_favorites", [
    {
      _id: "favorite-1",
      _openid: "achievement-openid",
      artwork_id: "art-1",
      deleted: false,
    },
  ]);

  const state = await handler({ action: "getAchievementState" });
  const equipped = await handler({
    action: "equipAchievement",
    achievement_id: "first_masterpiece",
  });
  const locked = await handler({
    action: "equipAchievement",
    achievement_id: "art_wanderer",
  });

  assert.equal(state.ok, true);
  assert.equal(state.data.profile.id, account.data.profile.id);
  assert.equal(
    state.data.achievements.items.find((item) => item.id === "first_masterpiece").unlocked,
    true,
  );
  assert.equal(equipped.ok, true);
  assert.equal(equipped.data.profile.equipped_title.title, "初识名作");
  assert.equal(equipped.data.achievements.equipped_title.id, "first_masterpiece");
  assert.equal(locked.ok, false);
  assert.equal(locked.error.code, "ACHIEVEMENT_NOT_UNLOCKED");
});

test("storage errors are logged but hidden from the client", async () => {
  const logEntries = [];
  const handler = createHandler({
    database: {
      collection() {
        throw new Error("internal database path and credential");
      },
    },
    logger: {
      error(message, details) {
        logEntries.push({ message, details });
      },
    },
  });

  const result = await handler({ action: "getOrCreateProfile" });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ACCOUNT_STORAGE_FAILED");
  assert.doesNotMatch(result.error.message, /credential|database path/i);
  assert.equal(logEntries.length, 1);
});

test("sanitizeProfile exposes only the client profile whitelist", () => {
  const profile = sanitizeProfile({
    _id: "user-1",
    _openid: "secret-openid",
    nickname: "Claude",
    account_status: "active",
    internal_note: "never expose",
  });

  assert.equal(profile.id, "user-1");
  assert.equal(profile.equipped_title_id, "ordinary_user");
  assert.equal(profile.achievement_schema_version, 1);
  assert.equal("_openid" in profile, false);
  assert.equal("internal_note" in profile, false);
});

test("profile document IDs are deterministic and do not expose raw OPENID", () => {
  const first = profileDocumentId("openid-a");
  const second = profileDocumentId("openid-a");
  const other = profileDocumentId("openid-b");

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^usr_[a-f0-9]{48}$/);
  assert.doesNotMatch(first, /openid-a/);
});

test("profile creation reuses a document already present in the transaction", async () => {
  const fake = createFakeDatabase();
  const id = profileDocumentId("openid-a");
  fake.rows.push({
    _id: id,
    _openid: "openid-a",
    account_status: "active",
  });

  const result = await createProfileDocumentIfMissing({
    database: fake.database,
    id,
    document: {
      _openid: "openid-a",
      account_status: "active",
      nickname: "不应覆盖",
    },
  });

  assert.equal(result.created, false);
  assert.equal(fake.rows.length, 1);
  assert.equal(fake.rows[0].nickname, undefined);
});

test("updateProfile only writes whitelisted profile fields", async () => {
  const fake = createFakeDatabase();
  const handler = createHandler({
    openid: "trusted-openid",
    database: fake.database,
  });
  const id = profileDocumentId("trusted-openid");
  const avatarUrl = `cloud://production/user-avatars/${id}/avatar.jpg`;

  const result = await handler({
    action: "updateProfile",
    profile: {
      nickname: "  艺术访客  ",
      avatar_url: avatarUrl,
      account_status: "admin",
      _openid: "forged-openid",
      schema_version: 999,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.nickname, "艺术访客");
  assert.equal(result.data.profile.avatar_url, avatarUrl);
  assert.equal(result.data.profile.profile_completed, true);
  assert.equal(fake.rows.length, 1);
  assert.equal(fake.rows[0]._openid, "trusted-openid");
  assert.equal(fake.rows[0].account_status, "active");
  assert.equal(fake.rows[0].schema_version, 2);
});

test("updateProfile rejects empty and overlong nicknames before writing", async () => {
  const fake = createFakeDatabase();
  const handler = createHandler({ database: fake.database });

  const empty = await handler({
    action: "updateProfile",
    profile: { nickname: "   " },
  });
  const overlong = await handler({
    action: "updateProfile",
    profile: { nickname: "二十三四五六七八九十一二三四五六七八九十一" },
  });

  assert.equal(empty.ok, false);
  assert.equal(empty.error.code, "ACCOUNT_NICKNAME_REQUIRED");
  assert.equal(overlong.ok, false);
  assert.equal(overlong.error.code, "ACCOUNT_NICKNAME_TOO_LONG");
  assert.equal(fake.rows.length, 1);
  assert.equal(fake.rows[0].nickname, "");
});

test("updateProfile rejects nicknames that fail content safety", async () => {
  const fake = createFakeDatabase();
  const handler = createHandler({
    database: fake.database,
    checkNickname: async () => ({
      result: {
        suggest: "risky",
      },
    }),
  });

  const result = await handler({
    action: "updateProfile",
    profile: { nickname: "待审核昵称" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ACCOUNT_NICKNAME_REJECTED");
  assert.equal(fake.rows[0].nickname, "");
});

test("updateProfile fails closed when content safety is unavailable", async () => {
  const fake = createFakeDatabase();
  const handler = createHandler({
    database: fake.database,
    checkNickname: async () => {
      throw new Error("upstream unavailable");
    },
  });

  const result = await handler({
    action: "updateProfile",
    profile: { nickname: "正常昵称" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ACCOUNT_CONTENT_CHECK_FAILED");
  assert.doesNotMatch(result.error.message, /upstream/i);
});

test("updateProfile only accepts avatars in the current profile directory", async () => {
  const fake = createFakeDatabase();
  const handler = createHandler({
    openid: "openid-a",
    database: fake.database,
  });
  const otherId = profileDocumentId("openid-b");

  const result = await handler({
    action: "updateProfile",
    profile: {
      nickname: "合法昵称",
      avatar_url: `cloud://production/user-avatars/${otherId}/avatar.jpg`,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "ACCOUNT_AVATAR_INVALID");
  assert.equal(fake.rows[0].avatar_url, "");
});

test("updating nickname without an avatar keeps the profile incomplete", async () => {
  const fake = createFakeDatabase();
  const handler = createHandler({ database: fake.database });

  const result = await handler({
    action: "updateProfile",
    profile: { nickname: "只设置昵称" },
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.nickname, "只设置昵称");
  assert.equal(result.data.profile.avatar_url, "");
  assert.equal(result.data.profile.profile_completed, false);
  assert.equal(fake.rows.length, 1);
});

test("sync can be enabled without changing profile identity fields", async () => {
  const fake = createFakeDatabase();
  const handler = createHandler({
    openid: "trusted-openid",
    database: fake.database,
  });

  const result = await handler({
    action: "setSyncEnabled",
    enabled: true,
    _openid: "forged-openid",
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.profile.sync_enabled, true);
  assert.equal(fake.rows[0]._openid, "trusted-openid");
  assert.equal(fake.rows[0].account_status, "active");
});

test("cloud function declares the nickname content-safety permission", () => {
  const config = JSON.parse(
    readFileSync("miniapp/cloudfunctions/accountProfile/config.json", "utf8"),
  );

  assert.deepEqual(config.permissions.openapi, ["security.msgSecCheck"]);

  const entry = readFileSync("miniapp/cloudfunctions/accountProfile/index.js", "utf8");
  assert.match(entry, /process\.env\.ACHIEVEMENT_ADMIN_OPENIDS/);
  assert.match(entry, /achievementAdminOpenids\.has/);
  assert.doesNotMatch(entry, /event\.(?:admin|is_admin|operator)/);
});
