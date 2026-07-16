import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadArtistDetailPage(services) {
  const filename = fileURLToPath(new URL("./artist-detail.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  let page = null;
  const localRequire = (id) => {
    if (id === "../../services/artists") return services.artists;
    if (id === "../../services/artworks") return services.artworks;
    if (id === "../../services/local-library") return services.localLibrary;
    if (id === "../../services/share-routes") {
      return services.shareRoutes || {
        buildArtistShareMessage: (artist) => ({
          title: artist ? artist.nameZh : "fallback",
          path: artist ? `/artist/${artist.id}` : "/",
        }),
      };
    }
    return require(id);
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
    require: localRequire,
    Page,
    wx: {
      setNavigationBarTitle() {},
      navigateBack() {},
      switchTab() {},
      showToast() {},
    },
    console: {
      warn() {},
    },
  }, { filename });

  return page;
}

test("artist detail renders related artworks with a total count query", async () => {
  const page = loadArtistDetailPage({
    artists: {
      loadArtistById: async () => ({
        artist: { id: "vincent-van-gogh", nameZh: "文森特·梵高", aliases: ["Vincent van Gogh", "Van Gogh"] },
        source: "cloud",
      }),
    },
    artworks: {
      countArtworksByArtist: async () => 303,
      fetchArtworksByArtist: async () => [{ id: "shoes", title: "Shoes" }],
      fallbackArtworksByArtistAliases: () => [],
      normalizeError: (error) => String(error && error.message ? error.message : error),
    },
    localLibrary: {
      isFollowedArtist: () => false,
      toggleFollowedArtist: () => true,
    },
  });

  const result = await Promise.race([
    page.loadArtist("vincent-van-gogh").then(() => "loaded"),
    new Promise((resolve) => setTimeout(() => resolve("blocked"), 20)),
  ]);

  assert.equal(result, "loaded");
  assert.equal(page.data.loading, false);
  assert.equal(page.data.artworkTotal, 303);
  assert.equal(page.data.hasMore, true);
  assert.deepEqual(page.data.artworks, [{ id: "shoes", title: "Shoes" }]);
});

test("artist detail loads the first 8 artworks and appends the next 8 on reach bottom", async () => {
  const calls = [];
  const makeItems = (skip, count) => Array.from({ length: count }, (_, index) => ({
    id: `artwork-${skip + index + 1}`,
  }));
  const page = loadArtistDetailPage({
    artists: {
      loadArtistById: async () => ({
        artist: { id: "vincent-van-gogh", nameZh: "文森特·梵高", aliases: ["Vincent van Gogh", "Van Gogh"] },
        source: "cloud",
      }),
    },
    artworks: {
      countArtworksByArtist: async () => 24,
      fetchArtworksByArtist: async (_artist, options) => {
        calls.push({ pageSize: options.pageSize, skip: options.skip });
        return makeItems(options.skip || 0, options.pageSize);
      },
      fallbackArtworksByArtistAliases: () => [],
      normalizeError: (error) => String(error && error.message ? error.message : error),
    },
    localLibrary: {
      isFollowedArtist: () => false,
      toggleFollowedArtist: () => true,
    },
  });

  await page.loadArtist("vincent-van-gogh");

  assert.equal(page.data.artworks.length, 8);
  assert.equal(page.data.skip, 8);
  assert.equal(page.data.artworkTotal, 24);
  assert.equal(page.data.hasMore, true);

  await page.loadMore();

  assert.equal(page.data.artworks.length, 16);
  assert.equal(page.data.artworks[0].id, "artwork-1");
  assert.equal(page.data.artworks[15].id, "artwork-16");
  assert.deepEqual(calls, [
    { pageSize: 8, skip: 0 },
    { pageSize: 8, skip: 8 },
  ]);
});

test("artist detail does not stop after the first page when the artist total is larger", async () => {
  const page = loadArtistDetailPage({
    artists: {
      loadArtistById: async () => ({
        artist: { id: "claude-monet", nameZh: "克洛德·莫奈", aliases: ["Claude Monet", "Monet", "莫奈"] },
        source: "cloud",
      }),
    },
    artworks: {
      countArtworksByArtist: async () => 303,
      fetchArtworksByArtist: async (_artist, options) => Array.from({ length: options.pageSize }, (_, index) => ({
        id: `monet-${(options.skip || 0) + index + 1}`,
      })),
      fallbackArtworksByArtistAliases: () => [],
      normalizeError: (error) => String(error && error.message ? error.message : error),
    },
    localLibrary: {
      isFollowedArtist: () => false,
      toggleFollowedArtist: () => true,
    },
  });

  await page.loadArtist("claude-monet");

  assert.equal(page.data.artworks.length, 8);
  assert.equal(page.data.artworkTotal, 303);
  assert.equal(page.data.hasMore, true);
});

test("artist detail config sets a reach-bottom distance for related artworks pagination", () => {
  const config = JSON.parse(readFileSync(new URL("./artist-detail.json", import.meta.url), "utf8"));

  assert.equal(typeof config.onReachBottomDistance, "number");
  assert.ok(config.onReachBottomDistance >= 120);
});

test("artist detail exposes a stable share payload", () => {
  const page = loadArtistDetailPage({
    artists: {},
    artworks: {},
    localLibrary: {},
    shareRoutes: {
      buildArtistShareMessage: (artist) => ({
        title: artist.nameZh,
        path: `/pages/artist-detail/artist-detail?id=${artist.id}`,
      }),
    },
  });
  page.data.artist = { id: "monet", nameZh: "莫奈" };

  assert.deepEqual(page.onShareAppMessage(), {
    title: "莫奈",
    path: "/pages/artist-detail/artist-detail?id=monet",
  });
});
