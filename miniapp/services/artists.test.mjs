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
    if (id === "../data/artist-filter-catalog") {
      return {
        ARTIST_CLASSIFICATION_LABELS: {
          "region-europe": "Europe",
          "style-impressionism": "Impressionism",
          "subject-landscape": "Landscape",
          "period-1890s": "1890s",
        },
        ARTIST_FILTER_GROUPS: [],
      };
    }
    if (id === "../data/classification-tags") {
      const labels = {
        "style-impressionism": { label: "Impressionism", group: "style" },
        "subject-landscape": { label: "Landscape", group: "subject" },
        "period-1890s": { label: "1890s", group: "decade" },
      };
      return {
        buildClassificationTagItems(ids) {
          return [...new Set(ids || [])]
            .filter((id) => labels[id])
            .map((id) => ({ id, ...labels[id] }));
        },
      };
    }
    throw new Error(`Unexpected dependency: ${id}`);
  };

  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      require: localRequire,
      setTimeout,
      clearTimeout,
      ...extraContext,
    },
    { filename },
  );
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
  const counters = options.counters || {};
  return {
    cloud: {
      database() {
        return {
          collection(name) {
            assert.equal(name, "artists");
            const createQuery = (filter) => {
              let skipCount = 0;
              let limitCount = 20;
              let projectedFields = null;
              const getFilteredRows = () =>
                filter && filter.review_status
                  ? rows.filter((row) => row.review_status === filter.review_status)
                  : rows;
              const query = {
                field(fields) {
                  projectedFields = fields;
                  counters.projectedFields = fields;
                  return this;
                },
                orderBy(field, direction) {
                  counters.orderBy = { field, direction };
                  return this;
                },
                skip(skip) {
                  skipCount = Number(skip || 0);
                  return this;
                },
                limit(limit) {
                  limitCount = Number(limit);
                  return this;
                },
                async get() {
                  if (options.reject) throw new Error("cloud unavailable");
                  if (options.hang) return new Promise(() => {});
                  counters.listGet = (counters.listGet || 0) + 1;
                  const filteredRows = getFilteredRows();
                  const effectiveLimit = options.maxLimit
                    ? Math.min(limitCount, options.maxLimit)
                    : limitCount;
                  const page = filteredRows.slice(skipCount, skipCount + effectiveLimit);
                  if (!projectedFields) return { data: page };
                  return {
                    data: page.map((row) =>
                      Object.fromEntries(
                        Object.entries(row).filter(([key]) => projectedFields[key]),
                      ),
                    ),
                  };
                },
                async count() {
                  if (options.reject) throw new Error("cloud unavailable");
                  if (options.hang) return new Promise(() => {});
                  counters.count = (counters.count || 0) + 1;
                  return { total: getFilteredRows().length };
                },
              };
              return query;
            };
            const collectionQuery = createQuery();
            return Object.assign(collectionQuery, {
              doc(id) {
                return {
                  async get() {
                    if (options.reject) throw new Error("cloud unavailable");
                    counters.docGet = (counters.docGet || 0) + 1;
                    return { data: rows.find((row) => row._id === id || row.id === id) || null };
                  },
                };
              },
              where(filter) {
                return createQuery(filter);
              },
            });
          },
        };
      },
    },
  };
}

const artistsService = loadCommonJsModule(new URL("./artists.js", import.meta.url));

test("loadArtistPage returns the first 20 compact records without loading the full directory", async () => {
  const counters = {};
  const rows = Array.from({ length: 45 }, (_, index) =>
    createCloudArtist({
      _id: `artist-page-${index + 1}`,
      name_en: `Artist Page ${index + 1}`,
      sources: [{ title: "Source" }],
    }),
  );
  const wxApi = createWxApi(rows, { counters });

  const result = await artistsService.loadArtistPage({
    wxApi,
    allowFallback: false,
  });

  assert.equal(result.source, "cloud");
  assert.equal(result.artists.length, 20);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextSkip, 20);
  assert.equal(counters.listGet, 1);
  assert.equal(counters.projectedFields._id, true);
  assert.equal(counters.projectedFields.sources, undefined);
  assert.equal(counters.projectedFields.portrait_url, true);
  assert.equal(counters.projectedFields.portrait_status, true);
  assert.equal(result.artists[0].bio, undefined);
});

test("loadArtistPage reuses a fresh page cache", async () => {
  const counters = {};
  const wxApi = createWxApi([createCloudArtist()], { counters });

  await artistsService.loadArtistPage({ wxApi, allowFallback: false });
  const result = await artistsService.loadArtistPage({ wxApi, allowFallback: false });

  assert.equal(result.cached, true);
  assert.equal(counters.listGet, 1);
});

