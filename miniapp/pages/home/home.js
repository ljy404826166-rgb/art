const {
  fetchRandomArtworks,
  searchArtworks: searchCloudArtworks,
  fallbackSearchArtworks,
  fallbackLatestArtworks,
  normalizeError,
} = require("../../services/artworks");
const {
  createHomeSearchState,
} = require("./home-search");

const SECTION_LIMIT = 8;
const SECTION_APPEND_LIMIT = 4;
const ROW_LIMIT = 8;
const HOME_SAMPLE_SIZE = 120;
const SEARCH_PAGE_SIZE = 60;
const SEARCH_DEBOUNCE_MS = 250;

function shuffleItems(items) {
  const shuffled = items.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = current;
  }
  return shuffled;
}

function withCardClass(items) {
  return items.map((item, index) => ({
    ...item,
    homeCardClass: index % 5 === 1 || index % 5 === 4 ? "is-wide" : "is-compact",
  }));
}

function uniqueTags(artworks) {
  const tags = [];
  artworks.forEach((item) => {
    (item.tags || item.tag_keys || []).forEach((tag) => {
      if (tag && !tags.includes(tag)) tags.push(tag);
    });
  });
  return shuffleItems(tags);
}

function buildSections(artworks, sectionLimit = SECTION_LIMIT) {
  const shuffled = withCardClass(shuffleItems(artworks));
  const recommendationItems = shuffled.slice(0, ROW_LIMIT);
  const usedInRecommendation = {};
  recommendationItems.forEach((item) => {
    usedInRecommendation[item._id || item.id] = true;
  });

  const sections = [
    {
      key: "recommendation",
      title: "推荐",
      items: recommendationItems,
      isRecommendation: true,
      showMore: false,
      targetTag: "",
    },
  ];

  uniqueTags(shuffled)
    .slice(0, sectionLimit)
    .forEach((tag) => {
      const candidates = shuffled.filter((item) => (item.tags || item.tag_keys || []).includes(tag));
      const freshItems = candidates.filter((item) => !usedInRecommendation[item._id || item.id]);
      const items = withCardClass((freshItems.length >= 3 ? freshItems : candidates).slice(0, ROW_LIMIT));
      if (items.length) {
        sections.push({
          key: `tag:${tag}`,
          title: tag,
          tag,
          targetTag: tag,
          showMore: true,
          items,
        });
      }
    });

  return sections;
}

function getArtworkKey(item) {
  return item && (item._id || item.id || item.source_id || item.title);
}

function mergeUniqueArtworks(existing, incoming) {
  const seen = {};
  const merged = [];
  (existing || []).concat(incoming || []).forEach((item) => {
    const key = getArtworkKey(item);
    if (!key || seen[key]) return;
    seen[key] = true;
    merged.push(item);
  });
  return merged;
}

function getNewUniqueArtworks(existing, incoming) {
  const seen = {};
  (existing || []).forEach((item) => {
    const key = getArtworkKey(item);
    if (key) seen[key] = true;
  });

  const fresh = [];
  (incoming || []).forEach((item) => {
    const key = getArtworkKey(item);
    if (!key || seen[key]) return;
    seen[key] = true;
    fresh.push(item);
  });
  return fresh;
}

function buildAppendSections(artworks, existingSections, batchIndex) {
  const shuffled = withCardClass(shuffleItems(artworks));
  const existingTags = {};
  (existingSections || []).forEach((section) => {
    if (section && section.tag) existingTags[section.tag] = true;
  });

  const preferredTags = uniqueTags(shuffled).filter((tag) => !existingTags[tag]);
  const fallbackTags = uniqueTags(shuffled).filter((tag) => existingTags[tag]);
  const tags = preferredTags.concat(fallbackTags).slice(0, SECTION_APPEND_LIMIT);
  const sections = tags.map((tag, index) => {
    const candidates = shuffled.filter((item) => (item.tags || item.tag_keys || []).includes(tag));
    return {
      key: `tag:${tag}:batch:${batchIndex}:${index}`,
      title: tag,
      tag,
      targetTag: tag,
      showMore: true,
      items: withCardClass(candidates.slice(0, ROW_LIMIT)),
    };
  }).filter((section) => section.items.length);

  if (sections.length) return sections;

  const items = withCardClass(shuffled.slice(0, ROW_LIMIT));
  return items.length
    ? [{
      key: `more:${batchIndex}`,
      title: "更多推荐",
      items,
      isRecommendation: true,
      showMore: false,
      targetTag: "",
    }]
    : [];
}

function appendSectionsPatch(startIndex, sections) {
  return sections.reduce((patch, section, index) => {
    patch[`sections[${startIndex + index}]`] = section;
    return patch;
  }, {});
}

