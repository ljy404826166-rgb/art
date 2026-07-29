const { CATEGORY_GROUPS } = require("./category-catalog");

const CLASSIFICATION_TAGS = CATEGORY_GROUPS.flatMap((group) =>
  group.tags.map((tag) => ({
    id: tag.id,
    label: tag.label,
    group: group.key,
  })),
);

const CLASSIFICATION_TAG_BY_ID = Object.fromEntries(
  CLASSIFICATION_TAGS.map((tag) => [tag.id, tag]),
);

function buildClassificationTagItems(ids) {
  const selected = new Set(
    (Array.isArray(ids) ? ids : []).map((id) => String(id || "").trim()).filter(Boolean),
  );
  return CLASSIFICATION_TAGS.filter((tag) => selected.has(tag.id)).map((tag) => ({ ...tag }));
}

module.exports = {
  CLASSIFICATION_TAG_BY_ID,
  CLASSIFICATION_TAGS,
  buildClassificationTagItems,
};
