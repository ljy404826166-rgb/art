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
    const { id } = event.detail || {};
    if (!id) return;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}`,
    });
  },
});
