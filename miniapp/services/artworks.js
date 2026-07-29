const { fallbackArtworks, fallbackById, normalizeArtwork } = require("../data/fallback-artworks");
const {
  expandSearchQueries,
  normalizeSearchText,
  searchArtworks: searchIndexedArtworks,
} = require("./search-engine");
const { buildSearchQueryTerms } = require("./search-terms");

const PAGE_SIZE = 20;
const SEARCH_CORPUS_BATCH_SIZE = 20;
const SEARCH_CORPUS_MAX_ROWS = 5000;
const SEARCH_CANDIDATE_PAGE_COUNT = 3;
const SEARCH_CANDIDATE_CONCURRENCY = 6;
const RANDOM_ARTWORK_CONCURRENCY = 2;
const RANDOM_SECTION_CONCURRENCY = 3;
const SECTION_COUNT_CACHE_TTL_MS = 5 * 60 * 1000;
let searchCorpusCache = null;
let searchCorpusPromise = null;
let searchCandidateCache = {};
let sectionCountCache = {};

function shuffleItems(items, random = Math.random) {
  const shuffled = items.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = current;
  }
  return shuffled;
}

function getArtworkArtistKey(item) {
  const artistIds = Array.isArray(item && item.artist_ids) ? item.artist_ids.filter(Boolean) : [];
  return String(
    artistIds[0] ||
      (item && (item.artist_id || item.artistId || item.artist)) ||
      `unknown:${getArtworkKey(item) || ""}`,
  )
    .trim()
    .toLowerCase();
}

function diversifyArtworksByArtist(items, options = {}) {
  const random = typeof options.random === "function" ? options.random : Math.random;
  const groups = [];
  const groupsByArtist = {};

  shuffleItems(items || [], random).forEach((item) => {
    const artistKey = getArtworkArtistKey(item);
    if (!groupsByArtist[artistKey]) {
      groupsByArtist[artistKey] = { artistKey, items: [] };
      groups.push(groupsByArtist[artistKey]);
    }
    groupsByArtist[artistKey].items.push(item);
  });

  const diversified = [];
  let activeGroups = shuffleItems(groups, random);
  while (activeGroups.length) {
    const nextGroups = [];
    activeGroups.forEach((group) => {
      const item = group.items.shift();
      if (item) diversified.push(item);
      if (group.items.length) nextGroups.push(group);
    });
    activeGroups = shuffleItems(nextGroups, random);
  }
  return diversified;
}

function cloudAvailable() {
  return Boolean(wx.cloud && wx.cloud.database);
}

