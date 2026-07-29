import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

function loadCommonJsModule(filePath, extraContext = {}) {
  const filename = filePath instanceof URL ? fileURLToPath(filePath) : filePath;
  const source = readFileSync(filename, "utf8");
  const module = { exports: {} };
  const fallback = {
    fallbackArtworks: [],
    fallbackById: () => null,
    normalizeArtwork: (item) => item,
  };
  const localRequire = (id) => {
    if (id === "../data/fallback-artworks") return fallback;
    if (id === "./search-engine")
      return loadCommonJsModule(new URL("./search-engine.js", import.meta.url));
    if (id === "./search-terms")
      return loadCommonJsModule(new URL("./search-terms.js", import.meta.url));
    return require(id);
  };
  vm.runInNewContext(
    source,
    { module, exports: module.exports, require: localRequire, ...extraContext },
    { filename },
  );
  return module.exports;
}

const { expandSearchQueries, normalizeSearchText } = loadCommonJsModule(
  new URL("./artworks.js", import.meta.url),
);

test("expandSearchQueries expands da Vinci queries for cloud search", () => {
  const queries = expandSearchQueries("达芬奇");

  assert.ok(queries.includes("列奥纳多·达·芬奇"));
  assert.ok(queries.includes("Leonardo da Vinci"));
  assert.ok(queries.includes("Da Vinci"));
});

test("normalizeSearchText removes punctuation that differs between user input and data", () => {
  assert.equal(normalizeSearchText("达·芬奇"), normalizeSearchText("达芬奇"));
});

test("expandSearchQueries keeps keyword search broad instead of artist-only", () => {
  const queries = expandSearchQueries("达芬奇");

  assert.ok(queries.includes("达芬奇"));
  assert.ok(queries.includes("达·芬奇"));
  assert.ok(queries.includes("列奥纳多·达·芬奇"));
});

function createFakeDatabase(rows, counters) {
  function matchesObject(row, clause) {
    return Object.entries(clause).every(([field, expected]) => {
      if (field === "status") return row.status === expected;
      if (expected && expected.__all) {
        const value = Array.isArray(row[field]) ? row[field] : [];
        return expected.__all.every((item) => value.includes(item));
      }
      if (expected && typeof expected.regexp === "string") {
        return new RegExp(expected.regexp, expected.options || "").test(String(row[field] || ""));
      }
      return row[field] === expected;
    });
  }

  function matchesWhere(row, clause) {
    if (!clause) return true;
    if (clause.__or) return clause.__or.some((item) => matchesObject(row, item));
    return matchesObject(row, clause);
  }

  function createCollectionQuery() {
    let whereClause = null;
    let skipCount = 0;
    let limitCount = 20;

    return {
      where(clause) {
        whereClause = clause;
        return this;
      },
      field() {
        return this;
      },
      orderBy() {
        return this;
      },
      skip(value) {
        skipCount = Number(value || 0);
        return this;
      },
      limit(value) {
        limitCount = Number(value || 20);
        return this;
      },
      async get() {
        counters.get += 1;
        const matched = rows.filter((row) => matchesWhere(row, whereClause));
        return { data: matched.slice(skipCount, skipCount + limitCount) };
      },
      async count() {
        counters.count += 1;
        const matched = rows.filter((row) => matchesWhere(row, whereClause));
        return { total: matched.length };
      },
    };
  }

  return {
    command: {
      or(clauses) {
        return { __or: clauses };
      },
      all(values) {
        return { __all: values };
      },
    },
    RegExp(options) {
      counters.regexp = Number(counters.regexp || 0) + 1;
      return options;
    },
    collection() {
      return createCollectionQuery();
    },
  };
}

test("searchArtworks queries indexed terms instead of loading the full corpus or using regexp", async () => {
  const counters = { get: 0, count: 0, regexp: 0 };
  const fakeDb = createFakeDatabase(
    [
      {
        _id: "title",
        status: "published",
        title_cn: "梵高研究",
        artist: "其他画家",
        search_terms: ["梵高"],
      },
      {
        _id: "artist",
        status: "published",
        title_cn: "星夜",
        artist: "文森特·梵高",
        search_terms: ["梵高"],
      },
      {
        _id: "description",
        status: "published",
        title_cn: "艺术笔记",
        artist: "其他画家",
        description: "简介内容提到梵高。",
        search_terms: ["梵高"],
      },
      {
        _id: "other",
        status: "published",
        title_cn: "睡莲",
        artist: "克洛德·莫奈",
        search_terms: ["莫奈"],
      },
    ],
    counters,
  );
  const { searchArtworks } = loadCommonJsModule(new URL("./artworks.js", import.meta.url), {
    wx: { cloud: { database: () => fakeDb } },
  });

  const results = await searchArtworks("梵高", { pageSize: 20 });

  assert.equal(
    JSON.stringify(results.map((item) => item._id)),
    JSON.stringify(["title", "artist", "description"]),
  );
  assert.ok(counters.get > 0);
  assert.equal(counters.count, 0);
  assert.equal(counters.regexp, 0);
});

