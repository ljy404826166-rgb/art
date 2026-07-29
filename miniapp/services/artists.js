const { mockArtists } = require("../data/mock-artists");
const {
  ARTIST_CLASSIFICATION_LABELS,
  ARTIST_FILTER_GROUPS,
} = require("../data/artist-filter-catalog");
const { buildClassificationTagItems } = require("../data/classification-tags");

const REVIEWED_STATUS = "reviewed";
const CLOUD_ARTISTS_PAGE_SIZE = 20;
const CLOUD_ARTISTS_REQUEST_TIMEOUT_MS = 8000;
const CLOUD_ARTISTS_CACHE_TTL_MS = 5 * 60 * 1000;
const CLOUD_ARTIST_LIST_FIELDS = {
  _id: true,
  id: true,
  name_zh: true,
  nameZh: true,
  name_en: true,
  nameEn: true,
  lifespan_text: true,
  lifespan: true,
  region: true,
  country: true,
  styles: true,
  periods: true,
  active_period: true,
  activePeriod: true,
  aliases: true,
  tags: true,
  avatar_text: true,
  avatarText: true,
  portrait_url: true,
  portraitUrl: true,
  portrait_source: true,
  portraitSource: true,
  portrait_license: true,
  portraitLicense: true,
  portrait_credit: true,
  portraitCredit: true,
  portrait_kind: true,
  portraitKind: true,
  portrait_artwork_id: true,
  portraitArtworkId: true,
  portrait_status: true,
  portraitStatus: true,
  portrait_updated_at: true,
  portraitUpdatedAt: true,
  review_status: true,
  reviewStatus: true,
  artwork_count: true,
  artworkCount: true,
  classification_version: true,
  region_id: true,
  style_ids: true,
  subject_ids: true,
  classified_artwork_count: true,
};
const artistPageCacheByApi = new WeakMap();
const artistDirectoryCacheByApi = new WeakMap();
const artistCountCacheByApi = new WeakMap();

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function joinDisplayValues(values, emptyText) {
  const normalized = unique(
    asArray(values)
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  );
  return normalized.length ? normalized.join("、") : emptyText;
}

function controlledStyleLabels(styleIds) {
  return unique(
    asArray(styleIds)
      .map((id) => ARTIST_CLASSIFICATION_LABELS[id] || "")
      .filter(Boolean),
  );
}

function buildArtistTagItems(styleIds, subjectIds) {
  return buildClassificationTagItems([...asArray(styleIds), ...asArray(subjectIds)]).filter(
    (tag) => tag.group === "style" || tag.group === "subject",
  );
}

function normalizePortraitFields(record) {
  const artist = record || {};
  const portraitStatus = String(artist.portrait_status || artist.portraitStatus || "").trim();
  const rawPortraitUrl = String(artist.portrait_url || artist.portraitUrl || "").trim();
  const approved = portraitStatus === "approved";
  return {
    portraitUrl: approved ? rawPortraitUrl : "",
    portraitSource: approved
      ? String(artist.portrait_source || artist.portraitSource || "").trim()
      : "",
    portraitLicense: approved
      ? String(artist.portrait_license || artist.portraitLicense || "").trim()
      : "",
    portraitCredit: approved
      ? String(artist.portrait_credit || artist.portraitCredit || "").trim()
      : "",
    portraitKind: approved ? String(artist.portrait_kind || artist.portraitKind || "").trim() : "",
    portraitArtworkId: approved
      ? String(artist.portrait_artwork_id || artist.portraitArtworkId || "").trim()
      : "",
    portraitStatus,
    portraitUpdatedAt: String(artist.portrait_updated_at || artist.portraitUpdatedAt || "").trim(),
  };
}

function normalizeCloudArtist(record) {
  const artist = record || {};
  const styleIds = asArray(artist.style_ids || artist.styleIds);
  const subjectIds = asArray(artist.subject_ids || artist.subjectIds);
  const styles = asArray(artist.styles);
  const representativeWorks = unique(
    asArray(artist.representative_works || artist.representativeWorks),
  ).slice(0, 2);
  const displayStyles = controlledStyleLabels(styleIds);
  const tags = asArray(artist.tags);
  return {
    id: artist._id || artist.id,
    nameZh: artist.name_zh || artist.nameZh,
    nameEn: artist.name_en || artist.nameEn,
    lifespan: artist.lifespan_text || artist.lifespan,
    region: artist.region,
    country: artist.country,
    styles,
    stylesText: joinDisplayValues(displayStyles, "待补充"),
    periods: asArray(artist.periods),
    activePeriod: artist.active_period || artist.activePeriod,
    representativeWorks,
    representativeWorksText: joinDisplayValues(representativeWorks, "暂无"),
    aliases: asArray(artist.aliases),
    bio: artist.bio_zh || artist.bio,
    tags,
    tagItems: buildArtistTagItems(styleIds, subjectIds),
    avatarText: artist.avatar_text || artist.avatarText,
    ...normalizePortraitFields(artist),
    artworkCount: artist.artwork_count || artist.artworkCount || 0,
    reviewStatus: getReviewStatus(artist),
    classificationVersion: artist.classification_version || artist.classificationVersion || "",
    regionId: artist.region_id || artist.regionId || "",
    styleIds,
    subjectIds,
    classifiedArtworkCount: artist.classified_artwork_count || artist.classifiedArtworkCount || 0,
  };
}

