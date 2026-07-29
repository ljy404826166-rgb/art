function callWxApi(api, options = {}) {
  return new Promise((resolve, reject) => {
    if (typeof api !== "function") {
      const error = new Error("当前微信版本暂不支持此功能");
      error.code = "PRIVACY_API_UNAVAILABLE";
      reject(error);
      return;
    }
    api({
      ...options,
      success: resolve,
      fail: reject,
    });
  });
}

function privacyStatus(result) {
  if (!result || typeof result !== "object") {
    return {
      label: "按需授权",
      hint: "仅在你主动选择头像等功能时申请必要权限",
    };
  }
  return result.needAuthorization === true
    ? {
        label: "待确认",
        hint: "使用涉及个人信息的功能前，微信会展示隐私保护提示",
      }
    : {
        label: "已就绪",
        hint: "隐私保护指引可随时从本页重新查看",
      };
}

Page({
  data: {
    privacyState: privacyStatus(null),
    loadingSetting: true,
    openingContract: false,
    dataGroups: [
      {
        title: "头像与昵称",
        icon: "/assets/icons/lucide/svg/user.svg",
        purpose: "仅用于本小程序内展示个人资料。",
        storage: "由你主动选择后保存到微信云开发；公共浏览无需提供。",
      },
      {
        title: "收藏与关注",
        icon: "/assets/icons/lucide/svg/heart.svg",
        purpose: "用于保存喜欢的作品和关注的画家。",
        storage: "先保存在本机，再按当前微信身份自动同步到云端。",
      },
      {
        title: "浏览历史",
        icon: "/assets/icons/lucide/svg/book-open.svg",
        purpose: "用于帮助你找回最近浏览过的作品。",
        storage: "在本机记录，并在同一微信账号的设备间自动同步。",
      },
      {
        title: "头衔与成就",
        icon: "/assets/icons/lucide/svg/badge-check.svg",
        purpose: "用于记录已获得的头衔、成就进度和当前佩戴头衔。",
        storage: "保存到微信云开发，并在同一微信账号的设备间同步。",
      },
      {
        title: "下载记录",
        icon: "/assets/icons/lucide/svg/download.svg",
        purpose: "用于展示本机已执行的下载操作。",
        storage: "下载清单只保存在当前设备；云端仅保存数量摘要，系统相册图片不会上传。",
      },
    ],
  },

  onLoad() {
    return this.refreshPrivacySetting();
  },

  refreshPrivacySetting() {
    if (typeof wx === "undefined" || typeof wx.getPrivacySetting !== "function") {
      this.setData({
        loadingSetting: false,
        privacyState: privacyStatus(null),
      });
      return Promise.resolve(null);
    }
    return callWxApi(wx.getPrivacySetting.bind(wx))
      .then((result) => {
        this.setData({
          loadingSetting: false,
          privacyState: privacyStatus(result),
        });
        return result;
      })
      .catch(() => {
        this.setData({
          loadingSetting: false,
          privacyState: privacyStatus(null),
        });
        return null;
      });
  },

  openPrivacyContract() {
    if (this.data.openingContract) return this._contractPromise;
    if (typeof wx.openPrivacyContract !== "function") {
      wx.showToast({
        title: "请升级微信后查看",
        icon: "none",
      });
      return Promise.resolve(null);
    }
    this.setData({ openingContract: true });
    this._contractPromise = callWxApi(wx.openPrivacyContract.bind(wx))
      .catch(() => {
        wx.showToast({
          title: "隐私指引暂无法打开",
          icon: "none",
        });
        return null;
      })
      .finally(() => {
        this._contractPromise = null;
        this.setData({ openingContract: false });
      });
    return this._contractPromise;
  },
});

module.exports = {
  callWxApi,
  privacyStatus,
};
