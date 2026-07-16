const {
  loadArtistById: loadArtistRecordById,
  loadArtistByArtworkText,
} = require("../../services/artists");
const {
  fetchArtworksByArtist,
  countArtworksByArtist,
  fallbackArtworksByArtistAliases,
  normalizeError,
} = require("../../services/artworks");
const {
  isFollowedArtist,
  toggleFollowedArtist,
} = require("../../services/local-library");
const { buildArtistShareMessage } = require("../../services/share-routes");

const ARTIST_WORKS_PAGE_SIZE = 8;

function getArtworkKey(item) {
  return item && (item._id || item.id || item.supabase_id || item.source_id || item.title);
}

function decodeRouteText(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

Page({
  data: {
    artist: null,
    artistSource: "",
    artworks: [],
    artworkTotal: 0,
    skip: 0,
    hasMore: true,
    loading: true,
    artworksLoading: false,
    loadingMore: false,
    error: "",
    usingFallback: false,
    isFollowed: false,
  },

  onLoad(options) {
    wx.setNavigationBarTitle({ title: "画家详情" });
    if (options && options.id) {
      this.loadArtistById(options.id);
      return;
    }
    this.loadArtistByText(decodeRouteText(options && options.artistText));
  },

  onShareAppMessage() {
    return buildArtistShareMessage(this.data.artist);
  },

  resetArtistState() {
    this.setData({
      artist: null,
      artistSource: "",
      artworks: [],
      artworkTotal: 0,
      skip: 0,
      hasMore: true,
      loading: true,
      artworksLoading: false,
      loadingMore: false,
      error: "",
      usingFallback: false,
      isFollowed: false,
    });
  },

  async loadArtistById(id) {
    this.resetArtistState();
    const artistResult = await loadArtistRecordById(id);
    await this.applyArtistResult(artistResult);
  },

  async loadArtist(id) {
    return this.loadArtistById(id);
  },

  async loadArtistByText(artistText) {
    this.resetArtistState();
    if (!artistText) {
      await this.applyArtistResult({
        artist: null,
        source: "error",
        error: "未找到画家信息",
      });
      return;
    }

    const artistResult = await loadArtistByArtworkText(artistText, { allowFallback: false });
    await this.applyArtistResult(artistResult);
  },

  async applyArtistResult(artistResult) {
    if (artistResult.source === "fallback") {
      console.warn("Using local artist fallback data");
    }

    const artist = artistResult.artist;
    if (!artist) {
      this.setData({
        artist: null,
        artistSource: artistResult.source,
        artworks: [],
        artworkTotal: 0,
        skip: 0,
        hasMore: false,
        loading: false,
        artworksLoading: false,
        loadingMore: false,
        error: "未找到画家信息",
      });
      return;
    }

    this.setData({
      artist,
      artistSource: artistResult.source,
      loading: false,
      artworksLoading: true,
      isFollowed: isFollowedArtist(artist.id),
    });

    await this.loadInitialArtworks(artist);
  },

  async loadInitialArtworks(artist) {
    const aliases = artist && artist.aliases;
    if (!artist || (!artist.nameZh && !artist.nameEn && (!aliases || !aliases.length))) {
      this.setData({
        artworks: [],
        artworkTotal: 0,
        skip: 0,
        hasMore: false,
        loading: false,
        artworksLoading: false,
        loadingMore: false,
      });
      return;
    }

    try {
      const [artworkTotal, artworks] = await Promise.all([
        countArtworksByArtist(artist),
        fetchArtworksByArtist(artist, {
          pageSize: ARTIST_WORKS_PAGE_SIZE,
          skip: 0,
        }),
      ]);
      const total = Math.max(Number(artworkTotal || 0), artworks.length);
      this.setData({
        artworks,
        artworkTotal: total,
        skip: artworks.length,
        hasMore: artworks.length < total,
        loading: false,
        artworksLoading: false,
      });
    } catch (error) {
      const fallbackArtworks = fallbackArtworksByArtistAliases(aliases);
      this.setData({
        artworks: fallbackArtworks,
        artworkTotal: fallbackArtworks.length,
        skip: fallbackArtworks.length,
        hasMore: false,
        loading: false,
        artworksLoading: false,
        loadingMore: false,
        error: normalizeError(error),
        usingFallback: true,
      });
    }
  },

  onReachBottom() {
    this.loadMore();
  },

  async loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore || this.data.usingFallback) return;
    const artist = this.data.artist;
    if (!artist) return;

    this.setData({ loadingMore: true });
    try {
      const skip = Number(this.data.skip || 0);
      const nextPage = await fetchArtworksByArtist(artist, {
        pageSize: ARTIST_WORKS_PAGE_SIZE,
        skip,
      });
      const seen = {};
      this.data.artworks.forEach((item) => {
        const id = getArtworkKey(item);
        if (id) seen[id] = true;
      });
      const fresh = nextPage.filter((item) => {
        const id = getArtworkKey(item);
        if (!id || seen[id]) return false;
        seen[id] = true;
        return true;
      });
      const artworks = this.data.artworks.concat(fresh);
      const nextSkip = skip + nextPage.length;
      const total = Number(this.data.artworkTotal || 0);
      this.setData({
        artworks,
        skip: nextSkip,
        hasMore: nextPage.length > 0 && (!total || artworks.length < total),
        loadingMore: false,
      });
    } catch (error) {
      this.setData({
        loadingMore: false,
        error: normalizeError(error),
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
    const { id, ratio } = event.detail || {};
    if (!id) return;
    const ratioValue = Number(ratio || 0);
    const ratioParam = ratioValue > 0 ? `&ratio=${encodeURIComponent(ratioValue)}` : "";
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}${ratioParam}`,
    });
  },
});
