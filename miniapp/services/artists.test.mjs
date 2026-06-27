import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCommonJsModule(filePath, extraContext = {}) {
  const filename = filePath instanceof URL ? fileURLToPath(filePath) : filePath;
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };

  const localRequire = (id) => {
    if (id === "../data/mock-artists") {
      return loadCommonJsModule(new URL("../data/mock-artists.js", import.meta.url));
    }
    return require(id);
  };

  vm.runInNewContext(source, { module, exports: module.exports, require: localRequire, ...extraContext }, { filename });
  return module.exports;
}

function createCloudArtist(overrides = {}) {
  return {
    _id: "claude-monet",
    name_zh: "Claude Monet CN",
    name_en: "Claude Monet",
    lifespan_text: "1840-1926",
    region: "Europe",
    country: "France",
    styles: ["Impressionism"],
    periods: ["19th century"],
    active_period: "Late 19th century",
    representative_works: ["Water Lilies"],
    aliases: ["Claude Monet", "Monet"],
    bio_zh: "Reviewed biography",
    tags: ["light study"],
    avatar_text: "M",
    review_status: "reviewed",
    ...overrides,
  };
}

function createWxApi(rows, options = {}) {
  return {
    cloud: {
      database() {
        return {
          collection(name) {
            assert.equal(name, "artists");
            const createQuery = (filter) => {
              let skipCount = 0;
              return {
                skip(skip) {
                  skipCount = Number(skip || 0);
                  return this;
                },
                limit(limit) {
                  return {
                    async get() {
                      if (options.reject) throw new Error("cloud unavailable");
                      const filteredRows = filter && filter.review_status
                        ? rows.filter((row) => row.review_status === filter.review_status)
                        : rows;
                      const effectiveLimit = options.maxLimit
                        ? Math.min(Number(limit), options.maxLimit)
                        : Number(limit);
                      return { data: filteredRows.slice(skipCount, skipCount + effectiveLimit) };
                    },
                  };
                },
              };
            };
            return {
              where(filter) {
                return createQuery(filter);
              },
              skip(skip) {
                return createQuery().skip(skip);
              },
              limit(limit) {
                return createQuery().limit(limit);
              },
            };
          },
        };
      },
    },
  };
}

const artistsService = loadCommonJsModule(new URL("./artists.js", import.meta.url));

test("loadArtists normalizes reviewed cloud records into page-facing fields", async () => {
  const result = await artistsService.loadArtists({
    wxApi: createWxApi([createCloudArtist()]),
  });

  assert.equal(result.source, "cloud");
  assert.equal(result.artists.length, 1);
  assert.equal(JSON.stringify(result.artists[0]), JSON.stringify({
    id: "claude-monet",
    nameZh: "Claude Monet CN",
    nameEn: "Claude Monet",
    lifespan: "1840-1926",
    region: "Europe",
    country: "France",
    styles: ["Impressionism"],
    periods: ["19th century"],
    activePeriod: "Late 19th century",
    representativeWorks: ["Water Lilies"],
    aliases: ["Claude Monet", "Monet"],
    bio: "Reviewed biography",
    tags: ["light study"],
    avatarText: "M",
    reviewStatus: "reviewed",
  }));
});

test("loadArtists includes collected cloud artists and excludes rejected records", async () => {
  const result = await artistsService.loadArtists({
    wxApi: createWxApi([
      createCloudArtist(),
      createCloudArtist({
        _id: "candidate-artist",
        review_status: "candidate",
      }),
      createCloudArtist({
        _id: "rejected-artist",
        review_status: "rejected",
      }),
    ]),
  });

  assert.equal(result.source, "cloud");
  assert.equal(JSON.stringify(result.artists.map((artist) => artist.id)), JSON.stringify(["claude-monet", "candidate-artist"]));
});

test("loadArtists accepts cloud records that use page-facing camelCase fields", async () => {
  const result = await artistsService.loadArtists({
    wxApi: createWxApi([{
      _id: "cloud-imported-artist",
      nameZh: "Cloud Imported Artist",
      nameEn: "Cloud Imported Artist EN",
      lifespan: "1900-1999",
      country: "France",
      region: "Europe",
      styles: ["Modernism"],
      periods: ["20th century"],
      activePeriod: "20th century",
      representativeWorks: ["Example"],
      aliases: ["Cloud Imported Artist"],
      bio: "Imported from cloud console",
      tags: ["modernism"],
      avatarText: "C",
      reviewStatus: "candidate",
    }]),
  });

  assert.equal(result.source, "cloud");
  assert.equal(result.artists.length, 1);
  assert.equal(result.artists[0].id, "cloud-imported-artist");
  assert.equal(result.artists[0].nameZh, "Cloud Imported Artist");
  assert.equal(result.artists[0].reviewStatus, "candidate");
});

