import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadSyncState(wxApi) {
  const module = { exports: {} };
  const source = readFileSync("miniapp/services/library-sync-state.js", "utf8");
  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      wx: wxApi,
      Date,
      Math,
    },
    {
      filename: "miniapp/services/library-sync-state.js",
    },
  );
  return module.exports;
}

function createWx() {
  const store = new Map();
  return {
    store,
    getStorageSync(key) {
      return store.get(key);
    },
    setStorageSync(key, value) {
      store.set(key, value);
    },
    removeStorageSync(key) {
      store.delete(key);
    },
  };
}

test("new and legacy devices default to automatic sync without losing queued records", () => {
  const wxApi = createWx();
  const syncState = loadSyncState(wxApi);

  assert.equal(syncState.readSyncState({ wxApi }).enabled, true);

  wxApi.setStorageSync(syncState.LIBRARY_SYNC_STATE_KEY, {
    version: 1,
    enabled: false,
    deviceId: "dev_legacy_device",
    seeded: true,
    pending: true,
    records: {
      favorites: {
        "art-legacy": {
          id: "art-legacy",
          updatedAt: 1000,
          deleted: true,
          snapshot: null,
        },
      },
      followedArtists: {},
      history: {},
    },
  });

  const migrated = syncState.readSyncState({ wxApi });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.enabled, true);
  assert.equal(migrated.pending, true);
  assert.equal(migrated.status, "pending");
  assert.equal(migrated.records.favorites["art-legacy"].deleted, true);
});

test("clearing local sync metadata removes both state and recovery snapshot", () => {
  const wxApi = createWx();
  const syncState = loadSyncState(wxApi);
  wxApi.setStorageSync(syncState.LIBRARY_SYNC_STATE_KEY, {
    version: syncState.LIBRARY_SYNC_VERSION,
  });
  wxApi.setStorageSync(syncState.LIBRARY_SYNC_SNAPSHOT_KEY, {
    version: syncState.LIBRARY_SYNC_VERSION,
  });

  assert.equal(syncState.clearLocalSyncState({ wxApi }), true);
  assert.equal(wxApi.store.has(syncState.LIBRARY_SYNC_STATE_KEY), false);
  assert.equal(wxApi.store.has(syncState.LIBRARY_SYNC_SNAPSHOT_KEY), false);
});

test("first sync state seeds existing local records and keeps a snapshot", () => {
  const wxApi = createWx();
  const syncState = loadSyncState(wxApi);
  syncState.seedLocalLibrary(
    {
      favorites: [{ _id: "art-1", titleCn: "睡莲", savedAt: "2026-07-20T00:00:00.000Z" }],
      followedArtists: [{ id: "artist-1", nameZh: "莫奈" }],
      history: [{ _id: "art-2", viewedAt: "2026-07-21T00:00:00.000Z" }],
    },
    {
      wxApi,
      now: 1000,
      random: () => 0.5,
    },
  );
  syncState.createInitialSnapshot(
    { favorites: ["art-1"] },
    {
      wxApi,
      now: 2000,
    },
  );

  const state = syncState.readSyncState({ wxApi });
  assert.equal(state.seeded, true);
  assert.equal(state.records.favorites["art-1"].deleted, false);
  assert.equal(state.records.followedArtists["artist-1"].snapshot.nameZh, "莫奈");
  assert.equal(state.records.history["art-2"].deviceViewCount, 1);
  assert.equal(state.snapshotCreatedAt, 2000);
  assert.equal(wxApi.store.get(syncState.LIBRARY_SYNC_SNAPSHOT_KEY).createdAt, 2000);
});

test("local deletions become tombstones and repeated history views increment locally", () => {
  const wxApi = createWx();
  const syncState = loadSyncState(wxApi);
  syncState.seedLocalLibrary(
    {
      favorites: [],
      followedArtists: [],
      history: [],
    },
    { wxApi, now: 1000, random: () => 0.2 },
  );

  syncState.recordLibraryMutation(
    "history",
    "art-1",
    {
      snapshot: { _id: "art-1" },
      viewedAt: 2000,
    },
    { wxApi, now: 2000 },
  );
  syncState.recordLibraryMutation(
    "history",
    "art-1",
    {
      snapshot: { _id: "art-1" },
      viewedAt: 3000,
    },
    { wxApi, now: 3000 },
  );
  syncState.recordLibraryMutation(
    "favorites",
    "art-2",
    {
      deleted: true,
    },
    { wxApi, now: 4000 },
  );

  const payload = syncState.createSyncPayload({ wxApi });
  assert.equal(payload.history[0].device_view_count, 2);
  assert.equal(payload.history[0].viewed_at_ms, 3000);
  assert.equal(payload.favorites[0].deleted, true);
});

test("successful server merge clears retry state and keeps current device count", () => {
  const wxApi = createWx();
  const syncState = loadSyncState(wxApi);
  syncState.seedLocalLibrary(
    {
      favorites: [],
      followedArtists: [],
      history: [],
    },
    { wxApi, now: 1000, random: () => 0.4 },
  );
  syncState.setLocalSyncEnabled(true, { wxApi });
  syncState.recordLibraryMutation(
    "history",
    "art-1",
    {
      viewedAt: 2000,
      snapshot: { _id: "art-1" },
    },
    { wxApi, now: 2000 },
  );

  syncState.markSyncSuccess(
    {
      synced_at_ms: 5000,
      favorites: [],
      followed_artists: [],
      history: [
        {
          id: "art-1",
          updated_at_ms: 2000,
          viewed_at_ms: 2000,
          view_count: 4,
          device_view_count: 1,
          deleted: false,
          snapshot: { _id: "art-1" },
        },
      ],
    },
    { wxApi },
  );

  const state = syncState.readSyncState({ wxApi });
  assert.equal(state.pending, false);
  assert.equal(state.status, "ready");
  assert.equal(state.lastSyncAt, 5000);
  assert.equal(state.records.history["art-1"].deviceViewCount, 1);
  assert.equal(state.records.history["art-1"].totalViewCount, 4);
});
