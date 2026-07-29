import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadService({ enabled = true, fail = null } = {}) {
  const calls = [];
  const state = {
    enabled,
    status: enabled ? "pending" : "disabled",
    pending: enabled,
  };
  const module = { exports: {} };
  const source = readFileSync("miniapp/services/user-library-sync.js", "utf8");

  vm.runInNewContext(
    source,
    {
      module,
      exports: module.exports,
      require(id) {
        if (id === "./account") {
          return {
            ACCOUNT_REQUEST_TIMEOUT_MS: 6000,
            clearCachedAchievementState() {
              calls.push({ type: "achievement-cache-clear" });
            },
            callAccountFunction: async (_wxApi, data) => {
              calls.push({ type: "cloud", data });
              if (fail) throw fail;
              return {
                result: {
                  ok: true,
                  data:
                    data.action === "syncLibrary"
                      ? {
                          profile: { id: "usr_123", sync_enabled: true },
                          library: {
                            synced_at_ms: 5000,
                            favorites: [
                              {
                                id: "art-1",
                                updated_at_ms: 1000,
                                deleted: false,
                                snapshot: { _id: "art-1" },
                              },
                            ],
                            followed_artists: [],
                            history: [],
                          },
                          achievements: {
                            newly_unlocked: ["first_masterpiece"],
                          },
                        }
                      : {
                          profile: {
                            id: "usr_123",
                            sync_enabled: data.enabled === true,
                          },
                        },
                },
              };
            },
            parseCloudPayload: (response) => response.result.data,
            sanitizeCachedProfile: (profile) => profile,
            withTimeout: (promise) => promise,
            writeCachedProfile() {},
          };
        }
        if (id === "./local-library") {
          return {
            applySyncedLibrary(library) {
              calls.push({ type: "apply", library });
            },
            getDownloadArtworks: () => [],
            getFavoriteArtworks: () => [{ _id: "art-1" }],
            getFollowedArtists: () => [],
            getHistoryArtworks: () => [],
            getLibraryStats: () => ({
              favorites: 1,
              followedArtists: 0,
              history: 0,
              downloads: 2,
            }),
          };
        }
        if (id === "./library-sync-state") {
          return {
            createInitialSnapshot() {
              calls.push({ type: "snapshot" });
            },
            createSyncPayload: () => ({
              device_id: "dev_device_a123",
              favorites: [
                {
                  id: "art-1",
                  updated_at_ms: 1000,
                  deleted: false,
                },
              ],
              followed_artists: [],
              history: [],
            }),
            getSyncSummary: () => ({ ...state }),
            markSyncAttempt() {
              state.status = "syncing";
              calls.push({ type: "attempt" });
            },
            markSyncFailure(error) {
              state.status = "error";
              state.pending = true;
              calls.push({ type: "failure", error });
            },
            markSyncSuccess() {
              state.status = "ready";
              state.pending = false;
              calls.push({ type: "success" });
            },
            readSyncState: () => ({ ...state }),
            seedLocalLibrary() {
              calls.push({ type: "seed" });
            },
            setLocalSyncEnabled(value) {
              state.enabled = value;
              state.status = value ? "pending" : "disabled";
              calls.push({ type: "local-enabled", value });
            },
          };
        }
        throw new Error(`Unexpected module: ${id}`);
      },
      wx: {},
      setTimeout,
      clearTimeout,
      Date,
      Number,
      Promise,
      console,
    },
    {
      filename: "miniapp/services/user-library-sync.js",
    },
  );

  return {
    service: module.exports,
    calls,
    state,
  };
}

test("manual sync uploads local records, applies the merged result, and clears pending state", async () => {
  const { service, calls, state } = loadService();
  await service.syncLibraryNow();

  const request = calls.find((call) => call.type === "cloud" && call.data.action === "syncLibrary");
  assert.equal(request.data.device_id, "dev_device_a123");
  assert.equal(request.data.download_summary.count, 2);
  assert.equal(
    calls.some((call) => call.type === "apply"),
    true,
  );
  assert.equal(
    calls.some((call) => call.type === "achievement-cache-clear"),
    true,
  );
  assert.equal(state.status, "ready");
  assert.equal(state.pending, false);
});

test("offline failure keeps local data and records a retry state", async () => {
  const error = Object.assign(new Error("network unavailable"), {
    code: "NETWORK_FAIL",
  });
  const { service, calls, state } = loadService({ fail: error });

  await assert.rejects(() => service.syncLibraryNow(), /network unavailable/);
  assert.equal(
    calls.some((call) => call.type === "apply"),
    false,
  );
  assert.equal(
    calls.some((call) => call.type === "failure"),
    true,
  );
  assert.equal(state.status, "error");
  assert.equal(state.pending, true);
});

test("enabling sync creates the first local snapshot before uploading", async () => {
  const { service, calls } = loadService({ enabled: false });
  await service.setLibrarySyncEnabled(true);

  const snapshotIndex = calls.findIndex((call) => call.type === "snapshot");
  const enableIndex = calls.findIndex(
    (call) => call.type === "cloud" && call.data.action === "setSyncEnabled",
  );
  const syncIndex = calls.findIndex(
    (call) => call.type === "cloud" && call.data.action === "syncLibrary",
  );
  assert.ok(snapshotIndex >= 0);
  assert.ok(enableIndex > snapshotIndex);
  assert.ok(syncIndex > enableIndex);
});

test("large personal libraries are split into repeatable cloud batches", () => {
  const { service } = loadService();
  const batches = service.createSyncBatches(
    {
      device_id: "dev_device_a123",
      favorites: Array.from({ length: 1001 }, (_, index) => ({
        id: `art-${index}`,
      })),
      followed_artists: [],
      history: [],
    },
    500,
  );

  assert.equal(batches.length, 3);
  assert.equal(batches[0].favorites.length, 500);
  assert.equal(batches[1].favorites.length, 500);
  assert.equal(batches[2].favorites.length, 1);
});
