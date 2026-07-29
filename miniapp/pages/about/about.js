function applicationMeta() {
  const app = typeof getApp === "function" ? getApp() : null;
  const globalData =
    app && app.globalData && typeof app.globalData === "object" ? app.globalData : {};
  return {
    name: String(globalData.appName || "Masterpiece"),
    version: String(globalData.appVersion || "0.1.0"),
    year: new Date().getFullYear(),
  };
}

const LEGAL_ITEMS = [
  {
    id: "content",
    title: "内容与资料说明",
  },
  {
    id: "copyright",
    title: "版权与来源说明",
  },
  {
    id: "disclaimer",
    title: "免责声明",
  },
  {
    id: "agreement",
    title: "用户协议",
  },
];

Page({
  data: {
    app: applicationMeta(),
    legalItems: LEGAL_ITEMS,
  },

  openLegalDocument(event) {
    const id = String(
      event && event.currentTarget && event.currentTarget.dataset
        ? event.currentTarget.dataset.id || ""
        : "",
    );
    if (!LEGAL_ITEMS.some((item) => item.id === id)) return;
    wx.navigateTo({
      url: `/pages/legal/legal?document=${encodeURIComponent(id)}`,
    });
  },
});

module.exports = {
  LEGAL_ITEMS,
  applicationMeta,
};
