import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadAccountDataPage({ confirm = true, deactivateFailure } = {}) {
  const source = readFileSync("miniapp/pages/account-data/account-data.js", "utf8");
  const module = { exports: {} };
  let page = null;
  const calls = [];
  const accountLoads = [];
  const toasts = [];
  let stats = {
    favorites: 2,
    followedArtists: 1,
    history: 3,
    downloads: 4,
  };
  const services = {
    account: {
      readCachedAccountState: () => ({
        status: "complete",
        profile: { id: "user-1" },
      }),
      loadAccountState: async (options) => {
        accountLoads.push(options);
        return {
          status: "complete",
          profile: { id: "user-1" },
        };
      },
      clearCachedAccountState() {
        calls.push("clear-account-cache");
      },
      async deactivateAccount() {
        calls.push("deactivate-cloud");
        if (deactivateFailure) throw deactivateFailure;
        return { deactivated: true };
      },
    },
    library: {
      getLibraryStats: () => ({ ...stats }),
      clearLocalHistoryArtworks() {
        calls.push("clear-history");
        stats = { ...stats, history: 0 };
      },
      clearLocalPersonalLibrary() {
        calls.push("clear-personal");
        stats = {
          ...stats,
          favorites: 0,
          followedArtists: 0,
          history: 0,
        };
      },
    },
    syncState: {
      clearLocalSyncState() {
        calls.push("clear-sync-state");
      },
    },
    sync: {
      suspendLibrarySyncForSession() {
        calls.push("suspend-sync");
      },
    },
  };

  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      Promise,
      String,
      Boolean,
      wx: {
        showModal(options) {
          options.success({ confirm });
        },
        showToast(options) {
          toasts.push(options);
        },
      },
      require(id) {
        if (id === "../../services/account") return services.account;
        if (id === "../../services/local-library") return services.library;
        if (id === "../../services/library-sync-state") return services.syncState;
        if (id === "../../services/user-library-sync") return services.sync;
        throw new Error(`Unexpected module: ${id}`);
      },
      Page(definition) {
        page = {
          ...definition,
          data: JSON.parse(JSON.stringify(definition.data)),
          setData(patch) {
            this.data = { ...this.data, ...patch };
          },
        };
      },
    },
    {
      filename: "miniapp/pages/account-data/account-data.js",
    },
  );

  return { accountLoads, calls, page, toasts };
}

test("account data page reuses a fresh account cache on repeated entry", async () => {
  const { accountLoads, page } = loadAccountDataPage();

  await page.onShow();
  await page.onShow();

  assert.equal(accountLoads.length, 2);
  assert.equal(
    accountLoads.every((options) => !options || !options.force),
    true,
  );
});

test("local personal cleanup preserves download records and never calls cloud deletion", async () => {
  const { calls, page } = loadAccountDataPage();
  await page.onShow();

  await page.clearLocalPersonalData();

  assert.deepEqual(calls, [
    "suspend-sync",
    "clear-personal",
    "clear-sync-state",
    "clear-account-cache",
  ]);
  assert.equal(page.data.stats.downloads, 4);
  assert.equal(page.data.stats.favorites, 0);
  assert.equal(calls.includes("deactivate-cloud"), false);
});

test("account deactivation succeeds in cloud before local cleanup", async () => {
  const { calls, page, toasts } = loadAccountDataPage();
  await page.onShow();

  await page.deactivateCloudAccount();

  assert.equal(calls[0], "deactivate-cloud");
  assert.deepEqual(calls.slice(1), [
    "suspend-sync",
    "clear-personal",
    "clear-sync-state",
    "clear-account-cache",
  ]);
  assert.equal(page.data.accountDeactivated, true);
  assert.equal(page.data.busyAction, "");
  assert.equal(toasts.at(-1).title, "账号已注销");
});

test("cancelled destructive actions leave all data untouched", async () => {
  const { calls, page } = loadAccountDataPage({ confirm: false });
  await page.onShow();

  await page.clearLocalHistory();

  assert.deepEqual(calls, []);
  assert.equal(page.data.stats.history, 3);
});

test("account page makes every destructive boundary explicit", () => {
  const template = readFileSync("miniapp/pages/account-data/account-data.wxml", "utf8");
  const styles = readFileSync("miniapp/pages/account-data/account-data.wxss", "utf8");

  assert.match(template, /<text class="intro-title">当前设备<\/text>/);
  assert.match(template, /<text class="section-title">清除数据<\/text>/);
  assert.match(template, /清除本机个人数据/);
  assert.match(template, /成就缓存/);
  assert.match(template, /注销账号/);
  assert.match(template, /再次登录需重新注册/);
  assert.match(template, /triangle-alert\.svg/);
  assert.match(template, /系统相册/);
  assert.doesNotMatch(template, /class="footnote"/);
  assert.doesNotMatch(template, /sync-card|自动同步已启用/);
  assert.doesNotMatch(template, /清除本机浏览历史/);
  assert.doesNotMatch(template, /同步开关|开启同步|关闭同步/);
  assert.match(styles, /\.action-card\s*\{[^}]*border-radius:\s*48rpx;/s);
  assert.match(styles, /\.action-title\s*\{[^}]*white-space:\s*nowrap;/s);
  assert.match(styles, /\.action-button\s*\{[^}]*width:\s*152rpx;/s);
  assert.match(styles, /\.action-button\s*\{[^}]*flex:\s*0 0 152rpx;/s);
  assert.match(styles, /\.danger-card\s*\{[^}]*background:\s*rgba\(255, 218, 214, 0\.2\);/s);
  assert.match(styles, /\.danger-button\s*\{[^}]*width:\s*300rpx;/s);
  assert.match(styles, /\.danger-button\s*\{[^}]*min-height:\s*88rpx;/s);
  assert.match(styles, /\.danger-button\s*\{[^}]*justify-self:\s*center;/s);
  assert.match(styles, /\.danger-watermark\s*\{[^}]*opacity:\s*0\.05;/s);
});
