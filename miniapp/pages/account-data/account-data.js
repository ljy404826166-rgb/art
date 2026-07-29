const {
  clearCachedAccountState,
  deactivateAccount,
  loadAccountState,
  readCachedAccountState,
} = require("../../services/account");
const {
  clearLocalHistoryArtworks,
  clearLocalPersonalLibrary,
  getLibraryStats,
} = require("../../services/local-library");
const { clearLocalSyncState } = require("../../services/library-sync-state");
const { suspendLibrarySyncForSession } = require("../../services/user-library-sync");

function confirmAction(options) {
  return new Promise((resolve) => {
    wx.showModal({
      title: options.title,
      content: options.content,
      confirmText: options.confirmText,
      confirmColor: options.confirmColor || "#111111",
      cancelText: "取消",
      success: (result) => resolve(Boolean(result && result.confirm)),
      fail: () => resolve(false),
    });
  });
}

function errorMessage(error, fallback) {
  return String((error && (error.message || error.errMsg)) || fallback).trim();
}

Page({
  data: {
    stats: {
      favorites: 0,
      followedArtists: 0,
      history: 0,
      downloads: 0,
    },
    accountDeactivated: false,
    busyAction: "",
  },

  onShow() {
    const state = readCachedAccountState();
    this.setData({
      stats: getLibraryStats(),
      accountDeactivated: state.status === "deactivated",
    });
    this._accountStatePromise = loadAccountState().then((nextState) => {
      this.setData({
        accountDeactivated: nextState.status === "deactivated",
      });
      return nextState;
    });
    return this._accountStatePromise;
  },

  clearLocalHistory() {
    return this.runConfirmedAction({
      action: "history",
      title: "清除本机浏览历史",
      content:
        "只清除当前设备上的浏览历史，不删除云端记录、其他设备数据或下载图片。下次重新同步时，云端历史可能恢复。",
      confirmText: "清除",
      execute: async () => {
        suspendLibrarySyncForSession();
        clearLocalHistoryArtworks();
      },
      successTitle: "本机历史已清除",
    });
  },

  clearLocalPersonalData() {
    return this.runConfirmedAction({
      action: "local",
      title: "清除本机个人数据",
      content:
        "将清除当前设备的账号与成就缓存、收藏、关注和浏览历史。云端头衔与其他数据、其他设备数据、下载记录及系统相册图片不受影响。",
      confirmText: "清除",
      execute: async () => {
        suspendLibrarySyncForSession();
        clearLocalPersonalLibrary();
        clearLocalSyncState();
        clearCachedAccountState();
      },
      successTitle: "本机个人数据已清除",
    });
  },

  deactivateCloudAccount() {
    if (this.data.accountDeactivated) return Promise.resolve(null);
    return this.runConfirmedAction({
      action: "deactivate",
      title: "确认注销账号",
      content:
        "注销后，云端头像昵称、收藏、关注、浏览历史、头衔与成就记录将被删除，且无法恢复。下载记录和系统相册图片仍保留在本机。",
      confirmText: "确认注销",
      confirmColor: "#ba1a1a",
      execute: async () => {
        await deactivateAccount();
        suspendLibrarySyncForSession();
        clearLocalPersonalLibrary();
        clearLocalSyncState();
        clearCachedAccountState();
        this.setData({ accountDeactivated: true });
      },
      successTitle: "账号已注销",
    });
  },

  runConfirmedAction(options) {
    if (this.data.busyAction) return Promise.resolve(null);
    return confirmAction(options).then((confirmed) => {
      if (!confirmed) return null;
      this.setData({ busyAction: options.action });
      return Promise.resolve()
        .then(options.execute)
        .then(() => {
          this.setData({ stats: getLibraryStats() });
          wx.showToast({
            title: options.successTitle,
            icon: "none",
          });
          return true;
        })
        .catch((error) => {
          wx.showToast({
            title: errorMessage(error, "操作失败，请稍后重试"),
            icon: "none",
          });
          return false;
        })
        .finally(() => {
          this.setData({ busyAction: "" });
        });
    });
  },
});

module.exports = {
  confirmAction,
  errorMessage,
};
