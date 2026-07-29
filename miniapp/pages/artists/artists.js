const {
  appendArtistPage,
  artistFilterGroups,
  createArtistPaginationState,
  filterArtistList,
  loadArtistCount,
  loadArtistPage,
  loadArtists,
} = require("../../services/artists");

const ALL_TAG_ID = "";
const ARTIST_INITIAL_LIMIT = 20;
const ARTIST_LOAD_MORE_SIZE = 8;

function createDefaultFilters() {
  return artistFilterGroups.reduce((filters, group) => {
    filters[group.key] = ALL_TAG_ID;
    return filters;
  }, {});
}

function createGroups(activeFilters, expandedGroups, groupHeights = {}) {
  return artistFilterGroups.map((group) => {
    const tags = (group.tags || []).map((tag) => ({
      ...tag,
      selected: activeFilters[group.key] === tag.id,
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

Page({
  data: {
    query: "",
    filters: createDefaultFilters(),
    expandedGroups: {},
    groupHeights: {},
    groups: createGroups(createDefaultFilters(), {}),
    artists: [],
    resultCountText: "读取中",
    hasMoreArtists: false,
    loadingMore: false,
    loading: true,
    source: "",
    error: "",
  },

  onLoad() {
    this.loadArtists();
  },

  onReady() {
    this.measureGroupHeights();
  },

  onShow() {
    wx.setNavigationBarTitle({ title: "画家" });
  },

  async loadArtists() {
    this.setData({ loading: true, error: "" });
    this._allArtists = [];
    this._filteredArtists = [];
    this._directoryReady = false;
    this._remoteHasMore = false;
    this._directoryLoadError = "";
    this._artistCountError = "";
    this._pageLoadFailed = false;
    this.preloadArtistCount();
    const result = await loadArtistPage({
      allowFallback: false,
      pageSize: ARTIST_INITIAL_LIMIT,
    });
    if (result.source === "error") {
      this._pageLoadFailed = true;
      console.warn("Unable to load reviewed cloud artists", result.error);
      this.setData({
        artists: [],
        resultCountText: "0位",
        hasMoreArtists: false,
        loadingMore: false,
        source: result.source,
        loading: false,
        error: result.error || "cloud artists unavailable",
      });
      return;
    }
    this._allArtists = result.artists;
    this._remoteHasMore = result.hasMore;
    this.setData({
      source: result.source,
      loading: false,
      error: "",
    });
    this.refreshArtists();
    this.preloadRemainingArtists();
  },

  preloadArtistCount() {
    if (this._artistCountPromise) return this._artistCountPromise;

    this._artistCountPromise = loadArtistCount({ allowFallback: false })
      .then((result) => {
        if (result.source === "error") {
          this._artistCountError = result.error || "cloud artists count unavailable";
        } else {
          this._totalArtistCount = Number(result.total);
          this._artistCountError = "";
        }
        if (!this._pageLoadFailed) this.refreshArtists();
      })
      .catch((error) => {
        this._artistCountError = error && error.message ? error.message : String(error);
        if (!this._pageLoadFailed) this.refreshArtists();
      })
      .finally(() => {
        this._artistCountPromise = null;
      });
    return this._artistCountPromise;
  },

  preloadRemainingArtists() {
    if (this._directoryReady) return Promise.resolve();
    if (this._directoryLoadPromise) return this._directoryLoadPromise;

    this._directoryLoadPromise = loadArtists({ allowFallback: false })
      .then((result) => {
        if (result.source === "error") {
          this._directoryLoadError = result.error || "cloud artists unavailable";
          console.warn("Unable to preload remaining cloud artists", this._directoryLoadError);
          this.refreshArtists();
          return;
        }
        const visibleLimit = Math.max(ARTIST_INITIAL_LIMIT, this.data.artists.length);
        this._allArtists = result.artists;
        this._totalArtistCount = result.artists.length;
        this._directoryReady = true;
        this._remoteHasMore = false;
        this._directoryLoadError = "";
        this.refreshArtists({ visibleLimit });
      })
      .finally(() => {
        this._directoryLoadPromise = null;
        if (this.data.loadingMore) this.setData({ loadingMore: false });
      });
    return this._directoryLoadPromise;
  },

  hasActiveDirectoryFilter() {
    if (String(this.data.query || "").trim()) return true;
    return Object.values(this.data.filters || {}).some(Boolean);
  },

  getResultCountText(filteredArtists) {
    const filteredCount = (filteredArtists || []).length;
    if (this.hasActiveDirectoryFilter()) {
      if (this._directoryReady) return `${filteredCount}位`;
      if (this._directoryLoadError) return `${filteredCount}位已加载`;
      return "读取中";
    }
    if (Number.isFinite(this._totalArtistCount)) {
      return `${this._totalArtistCount}位`;
    }
    if (this._directoryReady) return `${filteredCount}位`;
    if (this._artistCountError && this._directoryLoadError) {
      return `${filteredCount}位已加载`;
    }
    return "读取中";
  },

  handleSearchInput(event) {
    this.setData({ query: event.detail.value || "" });
    this.refreshArtists();
  },

  clearSearch() {
    this.setData({ query: "" });
    this.refreshArtists();
  },

  selectTag(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {};
    const key = String(dataset.group || "").trim();
    const tagId = String(dataset.tagId || "").trim();
    if (!key || !Object.prototype.hasOwnProperty.call(this.data.filters, key)) return;
    const filters = {
      ...this.data.filters,
      [key]: this.data.filters[key] === tagId ? ALL_TAG_ID : tagId,
    };
    this.setData({
      filters,
      groups: createGroups(filters, this.data.expandedGroups, this.data.groupHeights),
    });
    this.refreshArtists();
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
          const group = (this.data.groups || [])[index];
          const height = Math.ceil(Number(rect && rect.height) || 0);
          if (group && height > 0) groupHeights[group.key] = height;
        });
        if (!Object.keys(groupHeights).length) return;
        this.setData({
          groupHeights,
          groups: createGroups(this.data.filters, this.data.expandedGroups, groupHeights),
        });
      })
      .exec();
  },

  toggleGroup(event) {
    const key = String(
      (event && event.currentTarget && event.currentTarget.dataset.group) || "",
    ).trim();
    if (!key) return;
    const expandedGroups = {
      ...this.data.expandedGroups,
      [key]: !this.data.expandedGroups[key],
    };
    this.setData({
      expandedGroups,
      groups: createGroups(this.data.filters, expandedGroups, this.data.groupHeights),
    });
  },

  refreshArtists(options) {
    const filteredArtists = filterArtistList(this._allArtists, {
      query: this.data.query,
      filters: this.data.filters,
    });
    this._filteredArtists = filteredArtists;
    const page = createArtistPaginationState(filteredArtists, {
      initialLimit: (options && options.visibleLimit) || ARTIST_INITIAL_LIMIT,
    });
    this.setData({
      artists: page.artists,
      resultCountText: this.getResultCountText(filteredArtists),
      hasMoreArtists: page.hasMore || (!this._directoryReady && this._remoteHasMore),
      loadingMore: false,
    });
  },

  async onReachBottom() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMoreArtists) return;
    this.setData({ loadingMore: true });

    if (!this._directoryReady && this._remoteHasMore) {
      await this.preloadRemainingArtists();
      if (!this._directoryReady) {
        this.setData({ loadingMore: false });
        return;
      }
    }

    const page = appendArtistPage(this.data.artists, this._filteredArtists, {
      pageSize: ARTIST_LOAD_MORE_SIZE,
    });
    this.setData({
      artists: page.artists,
      resultCountText: `${page.total}位`,
      hasMoreArtists: page.hasMore,
      loadingMore: false,
    });
  },

  openArtist(event) {
    const { id } = event.currentTarget.dataset;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/artist-detail/artist-detail?id=${id}`,
    });
  },
});
