const { normalizeSearchQuery } = require("../../services/search-engine");

function createHomeSearchState(_artworks, query, options) {
  const normalizedQuery = normalizeSearchQuery(query);
  const searchMode = Boolean(normalizedQuery);
  const results = options && Array.isArray(options.results) ? options.results : [];
  return {
    searchQuery: String(query || ""),
    searchMode,
    searchResults: searchMode ? results : [],
  };
}

module.exports = {
  createHomeSearchState,
  normalizeSearchQuery,
};
