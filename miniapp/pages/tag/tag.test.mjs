import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadTagPage(artworksService) {
  const filename = fileURLToPath(new URL("./tag.js", import.meta.url));
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
      return require(id);
    },
    Page,
    wx: {
      navigateTo() {},
      setNavigationBarTitle() {},
    },
  }, { filename });

  return page;
}

test("tag page appends the next artwork page without replacing existing cards", async () => {
  const calls = [];
  const page = loadTagPage({
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

  await page.loadTag("Impressionism");

  assert.deepEqual(page.data.artworks.map((item) => item.id), ["a1", "a2"]);
  assert.equal(page.data.skip, 2);
  assert.equal(page.data.hasMore, true);

  await page.loadMore();

  assert.deepEqual(page.data.artworks.map((item) => item.id), ["a1", "a2", "a3", "a4"]);
  assert.equal(page.data.skip, 4);
  assert.equal(page.data.hasMore, false);
  assert.deepEqual(calls, [
    { pageSize: 20, skip: 0 },
    { pageSize: 20, skip: 2 },
  ]);
});

test("tag page keeps the visible label while passing normalized tag id to the service", async () => {
  const calls = [];
  const page = loadTagPage({
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
  });

  await page.onLoad({
    tag: encodeURIComponent("印象派"),
    tagId: encodeURIComponent("style-impressionism"),
  });

  assert.equal(page.data.tag, "印象派");
  assert.equal(page.data.tagId, "style-impressionism");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { type: "count", tag: { id: "style-impressionism", label: "印象派" } },
    { type: "fetch", tag: { id: "style-impressionism", label: "印象派" }, pageSize: 20, skip: 0 },
  ]);
});
