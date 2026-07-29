import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadProfilePage({ accountService, stats } = {}) {
  const filename = fileURLToPath(new URL("./profile.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  let page = null;
  const module = { exports: {} };
  const service = {
    DEFAULT_ACHIEVEMENT_TITLE: "普通用户",
    guestState: () => ({
      status: "guest",
      profile: null,
      source: "local",
      cachedAt: 0,
      errorCode: "",
      errorMessage: "",
    }),
    readCachedAccountState: () => ({
      status: "guest",
      profile: null,
      source: "local",
      cachedAt: 0,
      errorCode: "",
      errorMessage: "",
    }),
    loadAccountState: async () => ({
      status: "identified",
      profile: {
        id: "user-1",
        nickname: "",
        avatar_url: "",
        profile_completed: false,
      },
      source: "cloud",
      cachedAt: 1000,
      errorCode: "",
      errorMessage: "",
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
        if (id === "../../services/local-library") {
          return {
            getLibraryStats: () =>
              stats || {
                favorites: 2,
                followedArtists: 3,
                history: 4,
              },
          };
        }
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
        navigateTo() {},
        showToast() {},
      },
      console,
    },
    { filename },
  );

  return {
    page,
    helpers: module.exports,
  };
}

test("profile page renders local stats before cloud identity resolves", async () => {
  let resolveAccount;
  const accountPromise = new Promise((resolve) => {
    resolveAccount = resolve;
  });
  const { page } = loadProfilePage({
    accountService: {
      loadAccountState: () => accountPromise,
    },
  });

  page.onShow();

  assert.equal(page.data.stats[0].value, "2");
  assert.equal(page.data.stats[1].value, "3");
  assert.equal(page.data.stats[2].value, "4");
  assert.equal(page.data.accountStatus, "identifying");
  assert.equal(page.data.user.statusLabel, "连接中");

  resolveAccount({
    status: "identified",
    profile: {
      id: "user-1",
      nickname: "",
      avatar_url: "",
      profile_completed: false,
    },
    source: "cloud",
    cachedAt: 1000,
    errorCode: "",
    errorMessage: "",
  });
  await page._accountLoadPromise;
  await Promise.resolve();

  assert.equal(page.data.accountStatus, "identified");
  assert.equal(page.data.user.name, "微信用户");
  assert.equal(page.data.user.statusLabel, "已登录");
  assert.equal(page.data.user.role, "");
});

test("cached identity is visible immediately without a loading reset", () => {
  const { page } = loadProfilePage({
    accountService: {
      readCachedAccountState: () => ({
        status: "complete",
        profile: {
          id: "user-1",
          nickname: "莫奈",
          avatar_url: "cloud://avatar.jpg",
          profile_completed: true,
          equipped_title: {
            id: "artist_confidant",
            title: "画家知己",
          },
        },
        source: "cache",
        cachedAt: 1000,
        errorCode: "",
        errorMessage: "",
      }),
      loadAccountState: async () => ({
        status: "complete",
        profile: {
          id: "user-1",
          nickname: "莫奈",
          avatar_url: "cloud://avatar.jpg",
          profile_completed: true,
          equipped_title: {
            id: "artist_confidant",
            title: "画家知己",
          },
        },
        source: "cache",
        cachedAt: 1000,
        errorCode: "",
        errorMessage: "",
      }),
    },
  });

  page.onShow();

  assert.equal(page.data.accountStatus, "complete");
  assert.equal(page.data.user.name, "莫奈");
  assert.equal(page.data.user.avatarUrl, "cloud://avatar.jpg");
  assert.equal(page.data.user.statusLabel, "已登录");
  assert.equal(page.data.user.role, "");
  assert.equal(page.data.user.achievementTitle, "画家知己");
  assert.equal(page.data.user.isDefaultAchievementTitle, false);
  assert.equal(page.data.user.loading, false);
});

test("retry forces a fresh account request", async () => {
  const calls = [];
  const { page } = loadProfilePage({
    accountService: {
      readCachedAccountState: () => ({
        status: "offline",
        profile: null,
        source: "local",
        cachedAt: 0,
        errorCode: "NETWORK_FAIL",
        errorMessage: "offline",
      }),
      loadAccountState: async (options) => {
        calls.push(options);
        return {
          status: "error",
          profile: null,
          source: "local",
          cachedAt: 0,
          errorCode: "ACCOUNT_REQUEST_FAILED",
          errorMessage: "failed",
        };
      },
    },
  });

  await page.retryAccount();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].force, true);
});

