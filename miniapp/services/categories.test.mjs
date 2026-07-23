import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const CACHE_KEY = "artArchive:categoryCatalog:v1";

function loadCategoriesService(wxApi) {
  const filename = fileURLToPath(new URL("./categories.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module,
    exports: module.exports,
    wx: wxApi,
  }, { filename });
  return { service: module.exports, source };
}

function createCatalogWx({
  pointer = { _id: "active", active_catalog_version: "classification-v1" },
  rows = [],
  rejectCloud = false,
  initialCache,
} = {}) {
  const storage = new Map();
  if (initialCache !== undefined) storage.set(CACHE_KEY, initialCache);
  const counters = { pointerGets: 0, catalogGets: 0, where: [], cacheWrites: [] };

  const wxApi = {
    getStorageSync(key) {
      return storage.get(key);
    },
    setStorageSync(key, value) {
      storage.set(key, value);
      counters.cacheWrites.push({ key, value });
    },
    cloud: {
      database() {
        return {
          collection(name) {
            if (name === "category_catalog_state") {
              return {
                doc(id) {
                  assert.equal(id, "active");
                  return {
                    async get() {
                      counters.pointerGets += 1;
                      if (rejectCloud) throw new Error("cloud unavailable");
                      return { data: pointer };
                    },
                  };
                },
              };
            }

            assert.equal(name, "category_catalog");
            return {
              where(clause) {
                counters.where.push(clause);
                let skip = 0;
                let limit = 20;
                return {
                  skip(value) {
                    skip = Number(value || 0);
                    return this;
                  },
                  limit(value) {
                    limit = Number(value || 20);
                    return this;
                  },
                  async get() {
                    counters.catalogGets += 1;
                    if (rejectCloud) throw new Error("cloud unavailable");
                    const matched = rows.filter((row) => Object.entries(clause)
                      .every(([field, value]) => row[field] === value));
                    return { data: matched.slice(skip, skip + limit) };
                  },
                };
              },
            };
          },
        };
      },
    },
  };

  return { wxApi, storage, counters };
}

function validRows() {
  return [
    {
      _id: "v1--style-b",
      catalog_version: "classification-v1",
      group: "style",
      term_id: "style-b",
      label: "流派 B",
      artwork_count: 2,
      sort_order: 20,
      display_enabled: true,
      publish_status: "ready",
    },
    {
      _id: "v1--style-a",
      catalog_version: "classification-v1",
      group: "style",
      term_id: "style-a",
      label: "流派 A",
      artwork_count: 3,
      sort_order: 10,
      display_enabled: true,
      publish_status: "ready",
    },
    {
      _id: "v1--subject-a",
      catalog_version: "classification-v1",
      group: "subject",
      term_id: "subject-a",
      label: "题材 A",
      artwork_count: 1,
      sort_order: 5,
      display_enabled: true,
      publish_status: "ready",
    },
    {
      _id: "v1--period-1890s",
      catalog_version: "classification-v1",
      group: "decade",
      term_id: "period-1890s",
      label: "1890s",
      artwork_count: 1,
      sort_order: 1890,
      display_enabled: true,
      publish_status: "ready",
    },
    {
      _id: "v1--period-1900s",
      catalog_version: "classification-v1",
      group: "decade",
      term_id: "period-1900s",
      label: "1900s",
      artwork_count: 2,
      sort_order: 1900,
      display_enabled: true,
      publish_status: "ready",
    },
  ];
}

test("loadCategoryCatalog follows the active pointer, normalizes rows, sorts groups, and caches them", async () => {
  const rows = [
    ...validRows(),
    { ...validRows()[0], _id: "not-ready", term_id: "style-not-ready", publish_status: "draft" },
    { ...validRows()[0], _id: "hidden", term_id: "style-hidden", display_enabled: false },
    { ...validRows()[0], _id: "empty", term_id: "style-empty", artwork_count: 0 },
  ];
  const { wxApi, storage, counters } = createCatalogWx({ rows });
  const { service } = loadCategoriesService(wxApi);

  const result = await service.loadCategoryCatalog();

  assert.equal(result.catalogVersion, "classification-v1");
  assert.equal(result.source, "cloud");
  assert.equal(result.stale, false);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.groups.map((group) => group.key))),
    ["style", "subject", "decade"],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.groups[0].tags.map((tag) => tag.id))),
    ["style-a", "style-b"],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.groups[2].tags.map((tag) => tag.label))),
    ["1900s", "1890s"],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.groups[0].tags[0])),
    { id: "style-a", label: "流派 A", count: 3 },
  );
  assert.equal(counters.pointerGets, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(counters.where)), [{
    catalog_version: "classification-v1",
    publish_status: "ready",
  }]);
  assert.equal(counters.cacheWrites.length, 1);
  assert.equal(counters.cacheWrites[0].key, CACHE_KEY);
  assert.deepEqual(
    JSON.parse(JSON.stringify(storage.get(CACHE_KEY))),
    JSON.parse(JSON.stringify({
      catalogVersion: result.catalogVersion,
      groups: result.groups,
    })),
  );
});

test("loadCategoryCatalog returns only structurally valid cached catalog when cloud fails", async () => {
  const healthy = createCatalogWx({ rows: validRows() });
  const { service } = loadCategoriesService(healthy.wxApi);
  const cloudResult = await service.loadCategoryCatalog();
  const cached = healthy.storage.get(CACHE_KEY);

  const offline = createCatalogWx({ rejectCloud: true, initialCache: cached });
  const offlineService = loadCategoriesService(offline.wxApi).service;
  const result = await offlineService.loadCategoryCatalog();

  assert.equal(result.catalogVersion, cloudResult.catalogVersion);
  assert.equal(result.source, "cache");
  assert.equal(result.stale, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.groups)),
    JSON.parse(JSON.stringify(cloudResult.groups)),
  );
  assert.equal(offline.counters.cacheWrites.length, 0);
});

test("loadCategoryCatalog reads every catalog page when the version has more than 20 rows", async () => {
  const styleRows = Array.from({ length: 20 }, (_, index) => ({
    _id: `v1--style-${index}`,
    catalog_version: "classification-v1",
    group: "style",
    term_id: `style-${String(index).padStart(2, "0")}`,
    label: `流派 ${index}`,
    artwork_count: 1,
    sort_order: index,
    display_enabled: true,
    publish_status: "ready",
  }));
  const rows = [
    ...styleRows,
    validRows().find((row) => row.group === "subject"),
    validRows().find((row) => row.group === "decade"),
  ];
  const { wxApi, counters } = createCatalogWx({ rows });
  const { service } = loadCategoriesService(wxApi);

  const result = await service.loadCategoryCatalog();

  assert.equal(result.groups[0].tags.length, 20);
  assert.equal(result.groups[1].tags.length, 1);
  assert.equal(result.groups[2].tags.length, 1);
  assert.equal(counters.catalogGets, 2);
});

test("loadCategoryCatalog rejects cloud failure when cache is structurally invalid", async () => {
  const { wxApi } = createCatalogWx({
    rejectCloud: true,
    initialCache: {
      catalogVersion: "classification-v1",
      groups: [{ key: "style", name: "流派", tags: [] }],
    },
  });
  const { service } = loadCategoriesService(wxApi);

  await assert.rejects(() => service.loadCategoryCatalog(), /cloud unavailable/);
});

test("category service does not import hardcoded fallback groups", () => {
  const { wxApi } = createCatalogWx({ rows: validRows() });
  const { source } = loadCategoriesService(wxApi);

  assert.doesNotMatch(source, /fallbackGroups|fallback-artworks/);
});
