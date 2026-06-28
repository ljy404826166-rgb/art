const { mockArtists, artistFilterGroups } = require("../data/mock-artists");

const REVIEWED_STATUS = "reviewed";
const CANDIDATE_STATUS = "candidate";
const REJECTED_STATUS = "rejected";
const VISIBLE_REVIEW_STATUSES = new Set([REVIEWED_STATUS, CANDIDATE_STATUS]);
const CLOUD_ARTISTS_PAGE_SIZE = 20;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeCloudArtist(record) {
  const artist = record || {};
  return {
    id: artist._id || artist.id,
    nameZh: artist.name_zh || artist.nameZh,
    nameEn: artist.name_en || artist.nameEn,
    lifespan: artist.lifespan_text || artist.lifespan,
    region: artist.region,
    country: artist.country,
    styles: asArray(artist.styles),
    periods: asArray(artist.periods),
    activePeriod: artist.active_period || artist.activePeriod,
    representativeWorks: asArray(artist.representative_works || artist.representativeWorks),
    aliases: asArray(artist.aliases),
    bio: artist.bio_zh || artist.bio,
    tags: asArray(artist.tags),
    avatarText: artist.avatar_text || artist.avatarText,
    reviewStatus: getReviewStatus(artist),
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

function normalizeArtistLookupText(value) {
  return normalizeQuery(value)
    .replace(/[\s·•・,，.。()（）\[\]【】\-—–_、:：;；'’"“”/\\]+/g, "");
}

function getArtistLookupTexts(artist) {
  return [
    artist && artist.id,
    artist && artist.nameZh,
    artist && artist.nameEn,
    ...asArray(artist && artist.aliases),
  ]
    .map(normalizeArtistLookupText)
    .filter(Boolean);
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

function toPositiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function createArtistPaginationState(artists, options) {
  const allArtists = asArray(artists);
  const initialLimit = toPositiveInteger(options && options.initialLimit, 20);
  const visibleArtists = allArtists.slice(0, initialLimit);
  return {
    artists: visibleArtists,
    visibleCount: visibleArtists.length,
    total: allArtists.length,
    hasMore: visibleArtists.length < allArtists.length,
  };
}

function appendArtistPage(currentArtists, allArtists, options) {
  const current = asArray(currentArtists);
  const all = asArray(allArtists);
  const pageSize = toPositiveInteger(options && options.pageSize, 8);
  const nextArtists = all.slice(current.length, current.length + pageSize);
  const visibleArtists = current.concat(nextArtists);
  return {
    artists: visibleArtists,
    visibleCount: visibleArtists.length,
    total: all.length,
    hasMore: visibleArtists.length < all.length,
  };
}

function getArtistById(id) {
  const wanted = String(id || "");
  return listArtists().find((artist) => artist.id === wanted) || null;
}

function findArtistByArtworkText(artists, artistText) {
  const normalizedArtist = normalizeArtistLookupText(artistText);
  if (!normalizedArtist) return null;

  return asArray(artists)
    .map(normalizeArtist)
    .find((artist) => {
      const aliases = getArtistLookupTexts(artist);
      return aliases.some((alias) => normalizedArtist.includes(alias) || alias.includes(normalizedArtist));
    }) || null;
}

function getWxApi(options) {
  if (options && options.wxApi) return options.wxApi;
  if (typeof globalThis !== "undefined" && globalThis.wx) return globalThis.wx;
  return null;
}

function allowFallback(options) {
  return !options || options.allowFallback !== false;
}

function createArtistErrorResult(error) {
  return {
    artists: [],
    source: "error",
    error: error && error.message ? error.message : String(error),
  };
}

function getReviewStatus(record) {
  return String(record && (record.review_status || record.reviewStatus) || "").trim();
}

function isVisibleCloudArtist(record) {
  const status = getReviewStatus(record);
  if (!status) return true;
  return VISIBLE_REVIEW_STATUSES.has(status) && status !== REJECTED_STATUS;
}

async function fetchVisibleArtistsFromCloud(options) {
  const wxApi = getWxApi(options);
  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.database !== "function") {
    throw new Error("wx.cloud.database is unavailable");
  }

  const db = wxApi.cloud.database();
  const rows = [];

  for (let skip = 0; ; skip += CLOUD_ARTISTS_PAGE_SIZE) {
    const result = await db
      .collection("artists")
      .skip(skip)
      .limit(CLOUD_ARTISTS_PAGE_SIZE)
      .get();
    const batch = asArray(result && result.data);
    rows.push(...batch);
    if (batch.length < CLOUD_ARTISTS_PAGE_SIZE) break;
  }

  return rows
    .filter(isVisibleCloudArtist)
    .map(normalizeArtist);
}

async function fetchVisibleArtistByIdFromCloud(id, options) {
  const wanted = String(id || "");
  if (!wanted) return null;

  const wxApi = getWxApi(options);
  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.database !== "function") {
    throw new Error("wx.cloud.database is unavailable");
  }

  const db = wxApi.cloud.database();
  const result = await db
    .collection("artists")
    .doc(wanted)
    .get();
  const record = result && result.data;
  if (!record || !isVisibleCloudArtist(record)) return null;
  return normalizeArtist(record);
}

async function loadArtists(options) {
  try {
    const artists = await fetchVisibleArtistsFromCloud(options);
    if (!artists.length) {
      throw new Error("cloud artists collection returned no visible artists");
    }
    return { artists, source: "cloud" };
  } catch (error) {
    if (!allowFallback(options)) return createArtistErrorResult(error);
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
    const artist = await fetchVisibleArtistByIdFromCloud(wanted, options);
    if (!artist && allowFallback(options)) {
      return {
        artist: getArtistById(wanted),
        source: "fallback",
        error: "cloud artists collection returned no visible artists",
      };
    }
    return {
      artist,
      source: "cloud",
    };
  } catch (error) {
    if (!allowFallback(options)) {
      return {
        artist: null,
        source: "error",
        error: error && error.message ? error.message : String(error),
      };
    }
    return {
      artist: getArtistById(wanted),
      source: "fallback",
      error: error && error.message ? error.message : String(error),
    };
  }
}

async function loadArtistByArtworkText(artistText, options) {
  try {
    const artists = await fetchVisibleArtistsFromCloud(options);
    if (!artists.length) {
      throw new Error("cloud artists collection returned no visible artists");
    }
    return {
      artist: findArtistByArtworkText(artists, artistText),
      source: "cloud",
    };
  } catch (error) {
    if (!allowFallback(options)) {
      return {
        artist: null,
        source: "error",
        error: error && error.message ? error.message : String(error),
      };
    }
    return {
      artist: findArtistByArtworkText(listArtists(), artistText),
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
  createArtistPaginationState,
  appendArtistPage,
  listArtists,
  filterArtists,
  getArtistById,
  loadArtists,
  loadFilteredArtists,
  loadArtistById,
  loadArtistByArtworkText,
};
