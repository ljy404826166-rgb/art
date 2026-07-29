const { getLibraryStats } = require("../../services/local-library");
const {
  DEFAULT_ACHIEVEMENT_TITLE,
  guestState,
  loadAccountState,
  readCachedAccountState,
} = require("../../services/account");

function buildStats(stats) {
  return [
    {
      label: "我的收藏",
      value: String(stats.favorites),
      route: "/pages/favorites/favorites",
    },
    {
      label: "关注画家",
      value: String(stats.followedArtists),
      route: "/pages/followed-artists/followed-artists",
    },
    {
      label: "浏览历史",
      value: String(stats.history),
      route: "/pages/history/history",
    },
  ];
}

function buildSections() {
  return [
    {
      title: "账户与数据",
      items: [
        {
          label: "个人资料",
          icon: "/assets/icons/lucide/svg/user.svg",
          route: "/pages/profile-edit/profile-edit",
        },
        {
          label: "头衔与成就",
          icon: "/assets/icons/lucide/svg/badge-check.svg",
          route: "/pages/achievements/achievements",
        },
        {
          label: "账号与数据",
          icon: "/assets/icons/lucide/svg/settings.svg",
          route: "/pages/account-data/account-data",
        },
      ],
    },
    {
      title: "收藏与管理",
      items: [
        {
          label: "我的收藏",
          icon: "/assets/icons/lucide/svg/heart.svg",
          route: "/pages/favorites/favorites",
        },
        {
          label: "关注画家",
          icon: "/assets/icons/lucide/svg/user.svg",
          route: "/pages/followed-artists/followed-artists",
        },
        {
          label: "浏览历史",
          icon: "/assets/icons/lucide/svg/book-open.svg",
          route: "/pages/history/history",
        },
        {
          label: "下载管理",
          icon: "/assets/icons/lucide/svg/download.svg",
          route: "/pages/downloads/downloads",
        },
      ],
    },
    {
      title: "系统设置",
      items: [
        {
          label: "帮助与反馈",
          icon: "/assets/icons/lucide/svg/circle-help.svg",
          route: "/pages/help/help",
        },
        {
          label: "关于 Masterpiece",
          icon: "/assets/icons/lucide/svg/info.svg",
          route: "/pages/about/about",
        },
      ],
    },
  ];
}

function firstAvatarCharacter(name) {
  const value = String(name || "").trim();
  return value ? Array.from(value)[0] : "艺";
}

function buildAccountView(state) {
  const accountState = state || guestState();
  const profile = accountState.profile || null;
  const nickname = profile && profile.nickname ? profile.nickname : "";
  const defaultAchievementTitle = DEFAULT_ACHIEVEMENT_TITLE || "普通用户";
  const equippedTitle =
    profile && profile.equipped_title && profile.equipped_title.title
      ? profile.equipped_title.title
      : defaultAchievementTitle;
  const hasProfile = Boolean(profile);
  const name = nickname || (hasProfile ? "微信用户" : "访客用户");

  const view = {
    status: accountState.status,
    name,
    achievementTitle: equippedTitle,
    isDefaultAchievementTitle: equippedTitle === defaultAchievementTitle,
    role: "数据仅保存在当前设备",
    avatarText: firstAvatarCharacter(name),
    avatarUrl: profile && profile.avatar_url ? profile.avatar_url : "",
    statusLabel: "本地",
    showRetry: false,
    loading: false,
  };

  if (accountState.status === "identifying") {
    view.role = hasProfile ? "正在刷新账号状态…" : "正在建立微信身份…";
    view.statusLabel = "连接中";
    view.loading = true;
  } else if (accountState.status === "identified") {
    view.role = "";
    view.statusLabel = "已登录";
  } else if (accountState.status === "complete") {
    view.role = "";
    view.statusLabel = "已登录";
  } else if (accountState.status === "offline") {
    view.role = hasProfile ? "云端暂不可用 · 显示本地资料" : "云端暂不可用 · 使用本地数据";
    view.statusLabel = "离线";
    view.showRetry = true;
  } else if (accountState.status === "error") {
    view.role = hasProfile ? "账号刷新失败 · 显示本地资料" : "账号服务暂不可用 · 使用本地数据";
    view.statusLabel = "本地";
    view.showRetry = true;
  } else if (accountState.status === "deactivated") {
    view.name = "账号已注销";
    view.role = "云端个人数据已删除";
    view.avatarText = "艺";
    view.avatarUrl = "";
    view.statusLabel = "已注销";
    view.achievementTitle = "普通用户";
    view.isDefaultAchievementTitle = true;
  }

  return view;
}

Page({
  data: {
    accountStatus: "guest",
    user: buildAccountView(guestState()),
    stats: buildStats({ favorites: 0, followedArtists: 0, history: 0 }),
    sections: buildSections(),
  },

  onShow() {
    this.refreshStats();
    this.refreshAccount();
  },

  onUnload() {
    this._accountRequestToken = (this._accountRequestToken || 0) + 1;
  },

  refreshStats() {
    this.setData({
      stats: buildStats(getLibraryStats()),
    });
  },

  refreshAccount(options = {}) {
    const force = options.force === true;
    const cached = readCachedAccountState();
    const token = (this._accountRequestToken || 0) + 1;
    this._accountRequestToken = token;

    if (force || cached.status === "guest") {
      this.applyAccountState({
        ...cached,
        status: "identifying",
      });
    } else {
      this.applyAccountState(cached);
    }

    const request = loadAccountState({ force });
    this._accountLoadPromise = request;

    request.then((state) => {
      if (token !== this._accountRequestToken) return;
      this.applyAccountState(state);
    });

    return request;
  },

  applyAccountState(state) {
    this.setData({
      accountStatus: state.status,
      user: buildAccountView(state),
    });
  },

  retryAccount() {
    if (this.data.user.loading) return;
    return this.refreshAccount({ force: true }).then((state) => {
      if (state.status === "offline" || state.status === "error") {
        wx.showToast({
          title: "账号服务暂不可用",
          icon: "none",
        });
      }
    });
  },

  openStat(event) {
    const { route } = event.currentTarget.dataset || {};
    this.navigateToRoute(route);
  },

  openMenuItem(event) {
    const { route, disabled } = event.currentTarget.dataset || {};
    if (disabled) {
      wx.showToast({
        title: "暂未开放",
        icon: "none",
      });
      return;
    }
    this.navigateToRoute(route);
  },

  openAchievements() {
    this.navigateToRoute("/pages/achievements/achievements");
  },

  navigateToRoute(route) {
    if (!route) return;
    wx.navigateTo({ url: route });
  },
});

module.exports = {
  buildAccountView,
  buildSections,
  buildStats,
  firstAvatarCharacter,
};
