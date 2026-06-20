const {
  clearHistoryArtworks,
  getHistoryArtworks,
} = require("../../services/local-library");

Page({
  data: {
    artworks: [],
  },

  onShow() {
    this.refreshHistory();
  },

  refreshHistory() {
    this.setData({
      artworks: getHistoryArtworks(),
    });
  },

  clearHistory() {
    if (this.data.artworks.length === 0) return;
    wx.showModal({
      title: "清空浏览历史",
      content: "清空后，本机浏览历史将无法恢复。",
      confirmText: "清空",
      confirmColor: "#111111",
      success: (result) => {
        if (!result.confirm) return;
        clearHistoryArtworks();
        this.refreshHistory();
      },
    });
  },

  openArtwork(event) {
    const { id, ratio } = event.detail || {};
    if (!id) return;
    const ratioValue = Number(ratio || 0);
    const ratioParam = ratioValue > 0 ? `&ratio=${encodeURIComponent(ratioValue)}` : "";
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}${ratioParam}`,
    });
  },
});
