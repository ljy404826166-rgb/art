const {
  fetchArtworksByTag,
  countArtworksByTag,
  fallbackArtworksByTag,
  fallbackArtworkCountByTag,
  normalizeError,
} = require("../../services/artworks");

const PAGE_SIZE = 20;

Page({
  data: {
    tag: "",
    artworks: [],
    totalCount: 0,
    resultCountText: "0件作品",
    skip: 0,
    hasMore: true,
    loading: true,
    loadingMore: false,
    error: "",
    usingFallback: false,
  },

  onLoad(options) {
    const tag = decodeURIComponent((options && options.tag) || "");
    wx.setNavigationBarTitle({ title: "标签" });
    this.setData({ tag });
    if (tag) {
      this.loadTag(tag);
    } else {
      this.setData({
        loading: false,
        hasMore: false,
        error: "缺少标签参数",
      });
    }
  },

  onReachBottom() {
    this.loadMore();
  },

  async loadTag(tag) {
    this.setData({
      artworks: [],
      totalCount: 0,
      resultCountText: "读取中",
      skip: 0,
      hasMore: true,
      loading: true,
      loadingMore: false,
      error: "",
      usingFallback: false,
    });

    try {
      const [totalCount, artworks] = await Promise.all([
        countArtworksByTag(tag),
        fetchArtworksByTag(tag, { pageSize: PAGE_SIZE, skip: 0 }),
      ]);
      this.setData({
        artworks,
        totalCount,
        resultCountText: `${totalCount}件作品`,
        skip: artworks.length,
        hasMore: artworks.length < totalCount,
        loading: false,
      });
    } catch (error) {
      const fallback = fallbackArtworksByTag(tag);
      const totalCount = fallbackArtworkCountByTag(tag);
      this.setData({
        artworks: fallback,
        totalCount,
        resultCountText: `${totalCount}件作品`,
        skip: fallback.length,
        hasMore: false,
        loading: false,
        error: normalizeError(error),
        usingFallback: true,
      });
    }
  },

  async loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore || this.data.usingFallback) return;
    this.setData({ loadingMore: true });
    try {
      const nextPage = await fetchArtworksByTag(this.data.tag, {
        pageSize: PAGE_SIZE,
        skip: this.data.skip,
      });
      const artworks = this.data.artworks.concat(nextPage);
      this.setData({
        artworks,
        skip: artworks.length,
        hasMore: artworks.length < this.data.totalCount && nextPage.length > 0,
        loadingMore: false,
      });
    } catch (error) {
      this.setData({
        loadingMore: false,
        error: normalizeError(error),
      });
    }
  },

  retryLoad() {
    if (this.data.tag) this.loadTag(this.data.tag);
  },

  openDetail(event) {
    const { id, ratio } = event.detail || {};
    if (!id) return;
    const ratioValue = Number(ratio || 0);
    const ratioParam = ratioValue > 0 ? `&ratio=${encodeURIComponent(ratioValue)}` : "";
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}${ratioParam}`,
    });
  },
});
