import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCommonJsModule(filePath, overrides = {}) {
  const filename = filePath instanceof URL ? fileURLToPath(filePath) : filePath;
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };
  const localRequire = (id) => {
    if (Object.prototype.hasOwnProperty.call(overrides, id)) return overrides[id];
    if (id === "../../services/search-engine")
      return loadCommonJsModule(new URL("../../services/search-engine.js", import.meta.url));
    return require(id);
  };
  const context = {
    module,
    exports: module.exports,
    require: localRequire,
    Page: overrides.Page,
    wx: overrides.wx || {},
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(source, context, { filename });
  return module.exports;
}

const { createHomeSearchState } = loadCommonJsModule(new URL("./home-search.js", import.meta.url));
const { searchArtworks } = loadCommonJsModule(
  new URL("../../services/search-engine.js", import.meta.url),
);

const artworks = [
  { id: "1", title: "Starry Night", artist: "Vincent van Gogh" },
  { id: "2", title: "Water Lilies", artist: "Claude Monet" },
];

function assertIds(actualItems, expectedIds) {
  assert.equal(
    JSON.stringify(Array.from(actualItems).map((item) => item.id)),
    JSON.stringify(expectedIds),
  );
}

function assertJsonEqual(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function loadHomePageWithSearch(searchArtworksMock, options = {}) {
  let pageDefinition;
  const navigations = [];
  const Page = (definition) => {
    pageDefinition = definition;
  };

  const homeSearch = loadCommonJsModule(new URL("./home-search.js", import.meta.url));
  loadCommonJsModule(new URL("./home.js", import.meta.url), {
    Page,
    wx: {},
    "../../services/artworks": {
      fetchRandomArtworks: options.fetchRandomArtworks || (async () => []),
      fetchRecommendationChannels: options.fetchRecommendationChannels || (async () => []),
      fetchRandomArtworksBySection:
        options.fetchRandomArtworksBySection ||
        (async () => ({ items: [], total: 0, hasMore: false })),
      diversifyArtworksByArtist: (items) => items,
      searchArtworks: searchArtworksMock,
      fallbackSearchArtworks: () => [],
      fallbackLatestArtworks: () => [],
      normalizeError: (error) => String((error && error.message) || error || ""),
    },
    "./home-pagination": {
      createPaginatedSection: (section) => section,
      getArtworkKey: (item) => item && (item.id || item._id),
      getFreshArtworkBatch: (existing, incoming, limit) => (incoming || []).slice(0, limit),
    },
    "./home-search": homeSearch,
    "./home-placeholder": loadCommonJsModule(new URL("./home-placeholder.js", import.meta.url)),
    "./home-sections": {
      getHomeSectionCacheKey: (section) =>
        `${section.queryType}:${section.queryId || section.queryLabel}`,
      getHomeSectionQuery: (section) => ({
        type: section.queryType,
        id: section.queryId,
        label: section.queryLabel,
      }),
      resolveHomeSectionQuery: (tag) => ({ type: "tag", id: "", label: tag }),
    },
  });

  const page = {
    ...pageDefinition,
    data: JSON.parse(JSON.stringify(pageDefinition.data)),
    setData(patch) {
      Object.entries(patch).forEach(([key, value]) => {
        const sectionMatch = key.match(/^sections\[(\d+)\]\.(.+)$/);
        if (sectionMatch) {
          const index = Number(sectionMatch[1]);
          this.data.sections[index][sectionMatch[2]] = value;
          return;
        }
        this.data[key] = value;
      });
    },
  };
  page._navigations = navigations;
  return page;
}

test("home builds typed sections from the published recommendation channel catalog", async () => {
  const channelCalls = [];
  const page = loadHomePageWithSearch(async () => [], {
    fetchRandomArtworks: async () => [
      {
        id: "monet-1",
        title: "睡莲",
        artist_ids: ["claude-monet"],
        recommendation_signal_ids: ["signal-calm"],
      },
    ],
    fetchRecommendationChannels: async (options) => {
      channelCalls.push(options);
      return [
        {
          channel_key: "artist:claude-monet",
          title: "克劳德·莫奈",
          display_title: "莫奈的光与色",
          kind: "artist",
          query_field: "artist_ids",
          query_value: "claude-monet",
        },
      ];
    },
  });
  page.hydrateSectionRows = async () => {};

  await page.loadArtworks();

  assertJsonEqual(channelCalls, [{ limit: 200 }]);
  assert.equal(page.data.channelCatalog.length, 1);
  assert.equal(page.data.sections.length, 2);
  assert.equal(page.data.sections[1].title, "克劳德·莫奈");
  assert.equal(page.data.sections[1].queryType, "artist");
  assert.equal(page.data.sections[1].queryId, "claude-monet");
  assert.equal(page.data.searchPlaceholder, "睡莲");
  assertIds(page.data.sections[1].items, ["monet-1"]);
});

test("home never mixes an artist name into a tag channel heading", async () => {
  const page = loadHomePageWithSearch(async () => [], {
    fetchRandomArtworks: async () => [
      {
        id: "poetry-1",
        recommendation_signal_ids: ["signal-poetry"],
      },
    ],
    fetchRecommendationChannels: async () => [
      {
        channel_key: "signal:signal-poetry",
        title: "诗画",
        display_title: "葛饰北斋 · 诗画",
        kind: "signal",
        query_field: "recommendation_signal_ids",
        query_value: "signal-poetry",
      },
    ],
  });
  page.hydrateSectionRows = async () => {};

  await page.loadArtworks();

  assert.equal(page.data.sections[1].title, "诗画");
  assert.equal(page.data.sections[1].queryType, "signal");
});

test("createHomeSearchState returns to the home feed when the query is empty", () => {
  const state = createHomeSearchState(artworks, "   ");

  assert.equal(state.searchQuery, "   ");
  assert.equal(state.searchMode, false);
  assert.equal(state.searchResults.length, 0);
});

test("createHomeSearchState does not search the random home sample for non-empty input", () => {
  const state = createHomeSearchState(artworks, " van ");

  assert.equal(state.searchQuery, " van ");
  assert.equal(state.searchMode, true);
  assertIds(state.searchResults, []);
});

test("createHomeSearchState can preserve full-database results supplied by caller", () => {
  const state = createHomeSearchState([], " van ", { results: [artworks[0]] });

  assert.equal(state.searchMode, true);
  assertIds(state.searchResults, ["1"]);
});

test("home cloud search ignores an older response that resolves after a newer query", async () => {
  const older = deferred();
  const newer = deferred();
  const calls = [];
  const page = loadHomePageWithSearch((query) => {
    calls.push(query);
    return query === "old" ? older.promise : newer.promise;
  });

  page.data.searchMode = true;
  page.data.searching = true;
  page.data.searchTotal = 0;
  page.searchRequestId = 2;
  const oldSearch = page.runCloudSearch("old", 1);
  const newSearch = page.runCloudSearch("new", 2);

  newer.resolve([{ id: "new-result" }]);
  await newSearch;
  older.resolve([{ id: "old-result" }]);
  await oldSearch;

  assert.deepEqual(calls, ["old", "new"]);
  assertIds(page.data.searchResults, ["new-result"]);
  assert.equal(page.data.searchTotal, 1);
  assert.equal(page.data.searching, false);
});

test("home cloud search loads the first page only", async () => {
  const calls = [];
  const page = loadHomePageWithSearch(async (query, options) => {
    calls.push({ query, options });
    return Array.from({ length: 20 }, (_, index) => ({ id: `result-${index + 1}` }));
  });

  page.data.searchMode = true;
  page.searchRequestId = 1;
  await page.runCloudSearch("梵高", 1);

  assert.equal(calls.length, 1);
  assertJsonEqual(calls[0], { query: "梵高", options: { pageSize: 20, skip: 0 } });
  assert.equal(page.data.searchResults.length, 20);
  assert.equal(page.data.searchHasMore, true);
});

test("home search appends the next page on reach bottom without losing loaded results", async () => {
  const calls = [];
  const page = loadHomePageWithSearch(async (query, options) => {
    calls.push({ query, options });
    const offset = options && options.skip ? options.skip : 0;
    return Array.from({ length: 20 }, (_, index) => ({ id: `result-${offset + index + 1}` }));
  });

  page.data.searchQuery = "梵高";
  page.data.searchMode = true;
  page.searchRequestId = 1;
  await page.runCloudSearch("梵高", 1);
  await page.loadMoreSearchResults();

  assertJsonEqual(calls, [
    { query: "梵高", options: { pageSize: 20, skip: 0 } },
    { query: "梵高", options: { pageSize: 20, skip: 20 } },
  ]);
  assert.equal(page.data.searchResults.length, 40);
  assertIds(page.data.searchResults.slice(0, 2), ["result-1", "result-2"]);
  assertIds(page.data.searchResults.slice(20, 22), ["result-21", "result-22"]);
  assert.equal(page.data.searchLoadingMore, false);
});

test("home reach bottom loads more search results while in search mode", async () => {
  const calls = [];
  const page = loadHomePageWithSearch(async (query, options) => {
    calls.push({ query, options });
    const offset = options && options.skip ? options.skip : 0;
    return Array.from({ length: 20 }, (_, index) => ({ id: `result-${offset + index + 1}` }));
  });
  let randomLoadCalls = 0;
  page.loadMoreArtworks = () => {
    randomLoadCalls += 1;
  };

  page.data.searchQuery = "梵高";
  page.data.searchMode = true;
  page.searchRequestId = 1;
  await page.runCloudSearch("梵高", 1);
  const reachBottomResult = page.onReachBottom();
  if (reachBottomResult && typeof reachBottomResult.then === "function") {
    await reachBottomResult;
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  assert.equal(randomLoadCalls, 0);
  assertJsonEqual(calls, [
    { query: "梵高", options: { pageSize: 20, skip: 0 } },
    { query: "梵高", options: { pageSize: 20, skip: 20 } },
  ]);
  assert.equal(page.data.searchResults.length, 40);
});

test("home page config sets a reach-bottom distance for paged search loading", () => {
  const config = JSON.parse(readFileSync(new URL("./home.json", import.meta.url), "utf8"));

  assert.equal(typeof config.onReachBottomDistance, "number");
  assert.ok(config.onReachBottomDistance >= 120);
});

test("home section links preserve typed query metadata", () => {
  const template = readFileSync(new URL("./home.wxml", import.meta.url), "utf8");

  assert.match(template, /data-query-type="\{\{item\.queryType\}\}"/);
  assert.match(template, /data-query-id="\{\{item\.queryId\}\}"/);
  assert.match(template, /data-query-label="\{\{item\.queryLabel\}\}"/);
});

test("clearSearch restores the original home sections without reloading random artwork", () => {
  let loadCalls = 0;
  const page = loadHomePageWithSearch(async () => []);
  page.loadArtworks = () => {
    loadCalls += 1;
  };
  page.data.searchQuery = "Monet";
  page.data.searchMode = true;
  page.data.searchResults = [{ id: "1" }];
  page.data.searchTotal = 1;
  page.data.searching = true;
  page.data.searchError = "previous";

  page.clearSearch();

  assert.equal(page.data.searchQuery, "");
  assert.equal(page.data.searchMode, false);
  assert.equal(page.data.searchResults.length, 0);
  assert.equal(page.data.searchTotal, 0);
  assert.equal(page.data.searching, false);
  assert.equal(page.data.searchError, "");
  assert.equal(loadCalls, 0);
});

test("home hydrates a Leonardo row from a random artist-scoped batch", async () => {
  const calls = [];
  const remote = Array.from({ length: 8 }, (_, index) => ({
    id: `leonardo-${index + 1}`,
  }));
  const page = loadHomePageWithSearch(async () => [], {
    fetchRandomArtworksBySection: async (query, requestOptions) => {
      calls.push({ query, requestOptions });
      return {
        items: remote.slice(0, 7),
        total: 20,
        hasMore: true,
      };
    },
  });
  page.homeLoadToken = 1;
  page.data.artworks = [{ id: "sample" }];
  page.data.sections = [
    {
      key: "tag:leonardo",
      title: "列奥纳多·达·芬奇",
      items: [{ id: "sample" }],
      queryType: "artist",
      queryId: "leonardo-da-vinci",
      queryLabel: "列奥纳多·达·芬奇",
      hydrated: false,
      skip: 0,
      hasMore: true,
    },
  ];

  await page.hydrateSectionRow(0, 1);

  assertJsonEqual(calls, [
    {
      query: {
        type: "artist",
        id: "leonardo-da-vinci",
        label: "列奥纳多·达·芬奇",
      },
      requestOptions: { pageSize: 7, excludeIds: ["sample"] },
    },
  ]);
  assert.equal(page.data.sections[0].items.length, 8);
  assertIds(page.data.sections[0].items, ["sample", ...remote.slice(0, 7).map((item) => item.id)]);
  assert.equal(page.data.sections[0].skip, 8);
  assert.equal(page.data.sections[0].hasMore, true);
  assert.equal(page.data.sections[0].randomTotal, 20);
  assert.equal(page.data.sections[0].hydrated, true);
});

test("home tag rows request a fresh random batch and exclude visible artworks", async () => {
  const calls = [];
  const page = loadHomePageWithSearch(async () => [], {
    fetchRandomArtworksBySection: async (query, requestOptions) => {
      calls.push({ query, requestOptions });
      return {
        items: [
          { id: "oil-monet", artist_ids: ["claude-monet"] },
          { id: "oil-cezanne", artist_ids: ["paul-cezanne"] },
        ],
        total: 40,
        hasMore: true,
      };
    },
  });
  page.data.usingFallback = false;
  const section = {
    key: "tag:oil",
    tag: "油画",
    items: [{ id: "oil-van-gogh-1" }, { id: "oil-van-gogh-2" }],
    queryType: "classification",
    queryId: "medium-oil",
    queryLabel: "油画",
  };

  const result = await page.loadTagRowMore(section);

  assertJsonEqual(calls, [
    {
      query: {
        type: "classification",
        id: "medium-oil",
        label: "油画",
      },
      requestOptions: {
        pageSize: 8,
        excludeIds: ["oil-van-gogh-1", "oil-van-gogh-2"],
      },
    },
  ]);
  assertIds(result.items, ["oil-monet", "oil-cezanne"]);
  assert.equal(result.hasMore, true);
  assert.equal(result.total, 40);
});

test("one failed home section does not switch the entire home page to fallback", async () => {
  const page = loadHomePageWithSearch(async () => [], {
    fetchRandomArtworksBySection: async () => {
      throw new Error("section unavailable");
    },
  });
  page.homeLoadToken = 1;
  page.data.error = "";
  page.data.usingFallback = false;
  page.data.sections = [
    {
      key: "tag:broken",
      title: "测试栏目",
      items: [{ id: "sample" }],
      queryType: "tag",
      queryId: "",
      queryLabel: "测试栏目",
      hydrated: false,
    },
  ];

  await page.hydrateSectionRow(0, 1);

  assert.equal(page.data.error, "");
  assert.equal(page.data.usingFallback, false);
  assert.equal(page.data.sections[0].items.length, 1);
  assert.equal(page.data.sections[0].sectionError, "section unavailable");
});

test("searchArtworks tolerates mixed cloud field shapes", () => {
  const results = searchArtworks(
    [
      { id: "1", title: "Portrait", tags: { subject: "梵高" } },
      { id: "2", title: "Landscape", tag_keys: ["莫奈"] },
    ],
    "梵高",
  );

  assertIds(results, ["1"]);
});

test("searchArtworks matches da Vinci aliases with or without middle dot", () => {
  const results = searchArtworks(
    [
      { id: "1", title: "Study", artist: "列奥纳多·达·芬奇（Leonardo da Vinci, 1452-1519）" },
      { id: "2", title: "Portrait", artist: "伊达·西尔弗伯格" },
    ],
    "达芬奇",
  );

  assertIds(results, ["1"]);
});

test("searchArtworks matches Leonardo Chinese partial name", () => {
  const results = searchArtworks(
    [{ id: "1", title: "Study", tag_keys: ["列奥纳多·达·芬奇"] }],
    "列奥纳多",
  );

  assertIds(results, ["1"]);
});

test("searchArtworks searches all related database content instead of artist-only results", () => {
  const results = searchArtworks(
    [
      { id: "1", title: "圣母习作", artist: "列奥纳多·达·芬奇（Leonardo da Vinci, 1452-1519）" },
      { id: "2", title: "达芬奇手稿研究", artist: "其他画家" },
      {
        id: "3",
        title: "艺术史笔记",
        artist: "其他画家",
        description: "这件作品讨论列奥纳多对构图的影响。",
      },
      { id: "4", title: "莫奈花园", artist: "克洛德·莫奈" },
    ],
    "达芬奇",
  );

  assert.equal(
    JSON.stringify(
      Array.from(results)
        .map((item) => item.id)
        .sort(),
    ),
    JSON.stringify(["1", "2", "3"]),
  );
});

test("searchArtworks ranks title matches before artist and description matches", () => {
  const results = searchArtworks(
    [
      {
        id: "artist",
        title: "圣母习作",
        artist: "列奥纳多·达·芬奇（Leonardo da Vinci, 1452-1519）",
      },
      {
        id: "description",
        title: "艺术史笔记",
        artist: "其他画家",
        description: "简介内容提到了达·芬奇。",
      },
      { id: "title", title: "达芬奇构图研究", artist: "其他画家" },
    ],
    "达芬奇",
  );

  assertIds(results, ["title", "artist", "description"]);
});
