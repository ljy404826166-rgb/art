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

test("artist detail renders related artworks without a total count query", async () => {
  const page = loadArtistDetailPage({
    artists: {
      loadArtistById: async () => ({
        artist: { id: "vincent-van-gogh", aliases: ["Vincent van Gogh", "Van Gogh"] },
        source: "cloud",
      }),
    },
    artworks: {
      fetchArtworksByArtistAliases: async () => [{ id: "shoes", title: "Shoes" }],
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
        artist: { id: "vincent-van-gogh", aliases: ["Vincent van Gogh", "Van Gogh"] },
        source: "cloud",
      }),
    },
    artworks: {
      fetchArtworksByArtistAliases: async (_aliases, options) => {
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