function normalizeArtist(record) {
  const artist = record || {};
  if (artist._id || artist.name_zh || artist.review_status) {
    return normalizeCloudArtist(artist);
  }

  const styles = asArray(artist.styles);
  const representativeWorks = unique(asArray(artist.representativeWorks)).slice(0, 2);
  const tags = asArray(artist.tags);
  const styleIds = asArray(artist.styleIds);
  const subjectIds = asArray(artist.subjectIds);
  return {
    ...artist,
    ...normalizePortraitFields(artist),
    styles,
    stylesText: joinDisplayValues(styles, "待补充"),
    periods: asArray(artist.periods),
    aliases: asArray(artist.aliases),
    representativeWorks,
    representativeWorksText: joinDisplayValues(representativeWorks, "暂无"),
    tags,
    tagItems: buildArtistTagItems(styleIds, subjectIds),
    styleIds,
    subjectIds,
  };
}

function normalizeQuery(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function normalizeArtistLookupText(value) {
  return normalizeQuery(value).replace(/[\s·•・,，.。()（）[\]【】\-—–_、:：;；'’"“”/\\]+/g, "");
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
    ...asArray(artist.styleIds).map((id) => ARTIST_CLASSIFICATION_LABELS[id] || id),
    ...asArray(artist.subjectIds).map((id) => ARTIST_CLASSIFICATION_LABELS[id] || id),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isAllFilter(value) {
  return !value || value === "\u5168\u90e8" || value === "鍏ㄩ儴";
}

function matchesControlledFilter(value, ids, legacyValues) {
  if (isAllFilter(value)) return true;
  const normalized = String(value || "").trim();
  if (asArray(ids).includes(normalized)) return true;
  return asArray(legacyValues).includes(normalized);
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
      if (!matchesControlledFilter(filters.region, [artist.regionId], [artist.region]))
        return false;
      if (!matchesControlledFilter(filters.style, artist.styleIds, artist.styles)) return false;
      if (!matchesControlledFilter(filters.subject, artist.subjectIds, [])) return false;
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

  return (
    asArray(artists)
      .map(normalizeArtist)
      .find((artist) => {
        const aliases = getArtistLookupTexts(artist);
        return aliases.some(
          (alias) => normalizedArtist.includes(alias) || alias.includes(normalizedArtist),
        );
      }) || null
  );
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
  return String((record && (record.review_status || record.reviewStatus)) || "").trim();
}

function isVisibleCloudArtist(record) {
  return getReviewStatus(record) === REVIEWED_STATUS;
}

function getRequestTimeout(options) {
  return toPositiveInteger(options && options.timeoutMs, CLOUD_ARTISTS_REQUEST_TIMEOUT_MS);
}

function getCacheTtl(options) {
  return toPositiveInteger(options && options.cacheTtlMs, CLOUD_ARTISTS_CACHE_TTL_MS);
}

function isFreshCache(entry, options) {
  return (
    Boolean(entry) &&
    Date.now() - entry.cachedAt < getCacheTtl(options) &&
    !(options && options.forceRefresh)
  );
}

function getPageCache(wxApi) {
  let cache = artistPageCacheByApi.get(wxApi);
  if (!cache) {
    cache = new Map();
    artistPageCacheByApi.set(wxApi, cache);
  }
  return cache;
}

function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function projectArtistListQuery(collection) {
  let query = collection;
  if (query && typeof query.where === "function") {
    query = query.where({ review_status: REVIEWED_STATUS });
  }
  if (query && typeof query.field === "function") {
    query = query.field(CLOUD_ARTIST_LIST_FIELDS);
  }
  if (query && typeof query.orderBy === "function") {
    query = query.orderBy("_id", "asc");
  }
  return query;
}

async function fetchVisibleArtistPageFromCloud(options) {
  const wxApi = getWxApi(options);
  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.database !== "function") {
    throw new Error("wx.cloud.database is unavailable");
  }

  const skip = Math.max(0, Number(options && options.skip) || 0);
  const pageSize = Math.min(
    CLOUD_ARTISTS_PAGE_SIZE,
    toPositiveInteger(options && options.pageSize, CLOUD_ARTISTS_PAGE_SIZE),
  );
  const pageCache = getPageCache(wxApi);
  const cacheKey = `${skip}:${pageSize}`;
  const cached = pageCache.get(cacheKey);
  if (isFreshCache(cached, options)) {
    return {
      ...cached.value,
      cached: true,
    };
  }

  const db = wxApi.cloud.database();
  const query = projectArtistListQuery(db.collection("artists"));
  const result = await withTimeout(
    query.skip(skip).limit(pageSize).get(),
    getRequestTimeout(options),
    "cloud artists request timed out",
  );
  const batch = asArray(result && result.data);
  const value = {
    artists: batch.filter(isVisibleCloudArtist).map(normalizeArtist),
    rawCount: batch.length,
    nextSkip: skip + batch.length,
    hasMore: batch.length === pageSize,
  };
  pageCache.set(cacheKey, {
    cachedAt: Date.now(),
    value,
  });
  return value;
}

async function fetchVisibleArtistCountFromCloud(options) {
  const wxApi = getWxApi(options);
  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.database !== "function") {
    throw new Error("wx.cloud.database is unavailable");
  }

  const cached = artistCountCacheByApi.get(wxApi);
  if (isFreshCache(cached, options)) {
    return {
      total: cached.total,
      cached: true,
    };
  }

  const collection = wxApi.cloud.database().collection("artists");
  const query =
    collection && typeof collection.where === "function"
      ? collection.where({ review_status: REVIEWED_STATUS })
      : collection;
  if (!query || typeof query.count !== "function") {
    throw new Error("cloud artists count query is unavailable");
  }

  const result = await withTimeout(
    query.count(),
    getRequestTimeout(options),
    "cloud artists count request timed out",
  );
  const total = Number(result && result.total);
  if (!Number.isFinite(total) || total < 0) {
    throw new Error("cloud artists count returned an invalid total");
  }

  artistCountCacheByApi.set(wxApi, {
    total,
    cachedAt: Date.now(),
  });
  return { total };
}

async function fetchVisibleArtistsFromCloud(options) {
  const wxApi = getWxApi(options);
  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.database !== "function") {
    throw new Error("wx.cloud.database is unavailable");
  }

  const cached = artistDirectoryCacheByApi.get(wxApi);
  if (isFreshCache(cached, options)) return cached.artists;

  const artists = [];
  let skip = 0;
  while (true) {
    const page = await fetchVisibleArtistPageFromCloud({
      ...options,
      skip,
      pageSize: CLOUD_ARTISTS_PAGE_SIZE,
    });
    artists.push(...page.artists);
    if (!page.hasMore || page.nextSkip <= skip) break;
    skip = page.nextSkip;
  }
  artistDirectoryCacheByApi.set(wxApi, {
    artists,
    cachedAt: Date.now(),
  });
  return artists;
}

async function fetchVisibleArtistByIdFromCloud(id, options) {
  const wanted = String(id || "");
  if (!wanted) return { artist: null, found: false };

  const wxApi = getWxApi(options);
  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.database !== "function") {
    throw new Error("wx.cloud.database is unavailable");
  }

  const db = wxApi.cloud.database();
  const result = await withTimeout(
    db.collection("artists").doc(wanted).get(),
    getRequestTimeout(options),
    "cloud artist request timed out",
  );
  const record = result && result.data;
  if (!record) return { artist: null, found: false };
  if (!isVisibleCloudArtist(record)) return { artist: null, found: true };
  return { artist: normalizeArtist(record), found: true };
}

