import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const STORED_TAG_KEY = "artArchive:selectedCategoryTag";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function catalogFixture() {
  return {
    catalogVersion: "classification-v1",
    source: "cloud",
    stale: false,
    groups: [
      {
        key: "style",
        name: "流派",
        tags: [
          { id: "style-a", label: "流派 A", count: 3 },
          { id: "style-b", label: "流派 B", count: 2 },
        ],
      },
      {
        key: "subject",
        name: "题材",
        tags: [{ id: "subject-a", label: "题材 A", count: 1 }],
      },
      {
        key: "decade",
        name: "年代",
        tags: [{ id: "period-1900s", label: "1900s", count: 1 }],
      },
    ],
  };
}

function loadCategoryPage({
  catalogService = { loadCategoryCatalog: async () => catalogFixture() },
  artworksService = {},
  storedTag,
} = {}) {
  const filename = fileURLToPath(new URL("./category.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  const storage = new Map();
  const removedStorageKeys = [];
  const navigations = [];
  if (storedTag !== undefined) storage.set(STORED_TAG_KEY, storedTag);

  const normalizedArtworksService = {
    countArtworksByCategoryFilters: async () => 0,
    fetchArtworksByCategoryFilters: async () => [],
    normalizeError: (error) => String((error && error.message) || error || ""),
    ...artworksService,
  };

  let page = null;
  const Page = (definition) => {
    page = {
      ...definition,
      data: clone(definition.data),
      setData(patch) {
        Object.assign(this.data, patch);
      },
    };
  };

  vm.runInNewContext(
    source,
    {
      module: { exports: {} },
      exports: {},
      require(id) {
        if (id === "../../services/artworks") return normalizedArtworksService;
        if (id === "../../services/categories") return catalogService;
        throw new Error(`Unexpected dependency: ${id}`);
      },
      Page,
      wx: {
        getStorageSync(key) {
          return storage.get(key);
        },
        navigateTo(options) {
          navigations.push(options);
        },
        removeStorageSync(key) {
          removedStorageKeys.push(key);
          storage.delete(key);
        },
        setNavigationBarTitle() {},
      },
    },
    { filename },
  );

  return { page, source, storage, removedStorageKeys, navigations };
}

test("category page uses the fixed catalog and dynamic category result services", () => {
  const { source } = loadCategoryPage();

  assert.match(source, /loadCategoryCatalog/);
  assert.match(source, /fetchArtworksByCategoryFilters/);
  assert.match(source, /countArtworksByCategoryFilters/);
  assert.doesNotMatch(source, /fallbackGroups|fallbackArtworksByTag|fetchArtworksByTag/);
});

test("category result header does not display the artwork count", () => {
  const template = readFileSync(new URL("./category.wxml", import.meta.url), "utf8");
  const styles = readFileSync(new URL("./category.wxss", import.meta.url), "utf8");

  assert.doesNotMatch(template, /result-count/);
  assert.doesNotMatch(template, /resultCountText/);
  assert.doesNotMatch(styles, /\.result-count/);
});

test("category filters provide subtle press, selection, and expand motion", () => {
  const template = readFileSync(new URL("./category.wxml", import.meta.url), "utf8");
  const styles = readFileSync(new URL("./category.wxss", import.meta.url), "utf8");

  assert.match(template, /class="expand-button[^"]*"[\s\S]*hover-class="is-pressed"/);
  assert.equal((template.match(/hover-class="is-pressed"/g) || []).length, 2);
  assert.equal((template.match(/hover-start-time="0"/g) || []).length, 2);
  assert.equal((template.match(/hover-stay-time="80"/g) || []).length, 2);
  assert.match(template, /class="chip-clip" style="\{\{item\.panelStyle\}\}"/);
  assert.match(template, /class="chip-wrap chip-measure"/);
  assert.match(template, /wx:for="\{\{item\.tags\}\}"/);
  assert.doesNotMatch(template, /chip-content|visibleTags|<scroll-view/);

  assert.match(
    styles,
    /\.expand-icon\s*\{[\s\S]*transition: transform 220ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/,
  );
  assert.match(
    styles,
    /\.tag-chip\s*\{[\s\S]*transform 180ms cubic-bezier\(0\.22, 1, 0\.36, 1\),[\s\S]*background-color 180ms ease-out,[\s\S]*color 180ms ease-out;/,
  );
  assert.match(styles, /\.tag-chip\.is-pressed\s*\{[\s\S]*transform: scale\(0\.96\);/);
  assert.match(
    styles,
    /\.chip-clip\s*\{[\s\S]*transition: height 260ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/,
  );
  assert.doesNotMatch(styles, /chip-content-enter|translateY\(8rpx\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("category measures the persistent chip panel for accordion height", () => {
  const { source } = loadCategoryPage();

  assert.match(source, /groupHeights: \{\}/);
  assert.match(source, /measureGroupHeights\(\)/);
  assert.match(source, /\.selectAll\("\.chip-measure"\)/);
  assert.match(source, /panelStyle: expanded/);
  assert.match(source, /"height: 54rpx;"/);
});

test("selects, replaces, cancels, and combines one filter per category group", async () => {
  const filtersSeen = [];
  const { page } = loadCategoryPage({
    artworksService: {
      countArtworksByCategoryFilters: async () => 1,
      fetchArtworksByCategoryFilters: async (filters) => {
        filtersSeen.push(clone(filters));
        return [{ id: "a1" }];
      },
    },
  });

  await page.onShow();
  await page.selectTag({ currentTarget: { dataset: { group: "style", tagId: "style-a" } } });
  await page.selectTag({ currentTarget: { dataset: { group: "subject", tagId: "subject-a" } } });
  assert.deepEqual(clone(page.data.selectedFilters), {
    style: "style-a",
    subject: "subject-a",
    decade: "",
  });
  assert.ok(
    filtersSeen.some((filters) => filters.style === "style-a" && filters.subject === "subject-a"),
  );

  await page.selectTag({ currentTarget: { dataset: { group: "style", tagId: "style-b" } } });
  assert.equal(page.data.selectedFilters.style, "style-b");
  assert.equal(page.data.selectedFilters.subject, "subject-a");

  await page.selectTag({ currentTarget: { dataset: { group: "style", tagId: "style-b" } } });
  assert.deepEqual(clone(page.data.selectedFilters), {
    style: "",
    subject: "subject-a",
    decade: "",
  });
  assert.equal(page.data.hasActiveFilters, true);
  assert.equal(
    page.data.groupsView[0].tags.some((tag) => tag.selected),
    false,
  );
  assert.equal(page.data.groupsView[1].tags.find((tag) => tag.id === "subject-a").selected, true);
});

test("clearFilters removes every selection and refreshes unfiltered results", async () => {
  const filtersSeen = [];
  const { page } = loadCategoryPage({
    artworksService: {
      countArtworksByCategoryFilters: async () => 1,
      fetchArtworksByCategoryFilters: async (filters) => {
        filtersSeen.push(clone(filters));
        return [{ id: "a1" }];
      },
    },
  });

  await page.onShow();
  await page.selectTag({ currentTarget: { dataset: { group: "style", tagId: "style-a" } } });
  await page.selectTag({ currentTarget: { dataset: { group: "decade", tagId: "period-1900s" } } });
  await page.clearFilters();

  assert.deepEqual(clone(page.data.selectedFilters), { style: "", subject: "", decade: "" });
  assert.equal(page.data.hasActiveFilters, false);
  assert.deepEqual(filtersSeen.at(-1), { style: "", subject: "", decade: "" });
});

test("shows an intentional zero-result state without treating it as an error", async () => {
  const { page } = loadCategoryPage();

  await page.onShow();

  assert.equal(page.data.loading, false);
  assert.equal(page.data.resultError, "");
  assert.deepEqual(clone(page.data.artworks), []);
  assert.equal(page.data.totalCount, 0);
  assert.equal(page.data.resultCountText, "0件作品");
  assert.equal(page.data.hasMore, false);
});

test("returning from detail preserves 25 loaded artworks without duplicate requests", async () => {
  let catalogLoads = 0;
  let countLoads = 0;
  const fetchSkips = [];
  const { page } = loadCategoryPage({
    storedTag: "流派 A",
    catalogService: {
      async loadCategoryCatalog() {
        catalogLoads += 1;
        return catalogFixture();
      },
    },
    artworksService: {
      countArtworksByCategoryFilters: async () => {
        countLoads += 1;
        return 25;
      },
      fetchArtworksByCategoryFilters: async (_filters, options) => {
        fetchSkips.push(options.skip);
        const length = options.skip === 0 ? 20 : 5;
        return Array.from({ length }, (_, index) => ({ id: `art-${options.skip + index + 1}` }));
      },
    },
  });

  await page.onShow();
  await page.loadMore();
  assert.equal(page.data.artworks.length, 25);
  assert.equal(page.data.skip, 25);
  assert.equal(page.data.selectedFilters.style, "style-a");

  await page.onShow();

  assert.equal(page.data.artworks.length, 25);
  assert.equal(page.data.skip, 25);
  assert.equal(page.data.hasMore, false);
  assert.equal(page.data.selectedFilters.style, "style-a");
  assert.equal(catalogLoads, 1);
  assert.equal(countLoads, 1);
  assert.deepEqual(fetchSkips, [0, 20]);
});

test("a new valid stored category request refreshes an initialized page", async () => {
  const filtersSeen = [];
  let catalogLoads = 0;
  const loaded = loadCategoryPage({
    catalogService: {
      async loadCategoryCatalog() {
        catalogLoads += 1;
        return catalogFixture();
      },
    },
    artworksService: {
      countArtworksByCategoryFilters: async () => 0,
      fetchArtworksByCategoryFilters: async (filters) => {
        filtersSeen.push(clone(filters));
        return [];
      },
    },
  });

  await loaded.page.onShow();
  loaded.storage.set(STORED_TAG_KEY, "流派 A");
  await loaded.page.onShow();

  assert.equal(loaded.page.data.selectedFilters.style, "style-a");
  assert.deepEqual(filtersSeen, [
    { style: "", subject: "", decade: "" },
    { style: "style-a", subject: "", decade: "" },
  ]);
  assert.equal(catalogLoads, 2);
  assert.deepEqual(loaded.removedStorageKeys, [STORED_TAG_KEY]);
});

test("result errors preserve selected filters and retry only the results", async () => {
  let rejectResults = true;
  let catalogLoads = 0;
  const { page } = loadCategoryPage({
    catalogService: {
      async loadCategoryCatalog() {
        catalogLoads += 1;
        return catalogFixture();
      },
    },
    artworksService: {
      countArtworksByCategoryFilters: async () => 1,
      fetchArtworksByCategoryFilters: async () => {
        if (rejectResults) throw new Error("result unavailable");
        return [{ id: "a1" }];
      },
    },
  });

  await page.onShow();
  await page.selectTag({ currentTarget: { dataset: { group: "style", tagId: "style-a" } } });
  assert.equal(page.data.selectedFilters.style, "style-a");
  assert.equal(page.data.resultError, "result unavailable");

  rejectResults = false;
  await page.retryResults();

  assert.equal(page.data.selectedFilters.style, "style-a");
  assert.equal(page.data.resultError, "");
  assert.deepEqual(clone(page.data.artworks.map((item) => item.id)), ["a1"]);
  assert.equal(catalogLoads, 1);
});

test("catalog errors are independent from results and retry only the catalog", async () => {
  let rejectCatalog = true;
  let resultLoads = 0;
  const { page } = loadCategoryPage({
    catalogService: {
      async loadCategoryCatalog() {
        if (rejectCatalog) throw new Error("catalog unavailable");
        return catalogFixture();
      },
    },
    artworksService: {
      countArtworksByCategoryFilters: async () => 0,
      fetchArtworksByCategoryFilters: async () => {
        resultLoads += 1;
        return [];
      },
    },
  });

  await page.onShow();
  assert.equal(page.data.catalogError, "catalog unavailable");
  assert.equal(page.data.resultError, "");
  assert.equal(resultLoads, 1);

  rejectCatalog = false;
  await page.retryCatalog();

  assert.equal(page.data.catalogError, "");
  assert.deepEqual(
    page.data.groups.map((group) => group.key),
    ["style", "subject", "decade"],
  );
  assert.equal(resultLoads, 1);
});

test("catalog retry refreshes results only when it invalidates a selection", async () => {
  let catalog = catalogFixture();
  const filtersSeen = [];
  const { page } = loadCategoryPage({
    catalogService: {
      async loadCategoryCatalog() {
        return catalog;
      },
    },
    artworksService: {
      countArtworksByCategoryFilters: async () => 0,
      fetchArtworksByCategoryFilters: async (filters) => {
        filtersSeen.push(clone(filters));
        return [];
      },
    },
  });

  await page.onShow();
  await page.selectTag({ currentTarget: { dataset: { group: "style", tagId: "style-a" } } });
  catalog = {
    ...catalogFixture(),
    catalogVersion: "classification-v2",
    groups: catalogFixture().groups.map((group) =>
      group.key === "style"
        ? { ...group, tags: [{ id: "style-b", label: "流派 B", count: 2 }] }
        : group,
    ),
  };
  await page.retryCatalog();

  assert.equal(page.data.selectedFilters.style, "");
  assert.deepEqual(filtersSeen.at(-1), { style: "", subject: "", decade: "" });
});

test("resolves a stored home label only when it exists in the reviewed catalog", async () => {
  const filtersSeen = [];
  const known = loadCategoryPage({
    storedTag: "流派 A",
    artworksService: {
      countArtworksByCategoryFilters: async () => 0,
      fetchArtworksByCategoryFilters: async (filters) => {
        filtersSeen.push(clone(filters));
        return [];
      },
    },
  });

  await known.page.onShow();

  assert.equal(known.page.data.selectedFilters.style, "style-a");
  assert.equal(filtersSeen[0].style, "style-a");
  assert.deepEqual(known.removedStorageKeys, [STORED_TAG_KEY]);
});

test("rejects and removes an unknown legacy stored tag", async () => {
  const filtersSeen = [];
  const unknown = loadCategoryPage({
    storedTag: { id: "legacy-style", label: "旧标签" },
    artworksService: {
      countArtworksByCategoryFilters: async () => 0,
      fetchArtworksByCategoryFilters: async (filters) => {
        filtersSeen.push(clone(filters));
        return [];
      },
    },
  });

  await unknown.page.onShow();

  assert.deepEqual(clone(unknown.page.data.selectedFilters), {
    style: "",
    subject: "",
    decade: "",
  });
  assert.deepEqual(filtersSeen[0], { style: "", subject: "", decade: "" });
  assert.deepEqual(unknown.removedStorageKeys, [STORED_TAG_KEY]);
});

test("ignores stale result responses after filters change rapidly", async () => {
  const oldPage = deferred();
  const newPage = deferred();
  const { page } = loadCategoryPage({
    artworksService: {
      countArtworksByCategoryFilters: async () => 1,
      fetchArtworksByCategoryFilters: async (filters) => {
        if (filters.style === "style-a") return oldPage.promise;
        if (filters.style === "style-b") return newPage.promise;
        return [];
      },
    },
  });
  await page.onShow();

  const oldRequest = page.selectTag({
    currentTarget: { dataset: { group: "style", tagId: "style-a" } },
  });
  const newRequest = page.selectTag({
    currentTarget: { dataset: { group: "style", tagId: "style-b" } },
  });

  newPage.resolve([{ id: "new-result" }]);
  await newRequest;
  oldPage.resolve([{ id: "old-result" }]);
  await oldRequest;

  assert.equal(page.data.selectedFilters.style, "style-b");
  assert.deepEqual(clone(page.data.artworks.map((item) => item.id)), ["new-result"]);
  assert.equal(page.data.loading, false);
});

test("loadMore appends only unseen artworks in stable order and advances the raw offset", async () => {
  const calls = [];
  const { page } = loadCategoryPage({
    artworksService: {
      countArtworksByCategoryFilters: async () => 4,
      fetchArtworksByCategoryFilters: async (_filters, options) => {
        calls.push({ pageSize: options.pageSize, skip: options.skip });
        if (options.skip === 0) return [{ id: "a1" }, { id: "a2" }];
        return [{ id: "a2" }, { id: "a3" }];
      },
    },
  });

  await page.onShow();
  await page.loadMore();

  assert.deepEqual(clone(page.data.artworks.map((item) => item.id)), ["a1", "a2", "a3"]);
  assert.equal(page.data.skip, 4);
  assert.equal(page.data.hasMore, false);
  assert.equal(page.data.loadingMore, false);
  assert.deepEqual(calls, [
    { pageSize: 20, skip: 0 },
    { pageSize: 20, skip: 2 },
  ]);
});

test("loadMore failure keeps the grid visible and retries from the raw offset", async () => {
  let failPageTwo = true;
  const calls = [];
  const { page } = loadCategoryPage({
    artworksService: {
      countArtworksByCategoryFilters: async () => 25,
      fetchArtworksByCategoryFilters: async (_filters, options) => {
        calls.push(options.skip);
        if (options.skip === 20 && failPageTwo) throw new Error("page 2 failed");
        const length = options.skip === 0 ? 20 : 5;
        return Array.from({ length }, (_, index) => ({ id: `art-${options.skip + index + 1}` }));
      },
    },
  });

  await page.onShow();
  await page.loadMore();

  assert.equal(page.data.artworks.length, 20);
  assert.equal(page.data.skip, 20);
  assert.equal(page.data.hasMore, true);
  assert.equal(page.data.resultError, "");
  assert.equal(page.data.loadMoreError, "page 2 failed");

  failPageTwo = false;
  await page.retryLoadMore();

  assert.equal(page.data.artworks.length, 25);
  assert.equal(page.data.skip, 25);
  assert.equal(page.data.hasMore, false);
  assert.equal(page.data.loadMoreError, "");
  assert.deepEqual(calls, [0, 20, 20]);
});

test("a filter change suppresses an older loadMore response", async () => {
  const olderPage = deferred();
  const { page } = loadCategoryPage({
    artworksService: {
      countArtworksByCategoryFilters: async (filters) => (filters.style ? 1 : 3),
      fetchArtworksByCategoryFilters: async (filters, options) => {
        if (options.skip > 0) return olderPage.promise;
        if (filters.style) return [{ id: "filtered" }];
        return [{ id: "a1" }, { id: "a2" }];
      },
    },
  });

  await page.onShow();
  const olderRequest = page.loadMore();
  await page.selectTag({
    currentTarget: { dataset: { group: "style", tagId: "style-a" } },
  });
  olderPage.resolve([{ id: "stale" }]);
  await olderRequest;

  assert.deepEqual(clone(page.data.artworks.map((item) => item.id)), ["filtered"]);
  assert.equal(page.data.selectedFilters.style, "style-a");
  assert.equal(page.data.loadingMore, false);
  assert.equal(page.data.loadMoreError, "");
});

test("toggleGroup and openDetail preserve their existing behavior", () => {
  const { page, navigations } = loadCategoryPage();
  page.data.groups = catalogFixture().groups;
  page.data.groupsView = page.data.groups;

  page.toggleGroup({ currentTarget: { dataset: { group: "style" } } });
  assert.equal(page.data.expandedGroups.style, true);
  assert.equal(page.data.groupsView[0].expanded, true);

  page.openDetail({ detail: { id: "a/b", ratio: 1.5 } });
  assert.deepEqual(clone(navigations), [
    {
      url: "/pages/detail/detail?id=a%2Fb&ratio=1.5",
    },
  ]);
});

test("category template renders catalog tag objects and separate retry states", () => {
  const wxml = readFileSync(new URL("./category.wxml", import.meta.url), "utf8");

  assert.match(wxml, /wx:key="id"/);
  assert.match(wxml, /\{\{tag\.label\}\}/);
  assert.match(wxml, /\{\{tag\.selected \? 'is-active' : ''\}\}/);
  assert.match(wxml, /data-group="\{\{item\.key\}\}"/);
  assert.match(wxml, /data-tag-id="\{\{tag\.id\}\}"/);
  assert.match(wxml, /wx:if="\{\{hasActiveFilters\}\}"/);
  assert.match(wxml, /bindtap="clearFilters"/);
  assert.match(wxml, /bindretry="retryCatalog"/);
  assert.match(wxml, /bindretry="retryResults"/);
  assert.match(wxml, /loadMoreError/);
  assert.match(wxml, /bindtap="retryLoadMore"/);
  assert.doesNotMatch(wxml, /备用|fallback|activeTag/);
});
