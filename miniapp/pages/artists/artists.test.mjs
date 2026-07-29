import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const filterGroups = [
  {
    key: "region",
    name: "Region",
    tags: [{ id: "region-europe", label: "Europe" }],
  },
  {
    key: "style",
    name: "Style",
    tags: Array.from({ length: 10 }, (_, index) => ({
      id: `style-${index + 1}`,
      label: `Style ${index + 1}`,
    })),
  },
];

function makeArtists(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `artist-${index + 1}`,
    nameZh: `Artist CN ${index + 1}`,
    nameEn: `Artist ${index + 1}`,
    country: "France",
    styles: ["Impressionism"],
    lifespan: "1840-1926",
  }));
}

function createArtistPaginationState(artists, options) {
  const initialLimit = Number(options && options.initialLimit) || 20;
  const visible = artists.slice(0, initialLimit);
  return {
    artists: visible,
    total: artists.length,
    hasMore: visible.length < artists.length,
  };
}

function appendArtistPage(currentArtists, allArtists, options) {
  const pageSize = Number(options && options.pageSize) || 8;
  const visible = currentArtists.concat(
    allArtists.slice(currentArtists.length, currentArtists.length + pageSize),
  );
  return {
    artists: visible,
    total: allArtists.length,
    hasMore: visible.length < allArtists.length,
  };
}

function loadArtistsPage(artistService) {
  const filename = fileURLToPath(new URL("./artists.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  let page = null;
  const service = {
    appendArtistPage,
    artistFilterGroups: filterGroups,
    createArtistPaginationState,
    filterArtistList: (artists) => artists,
    loadArtistCount: async () => ({
      total: null,
      source: "error",
      error: "count unavailable",
    }),
    ...artistService,
  };
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
        if (id === "../../services/artists") return service;
        return require(id);
      },
      Page,
      wx: {
        setNavigationBarTitle() {},
        navigateTo() {},
      },
      console: {
        warn() {},
      },
    },
    { filename },
  );

  return page;
}

test("artists page renders the first cloud page before the full directory finishes", async () => {
  const pageCalls = [];
  let resolveDirectory;
  let resolveCount;
  const directoryPromise = new Promise((resolve) => {
    resolveDirectory = resolve;
  });
  const countPromise = new Promise((resolve) => {
    resolveCount = resolve;
  });
  const page = loadArtistsPage({
    loadArtistPage: async (options) => {
      pageCalls.push(options);
      return {
        artists: makeArtists(20),
        source: "cloud",
        hasMore: true,
      };
    },
    loadArtists: async (options) => {
      pageCalls.push(options);
      return directoryPromise;
    },
    loadArtistCount: async () => countPromise,
  });

  await page.loadArtists();

  assert.equal(pageCalls.length, 2);
  assert.equal(pageCalls[0].allowFallback, false);
  assert.equal(pageCalls[0].pageSize, 20);
  assert.equal(page.data.source, "cloud");
  assert.equal(page.data.artists.length, 20);
  assert.equal(page.data.loading, false);
  assert.equal(page.data.hasMoreArtists, true);
  assert.equal(page.data.resultCountText, "读取中");

  const pendingCount = page._artistCountPromise;
  resolveCount({
    total: 24,
    source: "cloud",
  });
  await pendingCount;
  assert.equal(page.data.resultCountText, "24位");

  resolveDirectory({
    artists: makeArtists(24),
    source: "cloud",
  });
  await page._directoryLoadPromise;

  assert.equal(page.data.artists.length, 20);
  assert.equal(page.data.hasMoreArtists, true);
  assert.match(page.data.resultCountText, /24/);
});

test("artists page appends eight cards without replacing existing cards", async () => {
  const page = loadArtistsPage({
    loadArtistPage: async () => ({
      artists: makeArtists(20),
      source: "cloud",
      hasMore: true,
    }),
    loadArtists: async () => ({
      artists: makeArtists(30),
      source: "cloud",
    }),
  });

  await page.loadArtists();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(page.data.artists.length, 20);
  assert.equal(page.data.artists[0].id, "artist-1");
  assert.equal(page.data.artists[19].id, "artist-20");

  await page.onReachBottom();

  assert.equal(page.data.artists.length, 28);
  assert.equal(page.data.artists[0].id, "artist-1");
  assert.equal(page.data.artists[19].id, "artist-20");
  assert.equal(page.data.artists[27].id, "artist-28");
  assert.equal(page.data.hasMoreArtists, true);

  await page.onReachBottom();

  assert.equal(page.data.artists.length, 30);
  assert.equal(page.data.artists[29].id, "artist-30");
  assert.equal(page.data.hasMoreArtists, false);
});

test("artists page does not display fallback cards when cloud read fails", async () => {
  const page = loadArtistsPage({
    loadArtistPage: async () => ({
      artists: makeArtists(8),
      source: "error",
      error: "cloud artists collection failed",
    }),
    loadArtists: async () => {
      throw new Error("full directory should not load after the first page fails");
    },
  });

  await page.loadArtists();

  assert.equal(page.data.artists.length, 0);
  assert.equal(page._allArtists.length, 0);
  assert.equal(page.data.hasMoreArtists, false);
  assert.equal(page.data.error, "cloud artists collection failed");
});

