const { getArtistById } = require("../../services/artists");
const {
  fetchArtworksByArtistAliases,
  fallbackArtworksByArtistAliases,
  normalizeError,
} = require("../../services/artworks");
const {
  isFollowedArtist,
  toggleFollowedArtist,
} = require("../../services/local-library");

Page({
  data: {
    artist: null,
    artworks: [],
    loading: true,
    error: "",
    usingFallback: false,
    isFollowed: false,
  },

  onLoad(options) {
    wx.setNavigationBarTitle({ title: "画家详情" });
    this.loadArtist(options.id);
  },

  async loadArtist(id) {
    const artist = getArtistById(id);
    if (!artist) {
      this.setData({
        artist: null,
        artworks: [],
        loading: false,
        error: "未找到画家信息",
      });
      return;
    }

    this.setData({
      artist,
      artworks: [],
      loading: true,
      error: "",
      usingFallback: false,
      isFollowed: isFollowedArtist(artist.id),
    });

    try {
      const artworks = await fetchArtworksByArtistAliases(artist.aliases, { pageSize: 24 });
      this.setData({
        artworks,
        loading: false,
      });
    } catch (error) {
      this.setData({
        artworks: fallbackArtworksByArtistAliases(artist.aliases),
        loading: false,
        error: normalizeError(error),
        usingFallback: true,
      });
    }
  },

  goBack() {
    wx.navigateBack({
      fail() {
        wx.switchTab({ url: "/pages/artists/artists" });
      },
    });
  },

  onShow() {
    if (!this.data.artist) return;
    this.setData({
      isFollowed: isFollowedArtist(this.data.artist.id),
    });
  },

  toggleFollowArtist() {
    if (!this.data.artist) return;
    const isFollowed = toggleFollowedArtist(this.data.artist);
    this.setData({ isFollowed });
    wx.showToast({
      title: isFollowed ? "已关注" : "已取消关注",
      icon: "none",
    });
  },

  openArtwork(event) {
    const { id } = event.detail || {};
    if (!id) return;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`,
    });
  },
});