Page({
  data: {
    artworks: [],
    sections: [],
    searchQuery: "",
    searchMode: false,
    searchResults: [],
    searchLoading: false,
    loading: true,
    loadingMore: false,
    sectionLimit: SECTION_LIMIT,
    loadBatch: 0,
    error: "",
    usingFallback: false,
  },

  onLoad() {
    this.loadArtworks();
  },

  onUnload() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
  },

  onPullDownRefresh() {
    this.loadArtworks({ stopPullDownRefresh: true });
  },

  onReachBottom() {
    this.loadMoreArtworks();
  },

  async loadArtworks(options) {
    this.setData({ loading: true, loadingMore: false, sectionLimit: SECTION_LIMIT, loadBatch: 0, error: "" });
    try {
      const artworks = await fetchRandomArtworks({ pageSize: HOME_SAMPLE_SIZE, batchSize: 20 });
      this.setData({
        artworks,
        sections: buildSections(artworks, SECTION_LIMIT),
        ...createHomeSearchState([], this.data.searchQuery, { results: this.data.searchResults }),
        loading: false,
        usingFallback: false,
      });
    } catch (error) {
      const fallback = fallbackLatestArtworks();
      this.setData({
        artworks: fallback,
        sections: buildSections(fallback, SECTION_LIMIT),
        ...createHomeSearchState([], this.data.searchQuery, { results: this.data.searchResults }),
        loading: false,
        error: normalizeError(error),
        usingFallback: true,
      });
    } finally {
      if (options && options.stopPullDownRefresh) {
        wx.stopPullDownRefresh();
      }
    }
  },

  async loadMoreArtworks() {
    if (this.data.loading || this.data.loadingMore || this.data.searchMode) return;
    this.setData({ loadingMore: true });
    try {
      const nextArtworks = await fetchRandomArtworks({ pageSize: 60, batchSize: 20 });
      const newArtworks = getNewUniqueArtworks(this.data.artworks, nextArtworks);
      const artworks = mergeUniqueArtworks(this.data.artworks, nextArtworks);
      const loadBatch = this.data.loadBatch + 1;
      const appendedSections = buildAppendSections(newArtworks.length ? newArtworks : nextArtworks, this.data.sections, loadBatch);
      this.setData({
        artworks,
        loadBatch,
        ...appendSectionsPatch(this.data.sections.length, appendedSections),
        loadingMore: false,
        usingFallback: false,
      });
    } catch (error) {
      this.setData({
        loadingMore: false,
        error: normalizeError(error),
      });
    }
  },

  retryLoad() {
    this.loadArtworks();
  },

  handleSearchInput(event) {
    const searchQuery = event.detail.value || "";
    const localState = createHomeSearchState([], searchQuery);
    this.setData({
      ...localState,
      searchLoading: localState.searchMode,
    });
    this.scheduleCloudSearch(searchQuery);
  },

  submitSearch() {
    const searchQuery = String(this.data.searchQuery || "");
    if (typeof wx !== "undefined" && typeof wx.hideKeyboard === "function") {
      wx.hideKeyboard();
    }
    this.runCloudSearchNow(searchQuery);
  },

  scheduleCloudSearch(query) {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const searchQuery = String(query || "");
    const normalizedQuery = searchQuery.trim();
    this.searchRequestId = (this.searchRequestId || 0) + 1;
    const requestId = this.searchRequestId;
    if (!normalizedQuery) {
      this.setData({ searchLoading: false });
      return;
    }
    this.searchTimer = setTimeout(() => {
      this.runCloudSearch(normalizedQuery, requestId);
    }, SEARCH_DEBOUNCE_MS);
  },

  runCloudSearchNow(query) {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    const normalizedQuery = String(query || "").trim();
    this.searchRequestId = (this.searchRequestId || 0) + 1;
    const requestId = this.searchRequestId;
    if (!normalizedQuery) {
      this.clearSearch();
      return;
    }
    this.setData({ searchLoading: true });
    this.runCloudSearch(normalizedQuery, requestId);
  },

  async runCloudSearch(query, requestId) {
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) return;
    try {
      const results = await searchCloudArtworks(normalizedQuery, { pageSize: SEARCH_PAGE_SIZE });
      if (requestId !== this.searchRequestId || !this.data.searchMode) return;
      this.setData({
        searchResults: results,
        searchLoading: false,
      });
    } catch (error) {
      if (requestId !== this.searchRequestId || !this.data.searchMode) return;
      const fallback = fallbackSearchArtworks(normalizedQuery).slice(0, SEARCH_PAGE_SIZE);
      this.setData({
        searchResults: fallback,
        searchLoading: false,
      });
    }
  },

  clearSearch() {
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchRequestId = (this.searchRequestId || 0) + 1;
    this.setData({
      searchQuery: "",
      searchMode: false,
      searchResults: [],
      searchLoading: false,
    });
  },

  openDetail(event) {
    const detail = event.detail || {};
    const dataset = event.currentTarget ? event.currentTarget.dataset || {} : {};
    const id = detail.id || dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`,
    });
  },

  openCategory(event) {
    const { tag } = event.currentTarget.dataset;
    if (tag) {
      wx.setStorageSync("artArchive:selectedCategoryTag", tag);
    }
    wx.switchTab({
      url: "/pages/category/category",
    });
  },

  openTagDetail(event) {
    const { tag } = event.currentTarget.dataset;
    if (!tag) return;
    wx.navigateTo({
      url: `/pages/tag/tag?tag=${encodeURIComponent(tag)}`,
    });
  },
});
