const { fallbackArtworks, fallbackById, normalizeArtwork } = require("../data/fallback-artworks");
const {
  expandSearchQueries,
  normalizeSearchText,
  searchArtworks: searchIndexedArtworks,
} = require("./search-engine");

const PAGE_SIZE = 20;
const SEARCH_CORPUS_BATCH_SIZE = 20;
const SEARCH_CORPUS_MAX_ROWS = 5000;
const SEARCH_CANDIDATE_FIELDS = [
  "title_cn",
  "title_en",
  "artist",
  "tags_text",
  "medium",
  "year_and_place",
  "location",
  "description",
];
const SEARCH_CANDIDATE_PAGE_COUNT = 3;
const SEARCH_CANDIDATE_CONCURRENCY = 6;
let searchCorpusCache = null;
let searchCorpusPromise = null;
let searchCandidateCache = {};

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

function matchesSearchQuery(item, query) {
  return searchIndexedArtworks([item], query).length > 0;
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
  const total = await countPublishedArtworks();
  if (!total) return [];

  const db = database();
  const batchCount = Math.max(1, Math.ceil(pageSize / batchSize));
  const queries = [];
  const maxSkip = Math.max(0, total - batchSize);

  for (let index = 0; index < batchCount; index += 1) {
    const skip = Math.floor(Math.random() * (maxSkip + 1));
    queries.push(
      db
        .collection("artworks")
        .where({ status: "published" })
        .orderBy("created_at", "desc")
        .skip(skip)
        .limit(batchSize)
        .get(),
    );
  }

  const results = await Promise.all(queries);
  const seen = {};
  const artworks = [];
  results.forEach((result) => {
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

async function fetchArtworksByTag(tag, options) {
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

async function countArtworksByTag(tag) {
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

function createSearchFieldRegexp(db, keyword) {
  return db.RegExp({
    regexp: escapeRegExp(keyword),
    options: "i",
  });
}

function createSearchCandidateTasks(db, keywords, candidateLimit) {
  const command = db.command;
  const pageCount = Math.max(1, Math.ceil(candidateLimit / PAGE_SIZE));
  const safePageCount = Math.min(pageCount, SEARCH_CANDIDATE_PAGE_COUNT);
  const tasks = [];

  keywords.forEach((keyword) => {
    if (command && typeof command.or === "function") {
      const clauses = SEARCH_CANDIDATE_FIELDS.map((field) => ({
        status: "published",
        [field]: createSearchFieldRegexp(db, keyword),
      }));

      for (let page = 0; page < safePageCount; page += 1) {
        const skip = page * PAGE_SIZE;
        tasks.push(() => db
          .collection("artworks")
          .where(command.or(clauses))
          .orderBy("created_at", "desc")
          .skip(skip)
          .limit(PAGE_SIZE)
          .get());
      }
      return;
    }

    SEARCH_CANDIDATE_FIELDS.forEach((field) => {
      for (let page = 0; page < Math.min(2, safePageCount); page += 1) {
        const skip = page * PAGE_SIZE;
        tasks.push(() => db
          .collection("artworks")
          .where({
            status: "published",
            [field]: createSearchFieldRegexp(db, keyword),
          })
          .orderBy("created_at", "desc")
          .skip(skip)
          .limit(PAGE_SIZE)
          .get());
      }
    });
  });

  return tasks;
}

async function fetchSearchCandidates(query, options) {
  const keywords = expandSearchQueries(query);
  if (!keywords.length) return [];

  const candidateLimit = Math.max(Number((options && options.candidateLimit) || 0), PAGE_SIZE * SEARCH_CANDIDATE_PAGE_COUNT);
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
  const candidateLimit = Math.max(pageSize + skip, pageSize * 3, PAGE_SIZE * SEARCH_CANDIDATE_PAGE_COUNT);
  const candidates = await fetchSearchCandidates(query, { candidateLimit });
  return searchIndexedArtworks(candidates, query).slice(skip, skip + pageSize);
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
  const names = (Array.isArray(aliases) ? aliases : [aliases]).filter(Boolean).map((name) => String(name).toLowerCase());
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
  fetchArtworksByTag,
  countArtworksByTag,
  fetchArtworksByArtistAliases,
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
  expandSearchQueries,
  normalizeSearchText,
};
