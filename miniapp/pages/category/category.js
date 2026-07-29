const {
  fetchArtworksByCategoryFilters,
  countArtworksByCategoryFilters,
  normalizeError,
} = require("../../services/artworks");
const { loadCategoryCatalog } = require("../../services/categories");

const PAGE_SIZE = 20;
const STORED_TAG_KEY = "artArchive:selectedCategoryTag";
const FILTER_GROUPS = ["style", "subject", "decade"];

function emptyFilters() {
  return {
    style: "",
    subject: "",
    decade: "",
  };
}

function cleanFilters(filters) {
  return FILTER_GROUPS.reduce((result, group) => {
    result[group] = String((filters && filters[group]) || "").trim();
    return result;
  }, {});
}

function hasActiveFilters(filters) {
  return FILTER_GROUPS.some((group) => Boolean(filters[group]));
}

function makeGroupsView(groups, expandedGroups, selectedFilters, groupHeights = {}) {
  return (groups || []).map((group) => {
    const tags = (group.tags || []).map((tag) => ({
      ...tag,
      selected: selectedFilters[group.key] === tag.id,
    }));
    const expanded = Boolean(expandedGroups[group.key]);
    const expandedHeight = Math.max(0, Number(groupHeights[group.key] || 0));
    return {
      ...group,
      tags,
      expanded,
      panelStyle: expanded
        ? expandedHeight
          ? `height: ${expandedHeight}px;`
          : "height: auto;"
        : "height: 54rpx;",
      canExpand: tags.length > 8,
    };
  });
}

function findStoredFilter(groups, storedTag) {
  const storedId =
    storedTag &&
    typeof storedTag === "object" &&
    String(storedTag.id || storedTag._id || storedTag.tag_id || storedTag.tagId || "").trim();
  const storedLabel =
    typeof storedTag === "string"
      ? storedTag.trim()
      : String(
          (storedTag &&
            (storedTag.label ||
              storedTag.label_zh ||
              storedTag.labelZh ||
              storedTag.name ||
              storedTag.text)) ||
            "",
        ).trim();

  for (const group of groups || []) {
    const tag = (group.tags || []).find((candidate) =>
      storedId ? candidate.id === storedId : storedLabel && candidate.label === storedLabel,
    );
    if (tag) return { group: group.key, tagId: tag.id };
  }
  return null;
}

function artworkKey(artwork) {
  if (!artwork || typeof artwork !== "object") return "";
  return String(artwork.id || artwork._id || artwork.source_id || "").trim();
}

function appendUniqueArtworks(existing, incoming) {
  const result = [];
  const seen = new Set();
  [...(existing || []), ...(incoming || [])].forEach((artwork) => {
    const key = artworkKey(artwork);
    if (key) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    result.push(artwork);
  });
  return result;
}

