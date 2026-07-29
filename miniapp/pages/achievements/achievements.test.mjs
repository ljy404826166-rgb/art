import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function achievementState({
  equippedId = "ordinary_user",
  unlockedIds = ["ordinary_user", "first_masterpiece"],
} = {}) {
  const definitions = [
    ["ordinary_user", "普通用户", "所有用户默认拥有", "default", 1, 1, "100.00%"],
    ["first_masterpiece", "初识名作", "收藏1件作品", "automatic", 1, 1, "85.00%"],
    ["treasure_with_care", "藏珍有道", "收藏20件不同作品", "automatic", 8, 20, "12.00%"],
    ["artist_confidant", "画家知己", "关注10位不同画家", "automatic", 3, 10, "18.00%"],
    ["art_wanderer", "艺术漫游者", "浏览50件不同作品", "automatic", 12, 50, "25.00%"],
    ["learned_all_ages", "博古通今", "有效纠错经人工核实", "manual", 0, 1, "2.00%"],
  ];
  return {
    catalog_version: 1,
    equipped_title: {
      id: equippedId,
      title: definitions.find(([id]) => id === equippedId)?.[1] || "普通用户",
    },
    active_user_count: 100,
    statistics_updated_at: null,
    items: definitions.map(([id, title, requirement, grantType, current, target, rate]) => ({
      id,
      title,
      description: "",
      requirement,
      grant_type: grantType,
      unlocked: unlockedIds.includes(id),
      equipped: equippedId === id,
      unlocked_at: unlockedIds.includes(id) ? 1000 : null,
      progress: { current, target },
      unlocked_user_count: Number.parseInt(rate, 10),
      unlock_rate: rate,
    })),
  };
}

function loadAchievementsPage({
  cachedState = null,
  cloudState = achievementState(),
  cloudFailure = null,
  equippedState = null,
} = {}) {
  const filename = fileURLToPath(new URL("./achievements.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };
  const loadCalls = [];
  const equipCalls = [];
  const toasts = [];
  let page = null;

  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      Promise,
      Number,
      Math,
      String,
      require(id) {
        assert.equal(id, "../../services/account");
        return {
          readCachedAchievementState: () => cachedState,
          loadAchievementState: async (options) => {
            loadCalls.push(options);
            if (cloudFailure) throw cloudFailure;
            return cloudState;
          },
          equipAchievement: async (options) => {
            equipCalls.push(options);
            return (
              equippedState ||
              achievementState({
                equippedId: options.achievementId,
              })
            );
          },
        };
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
      },
    },
    { filename },
  );

  return {
    equipCalls,
    helpers: module.exports,
    loadCalls,
    page,
    toasts,
  };
}

test("achievement view maps summary, progress, rates, and controlled icons", () => {
  const { helpers } = loadAchievementsPage();
  const view = helpers.buildAchievementView(achievementState());

  assert.equal(view.summary.countText, "2/6");
  assert.equal(view.summary.progressPercent, 33.33);
  assert.equal(view.sectionTitle, "首批6个头衔");
  assert.equal(view.items[0].statusText, "已佩戴");
  assert.equal(view.items[1].statusText, "已达成");
  assert.equal(view.items[1].canEquip, true);
  assert.equal(view.items[0].requirement, "默认拥有");
  assert.equal(view.items[2].statusText, "");
  assert.equal(view.items[2].actionHint, "");
  assert.equal(view.items[2].unlockRate, "12.00%");
  assert.equal(view.items[5].statusText, "");
  assert.equal(view.items[5].requirement, "有效纠错经人工核实");
  assert.match(view.items[0].icon, /medal-green\.svg$/);
  assert.match(view.items[1].icon, /image-green\.svg$/);
  assert.match(view.items[2].icon, /copy\.svg$/);
  assert.match(view.items[5].accessibleLabel, /未获得/);
});

test("cached achievement state renders before the cloud refresh completes", async () => {
  const cached = achievementState({
    unlockedIds: ["ordinary_user"],
  });
  const cloud = achievementState();
  const { page } = loadAchievementsPage({
    cachedState: cached,
    cloudState: cloud,
  });

  const request = page.onShow();
  assert.equal(page.data.hasState, true);
  assert.equal(page.data.summary.countText, "1/6");

  await request;
  assert.equal(page.data.summary.countText, "2/6");
  assert.equal(page.data.loading, false);
});