test("loadArtistCount returns the reviewed total without downloading artist rows", async () => {
  const counters = {};
  const wxApi = createWxApi(
    [
      createCloudArtist({ _id: "reviewed-1" }),
      createCloudArtist({ _id: "reviewed-2" }),
      createCloudArtist({ _id: "candidate", review_status: "candidate" }),
    ],
    { counters },
  );

  const result = await artistsService.loadArtistCount({
    wxApi,
    allowFallback: false,
  });

  assert.equal(result.source, "cloud");
  assert.equal(result.total, 2);
  assert.equal(counters.count, 1);
  assert.equal(counters.listGet || 0, 0);
});

test("loadArtistCount reuses its fresh total cache", async () => {
  const counters = {};
  const wxApi = createWxApi([createCloudArtist()], { counters });

  await artistsService.loadArtistCount({ wxApi, allowFallback: false });
  const result = await artistsService.loadArtistCount({ wxApi, allowFallback: false });

  assert.equal(result.cached, true);
  assert.equal(counters.count, 1);
});

test("loadArtistCount reports a cloud error without substituting a local total", async () => {
  const result = await artistsService.loadArtistCount({
    wxApi: createWxApi([], { reject: true }),
    allowFallback: false,
  });

  assert.equal(result.source, "error");
  assert.equal(result.total, null);
  assert.match(result.error, /cloud unavailable/);
});

test("loadArtistPage turns a hanging cloud read into an error after the timeout", async () => {
  const result = await artistsService.loadArtistPage({
    wxApi: createWxApi([], { hang: true }),
    allowFallback: false,
    timeoutMs: 10,
  });

  assert.equal(result.source, "error");
  assert.match(result.error, /timed out/);
});

test("loadArtists normalizes reviewed cloud records into page-facing fields", async () => {
  const result = await artistsService.loadArtists({
    wxApi: createWxApi([createCloudArtist()]),
  });

  assert.equal(result.source, "cloud");
  assert.equal(result.artists.length, 1);
  assert.equal(
    JSON.stringify(result.artists[0]),
    JSON.stringify({
      id: "claude-monet",
      nameZh: "Claude Monet CN",
      nameEn: "Claude Monet",
      lifespan: "1840-1926",
      region: "Europe",
      country: "France",
      styles: ["Impressionism"],
      stylesText: "待补充",
      periods: ["19th century"],
      activePeriod: "Late 19th century",
      representativeWorks: [],
      representativeWorksText: "暂无",
      aliases: ["Claude Monet", "Monet"],
      bio: undefined,
      tags: ["light study"],
      tagItems: [],
      avatarText: "M",
      portraitUrl: "",
      portraitSource: "",
      portraitLicense: "",
      portraitCredit: "",
      portraitKind: "",
      portraitArtworkId: "",
      portraitStatus: "",
      portraitUpdatedAt: "",
      artworkCount: 0,
      reviewStatus: "reviewed",
      classificationVersion: "",
      regionId: "",
      styleIds: [],
      subjectIds: [],
      classifiedArtworkCount: 0,
    }),
  );
});

test("normalizeCloudArtist prepares safe display text for controlled styles and works", () => {
  const artist = artistsService.normalizeCloudArtist(
    createCloudArtist({
      style_ids: ["style-impressionism", "style-impressionism", "unknown-style"],
      subject_ids: ["subject-landscape"],
      styles: ["1930s", "Portrait"],
      representative_works: ["Water Lilies", "Water Lilies", "Impression, Sunrise"],
      tags: ["Impressionism", "light study"],
    }),
  );

  assert.equal(artist.stylesText, "Impressionism");
  assert.equal(artist.representativeWorksText, "Water Lilies、Impression, Sunrise");
  assert.equal(artist.representativeWorks.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(artist.tagItems)), [
    { id: "style-impressionism", label: "Impressionism", group: "style" },
    { id: "subject-landscape", label: "Landscape", group: "subject" },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(artist.styles)), ["1930s", "Portrait"]);
});

test("normalizeCloudArtist exposes approved portrait metadata", () => {
  const artist = artistsService.normalizeCloudArtist(
    createCloudArtist({
      portrait_url: "https://cdn.example.test/claude-monet.webp",
      portrait_source: "https://commons.example.test/File:Monet",
      portrait_license: "Public Domain",
      portrait_credit: "Photographer / Museum",
      portrait_kind: "photograph",
      portrait_artwork_id: "artwork-self-portrait",
      portrait_status: "approved",
      portrait_updated_at: "2026-07-26T00:00:00.000Z",
    }),
  );

  assert.equal(artist.portraitUrl, "https://cdn.example.test/claude-monet.webp");
  assert.equal(artist.portraitSource, "https://commons.example.test/File:Monet");
  assert.equal(artist.portraitLicense, "Public Domain");
  assert.equal(artist.portraitCredit, "Photographer / Museum");
  assert.equal(artist.portraitKind, "photograph");
  assert.equal(artist.portraitArtworkId, "artwork-self-portrait");
  assert.equal(artist.portraitStatus, "approved");
  assert.equal(artist.portraitUpdatedAt, "2026-07-26T00:00:00.000Z");
});

