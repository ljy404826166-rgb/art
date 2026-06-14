const { fallbackArtworks, fallbackById, normalizeArtwork } = require("../data/fallback-artworks");

const PAGE_SIZE = 20;
const SEARCH_FIELDS = ["title_cn", "title_en", "artist", "tags_text", "medium", "year_and_place", "location"];

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

function matchesSearchQuery(item, query) {
  const value = String(query || "").trim().toLowerCase();
  if (!value) return false;

  const content = [
    item.title,
    item.titleCn,
    item.titleEn,
    item.artist,
    item.medium,
    item.dimensions,
    item.year,
    item.location,
    item.sourceName,
    ...(item.tags || item.tag_keys || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return content.includes(value);
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
  const db = database();
  const names = (Array.isArray(aliases) ? aliases : [aliases]).filter(Boolean);
  const seen = {};
  const artworks = [];

  for (const name of names) {
    if (artworks.length >= pageSize) break;
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
      .limit(pageSize)
      .get();

    (result.data || []).forEach((record) => {
      const normalized = normalizeArtwork(record);
      const id = getArtworkKey(normalized);
      if (!id || seen[id] || artworks.length >= pageSize) return;
      seen[id] = true;
      artworks.push(normalized);
    });
  }

  return artworks;
}

async function searchArtworks(query, options) {
  const keyword = String(query || "").trim();
  if (!keyword) return [];

  const pageSize = (options && options.pageSize) || PAGE_SIZE;
  const skip = (options && options.skip) || 0;
  const db = database();
  const regexp = escapeRegExp(keyword);
  const seen = {};
  const artworks = [];

  for (const field of SEARCH_FIELDS) {
    if (artworks.length >= pageSize) break;
    const result = await db
      .collection("artworks")
      .where({
        status: "published",
        [field]: db.RegExp({
          regexp,
          options: "i",
        }),
      })
      .orderBy("created_at", "desc")
      .skip(skip)
      .limit(pageSize)
      .get();

    (result.data || []).forEach((record) => {
      const normalized = normalizeArtwork(record);
      const id = getArtworkKey(normalized);
      if (!id || seen[id] || artworks.length >= pageSize) return;
      seen[id] = true;
      artworks.push(normalized);
    });
  }

  return artworks;
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
  return fallbackArtworks.map(normalizeArtwork).filter((item) => matchesSearchQuery(item, query));
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
  searchArtworks,
  fetchArtworkById,
  fallbackLatestArtworks,
  fallbackArtworksByTag,
  fallbackArtworkCountByTag,
  fallbackArtworksByArtistAliases,
  fallbackSearchArtworks,
  fallbackArtworkById,
  normalizeError,
};
