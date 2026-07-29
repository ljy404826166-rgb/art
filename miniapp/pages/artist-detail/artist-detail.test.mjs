import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadArtistDetailPage(services) {
  const filename = fileURLToPath(new URL("./artist-detail.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  let page = null;
  const navigations = [];
  const clipboardWrites = [];
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

  vm.runInNewContext(
    source,
    {
      module: { exports: {} },
      exports: {},
      require: localRequire,
      Page,
      wx: {
        setNavigationBarTitle() {},
        navigateBack() {},
        switchTab() {},
        showToast() {},
        navigateTo(options) {
          navigations.push(options.url);
        },
        setClipboardData(options) {
          clipboardWrites.push(options.data);
          if (options.success) options.success();
        },
      },
      console: {
        warn() {},
      },
    },
    { filename },
  );

  page.navigations = navigations;
  page.clipboardWrites = clipboardWrites;
  return page;
}

test("artist detail renders related artworks with a total count query", async () => {
  const page = loadArtistDetailPage({
    artists: {
      loadArtistById: async () => ({
        artist: {
          id: "vincent-van-gogh",
          nameZh: "文森特·梵高",
          aliases: ["Vincent van Gogh", "Van Gogh"],
        },
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
  const makeItems = (skip, count) =>
    Array.from({ length: count }, (_, index) => ({
      id: `artwork-${skip + index + 1}`,
    }));
  const page = loadArtistDetailPage({
    artists: {
      loadArtistById: async () => ({
        artist: {
          id: "vincent-van-gogh",
          nameZh: "文森特·梵高",
          aliases: ["Vincent van Gogh", "Van Gogh"],
        },
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
        artist: {
          id: "claude-monet",
          nameZh: "克洛德·莫奈",
          aliases: ["Claude Monet", "Monet", "莫奈"],
        },
        source: "cloud",
      }),
    },
    artworks: {
      countArtworksByArtist: async () => 303,
      fetchArtworksByArtist: async (_artist, options) =>
        Array.from({ length: options.pageSize }, (_, index) => ({
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

test("artist detail template renders precomputed text instead of calling array methods", () => {
  const template = readFileSync(new URL("./artist-detail.wxml", import.meta.url), "utf8");

  assert.match(template, /\{\{artist\.stylesText\}\}/);
  assert.match(template, /\{\{artist\.representativeWorksText\}\}/);
  assert.doesNotMatch(template, /\.join\(/);
});

test("artist detail ignores legacy text tags without a controlled id", () => {
  const page = loadArtistDetailPage({
    artists: {},
    artworks: {},
    localLibrary: {},
  });

  page.openClassificationTag({
    currentTarget: {
      dataset: { tag: "公共领域" },
    },
  });

  assert.deepEqual(page.navigations, []);
});

test("artist detail passes a controlled classification id to the tag page", () => {
  const page = loadArtistDetailPage({
    artists: {},
    artworks: {},
    localLibrary: {},
  });

  page.openClassificationTag({
    currentTarget: {
      dataset: {
        tag: "印象派",
        tagId: "style-impressionism",
      },
    },
  });

  assert.deepEqual(page.navigations, [
    "/pages/tag/tag?tag=%E5%8D%B0%E8%B1%A1%E6%B4%BE&queryType=classification&queryId=style-impressionism",
  ]);
});

test("artist detail template binds every controlled tag to typed navigation", () => {
  const template = readFileSync(new URL("./artist-detail.wxml", import.meta.url), "utf8");

  assert.match(
    template,
    /class="artist-tag"[^>]+data-tag="\{\{item\.label\}\}"[^>]+data-tag-id="\{\{item\.id\}\}"[^>]+bindtap="openClassificationTag"/,
  );
});

test("artist detail uses the shared portrait without showing source attribution", () => {
  const template = readFileSync(new URL("./artist-detail.wxml", import.meta.url), "utf8");
  const config = JSON.parse(readFileSync(new URL("./artist-detail.json", import.meta.url), "utf8"));

  assert.match(
    template,
    /<artist-portrait artist="\{\{artist\}\}" size="detail" lazy-load="\{\{false\}\}" \/>/u,
  );
  assert.doesNotMatch(template, /肖像来源与授权/u);
  assert.doesNotMatch(template, /artist\.portraitCredit/u);
  assert.doesNotMatch(template, /artist\.portraitLicense/u);
  assert.doesNotMatch(template, /copyPortraitSource/u);
  assert.doesNotMatch(template, /class="portrait">\{\{artist\.avatarText\}\}/u);
  assert.equal(
    config.usingComponents["artist-portrait"],
    "../../components/artist-portrait/artist-portrait",
  );
});
