const {
  fetchRandomArtworks,
  fallbackLatestArtworks,
  normalizeError,
} = require("../../services/artworks");

const SECTION_LIMIT = 8;
const SECTION_APPEND_LIMIT = 4;
const ROW_LIMIT = 8;
const HOME_SAMPLE_SIZE = 120;

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

function searchArtworks(artworks, query) {
  const value = String(query || "").trim().toLowerCase();
  if (!value) return [];
  return withCardClass(
    artworks.filter((item) => {
      const content = [
        item.title,
        item.titleCn,
        item.titleEn,
        item.artist,
        item.medium,
        item.dimensions,
        ...(item.tags || item.tag_keys || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return content.includes(value);
    }),
  );
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
    searchResults: [],
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
        searchResults: searchArtworks(artworks, this.data.searchQuery),
        loading: false,
        usingFallback: false,
      });
    } catch (error) {
      const fallback = fallbackLatestArtworks();
      this.setData({
        artworks: fallback,
        sections: buildSections(fallback, SECTION_LIMIT),
        searchResults: searchArtworks(fallback, this.data.searchQuery),
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
    if (this.data.loading || this.data.loadingMore || this.data.searchQuery) return;
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
    this.setData({
      searchQuery,
      searchResults: searchArtworks(this.data.artworks, searchQuery),
    });
  },

  clearSearch() {
    this.setData({
      searchQuery: "",
      searchResults: [],
    });
  },

  openSearchPage() {
    wx.navigateTo({
      url: "/pages/search/search",
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
