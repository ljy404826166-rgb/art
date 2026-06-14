const { artistFilterGroups, filterArtists } = require("../../services/artists");

function createDefaultFilters() {
  return artistFilterGroups.reduce((filters, group) => {
    filters[group.key] = "全部";
    return filters;
  }, {});
}

function createGroups(activeFilters) {
  return artistFilterGroups.map((group) => ({
    ...group,
    activeTag: activeFilters[group.key] || "全部",
  }));
}

Page({
  data: {
    query: "",
    filters: createDefaultFilters(),
    groups: createGroups(createDefaultFilters()),
    artists: [],
    resultCountText: "0位画家",
  },

  onLoad() {
    this.refreshArtists();
  },

  onShow() {
    wx.setNavigationBarTitle({ title: "画家" });
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
    const artists = filterArtists({
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