test("profile menus remove misleading account features", () => {
  const { helpers } = loadProfilePage();
  const sections = helpers.buildSections();
  const labels = sections.flatMap((section) => section.items.map((item) => item.label));

  assert.equal(sections[0].title, "账户与数据");
  assert.equal(labels.includes("实名认证"), false);
  assert.equal(labels.includes("会员特权"), false);
  assert.equal(labels.includes("安全中心"), false);
  assert.equal(labels.includes("数据同步"), false);
  assert.equal(labels.includes("偏好设置"), false);
  assert.equal(labels.includes("隐私与授权"), false);
  assert.equal(labels.includes("账号与数据"), true);
  assert.equal(labels.includes("头衔与成就"), true);
  assert.equal(labels.includes("关于 Masterpiece"), true);
  assert.equal(labels.includes("关于 Art Archive"), false);
  const accountData = sections[0].items.find((item) => item.label === "账号与数据");
  const achievements = sections[0].items.find((item) => item.label === "头衔与成就");
  assert.equal(accountData.route, "/pages/account-data/account-data");
  assert.equal(accountData.disabled, undefined);
  assert.equal(achievements.route, "/pages/achievements/achievements");
  assert.equal(achievements.disabled, undefined);
  const help = sections[2].items.find((item) => item.label === "帮助与反馈");
  assert.equal(help.route, "/pages/help/help");
  assert.equal(help.disabled, undefined);
  const about = sections[2].items.find((item) => item.label === "关于 Masterpiece");
  assert.equal(about.route, "/pages/about/about");
  assert.equal(about.disabled, undefined);
  assert.equal(sections[2].items.length, 2);
  assert.equal(
    sections.flatMap((section) => section.items).some((item) => item.disabled === true),
    false,
  );
  const personalProfile = sections[0].items.find((item) => item.label === "个人资料");
  assert.equal(personalProfile.disabled, undefined);
  assert.equal(personalProfile.route, "/pages/profile-edit/profile-edit");
});

test("profile template supports menu navigation and removes fake logout", () => {
  const template = readFileSync(fileURLToPath(new URL("./profile.wxml", import.meta.url)), "utf8");

  assert.match(template, /openMenuItem/);
  assert.match(template, /bindtap="retryAccount"/);
  assert.match(template, /bindtap="openAchievements"/);
  assert.match(template, /aria-role="button"/);
  assert.doesNotMatch(template, /<button[^>]*class="profile-title-link"/);
  assert.match(
    template,
    /class="profile-title-link profile-kicker \{\{user\.isDefaultAchievementTitle/,
  );
  assert.match(template, /class="profile-kicker-text"/);
  assert.match(template, /\{\{user\.achievementTitle\}\}/);
  assert.match(template, /user\.isDefaultAchievementTitle/);
  const styles = readFileSync(fileURLToPath(new URL("./profile.wxss", import.meta.url)), "utf8");
  assert.match(template, /class="profile-hero/);
  assert.match(template, /class="avatar"/);
  assert.match(template, /chevron-right\.svg/);
  assert.match(styles, /\.profile-page\s*\{[^}]*padding:\s*32rpx 40rpx 176rpx;/s);
  assert.match(
    styles,
    /\.profile-hero\s*\{[^}]*display:\s*flex;[^}]*gap:\s*32rpx;[^}]*align-items:\s*center;[^}]*border-radius:\s*48rpx;/s,
  );
  assert.match(
    styles,
    /\.profile-state\s*\{[^}]*top:\s*50%;[^}]*transform:\s*translateY\(-50%\);/s,
  );
  assert.match(
    styles,
    /\.profile-copy\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 1 auto;[^}]*align-items:\s*flex-start;[^}]*gap:\s*8rpx;/s,
  );
  assert.match(
    styles,
    /\.profile-title-link\s*\{[^}]*display:\s*inline-flex;[^}]*box-sizing:\s*border-box;[^}]*flex:\s*0 0 auto;[^}]*width:\s*auto;[^}]*min-height:\s*40rpx;[^}]*align-self:\s*flex-start;[^}]*padding:\s*0;/s,
  );
  assert.match(
    styles,
    /\.profile-kicker\s*\{[^}]*border-radius:\s*8rpx;[^}]*padding:\s*4rpx 16rpx;[^}]*font-size:\s*24rpx;[^}]*letter-spacing:\s*2\.4rpx;[^}]*line-height:\s*32rpx;/s,
  );
  assert.match(
    styles,
    /\.profile-kicker-text\s*\{[^}]*display:\s*block;[^}]*line-height:\s*32rpx;/s,
  );
  assert.match(
    styles,
    /\.profile-kicker\.is-earned\s*\{[^}]*color:\s*#07c160;[^}]*background:\s*#e7f8ed;/s,
  );
  assert.match(
    styles,
    /\.avatar\s*\{[^}]*box-sizing:\s*border-box;[^}]*flex:\s*0 0 160rpx;[^}]*width:\s*160rpx;[^}]*height:\s*160rpx;/s,
  );
  assert.match(
    styles,
    /\.profile-name\s*\{[^}]*display:\s*block;[^}]*font-size:\s*56rpx;[^}]*line-height:\s*64rpx;/s,
  );
  assert.match(styles, /\.stat-card\s*\{[^}]*border-radius:\s*48rpx;/s);
  assert.match(styles, /\.menu-card\s*\{[^}]*border-radius:\s*48rpx;/s);
  assert.match(styles, /\.menu-row\s*\{[^}]*min-height:\s*108rpx;/s);
  assert.match(styles, /\.menu-row::after/);
  assert.match(styles, /\.menu-row:last-child::after/);
  assert.doesNotMatch(template, /退出登录|handleLogout/);
});
