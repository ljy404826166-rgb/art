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

function isCanonicalString(value) {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function hasExactKeys(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value).sort();
  const wantedKeys = expectedKeys.slice().sort();
  return actualKeys.length === wantedKeys.length
    && actualKeys.every((key, index) => key === wantedKeys[index]);
}

function integrityError(message) {
  const error = new Error(message);
  error.code = "INVALID_CATEGORY_CATALOG";
  return error;
}

function compareCatalogTags(group, left, right) {
  if (group === "decade") {
    const decadeDifference = decadeNumber(left.label) - decadeNumber(right.label);
    if (decadeDifference) return decadeDifference;
  } else {
    const orderDifference = left.sortOrder - right.sortOrder;
    if (orderDifference) return orderDifference;
  }
  return left.id.localeCompare(right.id);
}

function normalizeCatalog(catalogVersion, rows) {
  const version = cleanText(catalogVersion);
  if (!version) throw integrityError("Category catalog has no active version.");
  if (!Array.isArray(rows)) throw integrityError("Category catalog rows are invalid.");

  const tagsByGroup = { style: [], subject: [], decade: [] };
  const seenIds = new Set();

  rows.forEach((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw integrityError("Category catalog contains a malformed row.");
    }
    if (row.catalog_version !== version) {
      throw integrityError("Category catalog row version does not match the active version.");
    }
    if (row.publish_status !== "ready") return;
    if (row.display_enabled !== true) return;
    if (typeof row.artwork_count !== "number" || !Number.isFinite(row.artwork_count)) {
      throw integrityError("Category catalog artwork count is invalid.");
    }
    if (row.artwork_count <= 0) return;
    if (!Object.prototype.hasOwnProperty.call(tagsByGroup, row.group)) {
      throw integrityError(`Category catalog group is invalid: ${cleanText(row.group)}.`);
    }
    if (!isCanonicalString(row.term_id) || !isCanonicalString(row.label)) {
      throw integrityError("Category catalog term identity is invalid.");
    }
    if (typeof row.sort_order !== "number" || !Number.isFinite(row.sort_order)) {
      throw integrityError(`Category catalog sort order is invalid: ${row.term_id}.`);
    }
    if (row.group === "decade" && !Number.isFinite(decadeNumber(row.label))) {
      throw integrityError(`Category catalog decade is invalid: ${row.term_id}.`);
    }

    const id = row.term_id;
    if (seenIds.has(id)) {
      throw integrityError(`Category catalog contains duplicate term: ${id}.`);
    }
    seenIds.add(id);

    tagsByGroup[row.group].push({
      id,
      label: row.label,
      count: row.artwork_count,
      sortOrder: row.sort_order,
    });
  });

  const groups = GROUP_DEFINITIONS.map((definition) => {
    const tags = tagsByGroup[definition.key]
      .sort((left, right) => compareCatalogTags(definition.key, left, right));
    if (!tags.length) {
      throw integrityError(`Category catalog group is empty: ${definition.key}.`);
    }
    return {
      key: definition.key,
      name: definition.name,
      tags,
    };
  });

  return { catalogVersion: version, groups };
}

function normalizeCachedCatalog(value, expectedVersion) {
  if (!hasExactKeys(value, ["catalogVersion", "groups"])) return null;
  if (!isCanonicalString(value.catalogVersion)) return null;
  if (expectedVersion && value.catalogVersion !== expectedVersion) return null;
  if (!Array.isArray(value.groups) || value.groups.length !== GROUP_DEFINITIONS.length) {
    return null;
  }

  const seenIds = new Set();
  const groups = [];
  const valid = GROUP_DEFINITIONS.every((definition, groupIndex) => {
    const group = value.groups[groupIndex];
    if (
      !hasExactKeys(group, ["key", "name", "tags"])
      || group.key !== definition.key
      || group.name !== definition.name
      || !Array.isArray(group.tags)
      || !group.tags.length
    ) {
      return false;
    }

    const tags = [];
    const tagsValid = group.tags.every((tag) => {
      if (!hasExactKeys(tag, ["id", "label", "count", "sortOrder"])) return false;
      if (
        !isCanonicalString(tag.id)
        || !isCanonicalString(tag.label)
        || typeof tag.count !== "number"
        || !Number.isInteger(tag.count)
        || tag.count <= 0
        || typeof tag.sortOrder !== "number"
        || !Number.isFinite(tag.sortOrder)
        || seenIds.has(tag.id)
      ) {
        return false;
      }
      if (
        definition.key === "decade"
        && !Number.isFinite(decadeNumber(tag.label))
      ) return false;

      seenIds.add(tag.id);
      tags.push({
        id: tag.id,
        label: tag.label,
        count: tag.count,
        sortOrder: tag.sortOrder,
      });
      return true;
    });
    if (!tagsValid) return false;

    tags.sort((left, right) => compareCatalogTags(definition.key, left, right));
    groups.push({ key: definition.key, name: definition.name, tags });
    return true;
  });

  return valid ? { catalogVersion: value.catalogVersion, groups } : null;
}

