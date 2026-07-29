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

test("fetchRandomArtworks limits concurrent reads and keeps successful batches", async () => {
  let activeReads = 0;
  let maxActiveReads = 0;
  let batchIndex = 0;

  const fakeDb = {
    collection() {
      return {
        where() {
          return this;
        },
        orderBy() {
          return this;
        },
        skip() {
          return this;
        },
        limit() {
          return this;
        },
        async count() {
          return { total: 60 };
        },
        async get() {
          const currentBatch = batchIndex;
          batchIndex += 1;
          activeReads += 1;
          maxActiveReads = Math.max(maxActiveReads, activeReads);
          await Promise.resolve();
          activeReads -= 1;

          if (currentBatch === 1) throw new Error("timeout");
          return {
            data: Array.from({ length: 20 }, (_, index) => ({
              _id: `batch-${currentBatch}-${index}`,
              status: "published",
            })),
          };
        },
      };
    },
  };

  const service = loadCommonJsModule(new URL("./artworks.js", import.meta.url), {
    wx: { cloud: { database: () => fakeDb } },
  });
  const artworks = await service.fetchRandomArtworks({
    pageSize: 60,
    batchSize: 20,
    concurrency: 2,
  });

  assert.equal(maxActiveReads, 2);
  assert.equal(artworks.length, 40);
});

test("fetchRecommendationChannels reads only published auto-feature channels", async () => {
  const { service, counters } = loadArtworksService([
    {
      _id: "published",
      channel_status: "published",
      auto_feature_eligible: true,
      priority_score: 10,
    },
    {
      _id: "long-tail",
      channel_status: "long_tail",
      auto_feature_eligible: false,
      priority_score: 20,
    },
  ]);

  const channels = await service.fetchRecommendationChannels({ limit: 8 });
  assert.equal(
    JSON.stringify(Array.from(channels, (channel) => channel._id)),
    JSON.stringify(["published"]),
  );
  assert.ok(counters.where.some((entry) => entry.collectionName === "recommendation_channels"));
});

test("fetchRecommendationChannels pages past the mini program per-read limit", async () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    _id: `channel-${index + 1}`,
    channel_status: "published",
    auto_feature_eligible: true,
    priority_score: 100 - index,
  }));
  const { service, counters } = loadArtworksService(rows);

  const channels = await service.fetchRecommendationChannels({ limit: 30 });

  assert.equal(channels.length, 25);
  assert.equal(counters.get, 2);
});

test("fetchRandomArtworks prefers the normalized recommendation pool", async () => {
  const { service, counters } = loadArtworksService([
    {
      _id: "eligible",
      status: "published",
      recommendation_status: "eligible",
      random_bucket: 12,
    },
    {
      _id: "legacy-only",
      status: "published",
      random_bucket: 13,
    },
  ]);

  const artworks = await service.fetchRandomArtworks({
    pageSize: 1,
    batchSize: 1,
    concurrency: 1,
  });

  assert.equal(
    JSON.stringify(Array.from(artworks, (artwork) => artwork._id)),
    JSON.stringify(["eligible"]),
  );
  assert.ok(
    counters.where.some(
      (entry) =>
        entry.collectionName === "artworks" &&
        entry.clause.status === "published" &&
        entry.clause.recommendation_status === "eligible",
    ),
  );
  assert.ok(
    counters.orderBy.some(
      (entry) =>
        entry.collectionName === "artworks" &&
        entry.field === "random_bucket" &&
        entry.direction === "asc",
    ),
  );
});

test("fetchRandomArtworksBySection stays inside the tag, skips seen works, and rotates artists", async () => {
  const oilRows = [
    ...Array.from({ length: 6 }, (_, index) => ({
      _id: `van-gogh-${index}`,
      status: "published",
      tag_keys: ["油画"],
      artist_ids: ["vincent-van-gogh"],
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      _id: `monet-${index}`,
      status: "published",
      tag_keys: ["油画"],
      artist_ids: ["claude-monet"],
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      _id: `cezanne-${index}`,
      status: "published",
      tag_keys: ["油画"],
      artist_ids: ["paul-cezanne"],
    })),
    {
      _id: "watercolor",
      status: "published",
      tag_keys: ["水彩"],
      artist_ids: ["other"],
    },
  ];
  const { service, counters } = loadArtworksService(oilRows);

  const firstBatch = await service.fetchRandomArtworksBySection(
    { type: "tag", label: "油画" },
    {
      pageSize: 6,
      excludeIds: ["van-gogh-0"],
      random: () => 0.999,
    },
  );

  assert.equal(firstBatch.total, 18);
  assert.equal(firstBatch.items.length, 6);
  assert.equal(firstBatch.hasMore, true);
  assert.equal(
    firstBatch.items.every((item) => item.tag_keys.includes("油画")),
    true,
  );
  assert.equal(
    firstBatch.items.some((item) => item._id === "van-gogh-0"),
    false,
  );
  assert.equal(new Set(firstBatch.items.slice(0, 3).map((item) => item.artist_ids[0])).size, 3);

  const allButTwo = oilRows
    .filter((item) => item.tag_keys.includes("油画"))
    .slice(0, 16)
    .map((item) => item._id);
  const finalBatch = await service.fetchRandomArtworksBySection(
    { type: "tag", label: "油画" },
    {
      pageSize: 8,
      excludeIds: allButTwo,
      random: () => 0.999,
    },
  );

  assert.equal(
    JSON.stringify(Array.from(finalBatch.items, (item) => item._id).sort()),
    JSON.stringify(["cezanne-4", "cezanne-5"]),
  );
  assert.equal(finalBatch.hasMore, false);
  assert.equal(counters.count, 1);
});

