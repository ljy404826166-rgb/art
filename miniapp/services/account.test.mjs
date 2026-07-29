import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadAccountService() {
  const module = { exports: {} };
  const source = readFileSync("miniapp/services/account.js", "utf8");
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      Promise,
      Date,
      Error,
      JSON,
      Number,
      String,
      Boolean,
      RegExp,
      setTimeout,
      clearTimeout,
    },
    { filename: "miniapp/services/account.js" },
  );
  return module.exports;
}

function createWxMock({
  profile,
  resultData,
  failure,
  defer = false,
  fileSize = 1024,
  uploadFailure,
} = {}) {
  const store = new Map();
  const calls = [];
  const uploads = [];
  let resolveCloud;
  let rejectCloud;

  const wxApi = {
    getStorageSync(key) {
      return store.get(key);
    },
    setStorageSync(key, value) {
      store.set(key, value);
    },
    removeStorageSync(key) {
      store.delete(key);
    },
    getFileInfo(options) {
      options.success({ size: fileSize });
    },
    cloud: {
      callFunction(options) {
        calls.push(options);
        if (defer) {
          resolveCloud = options.success;
          rejectCloud = options.fail;
          return;
        }
        if (failure) {
          options.fail(failure);
          return;
        }
        options.success({
          result: {
            ok: true,
            data: resultData || {
              created: true,
              profile: profile || {
                id: "user-1",
                nickname: "",
                profile_completed: false,
              },
            },
          },
        });
      },
      uploadFile(options) {
        uploads.push(options);
        if (uploadFailure) {
          options.fail(uploadFailure);
          return;
        }
        options.success({
          fileID: `cloud://production/${options.cloudPath}`,
        });
      },
    },
  };

  return {
    wxApi,
    calls,
    store,
    uploads,
    resolveCloud(value) {
      resolveCloud(value);
    },
    rejectCloud(error) {
      rejectCloud(error);
    },
  };
}

function achievementState(overrides = {}) {
  const equippedTitle = overrides.equipped_title || {
    id: "ordinary_user",
    title: "普通用户",
  };
  return {
    catalog_version: 1,
    equipped_title: equippedTitle,
    active_user_count: 100,
    statistics_updated_at: "server-date",
    items: [
      {
        id: "ordinary_user",
        title: "普通用户",
        description: "默认头衔",
        requirement: "所有用户默认拥有",
        grant_type: "default",
        unlocked: true,
        equipped: equippedTitle.id === "ordinary_user",
        unlocked_at: "server-date",
        progress: { current: 1, target: 1 },
        unlocked_user_count: 100,
        unlock_rate: "100.00%",
      },
      {
        id: "first_masterpiece",
        title: "初识名作",
        description: "收藏第一件作品",
        requirement: "收藏1件作品",
        grant_type: "automatic",
        unlocked: true,
        equipped: equippedTitle.id === "first_masterpiece",
        unlocked_at: "server-date",
        progress: { current: 1, target: 1 },
        unlocked_user_count: 25,
        unlock_rate: "25.00%",
      },
    ],
    ...overrides,
  };
}

test("account state starts as a local guest without cached profile", () => {
  const service = loadAccountService();
  const mock = createWxMock();

  const state = service.readCachedAccountState({ wxApi: mock.wxApi });

  assert.equal(state.status, "guest");
  assert.equal(state.profile, null);
  assert.equal(state.source, "local");
});

test("account deactivation is cloud-authorized and clears the profile cache", async () => {
  const service = loadAccountService();
  const mock = createWxMock({
    resultData: {
      deactivated: true,
      deleted_counts: {
        user_favorites: 2,
      },
    },
  });
  mock.store.set(service.ACCOUNT_PROFILE_CACHE_KEY, {
    version: service.ACCOUNT_PROFILE_CACHE_VERSION,
    cachedAt: 1000,
    profile: {
      id: "user-1",
      nickname: "艺术用户",
    },
  });

  const result = await service.deactivateAccount({
    wxApi: mock.wxApi,
  });

  assert.equal(result.deactivated, true);
  assert.equal(result.deletedCounts.user_favorites, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(mock.calls[0].data)), { action: "deactivateAccount" });
  assert.equal(mock.store.has(service.ACCOUNT_PROFILE_CACHE_KEY), false);
});

test("first cloud identity call caches a safe identified profile", async () => {
  const service = loadAccountService();
  const mock = createWxMock();

  const state = await service.loadAccountState({
    wxApi: mock.wxApi,
    now: 1000,
  });

  assert.equal(state.status, "identified");
  assert.equal(state.source, "cloud");
  assert.equal(state.profile.id, "user-1");
  assert.equal(mock.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(mock.calls[0].data)), {
    action: "getOrCreateProfile",
  });
  const cached = mock.store.get(service.ACCOUNT_PROFILE_CACHE_KEY);
  assert.equal(cached.cachedAt, 1000);
  assert.equal(cached.profile.id, "user-1");
});

