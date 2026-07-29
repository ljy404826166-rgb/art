const { CATEGORY_GROUPS } = require("../../data/category-catalog");
const { RECOMMENDATION_SIGNALS } = require("../../data/recommendation-signal-catalog");

const classificationByLabel = {};
CATEGORY_GROUPS.forEach((group) => {
  group.tags.forEach((tag) => {
    classificationByLabel[tag.label] = {
      type: "classification",
      id: tag.id,
      label: tag.label,
    };
  });
});

const recommendationSignalByLabel = {};
RECOMMENDATION_SIGNALS.forEach((signal) => {
  recommendationSignalByLabel[signal.label] = {
    type: "signal",
    id: signal.id,
    label: signal.label,
  };
});

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeLookupText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s·・•‧._\-—–（）()[\]{}，,。:：;；'"“”‘’]+/g, "");
}

function findArtistQuery(tag, artworks) {
  const wanted = normalizeLookupText(tag);
  if (!wanted) return null;

  for (const artwork of artworks || []) {
    const artistIds = asArray(artwork && artwork.artist_ids).filter(Boolean);
    if (!artistIds.length) continue;

    const exactLabelMatch = asArray(artwork.artist_labels).some(
      (label) => normalizeLookupText(label) === wanted,
    );
    const artistText = normalizeLookupText(artwork.artist);
    const artistTextMatch = Boolean(
      artistText && (artistText.includes(wanted) || wanted.includes(artistText)),
    );
    if (!exactLabelMatch && !artistTextMatch) continue;

    return {
      type: "artist",
      id: String(artistIds[0]),
      label: String(tag),
    };
  }

  return null;
}

function resolveHomeSectionQuery(tag, artworks) {
  const label = String(tag || "").trim();
  const artistQuery = findArtistQuery(label, artworks);
  if (artistQuery) return artistQuery;

  if (classificationByLabel[label]) {
    return { ...classificationByLabel[label] };
  }

  if (recommendationSignalByLabel[label]) {
    return { ...recommendationSignalByLabel[label] };
  }

  return {
    type: "tag",
    id: "",
    label,
  };
}

function getHomeSectionQuery(section) {
  return {
    type: String((section && section.queryType) || "tag"),
    id: String((section && section.queryId) || ""),
    label: String(
      (section && (section.queryLabel || section.tag || section.targetTag || section.title)) || "",
    ),
  };
}

function getHomeSectionCacheKey(section) {
  const query = getHomeSectionQuery(section);
  return `${query.type}:${query.id || query.label}`;
}

module.exports = {
  getHomeSectionCacheKey,
  getHomeSectionQuery,
  normalizeLookupText,
  resolveHomeSectionQuery,
};
