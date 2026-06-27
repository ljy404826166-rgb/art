const {
  artistFilterGroups,
  filterArtistList,
  loadArtists,
} = require("../../services/artists");

const ALL_TAG = "全部";

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
    artists: [],
    resultCountText: "0位画家",
    loading: true,
    source: "",
  },

  onLoad() {
    this.loadArtists();
  },

  onShow() {
    wx.setNavigationBarTitle({ title: "画家" });
  },

  async loadArtists() {
    this.setData({ loading: true });
    const result = await loadArtists();
    if (result.source === "fallback") {
      console.warn("Using local artist fallback data");
    }
    this.setData({
      allArtists: result.artists,
      source: result.source,
      loading: false,
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
    const artists = filterArtistList(this.data.allArtists, {
      query: this.data.query,
      filters: this.data.filters,
    });
    this.setData({
      artists,
      resultCountText: `${artists.length}位画家`,
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