test("normalizeCloudArtist suppresses a portrait URL unless status is approved", () => {
  const artist = artistsService.normalizeCloudArtist(
    createCloudArtist({
      portrait_url: "https://cdn.example.test/unreviewed.webp",
      portrait_source: "https://example.test/source",
      portrait_license: "Unknown",
      portrait_credit: "Unknown",
      portrait_kind: "other",
      portrait_artwork_id: "artwork-unreviewed",
      portrait_status: "rights_blocked",
    }),
  );

  assert.equal(artist.portraitUrl, "");
  assert.equal(artist.portraitSource, "");
  assert.equal(artist.portraitLicense, "");
  assert.equal(artist.portraitCredit, "");
  assert.equal(artist.portraitKind, "");
  assert.equal(artist.portraitArtworkId, "");
  assert.equal(artist.portraitStatus, "rights_blocked");
});

test("loadArtists exposes only reviewed cloud artists", async () => {
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
  assert.equal(
    JSON.stringify(result.artists.map((artist) => artist.id)),
    JSON.stringify(["claude-monet"]),
  );
});

test("loadArtists does not expose candidate records that use page-facing camelCase fields", async () => {
  const result = await artistsService.loadArtists({
    wxApi: createWxApi([
      {
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
        review_status: "candidate",
        reviewStatus: "candidate",
      },
    ]),
    allowFallback: false,
  });

  assert.equal(result.source, "error");
  assert.equal(result.artists.length, 0);
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
  const rows = Array.from({ length: 101 }, (_, index) =>
    createCloudArtist({
      _id: `artist-${index + 1}`,
      name_en: `Artist ${index + 1}`,
    }),
  );

  const result = await artistsService.loadArtists({
    wxApi: createWxApi(rows),
  });

  assert.equal(result.source, "cloud");
  assert.equal(result.artists.length, 101);
  assert.equal(result.artists[100].id, "artist-101");
});

test("loadArtists keeps paging when miniapp cloud caps each page at 20 records", async () => {
  const rows = Array.from({ length: 45 }, (_, index) =>
    createCloudArtist({
      _id: `capped-artist-${index + 1}`,
      name_en: `Capped Artist ${index + 1}`,
    }),
  );

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

test("loadArtistById does not fall back when a cloud artist exists but is rejected", async () => {
  const result = await artistsService.loadArtistById("claude-monet", {
    wxApi: createWxApi([
      createCloudArtist({
        _id: "claude-monet",
        review_status: "rejected",
      }),
    ]),
  });

  assert.equal(result.source, "cloud");
  assert.equal(result.artist, null);
});

test("loadArtistById does not expose a candidate cloud artist", async () => {
  const result = await artistsService.loadArtistById("claude-monet", {
    wxApi: createWxApi([
      createCloudArtist({
        _id: "claude-monet",
        review_status: "candidate",
      }),
    ]),
  });

  assert.equal(result.source, "cloud");
  assert.equal(result.artist, null);
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

test("loadArtistById uses direct cloud document lookup for known ids", async () => {
  const counters = {};
  const result = await artistsService.loadArtistById("vincent-van-gogh", {
    wxApi: createWxApi(
      [
        createCloudArtist(),
        createCloudArtist({
          _id: "vincent-van-gogh",
          name_zh: "Vincent van Gogh CN",
          name_en: "Vincent van Gogh",
        }),
      ],
      { counters },
    ),
    allowFallback: false,
  });

  assert.equal(result.source, "cloud");
  assert.equal(result.artist.id, "vincent-van-gogh");
  assert.equal(counters.docGet, 1);
  assert.equal(counters.listGet || 0, 0);
});

test("loadArtistByArtworkText resolves a cloud artist from artwork artist label", async () => {
  const result = await artistsService.loadArtistByArtworkText(
    "阿尔丰斯·穆夏 (Alphonse Mucha, 1860-1939)",
    {
      wxApi: createWxApi([
        createCloudArtist({
          _id: "alphonse-mucha",
          name_zh: "阿尔丰斯·穆夏",
          name_en: "Alphonse Mucha",
          aliases: ["Mucha", "穆夏"],
        }),
      ]),
      allowFallback: false,
    },
  );

  assert.equal(result.source, "cloud");
  assert.equal(result.artist.id, "alphonse-mucha");
});

test("filterArtistList filters by region, style, and query", () => {
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
    },
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].id, "claude-monet");
});

test("filterArtistList uses controlled region, style, and subject ids", () => {
  const monet = createCloudArtist({
    region_id: "region-europe",
    style_ids: ["style-impressionism"],
    subject_ids: ["subject-landscape"],
  });
  const result = artistsService.filterArtistList([monet], {
    query: "landscape",
    filters: {
      region: "region-europe",
      style: "style-impressionism",
      subject: "subject-landscape",
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