test("a late count response does not overwrite the first-page error state", async () => {
  let resolveCount;
  const countPromise = new Promise((resolve) => {
    resolveCount = resolve;
  });
  const page = loadArtistsPage({
    loadArtistPage: async () => ({
      artists: [],
      source: "error",
      error: "cloud unavailable",
    }),
    loadArtistCount: async () => countPromise,
    loadArtists: async () => {
      throw new Error("full directory should not load after the first page fails");
    },
  });

  await page.loadArtists();
  const pendingCount = page._artistCountPromise;
  resolveCount({ total: 103, source: "cloud" });
  await pendingCount;

  assert.equal(page.data.error, "cloud unavailable");
  assert.equal(page.data.resultCountText, "0位");
  assert.equal(page.data.artists.length, 0);
});

test("artists page selects controlled ids independently and can clear a group", () => {
  const page = loadArtistsPage({});
  page._allArtists = [];
  page.selectTag({
    currentTarget: {
      dataset: { group: "region", tagId: "region-europe" },
    },
  });
  assert.equal(page.data.filters.region, "region-europe");
  assert.equal(page.data.groups[0].tags[0].selected, true);

  page.selectTag({
    currentTarget: {
      dataset: { group: "region", tagId: "region-europe" },
    },
  });
  assert.equal(page.data.filters.region, "");
  assert.equal(page.data.groups[0].tags[0].selected, false);
});

test("artists page expands and collapses long filter groups", () => {
  const page = loadArtistsPage({});
  const styleGroup = page.data.groups.find((group) => group.key === "style");
  assert.equal(styleGroup.canExpand, true);
  assert.equal(styleGroup.expanded, false);
  assert.equal(styleGroup.tags.length, 10);
  assert.equal(styleGroup.panelStyle, "height: 54rpx;");

  page.toggleGroup({
    currentTarget: {
      dataset: { group: "style" },
    },
  });

  const expanded = page.data.groups.find((group) => group.key === "style");
  assert.equal(expanded.expanded, true);
  assert.equal(expanded.tags.length, 10);
  assert.equal(expanded.panelStyle, "height: auto;");
});

test("artists page reuses the category filter interaction contract", () => {
  const template = readFileSync(fileURLToPath(new URL("./artists.wxml", import.meta.url)), "utf8");
  const styles = readFileSync(fileURLToPath(new URL("./artists.wxss", import.meta.url)), "utf8");
  assert.match(template, /class="chip-clip" style="\{\{item\.panelStyle\}\}"/);
  assert.match(template, /class="chip-wrap chip-measure"/);
  assert.match(template, /wx:for="\{\{item\.tags\}\}"/);
  assert.match(template, /\{\{tag\.selected \? 'is-active' : ''\}\}/);
  assert.match(template, /data-group="\{\{item\.key\}\}"/);
  assert.equal((template.match(/hover-class="is-pressed"/g) || []).length, 2);
  assert.doesNotMatch(template, /visibleTags|<scroll-view/);
  assert.doesNotMatch(template, /canExpand|activeTagId|expandLabel/);
  assert.match(
    styles,
    /\.chip-clip\s*\{[\s\S]*transition: height 260ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/,
  );
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(template, /作品年代|年代\.\.\./);
});

test("artists result header does not display the artist count", () => {
  const template = readFileSync(fileURLToPath(new URL("./artists.wxml", import.meta.url)), "utf8");
  const styles = readFileSync(fileURLToPath(new URL("./artists.wxss", import.meta.url)), "utf8");

  assert.doesNotMatch(template, /result-count|resultCountText/);
  assert.doesNotMatch(styles, /\.result-count/);
});

test("artists page measures persistent chip panels for accordion height", () => {
  const filename = fileURLToPath(new URL("./artists.js", import.meta.url));
  const source = readFileSync(filename, "utf8");

  assert.match(source, /groupHeights: \{\}/);
  assert.match(source, /measureGroupHeights\(\)/);
  assert.match(source, /\.selectAll\("\.chip-measure"\)/);
  assert.match(source, /panelStyle: expanded/);
  assert.match(source, /"height: 54rpx;"/);
});

test("artists page renders the shared portrait component with lazy loading", () => {
  const template = readFileSync(new URL("./artists.wxml", import.meta.url), "utf8");
  const config = JSON.parse(readFileSync(new URL("./artists.json", import.meta.url), "utf8"));

  assert.match(
    template,
    /<artist-portrait artist="\{\{item\}\}" size="list" lazy-load="\{\{true\}\}" \/>/u,
  );
  assert.doesNotMatch(template, /class="artist-avatar"/u);
  assert.equal(
    config.usingComponents["artist-portrait"],
    "../../components/artist-portrait/artist-portrait",
  );
});