Page({
  data: {
    selectedFilters: emptyFilters(),
    hasActiveFilters: false,
    groups: [],
    groupsView: [],
    expandedGroups: {},
    groupHeights: {},
    catalogVersion: "",
    catalogSource: "",
    catalogStale: false,
    catalogLoading: true,
    catalogError: "",
    artworks: [],
    totalCount: 0,
    resultCountText: "0件作品",
    skip: 0,
    hasMore: false,
    loading: true,
    loadingMore: false,
    resultError: "",
    loadMoreError: "",
  },

  resultsRequestSerial: 0,
  catalogRequestSerial: 0,
  hasInitialized: false,

  async onShow() {
    wx.setNavigationBarTitle({ title: "分类" });
    const storedTag = wx.getStorageSync(STORED_TAG_KEY);
    if (this.hasInitialized && !storedTag) return;

    const catalogResult = await this.loadCatalog();
    if (!this.hasInitialized) {
      this.hasInitialized = true;
      return this.loadResults();
    }
    if (catalogResult && (catalogResult.filtersChanged || catalogResult.storedRequestApplied)) {
      return this.loadResults();
    }
  },

  onReachBottom() {
    return this.loadMore();
  },

  async loadCatalog() {
    const requestSerial = ++this.catalogRequestSerial;
    this.setData({
      catalogLoading: true,
      catalogError: "",
    });

    try {
      const catalog = await loadCategoryCatalog();
      if (requestSerial !== this.catalogRequestSerial) return;

      const groups = catalog.groups || [];
      const previousFilters = cleanFilters(this.data.selectedFilters);
      let selectedFilters = cleanFilters(previousFilters);
      let storedRequestApplied = false;
      FILTER_GROUPS.forEach((groupKey) => {
        const group = groups.find((candidate) => candidate.key === groupKey);
        const selectionExists =
          group && (group.tags || []).some((tag) => tag.id === selectedFilters[groupKey]);
        if (!selectionExists) selectedFilters[groupKey] = "";
      });

      const storedTag = wx.getStorageSync(STORED_TAG_KEY);
      if (storedTag) {
        const storedFilter = findStoredFilter(groups, storedTag);
        if (storedFilter) {
          selectedFilters = emptyFilters();
          selectedFilters[storedFilter.group] = storedFilter.tagId;
          storedRequestApplied = true;
        }
        wx.removeStorageSync(STORED_TAG_KEY);
      }

      this.setData(
        {
          groups,
          groupsView: makeGroupsView(
            groups,
            this.data.expandedGroups,
            selectedFilters,
            this.data.groupHeights,
          ),
          selectedFilters,
          hasActiveFilters: hasActiveFilters(selectedFilters),
          catalogVersion: String(catalog.catalogVersion || ""),
          catalogSource: String(catalog.source || ""),
          catalogStale: Boolean(catalog.stale),
          catalogLoading: false,
          catalogError: "",
        },
        () => this.measureGroupHeights(),
      );
      return {
        filtersChanged: FILTER_GROUPS.some(
          (groupKey) => previousFilters[groupKey] !== selectedFilters[groupKey],
        ),
        storedRequestApplied,
      };
    } catch (error) {
      if (requestSerial !== this.catalogRequestSerial) return;
      this.setData({
        catalogLoading: false,
        catalogError: normalizeError(error),
      });
      return { filtersChanged: false, storedRequestApplied: false };
    }
  },

  async retryCatalog() {
    const result = await this.loadCatalog();
    if (result && result.filtersChanged) return this.loadResults();
  },

  async selectTag(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const groupKey = String(dataset.group || "").trim();
    const tagId = String(dataset.tagId || "").trim();
    const group = this.data.groups.find((candidate) => candidate.key === groupKey);
    if (
      !FILTER_GROUPS.includes(groupKey) ||
      !tagId ||
      !group ||
      !(group.tags || []).some((tag) => tag.id === tagId)
    )
      return;

    const selectedFilters = cleanFilters(this.data.selectedFilters);
    selectedFilters[groupKey] = selectedFilters[groupKey] === tagId ? "" : tagId;
    return this.applyFilters(selectedFilters);
  },

  async clearFilters() {
    if (!hasActiveFilters(this.data.selectedFilters)) return;
    return this.applyFilters(emptyFilters());
  },

  async applyFilters(filters) {
    const selectedFilters = cleanFilters(filters || this.data.selectedFilters);
    this.setData({
      selectedFilters,
      hasActiveFilters: hasActiveFilters(selectedFilters),
      groupsView: makeGroupsView(
        this.data.groups,
        this.data.expandedGroups,
        selectedFilters,
        this.data.groupHeights,
      ),
    });
    return this.loadResults();
  },

  async loadResults() {
    const requestSerial = ++this.resultsRequestSerial;
    const filters = cleanFilters(this.data.selectedFilters);
    this.setData({
      artworks: [],
      totalCount: 0,
      resultCountText: "读取中",
      skip: 0,
      hasMore: false,
      loading: true,
      loadingMore: false,
      resultError: "",
      loadMoreError: "",
    });

    try {
      const [totalCountValue, firstPageValue] = await Promise.all([
        countArtworksByCategoryFilters(filters),
        fetchArtworksByCategoryFilters(filters, { pageSize: PAGE_SIZE, skip: 0 }),
      ]);
      if (requestSerial !== this.resultsRequestSerial) return;

      const totalCount = Math.max(0, Number(totalCountValue || 0));
      const firstPage = Array.isArray(firstPageValue) ? firstPageValue : [];
      const artworks = appendUniqueArtworks([], firstPage);
      const skip = firstPage.length;
      this.setData({
        artworks,
        totalCount,
        resultCountText: `${totalCount}件作品`,
        skip,
        hasMore: skip < totalCount && firstPage.length > 0,
        loading: false,
        loadingMore: false,
        resultError: "",
        loadMoreError: "",
      });
    } catch (error) {
      if (requestSerial !== this.resultsRequestSerial) return;
      this.setData({
        loading: false,
        loadingMore: false,
        hasMore: false,
        resultCountText: "读取失败",
        resultError: normalizeError(error),
        loadMoreError: "",
      });
    }
  },

  async retryResults() {
    return this.loadResults();
  },

  async loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return;

    const requestSerial = this.resultsRequestSerial;
    const filters = cleanFilters(this.data.selectedFilters);
    const currentSkip = this.data.skip;
    this.setData({
      loadingMore: true,
      loadMoreError: "",
    });

    try {
      const nextPageValue = await fetchArtworksByCategoryFilters(filters, {
        pageSize: PAGE_SIZE,
        skip: currentSkip,
      });
      if (requestSerial !== this.resultsRequestSerial) return;

      const nextPage = Array.isArray(nextPageValue) ? nextPageValue : [];
      const artworks = appendUniqueArtworks(this.data.artworks, nextPage);
      const skip = currentSkip + nextPage.length;
      this.setData({
        artworks,
        skip,
        hasMore: skip < this.data.totalCount && nextPage.length > 0,
        loadingMore: false,
        loadMoreError: "",
      });
    } catch (error) {
      if (requestSerial !== this.resultsRequestSerial) return;
      this.setData({
        loadingMore: false,
        loadMoreError: normalizeError(error),
      });
    }
  },

  async retryLoadMore() {
    return this.loadMore();
  },

  measureGroupHeights() {
    const query =
      typeof this.createSelectorQuery === "function"
        ? this.createSelectorQuery()
        : typeof wx !== "undefined" && typeof wx.createSelectorQuery === "function"
          ? wx.createSelectorQuery()
          : null;
    if (!query) return;

    query
      .selectAll(".chip-measure")
      .boundingClientRect((rects) => {
        const groupHeights = {};
        (rects || []).forEach((rect, index) => {
          const group = (this.data.groupsView || [])[index];
          const height = Math.ceil(Number(rect && rect.height) || 0);
          if (group && height > 0) groupHeights[group.key] = height;
        });
        if (!Object.keys(groupHeights).length) return;
        this.setData({
          groupHeights,
          groupsView: makeGroupsView(
            this.data.groups,
            this.data.expandedGroups,
            this.data.selectedFilters,
            groupHeights,
          ),
        });
      })
      .exec();
  },

  toggleGroup(event) {
    const groupKey = String(
      (event && event.currentTarget && event.currentTarget.dataset.group) || "",
    ).trim();
    if (!groupKey) return;
    const expandedGroups = {
      ...this.data.expandedGroups,
      [groupKey]: !this.data.expandedGroups[groupKey],
    };
    this.setData({
      expandedGroups,
      groupsView: makeGroupsView(
        this.data.groups,
        expandedGroups,
        this.data.selectedFilters,
        this.data.groupHeights,
      ),
    });
  },

  openDetail(event) {
    const { id, ratio } = (event && event.detail) || {};
    if (!id) return;
    const ratioValue = Number(ratio || 0);
    const ratioParam = ratioValue > 0 ? `&ratio=${encodeURIComponent(ratioValue)}` : "";
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}${ratioParam}`,
    });
  },
});
