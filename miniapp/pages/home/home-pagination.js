const DEFAULT_ROW_LIMIT = 8;

function getArtworkKey(item) {
  return item && (item._id || item.id || item.supabase_id || item.source_id || item.title);
}

function getFreshArtworkBatch(existingItems, incomingItems, limit) {
  const rowLimit = Number(limit || DEFAULT_ROW_LIMIT);
  const seen = {};
  (existingItems || []).forEach((item) => {
    const key = getArtworkKey(item);
    if (key) seen[key] = true;
  });

  const fresh = [];
  (incomingItems || []).forEach((item) => {
    const key = getArtworkKey(item);
    if (!key || seen[key] || fresh.length >= rowLimit) return;
    seen[key] = true;
    fresh.push(item);
  });
  return fresh;
}

function createPaginatedSection(section, options) {
  const rowLimit = Number((options && options.rowLimit) || DEFAULT_ROW_LIMIT);
  const sourceItems = (section && section.items) || [];
  const items = sourceItems.slice(0, rowLimit);
  const explicitSkip = section && Number(section.skip);
  const skip = Number.isFinite(explicitSkip) ? explicitSkip : items.length;
  const explicitHasMore = section && typeof section.hasMore === "boolean";

  return {
    ...section,
    items,
    skip,
    hasMore: explicitHasMore ? section.hasMore : sourceItems.length >= rowLimit,
    loadingMore: false,
  };
}

module.exports = {
  DEFAULT_ROW_LIMIT,
  createPaginatedSection,
  getArtworkKey,
  getFreshArtworkBatch,
};
