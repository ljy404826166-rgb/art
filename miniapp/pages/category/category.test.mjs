import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCategoryPage(artworksService, options = {}) {
  const filename = fileURLToPath(new URL("./category.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  let page = null;
  const Page = (definition) => {
    page = {
      ...definition,
      data: { ...definition.data },
      setData(patch) {
        this.data = { ...this.data, ...patch };
      },
    };
  };

  vm.runInNewContext(source, {
    module: { exports: {} },
    exports: {},
    require(id) {
      if (id === "../../services/artworks") return artworksService;
      if (id === "../../data/fallback-artworks") {
        return {
          fallbackGroups: [{ name: "Style", tags: ["Impressionism"] }],
        };
      }
      return require(id);
    },
    Page,
    wx: {
      getStorageSync() {
        return options.storedTag;
      },
      navigateTo() {},
      removeStorageSync() {},
      setNavigationBarTitle() {},
    },
  }, { filename });

  return page;
}

test("category page appends the next artwork page without replacing existing cards", async () => {
  const calls = [];
  const page = loadCategoryPage({
    countArtworksByTag: async () => 4,
    fetchArtworksByTag: async (_tag, options) => {
      calls.push({ pageSize: options.pageSize, skip: options.skip });
      if (options.skip === 0) {
        return [{ id: "a1" }, { id: "a2" }];
      }
      return [{ id: "a3" }, { id: "a4" }];
    },
    fallbackArtworksByTag: () => [],
    fallbackArtworkCountByTag: () => 0,
    normalizeError: (error) => String(error && error.message ? error.message : error),
  });

  await page.applyFilter("Impressionism");

  assert.deepEqual(page.data.filteredArtworks.map((item) => item.id), ["a1", "a2"]);
  assert.equal(page.data.skip, 2);
  assert.equal(page.data.hasMore, true);

  await page.loadMore();

  assert.deepEqual(page.data.filteredArtworks.map((item) => item.id), ["a1", "a2", "a3", "a4"]);
  assert.equal(page.data.skip, 4);
  assert.equal(page.data.hasMore, false);
  assert.deepEqual(calls, [
    { pageSize: 20, skip: 0 },
    { pageSize: 20, skip: 2 },
  ]);
});

test("category page keeps the visible label while passing normalized tag id to the service", async () => {
  const calls = [];
  const page = loadCategoryPage({
    countArtworksByTag: async (tag) => {
      calls.push({ type: "count", tag });
      return 1;
    },
    fetchArtworksByTag: async (tag, options) => {
      calls.push({ type: "fetch", tag, pageSize: options.pageSize, skip: options.skip });
      return [{ id: "a1" }];
    },
    fallbackArtworksByTag: () => [],
    fallbackArtworkCountByTag: () => 0,
    normalizeError: (error) => String(error && error.message ? error.message : error),
  }, {
    storedTag: { id: "style-impressionism", label: "印象派" },
  });

  await page.onShow();

  assert.equal(page.data.activeTag, "印象派");
  assert.equal(page.data.activeTagId, "style-impressionism");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { type: "count", tag: { id: "style-impressionism", label: "印象派" } },
    { type: "fetch", tag: { id: "style-impressionism", label: "印象派" }, pageSize: 20, skip: 0 },
  ]);
});
