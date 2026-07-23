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
    if (id === "./search-engine") return loadCommonJsModule(new URL("./search-engine.js", import.meta.url));
    return require(id);
  };

  vm.runInNewContext(source, { module, exports: module.exports, require: localRequire, ...extraContext }, { filename });
  return module.exports;
}

function createFakeDatabase(rows, counters) {
  function matchesObject(row, clause) {
    return Object.entries(clause).every(([field, expected]) => {
      if (field === "status") return row.status === expected;
      if (expected && expected.__all) {
        const value = Array.isArray(row[field]) ? row[field] : [];
        return expected.__all.every((item) => value.includes(item));
      }
      if (expected && expected.__existsArray) {
        return Array.isArray(row[field]) && row[field].length > 0;
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

  function createCollectionQuery(collectionName) {
    let whereClause = null;
    let skipCount = 0;
    let limitCount = 20;

    return {
      where(clause) {
        whereClause = clause;
        counters.where.push({ collectionName, clause });
        return this;
      },
      field() {
        return this;
      },
      orderBy(field, direction) {
        counters.orderBy.push({ collectionName, field, direction });
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
      exists(value) {
        return { __existsArray: value };
      },
    },
    RegExp(options) {
      return options;
    },
    collection(name) {
      return createCollectionQuery(name);
    },
  };
}

function loadArtworksService(rows) {
  const counters = { get: 0, count: 0, where: [], orderBy: [] };
  const fakeDb = createFakeDatabase(rows, counters);
  const service = loadCommonJsModule(new URL("./artworks.js", import.meta.url), {
    wx: { cloud: { database: () => fakeDb } },
  });
  return { service, counters };
}

test("fetchArtworksByArtistId and countArtworksByArtistId query normalized artist_ids", async () => {
  const { service, counters } = loadArtworksService([
    { _id: "a", status: "published", artist_ids: ["claude-monet"], artist: "Other" },
    { _id: "b", status: "published", artist_ids: ["claude-monet"], artist: "Other" },
    { _id: "c", status: "published", artist_ids: ["other"], artist: "Claude Monet" },
  ]);

  const page = await service.fetchArtworksByArtistId("claude-monet", { pageSize: 1, skip: 1 });
  const total = await service.countArtworksByArtistId("claude-monet");

  assert.deepEqual(page.map((item) => item._id), ["b"]);
  assert.equal(total, 2);
  assert.ok(counters.where.some((entry) => entry.clause.artist_ids?.__all?.includes("claude-monet")));
});

test("fetchArtworksByArtist falls back to aliases when normalized artist_ids are not backfilled", async () => {
  const { service } = loadArtworksService([
    { _id: "a", status: "published", artist: "Claude Monet" },
    { _id: "b", status: "published", artist: "Monet" },
    { _id: "c", status: "published", artist: "Other" },
  ]);

  const artist = { id: "claude-monet", nameZh: "克洛德·莫奈", nameEn: "Claude Monet", aliases: ["Monet"] };
  const page = await service.fetchArtworksByArtist(artist, { pageSize: 8, skip: 0 });
  const total = await service.countArtworksByArtist(artist);

  assert.deepEqual(page.map((item) => item._id), ["a", "b"]);
  assert.equal(total, 2);
});

test("fetchArtworksByTagId and countArtworksByTagId query normalized tag_ids", async () => {
  const { service, counters } = loadArtworksService([
    { _id: "a", status: "published", tag_ids: ["style-impressionism"], tag_keys: ["Other"] },
    { _id: "b", status: "published", tag_ids: ["style-impressionism"], tag_keys: ["Other"] },
    { _id: "c", status: "published", tag_ids: ["other"], tag_keys: ["印象派"] },
  ]);

  const page = await service.fetchArtworksByTagId("style-impressionism", { pageSize: 1, skip: 0 });
  const total = await service.countArtworksByTagId("style-impressionism");

  assert.deepEqual(page.map((item) => item._id), ["a"]);
  assert.equal(total, 2);
  assert.ok(counters.where.some((entry) => entry.clause.tag_ids?.__all?.includes("style-impressionism")));
});

test("fetchArtworksByTag accepts tag objects and falls back to tag label when tag_ids are not backfilled", async () => {
  const { service } = loadArtworksService([
    { _id: "a", status: "published", tag_keys: ["印象派"] },
    { _id: "b", status: "published", tag_keys: ["印象派"] },
    { _id: "c", status: "published", tag_keys: ["Other"] },
  ]);

  const tag = { id: "style-impressionism", label: "印象派" };
  const page = await service.fetchArtworksByTag(tag, { pageSize: 20, skip: 0 });
  const total = await service.countArtworksByTag(tag);

  assert.deepEqual(page.map((item) => item._id), ["a", "b"]);
  assert.equal(total, 2);
});

test("getSelectedClassificationIds trims values in group order and removes duplicates", () => {
  const { service } = loadArtworksService([]);

  assert.deepEqual(
    JSON.parse(JSON.stringify(service.getSelectedClassificationIds({
      style: " style-a ",
      subject: "style-a",
      decade: " period-1900s ",
      ignored: "subject-b",
    }))),
    ["style-a", "period-1900s"],
  );
});

test("category filters require all selected classification ids for fetch and count", async () => {
  const { service, counters } = loadArtworksService([
    {
      _id: "a",
      status: "published",
      created_at: "2026-02-01",
      classification_ids: ["style-a", "subject-a", "period-1900s"],
    },
    {
      _id: "b",
      status: "published",
      created_at: "2026-03-01",
      classification_ids: ["style-a", "subject-a"],
    },
    {
      _id: "c",
      status: "draft",
      created_at: "2026-04-01",
      classification_ids: ["style-a", "subject-a", "period-1900s"],
    },
  ]);
  const filters = { style: "style-a", subject: "subject-a", decade: "period-1900s" };

  const page = await service.fetchArtworksByCategoryFilters(filters, { pageSize: 20, skip: 0 });
  const total = await service.countArtworksByCategoryFilters(filters);

  assert.deepEqual(page.map((item) => item._id), ["a"]);
  assert.equal(total, 1);
  assert.equal(counters.where.length, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(counters.where[0].clause)),
    JSON.parse(JSON.stringify(counters.where[1].clause)),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(
    counters.where[0].clause.classification_ids.__all,
  )), [
    "style-a",
    "subject-a",
    "period-1900s",
  ]);
  assert.deepEqual(counters.orderBy.slice(-2), [
    { collectionName: "artworks", field: "created_at", direction: "desc" },
    { collectionName: "artworks", field: "_id", direction: "desc" },
  ]);
});

test("empty category filters query all published artworks with the same fetch and count clause", async () => {
  const { service, counters } = loadArtworksService([
    { _id: "a", status: "published", created_at: "2026-01-01" },
    { _id: "b", status: "draft", created_at: "2026-02-01" },
  ]);

  const page = await service.fetchArtworksByCategoryFilters({}, { pageSize: 20, skip: 0 });
  const total = await service.countArtworksByCategoryFilters({});

  assert.deepEqual(page.map((item) => item._id), ["a"]);
  assert.equal(total, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(
    counters.where.map((entry) => entry.clause),
  )), [
    { status: "published" },
    { status: "published" },
  ]);
});
