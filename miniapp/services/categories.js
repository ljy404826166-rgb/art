const { CATEGORY_CATALOG_VERSION, CATEGORY_GROUPS } = require("../data/category-catalog");

function cloneGroups() {
  return CATEGORY_GROUPS.map((group) => ({
    key: group.key,
    name: group.name,
    tags: group.tags.map((tag) => ({
      id: tag.id,
      label: tag.label,
      count: Number(tag.count || 0),
    })),
  }));
}

function loadCategoryCatalog() {
  return Promise.resolve({
    catalogVersion: CATEGORY_CATALOG_VERSION,
    groups: cloneGroups(),
    source: "local",
    stale: false,
  });
}

module.exports = {
  loadCategoryCatalog,
};