test("fetchArtworksByArtistAliases supports deduped pagination across aliases", async () => {
  const counters = { get: 0, count: 0 };
  const fakeDb = createFakeDatabase(
    [
      { _id: "a", status: "published", artist: "Vincent van Gogh" },
      { _id: "b", status: "published", artist: "Vincent van Gogh" },
      { _id: "c", status: "published", artist: "Van Gogh" },
      { _id: "d", status: "published", artist: "Van Gogh" },
    ],
    counters,
  );
  const { fetchArtworksByArtistAliases } = loadCommonJsModule(
    new URL("./artworks.js", import.meta.url),
    {
      wx: { cloud: { database: () => fakeDb } },
    },
  );

  const firstPage = await fetchArtworksByArtistAliases(["Vincent van Gogh", "Van Gogh"], {
    pageSize: 2,
    skip: 0,
  });
  const secondPage = await fetchArtworksByArtistAliases(["Vincent van Gogh", "Van Gogh"], {
    pageSize: 2,
    skip: 2,
  });

  assert.equal(JSON.stringify(firstPage.map((item) => item._id)), JSON.stringify(["a", "b"]));
  assert.equal(JSON.stringify(secondPage.map((item) => item._id)), JSON.stringify(["c", "d"]));
});

test("fetchArtworksByArtist prefers tag_keys for stable artist matching", async () => {
  const counters = { get: 0, count: 0 };
  const fakeDb = createFakeDatabase(
    [
      { _id: "a", status: "published", artist: "Claude Monet", tag_keys: ["克洛德·莫奈"] },
      { _id: "b", status: "published", artist: "Other", tag_keys: ["克洛德·莫奈"] },
      { _id: "c", status: "published", artist: "Other", tag_keys: ["其他画家"] },
    ],
    counters,
  );
  const { fetchArtworksByArtist, countArtworksByArtist } = loadCommonJsModule(
    new URL("./artworks.js", import.meta.url),
    {
      wx: { cloud: { database: () => fakeDb } },
    },
  );
  const artist = {
    nameZh: "克洛德·莫奈",
    aliases: ["Claude Monet", "Monet", "莫奈"],
  };

  const firstPage = await fetchArtworksByArtist(artist, { pageSize: 8, skip: 0 });
  const total = await countArtworksByArtist(artist);

  assert.equal(JSON.stringify(firstPage.map((item) => item._id)), JSON.stringify(["a", "b"]));
  assert.equal(total, 2);
});

test("fetchArtworksByArtist combines tag keys and artist aliases", async () => {
  const counters = { get: 0, count: 0 };
  const fakeDb = createFakeDatabase(
    [
      { _id: "tag", status: "published", artist: "Other", tag_keys: ["Claude Monet"] },
      { _id: "name", status: "published", artist: "Claude Monet", tag_keys: ["Other"] },
      { _id: "alias", status: "published", artist: "Monet", tag_keys: ["Other"] },
      { _id: "other", status: "published", artist: "Other", tag_keys: ["Other"] },
    ],
    counters,
  );
  const { fetchArtworksByArtist, countArtworksByArtist } = loadCommonJsModule(
    new URL("./artworks.js", import.meta.url),
    {
      wx: { cloud: { database: () => fakeDb } },
    },
  );
  const artist = {
    nameZh: "Claude Monet",
    aliases: ["Monet"],
  };

  const firstPage = await fetchArtworksByArtist(artist, { pageSize: 8, skip: 0 });
  const total = await countArtworksByArtist(artist);

  assert.equal(
    JSON.stringify(firstPage.map((item) => item._id)),
    JSON.stringify(["tag", "name", "alias"]),
  );
  assert.equal(total, 3);
});

test("typed home sections query artist_ids and classification_ids directly", async () => {
  const counters = { get: 0, count: 0 };
  const fakeDb = createFakeDatabase(
    [
      {
        _id: "leonardo",
        status: "published",
        artist_ids: ["leonardo-da-vinci"],
        classification_ids: ["style-renaissance"],
      },
      {
        _id: "munch",
        status: "published",
        artist_ids: ["edvard-munch"],
        classification_ids: ["style-expressionism"],
      },
    ],
    counters,
  );
  const { fetchArtworksBySection, countArtworksBySection } = loadCommonJsModule(
    new URL("./artworks.js", import.meta.url),
    {
      wx: { cloud: { database: () => fakeDb } },
    },
  );

  const artistRows = await fetchArtworksBySection(
    {
      type: "artist",
      id: "leonardo-da-vinci",
      label: "列奥纳多·达·芬奇",
    },
    { pageSize: 8, skip: 0 },
  );
  const expressionismCount = await countArtworksBySection({
    type: "classification",
    id: "style-expressionism",
    label: "表现主义",
  });

  assert.equal(JSON.stringify(artistRows.map((item) => item._id)), JSON.stringify(["leonardo"]));
  assert.equal(expressionismCount, 1);
});
