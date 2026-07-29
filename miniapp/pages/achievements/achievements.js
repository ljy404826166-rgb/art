const {
  equipAchievement,
  loadAchievementState,
  readCachedAchievementState,
} = require("../../services/account");

const ACHIEVEMENT_ICONS = Object.freeze({
  ordinary_user: "/assets/icons/lucide/svg/medal-green.svg",
  first_masterpiece: "/assets/icons/lucide/svg/image.svg",
  treasure_with_care: "/assets/icons/lucide/svg/copy.svg",
  artist_confidant: "/assets/icons/lucide/svg/users.svg",
  art_wanderer: "/assets/icons/lucide/svg/compass.svg",
  learned_all_ages: "/assets/icons/lucide/svg/scroll-text.svg",
});

const ACHIEVEMENT_UNLOCKED_ICONS = Object.freeze({
  ordinary_user: "/assets/icons/lucide/svg/medal-green.svg",
  first_masterpiece: "/assets/icons/lucide/svg/image-green.svg",
  treasure_with_care: "/assets/icons/lucide/svg/copy-green.svg",
  artist_confidant: "/assets/icons/lucide/svg/users-green.svg",
  art_wanderer: "/assets/icons/lucide/svg/compass-green.svg",
  learned_all_ages: "/assets/icons/lucide/svg/scroll-text-green.svg",
});

const ACHIEVEMENT_PRESENTATION = Object.freeze({
  ordinary_user: Object.freeze({ requirement: "默认拥有" }),
  learned_all_ages: Object.freeze({
    requirement: "有效纠错经人工核实",
  }),
});

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function errorMessage(error, fallback) {
  return stringValue(error && (error.message || error.errMsg)) || fallback;
}

function progressPercentage(current, target) {
  const safeTarget = Math.max(1, Number(target) || 1);
  const safeCurrent = Math.max(0, Math.min(safeTarget, Number(current) || 0));
  return Number(((safeCurrent / safeTarget) * 100).toFixed(2));
}

function buildAchievementItem(item, equippingId = "") {
  const progress = item && item.progress ? item.progress : {};
  const current = Math.max(0, Math.floor(Number(progress.current) || 0));
  const target = Math.max(1, Math.floor(Number(progress.target) || 1));
  const equipped = item && item.equipped === true;
  const unlocked = item && item.unlocked === true;
  const manual = item && item.grant_type === "manual";
  const id = stringValue(item && item.id);
  const presentation = ACHIEVEMENT_PRESENTATION[id] || {};
  const equipInProgress = Boolean(equippingId);
  const equipping = id === equippingId;
  let statusText = "";
  let statusClass = "";
  let stateClass = "is-locked";
  let actionHint = "";

  if (equipped) {
    statusText = "已佩戴";
    statusClass = "is-equipped";
    stateClass = "is-equipped";
  } else if (unlocked) {
    statusText = "已达成";
    statusClass = "is-unlocked";
    stateClass = "is-unlocked";
    actionHint = equipping ? "佩戴中…" : "";
  } else if (manual) {
    stateClass = "is-locked is-manual";
  }

  return {
    id,
    title: stringValue(item && item.title),
    requirement: presentation.requirement || stringValue(item && item.requirement),
    icon: unlocked
      ? ACHIEVEMENT_UNLOCKED_ICONS[id] || "/assets/icons/lucide/svg/badge-check-green.svg"
      : ACHIEVEMENT_ICONS[id] || "/assets/icons/lucide/svg/badge-check.svg",
    unlocked,
    equipped,
    equipping,
    canEquip: unlocked && !equipped && !equipInProgress,
    stateClass,
    statusText,
    statusClass,
    actionHint,
    progressText: `${Math.min(current, target)}/${target}`,
    progressPercent: progressPercentage(current, target),
    unlockRate: stringValue(item && item.unlock_rate) || "0.00%",
    rateClass: manual ? "is-manual" : "",
    accessibleLabel: [
      stringValue(item && item.title),
      stringValue(item && item.requirement),
      equipped
        ? "当前佩戴"
        : unlocked
          ? "已获得，点击佩戴"
          : `未获得，当前进度${Math.min(current, target)}/${target}`,
      `已有${stringValue(item && item.unlock_rate) || "0.00%"}的用户获得`,
    ]
      .filter(Boolean)
      .join("，"),
  };
}

