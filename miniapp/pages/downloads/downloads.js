const {
  clearDownloadArtworks,
  getDownloadArtworks,
} = require("../../services/local-library");

Page({
  data: {
    artworks: [],
  },

  onShow() {
    this.refreshDownloads();
  },

  refreshDownloads() {
    this.setData({
      artworks: getDownloadArtworks(),
    });
  },

  clearDownloads() {
    if (this.data.artworks.length === 0) return;
    wx.showModal({
      title: "清空下载记录",
      content: "清空后，本机下载记录将无法恢复，但不会删除系统相册中的图片。",
      confirmText: "清空",
      confirmColor: "#111111",
      success: (result) => {
        if (!result.confirm) return;
        clearDownloadArtworks();
        this.refreshDownloads();
        wx.showToast({
          title: "已清空下载记录",
          icon: "none",
        });
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
