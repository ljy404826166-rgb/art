import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const filterGroups = [
  {
    key: "region",
    name: "Region",
    tags: ["All", "Europe"],
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

  vm.runInNewContext(source, {
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
  }, { filename });

  return page;
}

test("artists page requires cloud data instead of local fallback", async () => {
  const loadCalls = [];
  const page = loadArtistsPage({
    loadArtists: async (options) => {
      loadCalls.push(options);
      return {
        artists: makeArtists(24),
        source: "cloud",
      };
    },
  });

  await page.loadArtists();

  assert.equal(loadCalls.length, 1);
  assert.equal(loadCalls[0].allowFallback, false);
  assert.equal(page.data.source, "cloud");
  assert.equal(page.data.allArtists.length, 24);
  assert.equal(page.data.artists.length, 20);
  assert.equal(page.data.hasMoreArtists, true);
  assert.match(page.data.resultCountText, /24/);
});

test("artists page appends eight cards without replacing existing cards", async () => {
  const page = loadArtistsPage({
    loadArtists: async () => ({
      artists: makeArtists(30),
      source: "cloud",
    }),
  });

  await page.loadArtists();

  assert.equal(page.data.artists.length, 20);
  assert.equal(page.data.artists[0].id, "artist-1");
  assert.equal(page.data.artists[19].id, "artist-20");

  page.onReachBottom();

  assert.equal(page.data.artists.length, 28);
  assert.equal(page.data.artists[0].id, "artist-1");
  assert.equal(page.data.artists[19].id, "artist-20");
  assert.equal(page.data.artists[27].id, "artist-28");
  assert.equal(page.data.hasMoreArtists, true);

  page.onReachBottom();

  assert.equal(page.data.artists.length, 30);
  assert.equal(page.data.artists[29].id, "artist-30");
  assert.equal(page.data.hasMoreArtists, false);
});

test("artists page does not display fallback cards when cloud read fails", async () => {
  const page = loadArtistsPage({
    loadArtists: async () => ({
      artists: makeArtists(8),
      source: "error",
      error: "cloud artists collection failed",
    }),
  });

  await page.loadArtists();

  assert.equal(page.data.artists.length, 0);
  assert.equal(page.data.allArtists.length, 0);
  assert.equal(page.data.hasMoreArtists, false);
  assert.equal(page.data.error, "cloud artists collection failed");
});
