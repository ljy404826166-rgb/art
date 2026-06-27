const { mockArtists, artistFilterGroups } = require("../data/mock-artists");

const REVIEWED_STATUS = "reviewed";
const CLOUD_ARTISTS_LIMIT = 100;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCloudArtist(record) {
  const artist = record || {};
  return {
    id: artist._id,
    nameZh: artist.name_zh,
    nameEn: artist.name_en,
    lifespan: artist.lifespan_text,
    region: artist.region,
    country: artist.country,
    styles: asArray(artist.styles),
    periods: asArray(artist.periods),
    activePeriod: artist.active_period,
    representativeWorks: asArray(artist.representative_works),
    aliases: asArray(artist.aliases),
    bio: artist.bio_zh,
    tags: asArray(artist.tags),
    avatarText: artist.avatar_text,
    reviewStatus: artist.review_status,
  };
}

function normalizeArtist(record) {
  const artist = record || {};
  if (artist._id || artist.name_zh || artist.review_status) {
    return normalizeCloudArtist(artist);
  }

  return {
    ...artist,
    styles: asArray(artist.styles),
    periods: asArray(artist.periods),
    aliases: asArray(artist.aliases),
    representativeWorks: asArray(artist.representativeWorks),
    tags: asArray(artist.tags),
  };
}

function normalizeQuery(value) {
  return String(value || "").trim().toLowerCase();
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

function isAllFilter(value) {
  return !value || value === "\u5168\u90e8" || value === "鍏ㄩ儴";
}

function listArtists() {
  return mockArtists.map(normalizeArtist);
}

function filterArtistList(artists, options) {
  const filters = (options && options.filters) || {};
  const query = normalizeQuery(options && options.query);

  return asArray(artists)
    .map(normalizeArtist)
    .filter((artist) => {
      if (query && !getArtistSearchText(artist).includes(query)) return false;
      if (!isAllFilter(filters.region) && artist.region !== filters.region) return false;
      if (!isAllFilter(filters.style) && !artist.styles.includes(filters.style)) return false;
      if (!isAllFilter(filters.period) && !artist.periods.includes(filters.period)) return false;
      return true;
    });
}

function filterArtists(options) {
  return filterArtistList(listArtists(), options);
}

function getArtistById(id) {
  const wanted = String(id || "");
  return listArtists().find((artist) => artist.id === wanted) || null;
}

function getWxApi(options) {
  if (options && options.wxApi) return options.wxApi;
  if (typeof globalThis !== "undefined" && globalThis.wx) return globalThis.wx;
  return null;
}

async function fetchReviewedArtistsFromCloud(options) {
  const wxApi = getWxApi(options);
  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.database !== "function") {
    throw new Error("wx.cloud.database is unavailable");
  }

  const result = await wxApi.cloud
    .database()
    .collection("artists")
    .where({ review_status: REVIEWED_STATUS })
    .limit(CLOUD_ARTISTS_LIMIT)
    .get();
  const rows = asArray(result && result.data);

  return rows
    .filter((record) => record && record.review_status === REVIEWED_STATUS)
    .map(normalizeArtist);
}

async function loadArtists(options) {
  try {
    return {
      artists: await fetchReviewedArtistsFromCloud(options),
      source: "cloud",
    };
  } catch (error) {
    return {
      artists: listArtists(),
      source: "fallback",
      error: error && error.message ? error.message : String(error),
    };
  }
}

async function loadFilteredArtists(options) {
  const result = await loadArtists(options);
  return {
    ...result,
    artists: filterArtistList(result.artists, options),
  };
}

async function loadArtistById(id, options) {
  const wanted = String(id || "");
  try {
    const artists = await fetchReviewedArtistsFromCloud(options);
    return {
      artist: artists.find((artist) => artist.id === wanted) || null,
      source: "cloud",
    };
  } catch (error) {
    return {
      artist: getArtistById(wanted),
      source: "fallback",
      error: error && error.message ? error.message : String(error),
    };
  }
}

module.exports = {
  artistFilterGroups,
  normalizeArtist,
  normalizeCloudArtist,
  filterArtistList,
  listArtists,
  filterArtists,
  getArtistById,
  loadArtists,
  loadFilteredArtists,
  loadArtistById,
};