function toPublicCatalog(catalog) {
  return {
    catalogVersion: catalog.catalogVersion,
    groups: catalog.groups.map((group) => ({
      key: group.key,
      name: group.name,
      tags: group.tags.map(({ id, label, count }) => ({ id, label, count })),
    })),
  };
}

function readValidCache(wxApi, expectedVersion) {
  if (!wxApi || typeof wxApi.getStorageSync !== "function") return null;
  try {
    const cached = wxApi.getStorageSync(CACHE_KEY);
    return normalizeCachedCatalog(cached, expectedVersion);
  } catch (error) {
    return null;
  }
}

function writeCache(wxApi, catalog) {
  if (!wxApi || typeof wxApi.setStorageSync !== "function") return;
  try {
    wxApi.setStorageSync(CACHE_KEY, {
      catalogVersion: catalog.catalogVersion,
      groups: catalog.groups.map((group) => ({
        key: group.key,
        name: group.name,
        tags: group.tags.map((tag) => ({
          id: tag.id,
          label: tag.label,
          count: tag.count,
          sortOrder: tag.sortOrder,
        })),
      })),
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
    if (!result || !Array.isArray(result.data)) {
      throw integrityError("Category catalog cloud response is malformed.");
    }
    const page = result.data;
    rows.push(...page);
    if (page.length < CATALOG_PAGE_SIZE) break;
  }

  return rows;
}

function staleCacheResult(catalog) {
  const publicCatalog = toPublicCatalog(catalog);
  return {
    ...publicCatalog,
    source: "cache",
    stale: true,
  };
}

function readCacheOrThrow(wxApi, expectedVersion, error) {
  const cached = readValidCache(wxApi, expectedVersion);
  if (cached) return staleCacheResult(cached);
  throw error;
}

async function loadCategoryCatalog(options) {
  const wxApi = getWxApi(options);
  if (!wxApi || !wxApi.cloud || typeof wxApi.cloud.database !== "function") {
    return readCacheOrThrow(
      wxApi,
      null,
      new Error("WeChat Cloud database is unavailable."),
    );
  }

  let db;
  let pointerResult;
  try {
    db = wxApi.cloud.database();
    pointerResult = await db
      .collection("category_catalog_state")
      .doc("active")
      .get();
  } catch (error) {
    return readCacheOrThrow(wxApi, null, error);
  }

  const catalogVersion = (
    pointerResult
    && pointerResult.data
    && pointerResult.data.active_catalog_version
  );
  if (!isCanonicalString(catalogVersion)) {
    throw integrityError("Category catalog active pointer is invalid.");
  }

  let rows;
  try {
    rows = await fetchCatalogRows(db, catalogVersion);
  } catch (error) {
    if (error && error.code === "INVALID_CATEGORY_CATALOG") throw error;
    return readCacheOrThrow(wxApi, catalogVersion, error);
  }

  const catalog = normalizeCatalog(catalogVersion, rows);
  writeCache(wxApi, catalog);
  return {
    ...toPublicCatalog(catalog),
    source: "cloud",
    stale: false,
  };
}

module.exports = {
  CACHE_KEY,
  loadCategoryCatalog,
};
