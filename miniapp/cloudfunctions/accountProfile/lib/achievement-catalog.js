const ACHIEVEMENT_CATALOG_VERSION = 1;
const DEFAULT_ACHIEVEMENT_ID = "ordinary_user";

const ACHIEVEMENT_STATISTICS = Object.freeze({
  denominator: "active_user_count",
  denominator_label: "全部未注销用户",
  decimal_places: 2,
  cache_ttl_seconds: 900,
});

const ACHIEVEMENT_CATALOG = Object.freeze([
  Object.freeze({
    id: DEFAULT_ACHIEVEMENT_ID,
    title: "普通用户",
    description: "进入 Masterpiece，开始自己的艺术探索。",
    requirement: "所有用户默认拥有",
    grant_type: "default",
    rule_type: "always",
    metric: "",
    threshold: 0,
    display_order: 10,
  }),
  Object.freeze({
    id: "first_masterpiece",
    title: "初识名作",
    description: "收藏第一件打动你的作品。",
    requirement: "收藏1件作品",
    grant_type: "automatic",
    rule_type: "threshold",
    metric: "favorite_unique_count",
    threshold: 1,
    display_order: 20,
  }),
  Object.freeze({
    id: "treasure_with_care",
    title: "藏珍有道",
    description: "持续整理自己的私人艺术收藏。",
    requirement: "收藏20件不同作品",
    grant_type: "automatic",
    rule_type: "threshold",
    metric: "favorite_unique_count",
    threshold: 20,
    display_order: 30,
  }),
  Object.freeze({
    id: "artist_confidant",
    title: "画家知己",
    description: "关注不同画家，建立自己的艺术家名录。",
    requirement: "关注10位不同画家",
    grant_type: "automatic",
    rule_type: "threshold",
    metric: "followed_artist_unique_count",
    threshold: 10,
    display_order: 40,
  }),
  Object.freeze({
    id: "art_wanderer",
    title: "艺术漫游者",
    description: "浏览不同作品，拓展观看艺术的边界。",
    requirement: "浏览50件不同作品",
    grant_type: "automatic",
    rule_type: "threshold",
    metric: "history_unique_count",
    threshold: 50,
    display_order: 50,
  }),
  Object.freeze({
    id: "learned_all_ages",
    title: "博古通今",
    description: "为作品或画家资料提供经核实的有效纠错。",
    requirement: "提交的作品或画家纠错经人工核实",
    grant_type: "manual",
    rule_type: "verified_correction",
    metric: "",
    threshold: 0,
    display_order: 60,
  }),
]);

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function formatUnlockRate(unlockedCount, activeUserCount) {
  const denominator = nonNegativeInteger(activeUserCount);
  if (denominator === 0) return "0.00%";

  const numerator = Math.min(nonNegativeInteger(unlockedCount), denominator);
  const percentage = (numerator / denominator) * 100;
  return `${percentage.toFixed(ACHIEVEMENT_STATISTICS.decimal_places)}%`;
}

function findAchievementDefinition(id) {
  const normalizedId = typeof id === "string" ? id.trim() : "";
  return ACHIEVEMENT_CATALOG.find((item) => item.id === normalizedId) || null;
}

module.exports = {
  ACHIEVEMENT_CATALOG,
  ACHIEVEMENT_CATALOG_VERSION,
  ACHIEVEMENT_STATISTICS,
  DEFAULT_ACHIEVEMENT_ID,
  findAchievementDefinition,
  formatUnlockRate,
};
