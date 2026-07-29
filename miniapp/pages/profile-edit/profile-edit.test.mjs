import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const PROFILE_ID = "usr_1234567890abcdef1234567890abcdef1234567890abcdef";

function profile(overrides = {}) {
  return {
    id: PROFILE_ID,
    nickname: "艺术访客",
    avatar_url: "cloud://production/user-avatars/profile/old.jpg",
    profile_completed: true,
    ...overrides,
  };
}

function loadProfileEditPage({ accountService } = {}) {
  const filename = fileURLToPath(new URL("./profile-edit.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  let page = null;
  const module = { exports: {} };
  const toasts = [];
  const navigations = [];
  const service = {
    normalizeNickname(value) {
      return String(value || "")
        .trim()
        .replace(/\s+/g, " ");
    },
    validateNickname(value) {
      const nickname = String(value || "")
        .trim()
        .replace(/\s+/g, " ");
      if (!nickname) {
        return { valid: false, value: "", message: "请输入昵称" };
      }
      return { valid: true, value: nickname, message: "" };
    },
    readCachedAccountState: () => ({
      status: "complete",
      profile: profile(),
    }),
    loadAccountState: async () => ({
      status: "complete",
      profile: profile(),
    }),
    uploadProfileAvatar: async () => ({
      fileID: `cloud://production/user-avatars/${PROFILE_ID}/new.jpg`,
    }),
    updateAccountProfile: async ({ nickname, avatarUrl }) => ({
      status: "complete",
      profile: profile({
        nickname,
        avatar_url: avatarUrl,
      }),
    }),
    ...accountService,
  };

  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      require(id) {
        if (id === "../../services/account") return service;
        throw new Error(`Unexpected module: ${id}`);
      },
      Page(definition) {
        page = {
          ...definition,
          data: JSON.parse(JSON.stringify(definition.data)),
          setData(patch) {
            this.data = {
              ...this.data,
              ...patch,
            };
          },
        };
      },
      wx: {
        showToast(options) {
          toasts.push(options);
        },
        navigateBack(options) {
          navigations.push(options);
        },
      },
      Promise,
      String,
      Array,
      Boolean,
      clearTimeout,
      setTimeout(callback) {
        callback();
        return 1;
      },
    },
    { filename },
  );

  return {
    helpers: module.exports,
    navigations,
    page,
    toasts,
  };
}

