const {
  fetchRandomArtworks,
  fetchArtworksByTag,
  searchArtworks: searchCloudArtworks,
  fallbackSearchArtworks,
  fallbackLatestArtworks,
  normalizeError,
} = require("../../services/artworks");
const {
  createPaginatedSection,
  getArtworkKey,
  getFreshArtworkBatch,
} = require("./home-pagination");
const {
  createHomeSearchState,
} = require("./home-search");

const SECTION_LIMIT = 8;
const SECTION_APPEND_LIMIT = 4;
const ROW_LIMIT = 8;
const HOME_SAMPLE_SIZE = 120;
const SEARCH_PAGE_SIZE = 20;
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

function withCardClass(items, startIndex = 0) {
  return items.map((item, index) => ({
    ...item,
    homeCardClass: (startIndex + index) % 5 === 1 || (startIndex + index) % 5 === 4 ? "is-wide" : "is-compact",
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

function artworkHasTag(item, tag) {
  return Boolean(tag && (item.tags || item.tag_keys || []).includes(tag));
}

function buildSections(artworks, sectionLimit = SECTION_LIMIT) {
  const shuffled = withCardClass(shuffleItems(artworks));
  const recommendationItems = shuffled.slice(0, ROW_LIMIT);
  const usedInRecommendation = {};
  recommendationItems.forEach((item) => {
    usedInRecommendation[item._id || item.id] = true;
  });

  const sections = [
    createPaginatedSection({
      key: "recommendation",
      title: "推荐",
      items: recommendationItems,
      isRecommendation: true,
      scrollLeft: 0,
      hasMore: true,
      showMore: false,
      targetTag: "",
    }, { rowLimit: ROW_LIMIT }),
  ];

  uniqueTags(shuffled)
    .slice(0, sectionLimit)
    .forEach((tag) => {
      const candidates = shuffled.filter((item) => (item.tags || item.tag_keys || []).includes(tag));
      const freshItems = candidates.filter((item) => !usedInRecommendation[item._id || item.id]);
      const items = withCardClass((freshItems.length >= 3 ? freshItems : candidates).slice(0, ROW_LIMIT));
      if (items.length) {
        sections.push(createPaginatedSection({
          key: `tag:${tag}`,
          title: tag,
          tag,
          targetTag: tag,
          moreUrl: `/pages/tag/tag?tag=${encodeURIComponent(tag)}`,
          scrollLeft: 0,
          hasMore: true,
          showMore: true,
          items,
        }, { rowLimit: ROW_LIMIT }));
      }
    });

  return sections;
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
    return createPaginatedSection({
      key: `tag:${tag}:batch:${batchIndex}:${index}`,
      title: tag,
      tag,
      targetTag: tag,
      moreUrl: `/pages/tag/tag?tag=${encodeURIComponent(tag)}`,
      scrollLeft: 0,
      hasMore: true,
      showMore: true,
      items: withCardClass(candidates.slice(0, ROW_LIMIT)),
    }, { rowLimit: ROW_LIMIT });
  }).filter((section) => section.items.length);

  if (sections.length) return sections;

  const items = withCardClass(shuffled.slice(0, ROW_LIMIT));
  return items.length
    ? [createPaginatedSection({
      key: `more:${batchIndex}`,
      title: "更多推荐",
      items,
      isRecommendation: true,
      scrollLeft: 0,
      hasMore: true,
      showMore: false,
      targetTag: "",
    }, { rowLimit: ROW_LIMIT })]
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
    searchTotal: 0,
    searching: false,
    searchError: "",
    searchLoading: false,
    searchLoadingMore: false,
    searchHasMore: false,
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
    if (this.data.searchMode) {
      this.loadMoreSearchResults();
      return;
    }
    this.loadMoreArtworks();
  },

  async loadArtworks(options) {
    this.sectionScrollLefts = {};
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

  async handleSectionScrollToLower(event) {
    const dataset = event.currentTarget ? event.currentTarget.dataset || {} : {};
    const detail = event.detail || {};
    const sectionIndex = Number(detail.sectionIndex ?? dataset.sectionIndex);
    const section = (this.data.sections || [])[sectionIndex];
    if (
      !Number.isFinite(sectionIndex)
      || !section
      || section.loadingMore
      || section.hasMore === false
      || this.data.loading
      || this.data.searchMode
    ) {
      return;
    }

    this.setData({
      [`sections[${sectionIndex}].loadingMore`]: true,
    });

    try {
      const result = section.isRecommendation
        ? await this.loadRecommendationRowMore(section)
        : await this.loadTagRowMore(section);
      this.applySectionAppend(sectionIndex, result);
    } catch (error) {
      this.setData({
        [`sections[${sectionIndex}].loadingMore`]: false,
        error: normalizeError(error),
      });
    }
  },

  async loadRecommendationRowMore(section) {
    if (this.data.usingFallback) {
      return this.getFallbackRowItems(section);
    }

    const items = await fetchRandomArtworks({ pageSize: ROW_LIMIT * 3, batchSize: 20 });
    return {
      items,
      fetchedCount: items.length,
      hasMore: items.length > 0,
    };
  },

  async loadTagRowMore(section) {
    const tag = section.tag || section.targetTag;
    if (!tag) {
      return { items: [], fetchedCount: 0, hasMore: false };
    }

    if (this.data.usingFallback) {
      return this.getFallbackRowItems(section);
    }

    const items = await fetchArtworksByTag(tag, {
      pageSize: ROW_LIMIT,
      skip: Number(section.skip || 0),
    });
    return {
      items,
      fetchedCount: items.length,
      hasMore: items.length >= ROW_LIMIT,
    };
  },

  getFallbackRowItems(section) {
    const tag = section.tag || section.targetTag;
    const source = tag
      ? (this.data.artworks || []).filter((item) => artworkHasTag(item, tag))
      : (this.data.artworks || []);
    const fresh = getFreshArtworkBatch(section.items, source, ROW_LIMIT);
    const remaining = getFreshArtworkBatch((section.items || []).concat(fresh), source, 1);
    return {
      items: fresh,
      fetchedCount: fresh.length,
      hasMore: remaining.length > 0,
    };
  },

  applySectionAppend(sectionIndex, result) {
    const section = (this.data.sections || [])[sectionIndex];
    if (!section) return;

    const incoming = (result && result.items) || [];
    const fresh = getFreshArtworkBatch(section.items, incoming, ROW_LIMIT);
    const decoratedFresh = withCardClass(fresh, (section.items || []).length);
    const items = (section.items || []).concat(decoratedFresh);
    const fetchedCount = Number((result && result.fetchedCount) || incoming.length || fresh.length || 0);
    const hasMore = Boolean(result && result.hasMore && fresh.length > 0);

    this.setData({
      artworks: mergeUniqueArtworks(this.data.artworks, incoming),
      [`sections[${sectionIndex}].items`]: items,
      [`sections[${sectionIndex}].skip`]: Number(section.skip || 0) + fetchedCount,
      [`sections[${sectionIndex}].hasMore`]: hasMore,
      [`sections[${sectionIndex}].loadingMore`]: false,
      error: "",
    });
  },

  retryLoad() {
    this.loadArtworks();
  },

  handleSearchInput(event) {
    const searchQuery = event.detail.value || "";
    const localState = createHomeSearchState([], searchQuery);
    this.setData({
      ...localState,
      searchTotal: 0,
      searching: localState.searchMode,
      searchError: "",
      searchLoading: localState.searchMode,
      searchLoadingMore: false,
      searchHasMore: false,
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
      this.setData({ searching: false, searchLoading: false, searchLoadingMore: false, searchHasMore: false });
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
    this.setData({ searching: true, searchError: "", searchLoading: true, searchLoadingMore: false, searchHasMore: false });
    this.runCloudSearch(normalizedQuery, requestId);
  },

  async runCloudSearch(query, requestId) {
    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) return;
    try {
      const results = await searchCloudArtworks(normalizedQuery, { pageSize: SEARCH_PAGE_SIZE, skip: 0 });
      if (requestId !== this.searchRequestId || !this.data.searchMode) return;
      this.setData({
        searchResults: results,
        searchTotal: results.length,
        searching: false,
        searchError: "",
        searchLoading: false,
        searchLoadingMore: false,
        searchHasMore: results.length >= SEARCH_PAGE_SIZE,
      });
    } catch (error) {
      if (requestId !== this.searchRequestId || !this.data.searchMode) return;
      const fallback = fallbackSearchArtworks(normalizedQuery).slice(0, SEARCH_PAGE_SIZE);
      this.setData({
        searchResults: fallback,
        searchTotal: fallback.length,
        searching: false,
        searchError: normalizeError(error),
        searchLoading: false,
        searchLoadingMore: false,
        searchHasMore: false,
      });
    }
  },

  async loadMoreSearchResults() {
    const normalizedQuery = String(this.data.searchQuery || "").trim();
    if (
      !this.data.searchMode
      || !normalizedQuery
      || this.data.searching
      || this.data.searchLoading
      || this.data.searchLoadingMore
      || !this.data.searchHasMore
    ) {
      return;
    }

    const requestId = this.searchRequestId;
    const skip = (this.data.searchResults || []).length;
    this.setData({ searchLoadingMore: true, searchError: "" });

    try {
      const results = await searchCloudArtworks(normalizedQuery, { pageSize: SEARCH_PAGE_SIZE, skip });
      if (
        requestId !== this.searchRequestId
        || !this.data.searchMode
        || normalizedQuery !== String(this.data.searchQuery || "").trim()
      ) {
        return;
      }
      const merged = mergeUniqueArtworks(this.data.searchResults, results);
      this.setData({
        searchResults: merged,
        searchTotal: merged.length,
        searchLoadingMore: false,
        searchHasMore: results.length >= SEARCH_PAGE_SIZE && merged.length > skip,
      });
    } catch (error) {
      if (requestId !== this.searchRequestId || !this.data.searchMode) return;
      this.setData({
        searchLoadingMore: false,
        searchHasMore: false,
        searchError: normalizeError(error),
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
      searchTotal: 0,
      searching: false,
      searchError: "",
      searchLoading: false,
      searchLoadingMore: false,
      searchHasMore: false,
    });
  },

  openDetail(event) {
    const detail = event.detail || {};
    const dataset = event.currentTarget ? event.currentTarget.dataset || {} : {};
    const id = detail.id || dataset.id;
    if (!id) return;
    const ratio = Number(detail.ratio || dataset.ratio || 0);
    const ratioParam = ratio > 0 ? `&ratio=${encodeURIComponent(ratio)}` : "";
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}${ratioParam}`,
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
    const dataset = event.currentTarget.dataset || {};
    const tag = dataset.tag || dataset.title;
    if (!tag) return;
    wx.navigateTo({
      url: `/pages/tag/tag?tag=${encodeURIComponent(tag)}`,
    });
  },
});
