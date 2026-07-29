const { getFavoriteArtworks } = require("../../services/local-library");

Page({
  data: {
    artworks: [],
  },

  onShow() {
    this.setData({
      artworks: getFavoriteArtworks(),
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
