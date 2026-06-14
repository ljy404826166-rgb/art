const {
  fetchArtworksByTag,
  countArtworksByTag,
  fallbackArtworksByTag,
  fallbackArtworkCountByTag,
  normalizeError,
} = require("../../services/artworks");
const { fallbackGroups } = require("../../data/fallback-artworks");

const PAGE_SIZE = 20;

function makeGroupsView(groups, expandedGroups) {
  return groups.map((group) => {
    const tags = group.tags || [];
    const expanded = Boolean(expandedGroups[group.name]);
    return {
      ...group,
      expanded,
      visibleTags: expanded ? tags : tags.slice(0, 8),
      canExpand: tags.length > 8,
    };
  });
}

Page({
  data: {
    activeTag: "印象派",
    groups: fallbackGroups,
    groupsView: makeGroupsView(fallbackGroups, {}),
    expandedGroups: {},
    allArtworks: [],
    filteredArtworks: [],
    totalCount: 0,
    resultCountText: "0件作品",
    skip: 0,
    hasMore: true,
    loading: true,
    loadingMore: false,
    error: "",
    usingFallback: false,
  },

  onShow() {
    wx.setNavigationBarTitle({ title: "分类" });
    const storedTag = wx.getStorageSync("artArchive:selectedCategoryTag");
    if (storedTag && storedTag !== this.data.activeTag) {
      wx.removeStorageSync("artArchive:selectedCategoryTag");
      this.applyFilter(storedTag);
      return;
    }
    if (!this.data.allArtworks.length) this.applyFilter(this.data.activeTag);
  },

  onReachBottom() {
    this.loadMore();
  },

  selectTag(event) {
    const { tag } = event.currentTarget.dataset;
    if (!tag || tag === this.data.activeTag) return;
    this.applyFilter(tag);
  },

  toggleGroup(event) {
    const { group } = event.currentTarget.dataset;
    const expandedGroups = {
      ...this.data.expandedGroups,
      [group]: !this.data.expandedGroups[group],
    };
    this.setData({
      expandedGroups,
      groupsView: makeGroupsView(this.data.groups, expandedGroups),
    });
  },

  async applyFilter(tag) {
    this.setData({
      activeTag: tag,
      allArtworks: [],
      filteredArtworks: [],
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
        allArtworks: artworks,
        totalCount,
        skip: artworks.length,
        hasMore: artworks.length < totalCount,
        loading: false,
      });
      this.updateVisibleArtworks();
    } catch (error) {
      const fallback = fallbackArtworksByTag(tag);
      const totalCount = fallbackArtworkCountByTag(tag);
      this.setData({
        allArtworks: fallback,
        totalCount,
        skip: fallback.length,
        hasMore: false,
        loading: false,
        error: normalizeError(error),
        usingFallback: true,
      });
      this.updateVisibleArtworks();
    }
  },

  async loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore || this.data.usingFallback) return;
    this.setData({ loadingMore: true });
    try {
      const nextPage = await fetchArtworksByTag(this.data.activeTag, {
        pageSize: PAGE_SIZE,
        skip: this.data.skip,
      });
      const allArtworks = this.data.allArtworks.concat(nextPage);
      this.setData({
        allArtworks,
        skip: allArtworks.length,
        hasMore: allArtworks.length < this.data.totalCount && nextPage.length > 0,
        loadingMore: false,
      });
      this.updateVisibleArtworks();
    } catch (error) {
      this.setData({
        loadingMore: false,
        error: normalizeError(error),
      });
    }
  },

  updateVisibleArtworks() {
    this.setData({
      filteredArtworks: this.data.allArtworks,
      resultCountText: `${this.data.totalCount}件作品`,
    });
  },

  retryLoad() {
    this.applyFilter(this.data.activeTag);
  },

  openDetail(event) {
    const { id } = event.detail || {};
    if (!id) return;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`,
    });
  },
});
