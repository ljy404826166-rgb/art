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

  vm.runInNewContext(
    source,
    {
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
    },
    { filename },
  );

  return page;
}

test("tag header does not display an artwork count", () => {
  const template = readFileSync(new URL("./tag.wxml", import.meta.url), "utf8");
  const styles = readFileSync(new URL("./tag.wxss", import.meta.url), "utf8");
  const source = readFileSync(new URL("./tag.js", import.meta.url), "utf8");

  assert.doesNotMatch(template, /tag-count|resultCountText/);
  assert.doesNotMatch(styles, /\.tag-count/);
  assert.doesNotMatch(source, /resultCountText/);
});

test("tag loading skeleton matches the flush artwork grid", () => {
  const template = readFileSync(new URL("./tag.wxml", import.meta.url), "utf8");

  assert.match(template, /<skeleton-card[^>]*variant="grid"[^>]*inset="\{\{false\}\}"/);
});

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

  assert.deepEqual(
    page.data.artworks.map((item) => item.id),
    ["a1", "a2"],
  );
  assert.equal(page.data.skip, 2);
  assert.equal(page.data.hasMore, true);

  await page.loadMore();

  assert.deepEqual(
    page.data.artworks.map((item) => item.id),
    ["a1", "a2", "a3", "a4"],
  );
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

test("tag page uses the typed artist query for full Leonardo pagination", async () => {
  const calls = [];
  const page = loadTagPage({
    countArtworksByTag: async () => 0,
    fetchArtworksByTag: async () => [],
    countArtworksBySection: async (query) => {
      calls.push({ type: "count", query });
      return 22;
    },
    fetchArtworksBySection: async (query, options) => {
      calls.push({ type: "fetch", query, options });
      return Array.from({ length: 20 }, (_, index) => ({ id: `leonardo-${index + 1}` }));
    },
    fallbackArtworksByTag: () => [],
    fallbackArtworkCountByTag: () => 0,
    normalizeError: (error) => String(error && error.message ? error.message : error),
  });

  await page.onLoad({
    tag: encodeURIComponent("列奥纳多·达·芬奇"),
    queryType: "artist",
    queryId: "leonardo-da-vinci",
  });

  assert.equal(page.data.totalCount, 22);
  assert.equal(page.data.artworks.length, 20);
  assert.equal(page.data.hasMore, true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    {
      type: "count",
      query: {
        type: "artist",
        id: "leonardo-da-vinci",
        label: "列奥纳多·达·芬奇",
      },
    },
    {
      type: "fetch",
      query: {
        type: "artist",
        id: "leonardo-da-vinci",
        label: "列奥纳多·达·芬奇",
      },
      options: { pageSize: 20, skip: 0 },
    },
  ]);
});
