const {
  fetchArtworkById,
  fallbackArtworkById,
  normalizeError,
} = require("../../services/artworks");
const { listArtists } = require("../../services/artists");
const {
  isFavoriteArtwork,
  recordHistoryArtwork,
  toggleFavoriteArtwork,
} = require("../../services/local-library");

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function findArtistByArtworkText(artistText) {
  const normalizedArtist = normalizeText(artistText);
  if (!normalizedArtist) return null;

  return listArtists().find((artist) => {
    const aliases = [
      artist.nameZh,
      artist.nameEn,
      ...(artist.aliases || []),
    ].map(normalizeText).filter(Boolean);
    return aliases.some((alias) => normalizedArtist.includes(alias) || alias.includes(normalizedArtist));
  }) || null;
}

Page({
  data: {
    artwork: null,
    currentId: "",
    loading: true,
    error: "",
    usingFallback: false,
    isFavorite: false,
  },

  onLoad(options) {
    wx.setNavigationBarTitle({
      title: "详情",
    });
    this.loadArtwork(options.id || options.source_id || options.supabase_id);
  },

  async loadArtwork(id) {
    this.setData({
      currentId: id || "",
      loading: true,
      error: "",
    });
    try {
      const artwork = await fetchArtworkById(id);
      this.applyLoadedArtwork(artwork, { usingFallback: false });
    } catch (error) {
      const fallbackArtwork = fallbackArtworkById(id);
      this.applyLoadedArtwork(fallbackArtwork, {
        error: normalizeError(error),
        usingFallback: true,
      });
    }
  },

  applyLoadedArtwork(artwork, options = {}) {
    const artworkId = artwork && (artwork._id || artwork.id || artwork.source_id || artwork.supabase_id);
    if (artwork) {
      recordHistoryArtwork(artwork);
    }

    this.setData({
      artwork,
      loading: false,
      error: options.error || "",
      usingFallback: Boolean(options.usingFallback),
      isFavorite: isFavoriteArtwork(artworkId),
    });
  },

  retryLoad() {
    this.loadArtwork(this.data.currentId);
  },

  openArtistFromArtwork() {
    const artist = findArtistByArtworkText(this.data.artwork && this.data.artwork.artist);
    if (!artist) {
      wx.showToast({
        title: "暂无画家详情",
        icon: "none",
      });
      return;
    }
    wx.navigateTo({
      url: `/pages/artist-detail/artist-detail?id=${artist.id}`,
    });
  },

  openTag(event) {
    const { tag } = event.currentTarget.dataset || {};
    if (!tag) return;
    wx.navigateTo({
      url: `/pages/tag/tag?tag=${encodeURIComponent(tag)}`,
    });
  },

  toggleFavorite() {
    if (!this.data.artwork) return;
    const isFavorite = toggleFavoriteArtwork(this.data.artwork);
    this.setData({ isFavorite });
    wx.showToast({
      title: isFavorite ? "已收藏" : "已取消收藏",
      icon: "none",
    });
  },
});
