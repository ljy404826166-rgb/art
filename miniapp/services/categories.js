const CACHE_KEY = "artArchive:categoryCatalog:v1";
const CATALOG_PAGE_SIZE = 20;
const GROUP_DEFINITIONS = [
  { key: "style", name: "流派" },
  { key: "subject", name: "题材" },
  { key: "decade", name: "年代" },
];

function cleanText(value) {
  return String(value == null ? "" : value).trim();
}

function getWxApi(options) {
  if (options && options.wxApi) return options.wxApi;
  if (typeof wx !== "undefined") return wx;
  return null;
}

function decadeNumber(label) {
  const match = cleanText(label).match(/^(\d{3,4})s$/);
  return match ? Number(match[1]) : NaN;
}

function compareCatalogRows(left, right) {
  if (left.group === "decade") {
    const decadeDifference = decadeNumber(right.label) - decadeNumber(left.label);
    if (decadeDifference) return decadeDifference;
  } else {
    const orderDifference = left.sortOrder - right.sortOrder;
    if (orderDifference) return orderDifference;
  }
  return left.id.localeCompare(right.id);
}

function normalizeCatalog(catalogVersion, rows) {
  const version = cleanText(catalogVersion);
  if (!version) throw new Error("Category catalog has no active version.");
  if (!Array.isArray(rows)) throw new Error("Category catalog rows are invalid.");

  const tagsByGroup = { style: [], subject: [], decade: [] };
  const seenIds = new Set();

  rows.forEach((row) => {
    if (
      cleanText(row && row.catalog_version) !== version
      || cleanText(row && row.publish_status) !== "ready"
      || !row
      || row.display_enabled !== true
      || !(Number(row.artwork_count) > 0)
      || !Object.prototype.hasOwnProperty.call(tagsByGroup, row.group)
    ) {
      return;
    }

    const id = cleanText(row.term_id);
    const label = cleanText(row.label);
    if (!id || !label) return;
    if (row.group === "decade" && !Number.isFinite(decadeNumber(label))) return;
    if (seenIds.has(id)) {
      throw new Error(`Category catalog contains duplicate term: ${id}.`);
    }
    seenIds.add(id);

    const numericSortOrder = Number(row.sort_order);
    tagsByGroup[row.group].push({
      id,
      label,
      count: Number(row.artwork_count),
      sortOrder: Number.isFinite(numericSortOrder) ? numericSortOrder : 0,
      group: row.group,
    });
  });

  const groups = GROUP_DEFINITIONS.map((definition) => {
    const tags = tagsByGroup[definition.key].sort(compareCatalogRows);
    if (!tags.length) {
      throw new Error(`Category catalog group is empty: ${definition.key}.`);
    }
    return {
      key: definition.key,
      name: definition.name,
      tags: tags.map(({ id, label, count }) => ({ id, label, count })),
    };
  });

  return { catalogVersion: version, groups };
}

function isValidCachedCatalog(value) {
  if (!value || typeof value !== "object" || !cleanText(value.catalogVersion)) return false;
  if (!Array.isArray(value.groups) || value.groups.length !== GROUP_DEFINITIONS.length) {
    return false;
  }

  const seenIds = new Set();
  return GROUP_DEFINITIONS.every((definition, groupIndex) => {
    const group = value.groups[groupIndex];
    if (
      !group
      || group.key !== definition.key
      || group.name !== definition.name
      || !Array.isArray(group.tags)
      || !group.tags.length
    ) {
      return false;
    }

    let previousDecade = Infinity;
    return group.tags.every((tag) => {
      const id = cleanText(tag && tag.id);
      const label = cleanText(tag && tag.label);
      const count = Number(tag && tag.count);
      if (!id || !label || !(count > 0) || seenIds.has(id)) return false;
      seenIds.add(id);

      if (definition.key === "decade") {
        const decade = decadeNumber(label);
        if (!Number.isFinite(decade) || decade > previousDecade) return false;
        previousDecade = decade;
      }
      return true;
    });
  });
}

function readValidCache(wxApi) {
  if (!wxApi || typeof wxApi.getStorageSync !== "function") return null;
  try {
    const cached = wxApi.getStorageSync(CACHE_KEY);
    return isValidCachedCatalog(cached) ? cached : null;
  } catch (error) {
    return null;
  }
}

function writeCache(wxApi, catalog) {
  if (!wxApi || typeof wxApi.setStorageSync !== "function") return;
  try {
    wxApi.setStorageSync(CACHE_KEY, {
      catalogVersion: catalog.catalogVersion,
      groups: catalog.groups,
    });
  } catch (error) {
    // A storage quota or serialization failure must not hide a valid cloud catalog.
  }
}

async function fetchCatalogRows(db, catalogVersion) {
  const rows = [];

  for (let skip = 0; ; skip += CATALOG_PAGE_SIZE) {
    const result = await db
      .collection("category_catalog")
      .where({
        catalog_version: catalogVersion,
        publish_status: "ready",
      })
      .skip(skip)
      .limit(CATALOG_PAGE_SIZE)
      .get();
    const page = Array.isArray(result && result.data) ? result.data : [];
    rows.push(...page);
    if (page.length < CATALOG_PAGE_SIZE) break;
  }

  return rows;
}

async function loadCloudCatalog(wxApi) {
  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.database !== "function") {
    throw new Error("WeChat Cloud database is unavailable.");
  }

  const db = wxApi.cloud.database();
  const pointerResult = await db
    .collection("category_catalog_state")
    .doc("active")
    .get();
  const catalogVersion = cleanText(
    pointerResult
    && pointerResult.data
    && pointerResult.data.active_catalog_version,
  );
  if (!catalogVersion) throw new Error("Category catalog active pointer is invalid.");

  const rows = await fetchCatalogRows(db, catalogVersion);
  return normalizeCatalog(catalogVersion, rows);
}

async function loadCategoryCatalog(options) {
  const wxApi = getWxApi(options);

  try {
    const catalog = await loadCloudCatalog(wxApi);
    writeCache(wxApi, catalog);
    return {
      ...catalog,
      source: "cloud",
      stale: false,
    };
  } catch (error) {
    const cached = readValidCache(wxApi);
    if (cached) {
      return {
        catalogVersion: cached.catalogVersion,
        groups: cached.groups,
        source: "cache",
        stale: true,
      };
    }
    throw error;
  }
}

module.exports = {
  CACHE_KEY,
  loadCategoryCatalog,
};