test("random artist sections use the deployed artist and random-bucket index order", async () => {
  const { service, counters } = loadArtworksService([
    {
      _id: "monet-1",
      status: "published",
      artist_ids: ["claude-monet"],
      random_bucket: 12,
    },
    {
      _id: "monet-2",
      status: "published",
      artist_ids: ["claude-monet"],
      random_bucket: 48,
    },
  ]);

  const result = await service.fetchRandomArtworksBySection(
    { type: "artist", id: "claude-monet", label: "克劳德·莫奈" },
    { pageSize: 1, random: () => 0.5 },
  );

  assert.equal(result.items.length, 1);
  assert.ok(
    counters.orderBy.some(
      (entry) =>
        entry.collectionName === "artworks" &&
        entry.field === "random_bucket" &&
        entry.direction === "asc",
    ),
  );
  assert.ok(
    counters.orderBy.some(
      (entry) =>
        entry.collectionName === "artworks" && entry.field === "_id" && entry.direction === "asc",
    ),
  );
});

test("fetchArtworksByArtistId and countArtworksByArtistId query normalized artist_ids", async () => {
  const { service, counters } = loadArtworksService([
    { _id: "a", status: "published", artist_ids: ["claude-monet"], artist: "Other" },
    { _id: "b", status: "published", artist_ids: ["claude-monet"], artist: "Other" },
    { _id: "c", status: "published", artist_ids: ["other"], artist: "Claude Monet" },
  ]);

  const page = await service.fetchArtworksByArtistId("claude-monet", { pageSize: 1, skip: 1 });
  const total = await service.countArtworksByArtistId("claude-monet");

  assert.deepEqual(
    page.map((item) => item._id),
    ["b"],
  );
  assert.equal(total, 2);
  assert.ok(
    counters.where.some((entry) => entry.clause.artist_ids?.__all?.includes("claude-monet")),
  );
});

test("fetchArtworksByArtist falls back to aliases when normalized artist_ids are not backfilled", async () => {
  const { service } = loadArtworksService([
    { _id: "a", status: "published", artist: "Claude Monet" },
    { _id: "b", status: "published", artist: "Monet" },
    { _id: "c", status: "published", artist: "Other" },
  ]);

  const artist = {
    id: "claude-monet",
    nameZh: "克洛德·莫奈",
    nameEn: "Claude Monet",
    aliases: ["Monet"],
  };
  const page = await service.fetchArtworksByArtist(artist, { pageSize: 8, skip: 0 });
  const total = await service.countArtworksByArtist(artist);

  assert.deepEqual(
    page.map((item) => item._id),
    ["a", "b"],
  );
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

  assert.deepEqual(
    page.map((item) => item._id),
    ["a"],
  );
  assert.equal(total, 2);
  assert.ok(
    counters.where.some((entry) => entry.clause.tag_ids?.__all?.includes("style-impressionism")),
  );
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

  assert.deepEqual(
    page.map((item) => item._id),
    ["a", "b"],
  );
  assert.equal(total, 2);
});

test("recommendation signal sections prefer normalized ids and fall back to legacy labels", async () => {
  const normalized = loadArtworksService([
    {
      _id: "normalized",
      status: "published",
      recommendation_signal_ids: ["signal-setting-nature"],
      tag_keys: ["Other"],
    },
    {
      _id: "legacy-only",
      status: "published",
      tag_keys: ["自然"],
    },
  ]).service;

  const normalizedPage = await normalized.fetchArtworksBySection(
    { type: "signal", id: "signal-setting-nature", label: "自然" },
    { pageSize: 20 },
  );
  assert.deepEqual(
    normalizedPage.map((item) => item._id),
    ["normalized"],
  );

  const legacy = loadArtworksService([
    { _id: "legacy-only", status: "published", tag_keys: ["自然"] },
  ]).service;
  const legacyPage = await legacy.fetchArtworksBySection(
    { type: "signal", id: "signal-setting-nature", label: "自然" },
    { pageSize: 20 },
  );
  assert.deepEqual(
    legacyPage.map((item) => item._id),
    ["legacy-only"],
  );
  assert.equal(
    await legacy.countArtworksBySection({
      type: "signal",
      id: "signal-setting-nature",
      label: "自然",
    }),
    1,
  );
});

test("getSelectedClassificationIds trims values in group order and removes duplicates", () => {
  const { service } = loadArtworksService([]);

  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        service.getSelectedClassificationIds({
          style: " style-a ",
          subject: "style-a",
          decade: " period-1900s ",
          ignored: "subject-b",
        }),
      ),
    ),
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

  assert.deepEqual(
    page.map((item) => item._id),
    ["a"],
  );
  assert.equal(total, 1);
  assert.equal(counters.where.length, 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(counters.where[0].clause)),
    JSON.parse(JSON.stringify(counters.where[1].clause)),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(counters.where[0].clause.classification_ids.__all)), [
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

  assert.deepEqual(
    page.map((item) => item._id),
    ["a"],
  );
  assert.equal(total, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(counters.where.map((entry) => entry.clause))), [
    { status: "published" },
    { status: "published" },
  ]);
});
