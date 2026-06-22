const { getLibraryStats } = require("../../services/local-library");

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

Page({
  data: {
    user: {
      name: "访客用户",
      role: "本地体验模式",
      avatarText: "艺",
    },
    stats: buildStats({ favorites: 0, followedArtists: 0, history: 0 }),
    sections: [
      {
        title: "账户与安全",
        items: [
          { label: "个人资料", icon: "/assets/icons/lucide/svg/user.svg", disabled: true },
          { label: "实名认证", icon: "/assets/icons/lucide/svg/badge-check.svg", disabled: true },
          { label: "安全中心", icon: "/assets/icons/lucide/svg/shield.svg", disabled: true },
        ],
      },
      {
        title: "收藏与管理",
        items: [
          { label: "我的收藏", icon: "/assets/icons/lucide/svg/heart.svg", route: "/pages/favorites/favorites" },
          { label: "关注画家", icon: "/assets/icons/lucide/svg/user.svg", route: "/pages/followed-artists/followed-artists" },
          { label: "浏览历史", icon: "/assets/icons/lucide/svg/book-open.svg", route: "/pages/history/history" },
          { label: "下载管理", icon: "/assets/icons/lucide/svg/download.svg", route: "/pages/downloads/downloads" },
          { label: "会员特权", icon: "/assets/icons/lucide/svg/star.svg", disabled: true },
        ],
      },
      {
        title: "系统设置",
        items: [
          { label: "偏好设置", icon: "/assets/icons/lucide/svg/settings.svg", disabled: true },
          { label: "帮助与反馈", icon: "/assets/icons/lucide/svg/circle-help.svg", disabled: true },
          { label: "关于 Art Archive", icon: "/assets/icons/lucide/svg/info.svg", disabled: true },
        ],
      },
    ],
  },

  onShow() {
    this.refreshStats();
  },

  refreshStats() {
    this.setData({
      stats: buildStats(getLibraryStats()),
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

  navigateToRoute(route) {
    if (!route) return;
    wx.navigateTo({ url: route });
  },

  handleLogout() {
    wx.showToast({
      title: "本地体验模式无需退出",
      icon: "none",
    });
  },
});
