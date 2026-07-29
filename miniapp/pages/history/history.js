const { clearLocalHistoryArtworks, getHistoryArtworks } = require("../../services/local-library");
const { suspendLibrarySyncForSession } = require("../../services/user-library-sync");

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
      content:
        "只清除当前设备上的浏览历史，不影响云端、其他设备或下载图片。重新进入小程序并同步后，云端历史可能恢复。",
      confirmText: "清空",
      confirmColor: "#111111",
      success: (result) => {
        if (!result.confirm) return;
        suspendLibrarySyncForSession();
        clearLocalHistoryArtworks();
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
