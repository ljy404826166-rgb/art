const {
  fallbackSearchArtworks,
  normalizeError,
  searchArtworks,
} = require("../../services/artworks");

const PAGE_SIZE = 20;
const DEBOUNCE_DELAY = 320;
const MIN_QUERY_LENGTH = 1;

Page({
  data: {
    query: "",
    artworks: [],
    skip: 0,
    hasMore: false,
    loading: false,
    loadingMore: false,
    searched: false,
    error: "",
    usingFallback: false,
  },

  searchTimer: null,

  onLoad(options) {
    const query = decodeURIComponent((options && options.q) || "");
    if (query) {
      this.setData({ query });
      this.runSearch(query);
    }
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },

  onReachBottom() {
    this.loadMore();
  },

  handleInput(event) {
    const query = event.detail.value || "";
    this.setData({ query });
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.runSearch(query);
    }, DEBOUNCE_DELAY);
  },

  handleConfirm() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.runSearch(this.data.query);
  },

  clearSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.setData({
      query: "",
      artworks: [],
      skip: 0,
      hasMore: false,
      loading: false,
      loadingMore: false,
      searched: false,
      error: "",
      usingFallback: false,
    });
  },

  async runSearch(rawQuery) {
    const query = String(rawQuery || "").trim();
    if (query.length < MIN_QUERY_LENGTH) {
      this.setData({
        artworks: [],
        skip: 0,
        hasMore: false,
        loading: false,
        loadingMore: false,
        searched: false,
        error: "",
        usingFallback: false,
      });
      return;
    }

    this.setData({
      loading: true,
      loadingMore: false,
      searched: true,
      error: "",
      usingFallback: false,
    });

    try {
      const artworks = await searchArtworks(query, { pageSize: PAGE_SIZE, skip: 0 });
      if (this.data.query.trim() !== query) return;
      this.setData({
        artworks,
        skip: artworks.length,
        hasMore: artworks.length >= PAGE_SIZE,
        loading: false,
      });
    } catch (error) {
      const fallback = fallbackSearchArtworks(query);
      if (this.data.query.trim() !== query) return;
      this.setData({
        artworks: fallback,
        skip: fallback.length,
        hasMore: false,
        loading: false,
        error: normalizeError(error),
        usingFallback: true,
      });
    }
  },

  async loadMore() {
    const query = this.data.query.trim();
    if (!query || this.data.loading || this.data.loadingMore || !this.data.hasMore || this.data.usingFallback) return;

    this.setData({ loadingMore: true });
    try {
      const nextPage = await searchArtworks(query, {
        pageSize: PAGE_SIZE,
        skip: this.data.skip,
      });
      const artworks = this.mergeUnique(this.data.artworks, nextPage);
      this.setData({
        artworks,
        skip: this.data.skip + nextPage.length,
        hasMore: nextPage.length >= PAGE_SIZE,
        loadingMore: false,
      });
    } catch (error) {
      this.setData({
        loadingMore: false,
        error: normalizeError(error),
      });
    }
  },

  mergeUnique(existing, incoming) {
    const seen = {};
    const merged = [];
    (existing || []).concat(incoming || []).forEach((item) => {
      const id = item && (item._id || item.id || item.supabaseId || item.title);
      if (!id || seen[id]) return;
      seen[id] = true;
      merged.push(item);
    });
    return merged;
  },

  retrySearch() {
    this.runSearch(this.data.query);
  },

  openDetail(event) {
    const { id } = event.detail || {};
    if (!id) return;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}`,
    });
  },
});
