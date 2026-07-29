const SEARCH_SOURCE_FIELDS = [
  "title_cn",
  "title_en",
  "title",
  "artist",
  "artist_display",
  "tags",
  "tags_text",
  "tag_keys",
  "medium",
  "year_and_place",
  "location",
  "description",
];

const MAX_CJK_GRAM = 3;
const MAX_LATIN_PREFIX = 12;
const MAX_ARTWORK_SEARCH_TERMS = 900;
const MAX_QUERY_TERMS = 24;

function normalizeSearchTermText(value) {
  let text = String(value == null ? "" : value);
  if (typeof text.normalize === "function") {
    text = text.normalize("NFKD");
  }
  return text
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^0-9a-z\u3400-\u9fff]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stringValues(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => stringValues(item));
  }
  if (value == null) return [];
  const text = String(value).trim();
  return text ? [text] : [];
}

function addTerm(target, value, limit) {
  if (target.size >= limit) return;
  const term = String(value || "").trim();
  if (term) target.add(term);
}

function addCjkIndexTerms(target, normalized, limit) {
  const segments = normalized.match(/[\u3400-\u9fff]+/g) || [];
  segments.forEach((segment) => {
    const maxLength = Math.min(MAX_CJK_GRAM, segment.length);
    for (let size = 1; size <= maxLength && target.size < limit; size += 1) {
      for (let start = 0; start + size <= segment.length && target.size < limit; start += 1) {
        addTerm(target, segment.slice(start, start + size), limit);
      }
    }
  });
}

function addLatinIndexTerms(target, normalized, limit) {
  const words = normalized.match(/[a-z0-9]+/g) || [];
  words.forEach((word) => {
    const prefixLimit = Math.min(MAX_LATIN_PREFIX, word.length);
    for (let size = 1; size <= prefixLimit && target.size < limit; size += 1) {
      addTerm(target, word.slice(0, size), limit);
    }
    addTerm(target, word, limit);
  });
}

function buildArtworkSearchTerms(artwork, options) {
  const limit = Math.max(1, Number((options && options.limit) || MAX_ARTWORK_SEARCH_TERMS));
  const terms = new Set();

  SEARCH_SOURCE_FIELDS.forEach((field) => {
    stringValues(artwork && artwork[field]).forEach((value) => {
      if (terms.size >= limit) return;
      const normalized = normalizeSearchTermText(value);
      if (!normalized) return;
      addCjkIndexTerms(terms, normalized, limit);
      addLatinIndexTerms(terms, normalized, limit);
    });
  });

  return Array.from(terms);
}

function buildSearchQueryTerms(query) {
  const normalized = normalizeSearchTermText(query);
  if (!normalized) return [];

  const terms = new Set();
  const cjkSegments = normalized.match(/[\u3400-\u9fff]+/g) || [];
  cjkSegments.forEach((segment) => {
    if (segment.length <= MAX_CJK_GRAM) {
      addTerm(terms, segment, MAX_QUERY_TERMS);
      return;
    }
    for (
      let start = 0;
      start + MAX_CJK_GRAM <= segment.length && terms.size < MAX_QUERY_TERMS;
      start += 1
    ) {
      addTerm(terms, segment.slice(start, start + MAX_CJK_GRAM), MAX_QUERY_TERMS);
    }
  });

  const words = normalized.match(/[a-z0-9]+/g) || [];
  words.forEach((word) => addTerm(terms, word, MAX_QUERY_TERMS));

  return Array.from(terms);
}

module.exports = {
  MAX_ARTWORK_SEARCH_TERMS,
  SEARCH_SOURCE_FIELDS,
  buildArtworkSearchTerms,
  buildSearchQueryTerms,
  normalizeSearchTermText,
};
