const { mockArtists, artistFilterGroups } = require("../data/mock-artists");

function normalizeArtist(record) {
  const artist = record || {};
  return {
    ...artist,
    styles: Array.isArray(artist.styles) ? artist.styles : [],
    periods: Array.isArray(artist.periods) ? artist.periods : [],
    aliases: Array.isArray(artist.aliases) ? artist.aliases : [],
    representativeWorks: Array.isArray(artist.representativeWorks) ? artist.representativeWorks : [],
    tags: Array.isArray(artist.tags) ? artist.tags : [],
  };
}

function getArtistSearchText(artist) {
  return [
    artist.nameZh,
    artist.nameEn,
    artist.lifespan,
    artist.region,
    artist.country,
    artist.activePeriod,
    ...(artist.styles || []),
    ...(artist.periods || []),
    ...(artist.aliases || []),
    ...(artist.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function listArtists() {
  return mockArtists.map(normalizeArtist);
}

function filterArtists(options) {
  const filters = (options && options.filters) || {};
  const query = String((options && options.query) || "").trim().toLowerCase();

  return listArtists().filter((artist) => {
    if (query && !getArtistSearchText(artist).includes(query)) return false;
    if (filters.region && filters.region !== "全部" && artist.region !== filters.region) return false;
    if (filters.style && filters.style !== "全部" && !artist.styles.includes(filters.style)) return false;
    if (filters.period && filters.period !== "全部" && !artist.periods.includes(filters.period)) return false;
    return true;
  });
}

function getArtistById(id) {
  const wanted = String(id || "");
  return listArtists().find((artist) => artist.id === wanted) || null;
}

module.exports = {
  artistFilterGroups,
  listArtists,
  filterArtists,
  getArtistById,
};
