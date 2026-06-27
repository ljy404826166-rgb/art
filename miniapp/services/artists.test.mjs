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
            return {
              where(filter) {
                assert.equal(JSON.stringify(filter), JSON.stringify({ review_status: "reviewed" }));
                return {
                  limit(limit) {
                    assert.equal(limit, 100);
                    return {
                      async get() {
                        if (options.reject) throw new Error("cloud unavailable");
                        return { data: rows };
                      },
                    };
                  },
                };
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

test("loadArtists excludes non-reviewed cloud records defensively", async () => {
  const result = await artistsService.loadArtists({
    wxApi: createWxApi([
      createCloudArtist(),
      createCloudArtist({
        _id: "candidate-artist",
        review_status: "candidate",
      }),
    ]),
  });

  assert.equal(result.source, "cloud");
  assert.deepEqual(result.artists.map((artist) => artist.id), ["claude-monet"]);
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