test("loadArtists falls back to local mock artists when cloud read fails", async () => {
  const result = await artistsService.loadArtists({
    wxApi: createWxApi([], { reject: true }),
  });

  assert.equal(result.source, "fallback");
  assert.ok(result.artists.length > 0);
  assert.ok(result.artists[0].id);
  assert.match(result.error, /cloud unavailable/);
});

test("loadArtists falls back when cloud returns no visible artists", async () => {
  const result = await artistsService.loadArtists({
    wxApi: createWxApi([]),
  });

  assert.equal(result.source, "fallback");
  assert.ok(result.artists.length > 0);
  assert.match(result.error, /no visible artists/);
});

test("loadArtists can avoid local fallback when cloud artists are required", async () => {
  const result = await artistsService.loadArtists({
    wxApi: createWxApi([]),
    allowFallback: false,
  });

  assert.equal(result.source, "error");
  assert.equal(result.artists.length, 0);
  assert.match(result.error, /no visible artists/);
});

test("loadArtists fetches all visible cloud artists across pages", async () => {
  const rows = Array.from({ length: 101 }, (_, index) => createCloudArtist({
    _id: `artist-${index + 1}`,
    name_en: `Artist ${index + 1}`,
  }));

  const result = await artistsService.loadArtists({
    wxApi: createWxApi(rows),
  });

  assert.equal(result.source, "cloud");
  assert.equal(result.artists.length, 101);
  assert.equal(result.artists[100].id, "artist-101");
});

test("loadArtists keeps paging when miniapp cloud caps each page at 20 records", async () => {
  const rows = Array.from({ length: 45 }, (_, index) => createCloudArtist({
    _id: `capped-artist-${index + 1}`,
    name_en: `Capped Artist ${index + 1}`,
  }));

  const result = await artistsService.loadArtists({
    wxApi: createWxApi(rows, { maxLimit: 20 }),
  });

  assert.equal(result.source, "cloud");
  assert.equal(result.artists.length, 45);
  assert.equal(result.artists[44].id, "capped-artist-45");
});

test("loadArtistById falls back when cloud returns an empty visible artist set", async () => {
  const result = await artistsService.loadArtistById("claude-monet", {
    wxApi: createWxApi([]),
  });

  assert.equal(result.source, "fallback");
  assert.equal(result.artist.id, "claude-monet");
  assert.match(result.error, /no visible artists/);
});

test("loadArtistById resolves a cloud artist by _id", async () => {
  const result = await artistsService.loadArtistById("vincent-van-gogh", {
    wxApi: createWxApi([
      createCloudArtist(),
      createCloudArtist({
        _id: "vincent-van-gogh",
        name_zh: "Vincent van Gogh CN",
        name_en: "Vincent van Gogh",
        aliases: ["Vincent van Gogh", "Van Gogh"],
      }),
    ]),
  });

  assert.equal(result.source, "cloud");
  assert.equal(result.artist.id, "vincent-van-gogh");
  assert.equal(result.artist.nameEn, "Vincent van Gogh");
});

test("filterArtistList filters by region, style, period, and query", () => {
  const monet = createCloudArtist();
  const matisse = createCloudArtist({
    _id: "henri-matisse",
    name_en: "Henri Matisse",
    styles: ["Modernism"],
    periods: ["20th century"],
    aliases: ["Matisse"],
  });

  const result = artistsService.filterArtistList([monet, matisse], {
    query: "monet",
    filters: {
      region: "Europe",
      style: "Impressionism",
      period: "19th century",
    },
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, "claude-monet");
});

test("artist pagination appends the next page without replacing existing cards", () => {
  const artists = Array.from({ length: 30 }, (_, index) => ({
    id: `artist-${index + 1}`,
  }));

  const initial = artistsService.createArtistPaginationState(artists, { initialLimit: 20 });
  assert.equal(initial.artists.length, 20);
  assert.equal(initial.hasMore, true);

  const appended = artistsService.appendArtistPage(initial.artists, artists, { pageSize: 8 });
  assert.equal(appended.artists.length, 28);
  assert.equal(appended.artists[0].id, "artist-1");
  assert.equal(appended.artists[19].id, "artist-20");
  assert.equal(appended.artists[27].id, "artist-28");
  assert.equal(appended.hasMore, true);

  const completed = artistsService.appendArtistPage(appended.artists, artists, { pageSize: 8 });
  assert.equal(completed.artists.length, 30);
  assert.equal(completed.artists[29].id, "artist-30");
  assert.equal(completed.hasMore, false);
});