test("a fresh cached profile avoids repeated cloud requests", async () => {
  const service = loadAccountService();
  const mock = createWxMock();
  mock.store.set(service.ACCOUNT_PROFILE_CACHE_KEY, {
    version: service.ACCOUNT_PROFILE_CACHE_VERSION,
    cachedAt: 1000,
    profile: {
      id: "user-cached",
      nickname: "莫奈",
      profile_completed: true,
    },
  });

  const state = await service.loadAccountState({
    wxApi: mock.wxApi,
    now: 2000,
  });

  assert.equal(state.status, "complete");
  assert.equal(state.source, "cache");
  assert.equal(state.profile.nickname, "莫奈");
  assert.equal(mock.calls.length, 0);
});

test("offline cloud failure preserves cached profile", async () => {
  const service = loadAccountService();
  const mock = createWxMock({
    failure: {
      errCode: "NETWORK_FAIL",
      errMsg: "request:fail network offline",
    },
  });
  mock.store.set(service.ACCOUNT_PROFILE_CACHE_KEY, {
    version: service.ACCOUNT_PROFILE_CACHE_VERSION,
    cachedAt: 1000,
    profile: {
      id: "user-cached",
      nickname: "本地用户",
      profile_completed: true,
    },
  });

  const state = await service.loadAccountState({
    wxApi: mock.wxApi,
    now: 999999,
    force: true,
  });

  assert.equal(state.status, "offline");
  assert.equal(state.profile.nickname, "本地用户");
  assert.equal(state.source, "cache");
});

test("invalid cloud responses become safe error states", async () => {
  const service = loadAccountService();
  const mock = createWxMock({ defer: true });
  const pending = service.loadAccountState({
    wxApi: mock.wxApi,
    now: 1000,
  });

  mock.resolveCloud({ result: { ok: true, data: {} } });
  const state = await pending;

  assert.equal(state.status, "error");
  assert.equal(state.errorCode, "ACCOUNT_RESPONSE_INVALID");
  assert.equal(state.profile, null);
});

test("concurrent page refreshes share one cloud request", async () => {
  const service = loadAccountService();
  const mock = createWxMock({ defer: true });

  const first = service.loadAccountState({
    wxApi: mock.wxApi,
    now: 1000,
    force: true,
  });
  const second = service.loadAccountState({
    wxApi: mock.wxApi,
    now: 1000,
    force: true,
  });

  assert.equal(mock.calls.length, 1);
  mock.resolveCloud({
    result: {
      ok: true,
      data: {
        profile: {
          id: "user-1",
          nickname: "",
          profile_completed: false,
        },
      },
    },
  });

  const [firstState, secondState] = await Promise.all([first, second]);
  assert.equal(firstState.profile.id, "user-1");
  assert.equal(secondState.profile.id, "user-1");
});

test("cloud request timeout produces an offline state", async () => {
  const service = loadAccountService();
  const mock = createWxMock({ defer: true });

  const state = await service.loadAccountState({
    wxApi: mock.wxApi,
    now: 1000,
    timeoutMs: 5,
  });

  assert.equal(state.status, "offline");
  assert.equal(state.errorCode, "ACCOUNT_REQUEST_TIMEOUT");
});

test("nickname validation trims whitespace and enforces twenty characters", () => {
  const service = loadAccountService();

  assert.deepEqual(JSON.parse(JSON.stringify(service.validateNickname("  艺术  访客  "))), {
    valid: true,
    value: "艺术 访客",
    message: "",
  });
  assert.equal(service.validateNickname(" ").valid, false);
  assert.equal(service.validateNickname("一二三四五六七八九十一二三四五六七八九十一").valid, false);
  assert.equal(service.validateNickname("<访客>").valid, false);
});

test("profile update calls the whitelist action and refreshes local cache", async () => {
  const service = loadAccountService();
  const profile = {
    id: "usr_1234567890abcdef1234567890abcdef1234567890abcdef",
    nickname: "新昵称",
    avatar_url: "cloud://production/user-avatars/usr_123/avatar.jpg",
    profile_completed: true,
  };
  const mock = createWxMock({ profile });

  const state = await service.updateAccountProfile({
    wxApi: mock.wxApi,
    nickname: " 新昵称 ",
    avatarUrl: profile.avatar_url,
    now: 2000,
  });

  assert.equal(state.status, "complete");
  assert.equal(mock.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(mock.calls[0].data)), {
    action: "updateProfile",
    profile: {
      nickname: "新昵称",
      avatar_url: profile.avatar_url,
    },
  });
  assert.equal(mock.store.get(service.ACCOUNT_PROFILE_CACHE_KEY).profile.nickname, "新昵称");
});