test("an unlocked title can be equipped and updates the visible state", async () => {
  const equipped = achievementState({
    equippedId: "first_masterpiece",
  });
  const { equipCalls, page, toasts } = loadAchievementsPage({
    equippedState: equipped,
  });
  await page.onShow();

  await page.selectAchievement({
    currentTarget: {
      dataset: { achievementId: "first_masterpiece" },
    },
  });

  assert.equal(equipCalls.length, 1);
  assert.equal(equipCalls[0].achievementId, "first_masterpiece");
  assert.equal(page.data.items[1].equipped, true);
  assert.equal(page.data.items[1].statusText, "已佩戴");
  assert.equal(toasts.at(-1).title, "头衔已佩戴");
});

test("a locked title explains the requirement without calling equip", async () => {
  const { equipCalls, page, toasts } = loadAchievementsPage();
  await page.onShow();

  await page.selectAchievement({
    currentTarget: {
      dataset: { achievementId: "treasure_with_care" },
    },
  });

  assert.equal(equipCalls.length, 0);
  assert.equal(toasts.at(-1).title, "完成条件后即可获得");
});

test("cloud failure keeps cached achievements and exposes a retry state", async () => {
  const { page } = loadAchievementsPage({
    cachedState: achievementState(),
    cloudFailure: new Error("网络不可用"),
  });

  await page.onShow();

  assert.equal(page.data.hasState, true);
  assert.equal(page.data.stale, true);
  assert.equal(page.data.errorMessage, "网络不可用");
});

test("achievement template matches the supplied card design and accessibility contract", () => {
  const template = readFileSync(
    fileURLToPath(new URL("./achievements.wxml", import.meta.url)),
    "utf8",
  );
  const styles = readFileSync(
    fileURLToPath(new URL("./achievements.wxss", import.meta.url)),
    "utf8",
  );
  const config = JSON.parse(
    readFileSync(fileURLToPath(new URL("./achievements.json", import.meta.url)), "utf8"),
  );

  assert.equal(config.navigationBarTitleText, "我的成就");
  assert.match(template, /成就进度/);
  assert.match(template, /集齐名头，点亮艺术人生/);
  assert.match(template, /summary\.progressPercent/);
  assert.match(template, /item\.unlockRate/);
  assert.match(template, /bindtap="selectAchievement"/);
  assert.match(template, /aria-role="button"/);
  assert.doesNotMatch(template, /<button[^>]*wx:for="\{\{items\}\}"/);
  assert.match(template, /aria-label="\{\{item\.accessibleLabel\}\}"/);
  assert.match(template, /统计，数据可能存在短暂延迟/);
  assert.match(styles, /\.summary-card\s*\{[^}]*border-radius:\s*48rpx;/s);
  assert.match(styles, /\.achievement-card\s*\{[^}]*min-height:\s*192rpx;/s);
  assert.match(styles, /\.achievement-list\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*stretch;/s);
  assert.match(styles, /\.achievement-card\s*\{[^}]*display:\s*flex;[^}]*align-self:\s*stretch;/s);
  assert.match(styles, /\.achievement-copy\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;/s);
  assert.match(template, /class="achievement-status-label"/);
  assert.match(
    styles,
    /\.achievement-status\s*\{[^}]*display:\s*flex;[^}]*width:\s*88rpx;[^}]*height:\s*36rpx;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/s,
  );
  assert.match(
    styles,
    /\.achievement-status-label\s*\{[^}]*font-size:\s*20rpx;[^}]*line-height:\s*24rpx;[^}]*text-align:\s*center;/s,
  );
  assert.match(
    styles,
    /\.achievement-card\.is-unlocked \.achievement-icon-wrap,[\s\S]*background:\s*#e7f8ed;/,
  );
  assert.match(styles, /\.achievement-card\.is-equipped\s*\{[^}]*border-color:\s*#07c160;/s);
  assert.match(styles, /\.retry-button\s*\{[^}]*min-height:\s*88rpx;/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