test("profile edit page restores the cached cloud profile", async () => {
  const { page } = loadProfileEditPage();

  await page.onLoad();

  assert.equal(page.data.profileId, PROFILE_ID);
  assert.equal(page.data.nickname, "艺术访客");
  assert.match(page.data.avatarPreviewUrl, /^cloud:\/\//);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.canSave, false);
});

test("native avatar and nickname controls are present", () => {
  const template = readFileSync(
    fileURLToPath(new URL("./profile-edit.wxml", import.meta.url)),
    "utf8",
  );
  const styles = readFileSync(
    fileURLToPath(new URL("./profile-edit.wxss", import.meta.url)),
    "utf8",
  );

  assert.match(template, /open-type="chooseAvatar"/);
  assert.match(template, /bindchooseavatar="onChooseAvatar"/);
  assert.match(template, /class="avatar-picker-hitbox"/);
  assert.match(template, /使用微信登录/);
  assert.doesNotMatch(template, /更换头像|选择头像|支持 JPG, PNG/);
  assert.doesNotMatch(template, /avatar-action-icon|avatar-action-hint/);
  assert.match(template, /type="nickname"/);
  assert.match(template, /maxlength="20"/);
  assert.match(template, /bindtap="clearNickname"/);
  assert.doesNotMatch(template, /save-bar|saveProfile|保存资料/);
  assert.doesNotMatch(template, /privacy-note/);
  assert.doesNotMatch(styles, /\.save-bar|\.save-button/);
  assert.match(styles, /\.profile-edit-page\s*\{[^}]*background:\s*#f8f8f7;/s);
  assert.match(styles, /\.profile-form\s*\{[^}]*border-radius:\s*48rpx;/s);
  assert.match(styles, /\.avatar-field\s*\{[^}]*align-items:\s*stretch;/s);
  assert.match(styles, /\.avatar-picker\s*\{[^}]*min-height:\s*192rpx;/s);
  assert.match(styles, /\.avatar-preview\s*\{[^}]*width:\s*128rpx;/s);
  assert.match(styles, /\.avatar-picker-hitbox\s*\{[^}]*position:\s*absolute;/s);
  assert.match(styles, /\.avatar-action-title\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(styles, /\.avatar-action-arrow\s*\{[^}]*margin-left:\s*auto;/s);
  assert.match(styles, /\.nickname-control\s*\{[^}]*min-height:\s*112rpx;/s);
});

test("choosing an avatar previews locally before upload", async () => {
  let resolveUpload;
  const uploadPending = new Promise((resolve) => {
    resolveUpload = resolve;
  });
  const { page } = loadProfileEditPage({
    accountService: {
      uploadProfileAvatar: () => uploadPending,
    },
  });
  await page.onLoad();

  const saving = page.onChooseAvatar({
    detail: {
      avatarUrl: "wxfile://tmp/new-avatar.jpg",
    },
  });

  assert.equal(page.data.avatarPreviewUrl, "wxfile://tmp/new-avatar.jpg");
  assert.equal(page.data.pendingAvatarPath, "wxfile://tmp/new-avatar.jpg");
  assert.equal(page.data.saving, true);

  resolveUpload({
    fileID: `cloud://production/user-avatars/${PROFILE_ID}/new.jpg`,
  });
  await saving;
  assert.equal(page.data.pendingAvatarPath, "");
  assert.equal(page.data.saving, false);
});

test("clearing the nickname updates the designed input state without saving", async () => {
  const { page } = loadProfileEditPage();
  await page.onLoad();

  page.clearNickname();

  assert.equal(page.data.nickname, "");
  assert.equal(page.data.avatarText, "微");
  assert.equal(page.data.canSave, false);
  assert.equal(page.data.formError, "");
});

test("avatar authorization automatically uploads and saves without navigation", async () => {
  const calls = [];
  const { page, toasts, navigations } = loadProfileEditPage({
    accountService: {
      uploadProfileAvatar: async (options) => {
        calls.push({ type: "upload", options });
        return {
          fileID: `cloud://production/user-avatars/${PROFILE_ID}/new.jpg`,
        };
      },
      updateAccountProfile: async (options) => {
        calls.push({ type: "update", options });
        return {
          status: "complete",
          profile: profile({
            nickname: options.nickname,
            avatar_url: options.avatarUrl,
          }),
        };
      },
    },
  });
  await page.onLoad();
  await page.onChooseAvatar({
    detail: { avatarUrl: "wxfile://tmp/new-avatar.jpg" },
  });

  assert.deepEqual(
    calls.map((call) => call.type),
    ["upload", "update"],
  );
  assert.equal(calls[1].options.nickname, "艺术访客");
  assert.match(calls[1].options.avatarUrl, /^cloud:\/\//);
  assert.equal(page.data.nickname, "艺术访客");
  assert.equal(page.data.saving, false);
  assert.equal(toasts.at(-1).title, "保存成功");
  assert.equal(navigations.length, 0);
});

test("a valid nickname automatically saves after input finishes", async () => {
  const updates = [];
  const { page } = loadProfileEditPage({
    accountService: {
      updateAccountProfile: async (options) => {
        updates.push(options);
        return {
          status: "complete",
          profile: profile({ nickname: options.nickname }),
        };
      },
    },
  });
  await page.onLoad();

  page.onNicknameInput({
    detail: { value: " 新昵称 " },
  });
  assert.equal(updates.length, 0);

  await page.onNicknameBlur();

  assert.equal(updates.length, 1);
  assert.equal(updates[0].nickname, "新昵称");
  assert.equal(page.data.nickname, "新昵称");
});

test("repeated save taps share the active page request", async () => {
  let resolveUpdate;
  let updateCalls = 0;
  const pending = new Promise((resolve) => {
    resolveUpdate = resolve;
  });
  const { page } = loadProfileEditPage({
    accountService: {
      updateAccountProfile: () => {
        updateCalls += 1;
        return pending;
      },
    },
  });
  await page.onLoad();
  page.onNicknameInput({
    detail: { value: "另一个昵称" },
  });

  const first = page.saveProfile();
  const second = page.saveProfile();
  assert.equal(first, second);
  assert.equal(updateCalls, 1);

  resolveUpdate({
    status: "complete",
    profile: profile({ nickname: "另一个昵称" }),
  });
  await first;
});

test("avatar upload failure restores the previously saved avatar", async () => {
  let updateCalls = 0;
  const oldAvatar = profile().avatar_url;
  const { page, toasts } = loadProfileEditPage({
    accountService: {
      uploadProfileAvatar: async () => {
        throw new Error("头像上传失败，请稍后重试");
      },
      updateAccountProfile: async () => {
        updateCalls += 1;
        return null;
      },
    },
  });
  await page.onLoad();
  await page.onChooseAvatar({
    detail: { avatarUrl: "wxfile://tmp/new-avatar.jpg" },
  });

  assert.equal(updateCalls, 0);
  assert.equal(page.data.avatarPreviewUrl, oldAvatar);
  assert.equal(page.data.pendingAvatarPath, "");
  assert.equal(toasts.at(-1).title, "头像上传失败，请稍后重试");
});

test("invalid nickname is explained on blur without writing cloud data", async () => {
  let updateCalls = 0;
  const { page, toasts } = loadProfileEditPage({
    accountService: {
      validateNickname: () => ({
        valid: false,
        value: "",
        message: "请输入昵称",
      }),
      updateAccountProfile: async () => {
        updateCalls += 1;
      },
    },
  });
  await page.onLoad();
  page.onNicknameInput({
    detail: { value: "" },
  });

  await page.onNicknameBlur();

  assert.equal(updateCalls, 0);
  assert.equal(page.data.formError, "请输入昵称");
  assert.equal(toasts.length, 0);
});