async function loadArtistPage(options) {
  try {
    const page = await fetchVisibleArtistPageFromCloud(options);
    if (!page.artists.length && !page.hasMore) {
      throw new Error("cloud artists collection returned no visible artists");
    }
    return {
      ...page,
      source: "cloud",
    };
  } catch (error) {
    if (!allowFallback(options)) return createArtistErrorResult(error);
    const skip = Math.max(0, Number(options && options.skip) || 0);
    const pageSize = toPositiveInteger(options && options.pageSize, CLOUD_ARTISTS_PAGE_SIZE);
    const artists = listArtists().slice(skip, skip + pageSize);
    return {
      artists,
      rawCount: artists.length,
      nextSkip: skip + artists.length,
      hasMore: skip + artists.length < listArtists().length,
      source: "fallback",
      error: error && error.message ? error.message : String(error),
    };
  }
}

async function loadArtistCount(options) {
  try {
    const result = await fetchVisibleArtistCountFromCloud(options);
    return {
      ...result,
      source: "cloud",
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (!allowFallback(options)) {
      return {
        total: null,
        source: "error",
        error: message,
      };
    }
    return {
      total: listArtists().length,
      source: "fallback",
      error: message,
    };
  }
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
    const result = await fetchVisibleArtistByIdFromCloud(wanted, options);
    if (!result.artist && result.found) {
      return {
        artist: null,
        source: "cloud",
      };
    }
    if (!result.artist && allowFallback(options)) {
      return {
        artist: getArtistById(wanted),
        source: "fallback",
        error: "cloud artists collection returned no visible artists",
      };
    }
    return {
      artist: result.artist,
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
    const listArtist = findArtistByArtworkText(artists, artistText);
    if (!listArtist) return { artist: null, source: "cloud" };
    const fullArtist = await fetchVisibleArtistByIdFromCloud(listArtist.id, options);
    return {
      artist: fullArtist.artist || listArtist,
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
  artistFilterGroups: ARTIST_FILTER_GROUPS,
  normalizeArtist,
  normalizeCloudArtist,
  normalizePortraitFields,
  filterArtistList,
  createArtistPaginationState,
  appendArtistPage,
  listArtists,
  filterArtists,
  getArtistById,
  loadArtistPage,
  loadArtistCount,
  loadArtists,
  loadFilteredArtists,
  loadArtistById,
  loadArtistByArtworkText,
};