function buildAchievementView(state, options = {}) {
  const sourceItems = state && Array.isArray(state.items) ? state.items : [];
  const unlockedCount = sourceItems.filter((item) => item && item.unlocked === true).length;
  const totalCount = sourceItems.length;
  const progressPercent = progressPercentage(unlockedCount, totalCount);

  return {
    summary: {
      unlockedCount,
      totalCount,
      countText: `${unlockedCount}/${totalCount}`,
      progressPercent,
      progressLabel: `已获得${unlockedCount}个，共${totalCount}个头衔`,
    },
    sectionTitle: `首批${totalCount}个头衔`,
    items: sourceItems.map((item) => buildAchievementItem(item, options.equippingId)),
  };
}

Page({
  data: {
    loading: true,
    hasState: false,
    stale: false,
    errorMessage: "",
    equippingId: "",
    skeletonItems: [1, 2, 3, 4],
    summary: {
      unlockedCount: 0,
      totalCount: 0,
      countText: "0/0",
      progressPercent: 0,
      progressLabel: "暂未读取成就进度",
    },
    sectionTitle: "首批头衔",
    items: [],
  },

  onShow() {
    return this.refreshAchievements();
  },

  onUnload() {
    this._requestToken = (this._requestToken || 0) + 1;
  },

  applyAchievementState(state, options = {}) {
    this._achievementState = state;
    const equippingId = stringValue(options.equippingId);
    this.setData({
      ...buildAchievementView(state, { equippingId }),
      loading: false,
      hasState: true,
      stale: options.stale === true,
      errorMessage: stringValue(options.errorMessage),
      equippingId,
    });
  },

  refreshAchievements(options = {}) {
    const force = options.force === true;
    const cached = readCachedAchievementState();
    const token = (this._requestToken || 0) + 1;
    this._requestToken = token;

    if (cached) {
      this.applyAchievementState(cached);
    } else {
      this.setData({
        loading: true,
        hasState: false,
        stale: false,
        errorMessage: "",
      });
    }

    const request = loadAchievementState({ force });
    this._loadPromise = request;
    return request
      .then((state) => {
        if (token !== this._requestToken) return state;
        this.applyAchievementState(state);
        return state;
      })
      .catch((error) => {
        if (token !== this._requestToken) return null;
        const message = errorMessage(error, "成就数据暂时无法读取");
        if (this._achievementState) {
          this.applyAchievementState(this._achievementState, {
            stale: true,
            errorMessage: message,
          });
        } else {
          this.setData({
            loading: false,
            hasState: false,
            stale: false,
            errorMessage: message,
          });
        }
        return null;
      });
  },

  retryLoad() {
    if (this.data.loading) return this._loadPromise;
    return this.refreshAchievements({ force: true });
  },

  selectAchievement(event) {
    const achievementId = stringValue(
      event && event.currentTarget && event.currentTarget.dataset
        ? event.currentTarget.dataset.achievementId
        : "",
    );
    const item = this.data.items.find((candidate) => candidate.id === achievementId);
    if (!item || item.equipped || item.equipping) return Promise.resolve(null);
    if (!item.unlocked) {
      wx.showToast({
        title: "完成条件后即可获得",
        icon: "none",
      });
      return Promise.resolve(null);
    }
    if (this.data.equippingId) return Promise.resolve(null);

    this.applyAchievementState(this._achievementState, {
      equippingId: achievementId,
    });
    const request = equipAchievement({ achievementId });
    this._equipPromise = request;
    return request
      .then((state) => {
        this.applyAchievementState(state);
        wx.showToast({
          title: "头衔已佩戴",
          icon: "success",
        });
        return state;
      })
      .catch((error) => {
        this.applyAchievementState(this._achievementState);
        wx.showToast({
          title: errorMessage(error, "佩戴失败，请稍后重试"),
          icon: "none",
        });
        return null;
      })
      .finally(() => {
        this._equipPromise = null;
      });
  },
});

module.exports = {
  ACHIEVEMENT_ICONS,
  ACHIEVEMENT_PRESENTATION,
  buildAchievementItem,
  buildAchievementView,
  errorMessage,
  progressPercentage,
};
