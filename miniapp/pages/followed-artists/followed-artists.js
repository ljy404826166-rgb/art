const { getFollowedArtists } = require("../../services/local-library");

Page({
  data: {
    artists: [],
  },

  onShow() {
    this.setData({
      artists: getFollowedArtists(),
    });
  },

  openArtist(event) {
    const { id } = event.currentTarget.dataset || {};
    if (!id) return;
    wx.navigateTo({
      url: `/pages/artist-detail/artist-detail?id=${encodeURIComponent(id)}`,
    });
  },
});