test("concurrent profile saves share one cloud request", async () => {
  const service = loadAccountService();
  const mock = createWxMock({ defer: true });
  const first = service.updateAccountProfile({
    wxApi: mock.wxApi,
    nickname: "艺术访客",
    avatarUrl: "",
  });
  const second = service.updateAccountProfile({
    wxApi: mock.wxApi,
    nickname: "艺术访客",
    avatarUrl: "",
  });

  assert.equal(mock.calls.length, 1);
  mock.resolveCloud({
    result: {
      ok: true,
      data: {
        profile: {
          id: "user-1",
          nickname: "艺术访客",
          avatar_url: "",
          profile_completed: false,
        },
      },
    },
  });

  const [firstState, secondState] = await Promise.all([first, second]);
  assert.equal(firstState.profile.nickname, "艺术访客");
  assert.equal(secondState.profile.nickname, "艺术访客");
});

test("avatar upload uses the current profile controlled directory", async () => {
  const service = loadAccountService();
  const mock = createWxMock();
  const profileId = "usr_1234567890abcdef1234567890abcdef1234567890abcdef";

  const result = await service.uploadProfileAvatar({
    wxApi: mock.wxApi,
    filePath: "wxfile://tmp/avatar.png",
    profileId,
    now: 1234,
    random: () => 0,
  });

  assert.equal(result.cloudPath, `user-avatars/${profileId}/1234-000000.png`);
  assert.equal(result.fileID, `cloud://production/user-avatars/${profileId}/1234-000000.png`);
  assert.equal(mock.uploads.length, 1);
});

test("oversized or failed avatar uploads do not return a new file reference", async () => {
  const service = loadAccountService();
  const profileId = "usr_1234567890abcdef1234567890abcdef1234567890abcdef";
  const oversized = createWxMock({
    fileSize: service.MAX_AVATAR_SIZE_BYTES + 1,
  });
  const failed = createWxMock({
    uploadFailure: {
      errCode: "NETWORK_FAIL",
    },
  });

  await assert.rejects(
    service.uploadProfileAvatar({
      wxApi: oversized.wxApi,
      filePath: "wxfile://tmp/avatar.jpg",
      profileId,
    }),
    /不能超过4MB/,
  );
  assert.equal(oversized.uploads.length, 0);

  await assert.rejects(
    service.uploadProfileAvatar({
      wxApi: failed.wxApi,
      filePath: "wxfile://tmp/avatar.jpg",
      profileId,
    }),
    /上传失败/,
  );
});

test("achievement state loads from cloud, keeps two-decimal rates, and reuses cache", async () => {
  const service = loadAccountService();
  const mock = createWxMock({
    resultData: {
      profile: {
        id: "user-1",
        nickname: "艺术用户",
        equipped_title_id: "ordinary_user",
        equipped_title: {
          id: "ordinary_user",
          title: "普通用户",
        },
      },
      achievements: achievementState(),
    },
  });

  const cloud = await service.loadAchievementState({
    wxApi: mock.wxApi,
    now: 1000,
  });
  const cached = await service.loadAchievementState({
    wxApi: mock.wxApi,
    now: 2000,
  });

  assert.equal(cloud.source, "cloud");
  assert.equal(cloud.items[1].unlock_rate, "25.00%");
  assert.equal(cached.source, "cache");
  assert.equal(mock.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(mock.calls[0].data)), {
    action: "getAchievementState",
  });
  assert.equal(
    mock.store.get(service.ACHIEVEMENT_CACHE_KEY).version,
    service.ACHIEVEMENT_CACHE_VERSION,
  );
});

test("equipping an achievement updates both achievement and profile caches", async () => {
  const service = loadAccountService();
  const equippedTitle = {
    id: "first_masterpiece",
    title: "初识名作",
  };
  const mock = createWxMock({
    resultData: {
      profile: {
        id: "user-1",
        nickname: "艺术用户",
        equipped_title_id: equippedTitle.id,
        equipped_title: equippedTitle,
      },
      achievements: achievementState({
        equipped_title: equippedTitle,
      }),
    },
  });

  const state = await service.equipAchievement({
    wxApi: mock.wxApi,
    achievementId: "first_masterpiece",
    now: 3000,
  });

  assert.equal(state.equipped_title.title, "初识名作");
  assert.equal(state.profile.equipped_title_id, "first_masterpiece");
  assert.deepEqual(JSON.parse(JSON.stringify(mock.calls[0].data)), {
    action: "equipAchievement",
    achievement_id: "first_masterpiece",
  });
  assert.equal(
    mock.store.get(service.ACCOUNT_PROFILE_CACHE_KEY).profile.equipped_title.title,
    "初识名作",
  );
});

test("legacy profile caches are rejected and missing titles fall back safely", () => {
  const service = loadAccountService();
  const mock = createWxMock();
  mock.store.set(service.ACCOUNT_PROFILE_CACHE_KEY, {
    version: 1,
    cachedAt: 1000,
    profile: {
      id: "legacy-user",
      nickname: "旧用户",
    },
  });

  assert.equal(service.readCachedAccountState({ wxApi: mock.wxApi }).status, "guest");
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        service.sanitizeCachedProfile({
          id: "profile-without-title",
        }).equipped_title,
      ),
    ),
    {
      id: "ordinary_user",
      title: "普通用户",
    },
  );
});