function database() {
  if (!cloudAvailable()) {
    throw new Error("微信云开发尚未开启");
  }
  return wx.cloud.database();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeError(error) {
  if (!error) return "云数据库读取失败";
  return error.errMsg || error.message || String(error);
}

function getArtworkKey(item) {
  return item && (item._id || item.id || item.supabase_id || item.source_id || item.title);
}

function addUniqueNormalizedArtworks(target, incoming, seen, limit) {
  (incoming || []).forEach((record) => {
    if (target.length >= limit) return;
    const normalized = normalizeArtwork(record);
    const id = getArtworkKey(normalized);
    if (!id || seen[id]) return;
    seen[id] = true;
    target.push(normalized);
  });
}

async function runLimited(tasks, concurrency) {
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < tasks.length) {
      const current = cursor;
      cursor += 1;
      results[current] = await tasks[current]();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

async function fetchLatestArtworks(options) {
  const pageSize = (options && options.pageSize) || PAGE_SIZE;
  const skip = (options && options.skip) || 0;
  const db = database();
  const result = await db
    .collection("artworks")
    .where({ status: "published" })
    .orderBy("created_at", "desc")
    .skip(skip)
    .limit(pageSize)
    .get();
  return (result.data || []).map(normalizeArtwork);
}

async function countPublishedArtworks() {
  const db = database();
  const result = await db.collection("artworks").where({ status: "published" }).count();
  return Number(result.total || 0);
}

async function countRecommendationEligibleArtworks() {
  const db = database();
  const result = await db
    .collection("artworks")
    .where({
      status: "published",
      recommendation_status: "eligible",
    })
    .count();
  return Number(result.total || 0);
}

function searchCorpusFields() {
  return {
    _id: true,
    supabase_id: true,
    slug: true,
    title_cn: true,
    title_en: true,
    artist: true,
    year_and_place: true,
    location: true,
    medium: true,
    dimensions: true,
    description: true,
    tags: true,
    tags_text: true,
    tag_keys: true,
    search_terms: true,
    source_name: true,
    source_url: true,
    image_id: true,
    thumbnail_url: true,
    display_url: true,
    download_url: true,
    cloud_file_id: true,
    status: true,
    created_at: true,
    updated_at: true,
  };
}

async function fetchSearchCorpus(options) {
  if (searchCorpusCache && !(options && options.force)) return searchCorpusCache;
  if (searchCorpusPromise && !(options && options.force)) return searchCorpusPromise;

  searchCorpusPromise = (async () => {
    const db = database();
    const total = Math.min(await countPublishedArtworks(), SEARCH_CORPUS_MAX_ROWS);
    const rows = [];

    for (let skip = 0; skip < total; skip += SEARCH_CORPUS_BATCH_SIZE) {
      let query = db.collection("artworks").where({ status: "published" });
      if (typeof query.field === "function") {
        query = query.field(searchCorpusFields());
      }

      const result = await query
        .orderBy("created_at", "desc")
        .skip(skip)
        .limit(SEARCH_CORPUS_BATCH_SIZE)
        .get();

      const data = result.data || [];
      rows.push(...data.map(normalizeArtwork));
      if (data.length < SEARCH_CORPUS_BATCH_SIZE) break;
    }

    searchCorpusCache = rows;
    searchCorpusPromise = null;
    return rows;
  })().catch((error) => {
    searchCorpusPromise = null;
    throw error;
  });

  return searchCorpusPromise;
}

async function fetchRandomArtworks(options) {
  const pageSize = (options && options.pageSize) || 96;
  const batchSize = (options && options.batchSize) || PAGE_SIZE;
  const requestedConcurrency = Number(
    (options && options.concurrency) || RANDOM_ARTWORK_CONCURRENCY,
  );
  const concurrency =
    Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
      ? Math.floor(requestedConcurrency)
      : RANDOM_ARTWORK_CONCURRENCY;
  const eligibleTotal = await countRecommendationEligibleArtworks();
  const usesRecommendationPool = eligibleTotal > 0;
  const total = usesRecommendationPool ? eligibleTotal : await countPublishedArtworks();
  if (!total) return [];

  const db = database();
  const batchCount = Math.max(1, Math.ceil(pageSize / batchSize));
  const tasks = [];
  const maxSkip = Math.max(0, total - batchSize);

  for (let index = 0; index < batchCount; index += 1) {
    const skip = Math.floor(Math.random() * (maxSkip + 1));
    tasks.push(async () => {
      try {
        return await db
          .collection("artworks")
          .where(
            usesRecommendationPool
              ? { status: "published", recommendation_status: "eligible" }
              : { status: "published" },
          )
          .orderBy(usesRecommendationPool ? "random_bucket" : "created_at", "asc")
          .orderBy("_id", "asc")
          .skip(skip)
          .limit(batchSize)
          .get();
      } catch (error) {
        return { data: [], error };
      }
    });
  }

  const results = await runLimited(tasks, concurrency);
  const successfulResults = results.filter((result) => !(result && result.error));
  if (!successfulResults.length) {
    const failedResult = results.find((result) => result && result.error);
    throw (failedResult && failedResult.error) || new Error("云数据库读取超时");
  }

  const seen = {};
  const artworks = [];
  successfulResults.forEach((result) => {
    (result.data || []).forEach((record) => {
      const normalized = normalizeArtwork(record);
      const id = getArtworkKey(normalized);
      if (!id || seen[id]) return;
      seen[id] = true;
      artworks.push(normalized);
    });
  });

  return shuffleItems(artworks).slice(0, pageSize);
}

async function fetchRecommendationChannels(options) {
  const limit = Math.max(1, Math.min(200, Math.floor(Number(options && options.limit) || 180)));
  const db = database();
  const rows = [];
  for (let skip = 0; skip < limit; skip += PAGE_SIZE) {
    const batchSize = Math.min(PAGE_SIZE, limit - skip);
    const result = await db
      .collection("recommendation_channels")
      .where({
        channel_status: "published",
        auto_feature_eligible: true,
      })
      .orderBy("priority_score", "desc")
      .skip(skip)
      .limit(batchSize)
      .get();
    const batch = result.data || [];
    rows.push(...batch);
    if (batch.length < batchSize) break;
  }
  return rows;
}

function getTagId(tag) {
  if (!tag || typeof tag === "string") return "";
  return String(tag.id || tag._id || tag.tag_id || tag.tagId || "").trim();
}

function getTagLabel(tag) {
  if (typeof tag === "string") return tag;
  if (!tag) return "";
  return String(tag.label || tag.label_zh || tag.labelZh || tag.name || tag.text || "").trim();
}

function createArrayContainsWhereClause(db, field, value) {
  if (!value || !db.command || typeof db.command.all !== "function") return null;
  return {
    status: "published",
    [field]: db.command.all([value]),
  };
}

function getSelectedClassificationIds(filters) {
  return [filters && filters.style, filters && filters.subject, filters && filters.decade]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function createCategoryWhereClause(db, filters) {
  const ids = getSelectedClassificationIds(filters);
  if (!ids.length) return { status: "published" };
  if (!db.command || typeof db.command.all !== "function") {
    throw new Error("WeChat Cloud array-all query is unavailable.");
  }
  return {
    status: "published",
    classification_ids: db.command.all(ids),
  };
}

async function fetchArtworksByCategoryFilters(filters, options) {
  const pageSize = (options && options.pageSize) || PAGE_SIZE;
  const skip = (options && options.skip) || 0;
  const db = database();
  const whereClause = createCategoryWhereClause(db, filters);
  const result = await db
    .collection("artworks")
    .where(whereClause)
    .orderBy("created_at", "desc")
    .orderBy("_id", "desc")
    .skip(skip)
    .limit(pageSize)
    .get();
  return (result.data || []).map(normalizeArtwork);
}

async function countArtworksByCategoryFilters(filters) {
  const db = database();
  const whereClause = createCategoryWhereClause(db, filters);
  const result = await db.collection("artworks").where(whereClause).count();
  return Number(result.total || 0);
}

async function fetchArtworksByTagId(tagId, options) {
  const pageSize = (options && options.pageSize) || PAGE_SIZE;
  const skip = (options && options.skip) || 0;
  const randomOrder = Boolean(options && options.randomOrder);
  const db = database();
  const whereClause = createArrayContainsWhereClause(db, "tag_ids", String(tagId || "").trim());
  if (!whereClause) return [];

  let query = db.collection("artworks").where(whereClause);
  query = randomOrder
    ? query.orderBy("random_bucket", "asc").orderBy("_id", "asc")
    : query.orderBy("created_at", "desc");
  const result = await query.skip(skip).limit(pageSize).get();
  return (result.data || []).map(normalizeArtwork);
}

async function countArtworksByTagId(tagId) {
  const db = database();
  const whereClause = createArrayContainsWhereClause(db, "tag_ids", String(tagId || "").trim());
  if (!whereClause) return 0;

  const result = await db.collection("artworks").where(whereClause).count();
  return Number(result.total || 0);
}

async function fetchArtworksByTagLabel(tag, options) {
  const pageSize = (options && options.pageSize) || PAGE_SIZE;
  const skip = (options && options.skip) || 0;
  const db = database();
  const command = db.command;
  const result = await db
    .collection("artworks")
    .where({
      status: "published",
      tag_keys: command.all([tag]),
    })
    .orderBy("created_at", "desc")
    .skip(skip)
    .limit(pageSize)
    .get();
  return (result.data || []).map(normalizeArtwork);
}

async function countArtworksByTagLabel(tag) {
  const db = database();
  const command = db.command;
  const result = await db
    .collection("artworks")
    .where({
      status: "published",
      tag_keys: command.all([tag]),
    })
    .count();
  return Number(result.total || 0);
}

async function fetchArtworksByTag(tag, options) {
  const tagId = getTagId(tag);
  const tagLabel = getTagLabel(tag);
  const skip = (options && options.skip) || 0;

  if (tagId) {
    const normalizedRows = await fetchArtworksByTagId(tagId, options);
    if (normalizedRows.length > 0 || skip > 0 || !tagLabel) {
      return normalizedRows;
    }
  }

  if (!tagLabel) return [];
  return fetchArtworksByTagLabel(tagLabel, options);
}

async function countArtworksByTag(tag) {
  const tagId = getTagId(tag);
  const tagLabel = getTagLabel(tag);

  if (tagId) {
    const normalizedCount = await countArtworksByTagId(tagId);
    if (normalizedCount > 0 || !tagLabel) {
      return normalizedCount;
    }
  }

  if (!tagLabel) return 0;
  return countArtworksByTagLabel(tagLabel);
}

async function fetchArtworksByClassificationId(classificationId, options) {
  const pageSize = (options && options.pageSize) || PAGE_SIZE;
  const skip = (options && options.skip) || 0;
  const db = database();
  const whereClause = createArrayContainsWhereClause(
    db,
    "classification_ids",
    String(classificationId || "").trim(),
  );
  if (!whereClause) return [];

  const result = await db
    .collection("artworks")
    .where(whereClause)
    .orderBy("created_at", "desc")
    .skip(skip)
    .limit(pageSize)
    .get();
  return (result.data || []).map(normalizeArtwork);
}

async function countArtworksByClassificationId(classificationId) {
  const db = database();
  const whereClause = createArrayContainsWhereClause(
    db,
    "classification_ids",
    String(classificationId || "").trim(),
  );
  if (!whereClause) return 0;

  const result = await db.collection("artworks").where(whereClause).count();
  return Number(result.total || 0);
}

async function fetchArtworksByRecommendationSignalId(signalId, options) {
  const pageSize = (options && options.pageSize) || PAGE_SIZE;
  const skip = (options && options.skip) || 0;
  const db = database();
  const whereClause = createArrayContainsWhereClause(
    db,
    "recommendation_signal_ids",
    String(signalId || "").trim(),
  );
  if (!whereClause) return [];

  const result = await db
    .collection("artworks")
    .where(whereClause)
    .orderBy("random_bucket", "asc")
    .orderBy("_id", "asc")
    .skip(skip)
    .limit(pageSize)
    .get();
  return (result.data || []).map(normalizeArtwork);
}

async function countArtworksByRecommendationSignalId(signalId) {
  const db = database();
  const whereClause = createArrayContainsWhereClause(
    db,
    "recommendation_signal_ids",
    String(signalId || "").trim(),
  );
  if (!whereClause) return 0;

  const result = await db.collection("artworks").where(whereClause).count();
  return Number(result.total || 0);
}

function normalizeSectionQuery(section) {
  if (typeof section === "string") {
    return { type: "tag", id: "", label: section.trim() };
  }
  return {
    type: String((section && section.type) || "tag").trim(),
    id: String((section && section.id) || "").trim(),
    label: String((section && section.label) || "").trim(),
  };
}

async function fetchArtworksBySection(section, options) {
  const query = normalizeSectionQuery(section);
  if (query.type === "artist" && query.id) {
    return fetchArtworksByArtistId(query.id, options);
  }
  if (query.type === "classification" && query.id) {
    return fetchArtworksByClassificationId(query.id, options);
  }
  if (query.type === "signal" && query.id) {
    const normalizedCount = await countArtworksByRecommendationSignalId(query.id);
    if (normalizedCount > 0 || !query.label) {
      return fetchArtworksByRecommendationSignalId(query.id, options);
    }
    return fetchArtworksByTagLabel(query.label, options);
  }
  return fetchArtworksByTag(query.id ? { id: query.id, label: query.label } : query.label, options);
}

async function countArtworksBySection(section) {
  const query = normalizeSectionQuery(section);
  if (query.type === "artist" && query.id) {
    return countArtworksByArtistId(query.id);
  }
  if (query.type === "classification" && query.id) {
    return countArtworksByClassificationId(query.id);
  }
  if (query.type === "signal" && query.id) {
    const normalizedCount = await countArtworksByRecommendationSignalId(query.id);
    if (normalizedCount > 0 || !query.label) return normalizedCount;
    return countArtworksByTagLabel(query.label);
  }
  return countArtworksByTag(query.id ? { id: query.id, label: query.label } : query.label);
}

function getSectionCountCacheKey(section) {
  const query = normalizeSectionQuery(section);
  return `${query.type}:${query.id || query.label}`;
}

async function getCachedArtworkCountBySection(section, options = {}) {
  const cacheKey = getSectionCountCacheKey(section);
  const cached = sectionCountCache[cacheKey];
  if (!options.forceCount && cached && Date.now() - cached.cachedAt < SECTION_COUNT_CACHE_TTL_MS) {
    return cached.total;
  }

  const total = await countArtworksBySection(section);
  sectionCountCache[cacheKey] = {
    total,
    cachedAt: Date.now(),
  };
  return total;
}

async function fetchRandomArtworksBySection(section, options = {}) {
  const query = normalizeSectionQuery(section);
  const pageSize = Math.max(1, Math.floor(Number(options.pageSize) || PAGE_SIZE));
  const random = typeof options.random === "function" ? options.random : Math.random;
  const excluded = {};
  (Array.isArray(options.excludeIds) ? options.excludeIds : []).forEach((value) => {
    const key = String(value || "").trim();
    if (key) excluded[key] = true;
  });

  const total = await getCachedArtworkCountBySection(query, options);
  const excludedCount = Object.keys(excluded).length;
  const remainingCount = Math.max(0, total - excludedCount);
  if (!total || !remainingCount) {
    return {
      items: [],
      total,
      hasMore: false,
    };
  }

  const wantedCount = Math.min(pageSize, remainingCount);
  const batchSize = Math.min(PAGE_SIZE, Math.max(pageSize, 8));
  const windowCount = Math.max(1, Math.ceil(total / batchSize));
  const candidateTarget = Math.min(total, Math.max(wantedCount, wantedCount * 3));
  const initialWindowCount = Math.min(
    windowCount,
    Math.max(1, Math.ceil(candidateTarget / batchSize)),
  );
  const windowIndexes = shuffleItems(
    Array.from({ length: windowCount }, (_, index) => index),
    random,
  );
  const firstWindowIndexes = windowIndexes.slice(0, initialWindowCount);
  const remainingWindowIndexes = windowIndexes.slice(initialWindowCount);
  const seen = { ...excluded };
  const candidates = [];

  const collectRows = (rows) => {
    (rows || []).forEach((item) => {
      const key = getArtworkKey(item);
      if (!key || seen[key]) return;
      seen[key] = true;
      candidates.push(item);
    });
  };
  const fetchWindow = (windowIndex) =>
    fetchArtworksBySection(query, {
      pageSize: batchSize,
      skip: windowIndex * batchSize,
      randomOrder: true,
    });

  const firstResults = await runLimited(
    firstWindowIndexes.map((windowIndex) => () => fetchWindow(windowIndex)),
    Math.max(1, Math.floor(Number(options.concurrency) || RANDOM_SECTION_CONCURRENCY)),
  );
  firstResults.forEach(collectRows);

  for (
    let index = 0;
    index < remainingWindowIndexes.length && candidates.length < wantedCount;
    index += 1
  ) {
    collectRows(await fetchWindow(remainingWindowIndexes[index]));
  }

  const items = diversifyArtworksByArtist(candidates, { random }).slice(0, wantedCount);
  return {
    items,
    total,
    hasMore: excludedCount + items.length < total,
  };
}

async function fetchArtworksByArtistAliases(aliases, options) {
  const pageSize = (options && options.pageSize) || PAGE_SIZE;
  const skip = (options && options.skip) || 0;
  const maxPages = (options && options.maxPages) || 100;
  const targetCount = skip + pageSize;
  const db = database();
  const names = (Array.isArray(aliases) ? aliases : [aliases]).filter(Boolean);
  const seen = {};
  const artworks = [];

  for (const name of names) {
    if (artworks.length >= targetCount) break;
    for (let page = 0; page < maxPages; page += 1) {
      if (artworks.length >= targetCount) break;
      const result = await db
        .collection("artworks")
        .where({
          status: "published",
          artist: db.RegExp({
            regexp: escapeRegExp(name),
            options: "i",
          }),
        })
        .orderBy("created_at", "desc")
        .skip(page * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .get();
      const rows = result.data || [];
      rows.forEach((record) => {
        const normalized = normalizeArtwork(record);
        const id = getArtworkKey(normalized);
        if (!id || seen[id] || artworks.length >= targetCount) return;
        seen[id] = true;
        artworks.push(normalized);
      });
      if (rows.length < PAGE_SIZE) break;
    }
  }

  return artworks.slice(skip, targetCount);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function getArtistPrimaryTag(artist) {
  if (!artist || Array.isArray(artist)) return "";
  return String(artist.nameZh || artist.name_zh || "").trim();
}

function getArtistAliases(artist) {
  if (Array.isArray(artist)) return artist;
  if (!artist) return [];
  return [
    artist.nameZh || artist.name_zh,
    artist.nameEn || artist.name_en,
    ...asArray(artist.aliases),
  ].filter(Boolean);
}

function getArtistId(artist) {
  if (!artist || Array.isArray(artist)) return "";
  return String(artist.id || artist._id || artist.artist_id || artist.artistId || "").trim();
}

function canQueryArtistByTag(db, artist) {
  return Boolean(getArtistPrimaryTag(artist) && db.command && typeof db.command.all === "function");
}

function getArtistMatchClauses(db, artist) {
  const clauses = [];
  const primaryTag = getArtistPrimaryTag(artist);
  const aliases = [];
  const seen = {};

  if (canQueryArtistByTag(db, artist)) {
    clauses.push({
      status: "published",
      tag_keys: db.command.all([primaryTag]),
    });
  }

  getArtistAliases(artist).forEach((name) => {
    const value = String(name || "").trim();
    if (!value || seen[value]) return;
    seen[value] = true;
    aliases.push(value);
  });

  aliases.forEach((name) => {
    clauses.push({
      status: "published",
      artist: db.RegExp({
        regexp: escapeRegExp(name),
        options: "i",
      }),
    });
  });

  return clauses;
}

function createArtistWhereClause(db, artist) {
  const clauses = getArtistMatchClauses(db, artist);
  if (!clauses.length) return null;
  if (clauses.length === 1) return clauses[0];
  if (db.command && typeof db.command.or === "function") {
    return db.command.or(clauses);
  }
  return clauses[0];
}

async function fetchArtworksByArtist(artist, options) {
  const skip = (options && options.skip) || 0;
  const artistId = getArtistId(artist);
  const aliases = getArtistAliases(artist);

  if (artistId) {
    const normalizedRows = await fetchArtworksByArtistId(artistId, options);
    if (normalizedRows.length > 0 || skip > 0 || !aliases.length) {
      return normalizedRows;
    }
  }

  const pageSize = (options && options.pageSize) || PAGE_SIZE;
  const db = database();
  const whereClause = createArtistWhereClause(db, artist);

  if (whereClause) {
    const result = await db
      .collection("artworks")
      .where(whereClause)
      .orderBy("created_at", "desc")
      .skip(skip)
      .limit(pageSize)
      .get();
    return (result.data || []).map(normalizeArtwork);
  }

  return fetchArtworksByArtistAliases(getArtistAliases(artist), options);
}

async function countArtworksByArtist(artist) {
  const artistId = getArtistId(artist);
  const aliases = getArtistAliases(artist);

  if (artistId) {
    const normalizedCount = await countArtworksByArtistId(artistId);
    if (normalizedCount > 0 || !aliases.length) {
      return normalizedCount;
    }
  }

  const db = database();
  const whereClause = createArtistWhereClause(db, artist);

  if (whereClause) {
    const result = await db.collection("artworks").where(whereClause).count();
    return Number(result.total || 0);
  }

  const artworks = await fetchArtworksByArtistAliases(getArtistAliases(artist), {
    pageSize: SEARCH_CORPUS_MAX_ROWS,
    skip: 0,
    maxPages: Math.ceil(SEARCH_CORPUS_MAX_ROWS / PAGE_SIZE),
  });
  return artworks.length;
}

async function fetchArtworksByArtistId(artistId, options) {
  const pageSize = (options && options.pageSize) || PAGE_SIZE;
  const skip = (options && options.skip) || 0;
  const randomOrder = Boolean(options && options.randomOrder);
  const db = database();
  const whereClause = createArrayContainsWhereClause(
    db,
    "artist_ids",
    String(artistId || "").trim(),
  );
  if (!whereClause) return [];

  let query = db.collection("artworks").where(whereClause);
  query = randomOrder
    ? query.orderBy("random_bucket", "asc").orderBy("_id", "asc")
    : query.orderBy("created_at", "desc");
  const result = await query.skip(skip).limit(pageSize).get();
  return (result.data || []).map(normalizeArtwork);
}

async function countArtworksByArtistId(artistId) {
  const db = database();
  const whereClause = createArrayContainsWhereClause(
    db,
    "artist_ids",
    String(artistId || "").trim(),
  );
  if (!whereClause) return 0;

  const result = await db.collection("artworks").where(whereClause).count();
  return Number(result.total || 0);
}

function createSearchCandidateTasks(db, keywords, candidateLimit) {
  const command = db.command;
  if (!command || typeof command.all !== "function") {
    throw new Error("当前云数据库不支持数组全量匹配查询");
  }

  const pageCount = Math.max(1, Math.ceil(candidateLimit / PAGE_SIZE));
  const safePageCount = Math.min(pageCount, SEARCH_CANDIDATE_PAGE_COUNT);
  const tasks = [];
  const seenQueries = {};

  keywords.forEach((keyword) => {
    const queryTerms = buildSearchQueryTerms(keyword);
    const queryKey = queryTerms.join("\u0000");
    if (!queryTerms.length || seenQueries[queryKey]) return;
    seenQueries[queryKey] = true;

    for (let page = 0; page < safePageCount; page += 1) {
      const skip = page * PAGE_SIZE;
      tasks.push(() =>
        db
          .collection("artworks")
          .where({
            status: "published",
            search_terms: command.all(queryTerms),
          })
          .orderBy("created_at", "desc")
          .skip(skip)
          .limit(PAGE_SIZE)
          .get(),
      );
    }
  });

  return tasks;
}

async function fetchSearchCandidates(query, options) {
  const keywords = expandSearchQueries(query);
  if (!keywords.length) return [];

  const candidateLimit = Math.max(
    Number((options && options.candidateLimit) || 0),
    PAGE_SIZE * SEARCH_CANDIDATE_PAGE_COUNT,
  );
  const cacheKey = `${normalizeSearchText(query)}:${candidateLimit}`;
  if (searchCandidateCache[cacheKey]) return searchCandidateCache[cacheKey];

  const db = database();
  const tasks = createSearchCandidateTasks(db, keywords, candidateLimit);
  const results = await runLimited(tasks, SEARCH_CANDIDATE_CONCURRENCY);
  const seen = {};
  const candidates = [];
  results.forEach((result) => {
    addUniqueNormalizedArtworks(candidates, (result && result.data) || [], seen, candidateLimit);
  });

  searchCandidateCache[cacheKey] = candidates;
  return candidates;
}

async function searchArtworks(query, options) {
  const keywords = expandSearchQueries(query);
  if (!keywords.length) return [];

  const pageSize = (options && options.pageSize) || PAGE_SIZE;
  const skip = (options && options.skip) || 0;
  const candidateLimit = Math.max(
    pageSize + skip,
    pageSize * 3,
    PAGE_SIZE * SEARCH_CANDIDATE_PAGE_COUNT,
  );
  const candidates = await fetchSearchCandidates(query, { candidateLimit });
  return searchIndexedArtworks(candidates, query, { limit: pageSize, skip });
}

async function fetchArtworkById(id) {
  const db = database();
  const wanted = String(id || "");
  if (!wanted) throw new Error("缺少作品 id");

  try {
    const result = await db.collection("artworks").doc(wanted).get();
    if (result.data) return normalizeArtwork(result.data);
  } catch (error) {
    if (!wanted.startsWith("artwork_")) throw error;
  }

  const sourceId = wanted.replace(/^artwork_/, "");
  const result = await db.collection("artworks").where({ supabase_id: sourceId }).limit(1).get();
  const item = (result.data || [])[0];
  if (!item) throw new Error("未找到作品");
  return normalizeArtwork(item);
}

function fallbackLatestArtworks() {
  return shuffleItems(fallbackArtworks.map(normalizeArtwork));
}

function fallbackArtworksByTag(tag) {
  return fallbackArtworks
    .filter((item) => {
      const tags = Array.isArray(item.tag_keys) ? item.tag_keys : item.tags || [];
      return tags.includes(tag);
    })
    .map(normalizeArtwork);
}

function fallbackArtworkCountByTag(tag) {
  return fallbackArtworksByTag(tag).length;
}

function fallbackArtworksByArtistAliases(aliases) {
  const names = (Array.isArray(aliases) ? aliases : [aliases])
    .filter(Boolean)
    .map((name) => String(name).toLowerCase());
  return fallbackArtworks
    .filter((item) => {
      const artist = String(item.artist || "").toLowerCase();
      return names.some((name) => artist.includes(name));
    })
    .map(normalizeArtwork);
}

function fallbackSearchArtworks(query) {
  return searchIndexedArtworks(fallbackArtworks.map(normalizeArtwork), query);
}

function fallbackArtworkById(id) {
  const item = fallbackById(id);
  return item ? normalizeArtwork(item) : normalizeArtwork(fallbackArtworks[0]);
}

module.exports = {
  PAGE_SIZE,
  fetchLatestArtworks,
  fetchRandomArtworks,
  countPublishedArtworks,
  countRecommendationEligibleArtworks,
  fetchRecommendationChannels,
  getSelectedClassificationIds,
  fetchArtworksByCategoryFilters,
  countArtworksByCategoryFilters,
  fetchArtworksByTagId,
  countArtworksByTagId,
  fetchArtworksByTag,
  countArtworksByTag,
  fetchArtworksByClassificationId,
  countArtworksByClassificationId,
  fetchArtworksByRecommendationSignalId,
  countArtworksByRecommendationSignalId,
  fetchArtworksBySection,
  fetchRandomArtworksBySection,
  countArtworksBySection,
  fetchArtworksByArtistId,
  countArtworksByArtistId,
  fetchArtworksByArtistAliases,
  fetchArtworksByArtist,
  countArtworksByArtist,
  fetchSearchCorpus,
  searchArtworks,
  fetchArtworkById,
  fallbackLatestArtworks,
  fallbackArtworksByTag,
  fallbackArtworkCountByTag,
  fallbackArtworksByArtistAliases,
  fallbackSearchArtworks,
  fallbackArtworkById,
  normalizeError,
  diversifyArtworksByArtist,
  expandSearchQueries,
  normalizeSearchText,
};
