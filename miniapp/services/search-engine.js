const SEARCH_ALIASES = [
  {
    keys: ["达", "达芬奇", "达·芬奇", "列奥纳多", "列奥纳多达芬奇", "leonardo", "da vinci", "davinci", "leonardo da vinci"],
    values: ["列奥纳多·达·芬奇", "列奥纳多", "达·芬奇", "达芬奇", "Leonardo da Vinci", "Da Vinci", "Leonardo"],
  },
];

const SEARCH_FIELD_CONFIG = [
  { keys: ["title", "titleCn", "title_cn"], weight: 180 },
  { keys: ["titleEn", "title_en"], weight: 160 },
  { keys: ["artist", "artistDisplay", "artist_display", "artist_ids", "artist_labels"], weight: 110 },
  { keys: ["description"], weight: 80 },
  { keys: ["tags", "tag_keys", "tag_ids", "tag_labels", "tags_text"], weight: 55 },
  { keys: ["medium"], weight: 45 },
  { keys: ["year", "year_and_place", "period"], weight: 35 },
  { keys: ["location"], weight: 30 },
  { keys: ["sourceName", "source_name", "source_url", "image_id"], weight: 8 },
];

function normalizeSearchQuery(query) {
  return String(query || "").trim();
}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[·\s\-_\u3000,，.。'’"“”()（）:：/\\[\]【】《》<>]/g, "");
}

function expandSearchQueries(query) {
  const keyword = normalizeSearchQuery(query);
  if (!keyword) return [];

  const normalized = normalizeSearchText(keyword);
  const queries = [keyword];

  SEARCH_ALIASES.forEach((group) => {
    const matched = group.keys.some((key) => {
      const normalizedKey = normalizeSearchText(key);
      return normalizedKey && (normalized.includes(normalizedKey) || normalizedKey.includes(normalized));
    });
    if (matched) queries.push(...group.values);
  });

  const seen = {};
  return queries.filter((item) => {
    const key = String(item || "").trim().toLowerCase();
    if (!key || seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function toSearchTokens(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(toSearchTokens);
  if (typeof value === "object") return Object.values(value).flatMap(toSearchTokens);
  return [String(value)];
}

function getFieldValue(item, keys) {
  return keys.flatMap((key) => toSearchTokens(item && item[key])).filter(Boolean).join(" ");
}

function scoreField(fieldText, query) {
  const rawField = String(fieldText || "").toLowerCase();
  const rawQuery = String(query || "").toLowerCase();
  const normalizedField = normalizeSearchText(fieldText);
  const normalizedQuery = normalizeSearchText(query);

  if (!normalizedField || !normalizedQuery) return 0;
  if (normalizedField === normalizedQuery) return 1;
  if (rawField.startsWith(rawQuery) || normalizedField.startsWith(normalizedQuery)) return 0.94;
  if (rawField.includes(rawQuery)) return 0.88;
  if (normalizedField.includes(normalizedQuery)) return 0.78;

  return 0;
}

function getArtworkKey(item) {
  return item && (item._id || item.id || item.supabase_id || item.source_id || item.title || item.title_cn);
}

function scoreArtwork(item, queryVariants) {
  let score = 0;

  SEARCH_FIELD_CONFIG.forEach((field) => {
    const fieldText = getFieldValue(item, field.keys);
    if (!fieldText) return;
    const bestFieldScore = queryVariants.reduce((best, query) => Math.max(best, scoreField(fieldText, query)), 0);
    score += bestFieldScore * field.weight;
  });

  return score;
}

function searchArtworks(artworks, query, options) {
  const queryVariants = expandSearchQueries(query);
  if (!queryVariants.length) return [];

  const limit = Number((options && options.limit) || 0);
  const skip = Number((options && options.skip) || 0);
  const scored = [];
  const seen = {};

  (artworks || []).forEach((item, index) => {
    const key = getArtworkKey(item);
    if (!key || seen[key]) return;
    seen[key] = true;

    const score = scoreArtwork(item, queryVariants);
    if (score <= 0) return;
    scored.push({ item, score, index });
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const results = scored.map((entry) => entry.item);
  return limit > 0 ? results.slice(skip, skip + limit) : results.slice(skip);
}

module.exports = {
  SEARCH_FIELD_CONFIG,
  expandSearchQueries,
  normalizeSearchQuery,
  normalizeSearchText,
  searchArtworks,
  scoreArtwork,
  toSearchTokens,
};
