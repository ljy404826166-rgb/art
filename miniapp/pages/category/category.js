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

function normalizeTagInput(tag) {
  if (!tag || typeof tag === "string") {
    return {
      id: "",
      label: String(tag || ""),
    };
  }

  return {
    id: String(tag.id || tag._id || tag.tag_id || tag.tagId || "").trim(),
    label: String(tag.label || tag.label_zh || tag.labelZh || tag.name || tag.text || "").trim(),
  };
}

Page({
  data: {
    activeTag: "印象派",
    activeTagId: "",
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
    const tagInfo = normalizeTagInput(tag);
    const tagQuery = tagInfo.id ? { id: tagInfo.id, label: tagInfo.label } : tagInfo.label;

    this.setData({
      activeTag: tagInfo.label,
      activeTagId: tagInfo.id,
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
        countArtworksByTag(tagQuery),
        fetchArtworksByTag(tagQuery, { pageSize: PAGE_SIZE, skip: 0 }),
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
      const fallback = fallbackArtworksByTag(tagInfo.label);
      const totalCount = fallbackArtworkCountByTag(tagInfo.label);
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
      const tagQuery = this.data.activeTagId
        ? { id: this.data.activeTagId, label: this.data.activeTag }
        : this.data.activeTag;
      const nextPage = await fetchArtworksByTag(tagQuery, {
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
    this.applyFilter(
      this.data.activeTagId
        ? { id: this.data.activeTagId, label: this.data.activeTag }
        : this.data.activeTag,
    );
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
