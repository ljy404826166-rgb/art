const {
  appendArtistPage,
  artistFilterGroups,
  createArtistPaginationState,
  filterArtistList,
  loadArtists,
} = require("../../services/artists");

const ALL_TAG = "全部";
const ARTIST_INITIAL_LIMIT = 20;
const ARTIST_LOAD_MORE_SIZE = 8;

function createDefaultFilters() {
  return artistFilterGroups.reduce((filters, group) => {
    filters[group.key] = ALL_TAG;
    return filters;
  }, {});
}

function createGroups(activeFilters) {
  return artistFilterGroups.map((group) => ({
    ...group,
    activeTag: activeFilters[group.key] || ALL_TAG,
  }));
}

Page({
  data: {
    query: "",
    filters: createDefaultFilters(),
    groups: createGroups(createDefaultFilters()),
    allArtists: [],
    filteredArtists: [],
    artists: [],
    resultCountText: "0位画家",
    hasMoreArtists: false,
    loadingMore: false,
    loading: true,
    source: "",
    error: "",
  },

  onLoad() {
    this.loadArtists();
  },

  onShow() {
    wx.setNavigationBarTitle({ title: "画家" });
  },

  async loadArtists() {
    this.setData({ loading: true, error: "" });
    const result = await loadArtists({ allowFallback: false });
    if (result.source === "error") {
      console.warn("Unable to load reviewed cloud artists", result.error);
      this.setData({
        allArtists: [],
        filteredArtists: [],
        artists: [],
        resultCountText: "0位画家",
        hasMoreArtists: false,
        loadingMore: false,
        source: result.source,
        loading: false,
        error: result.error || "cloud artists unavailable",
      });
      return;
    }
    this.setData({
      allArtists: result.artists,
      source: result.source,
      loading: false,
      error: "",
    });
    this.refreshArtists();
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
    const { key, tag } = event.currentTarget.dataset;
    if (!key || !tag) return;
    const filters = {
      ...this.data.filters,
      [key]: tag,
    };
    this.setData({
      filters,
      groups: createGroups(filters),
    });
    this.refreshArtists();
  },

  refreshArtists() {
    const filteredArtists = filterArtistList(this.data.allArtists, {
      query: this.data.query,
      filters: this.data.filters,
    });
    const page = createArtistPaginationState(filteredArtists, {
      initialLimit: ARTIST_INITIAL_LIMIT,
    });
    this.setData({
      filteredArtists,
      artists: page.artists,
      resultCountText: `${filteredArtists.length}位画家`,
      hasMoreArtists: page.hasMore,
      loadingMore: false,
    });
  },

  onReachBottom() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMoreArtists) return;
    this.setData({ loadingMore: true });
    const page = appendArtistPage(this.data.artists, this.data.filteredArtists, {
      pageSize: ARTIST_LOAD_MORE_SIZE,
    });
    this.setData({
      artists: page.artists,
      resultCountText: `${page.total}位画家`,
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
