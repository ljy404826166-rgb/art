const {
  ACCOUNT_REQUEST_TIMEOUT_MS,
  callAccountFunction,
  clearCachedAchievementState,
  parseCloudPayload,
  sanitizeCachedProfile,
  withTimeout,
  writeCachedProfile,
} = require("./account");
const {
  applySyncedLibrary,
  getDownloadArtworks,
  getFavoriteArtworks,
  getFollowedArtists,
  getHistoryArtworks,
  getLibraryStats,
} = require("./local-library");
const {
  createInitialSnapshot,
  createSyncPayload,
  getSyncSummary,
  markSyncAttempt,
  markSyncFailure,
  markSyncSuccess,
  readSyncState,
  seedLocalLibrary,
  setLocalSyncEnabled,
} = require("./library-sync-state");

const LIBRARY_SYNC_TIMEOUT_MS = Math.max(15000, ACCOUNT_REQUEST_TIMEOUT_MS);
const LIBRARY_SYNC_RETRY_DELAY_MS = 1200;
const LIBRARY_SYNC_BATCH_SIZE = 500;

let activeSyncRequest = null;
let scheduledSyncTimer = null;
let sessionSyncSuspended = false;
let syncGeneration = 0;

function getWxApi(options) {
  if (options && options.wxApi) return options.wxApi;
  return typeof wx !== "undefined" ? wx : null;
}

function currentLibrary() {
  return {
    favorites: getFavoriteArtworks(),
    followedArtists: getFollowedArtists(),
    history: getHistoryArtworks(),
    downloads: getDownloadArtworks(),
  };
}

function prepareLocalSync(options = {}) {
  const library = currentLibrary();
  seedLocalLibrary(library, options);
  return library;
}

function cacheProfileFromData(wxApi, data, now) {
  const profile = sanitizeCachedProfile(data && data.profile);
  if (profile) writeCachedProfile(wxApi, profile, now);
  return profile;
}

function cloudRequest(wxApi, data, timeoutMs) {
  return withTimeout(callAccountFunction(wxApi, data), timeoutMs || LIBRARY_SYNC_TIMEOUT_MS).then(
    parseCloudPayload,
  );
}

async function setLibrarySyncEnabled(enabled, options = {}) {
  const wxApi = getWxApi(options);
  const now = typeof options.now === "number" ? options.now : Date.now();
  const library = prepareLocalSync({ ...options, wxApi });

  if (enabled) {
    createInitialSnapshot(library, { ...options, wxApi, now });
  }
  setLocalSyncEnabled(enabled, { ...options, wxApi });

  try {
    const data = await cloudRequest(
      wxApi,
      {
        action: "setSyncEnabled",
        enabled: enabled === true,
      },
      options.timeoutMs,
    );
    cacheProfileFromData(wxApi, data, now);
    if (!enabled) return getSyncSummary({ wxApi });
    return syncLibraryNow({ ...options, wxApi, force: true });
  } catch (error) {
    markSyncFailure(error, { ...options, wxApi });
    throw error;
  }
}

function validateLibraryResponse(data) {
  const library = data && data.library;
  if (
    !library ||
    !Array.isArray(library.favorites) ||
    !Array.isArray(library.followed_artists) ||
    !Array.isArray(library.history)
  ) {
    const error = new Error("云端同步结果格式异常");
    error.code = "LIBRARY_SYNC_RESPONSE_INVALID";
    throw error;
  }
  return library;
}

function createSyncBatches(payload, batchSize = LIBRARY_SYNC_BATCH_SIZE) {
  const size = Math.max(1, Math.floor(Number(batchSize) || 1));
  const resourceNames = ["favorites", "followed_artists", "history"];
  const totalBatches = Math.max(
    1,
    ...resourceNames.map((resource) =>
      Math.ceil(
        (Array.isArray(payload && payload[resource]) ? payload[resource].length : 0) / size,
      ),
    ),
  );
  return Array.from({ length: totalBatches }, (_, index) => ({
    device_id: payload.device_id,
    favorites: (payload.favorites || []).slice(index * size, (index + 1) * size),
    followed_artists: (payload.followed_artists || []).slice(index * size, (index + 1) * size),
    history: (payload.history || []).slice(index * size, (index + 1) * size),
  }));
}

function syncLibraryNow(options = {}) {
  if (sessionSyncSuspended) {
    return Promise.resolve(
      getSyncSummary({
        wxApi: getWxApi(options),
      }),
    );
  }
  if (activeSyncRequest) return activeSyncRequest;
  const wxApi = getWxApi(options);
  const state = readSyncState({ wxApi });
  if (!state.enabled && options.force !== true) {
    return Promise.resolve(getSyncSummary({ wxApi }));
  }
  if (!state.enabled) {
    const error = new Error("请先开启个人数据同步");
    error.code = "LIBRARY_SYNC_DISABLED";
    return Promise.reject(error);
  }

  prepareLocalSync({ ...options, wxApi });
  markSyncAttempt({ ...options, wxApi });
  const payload = createSyncPayload({ wxApi });
  const batches = createSyncBatches(payload);
  const stats = getLibraryStats();
  const now = typeof options.now === "number" ? options.now : Date.now();
  const generation = syncGeneration;

  activeSyncRequest = (async () => {
    let data = null;
    for (const batch of batches) {
      data = await cloudRequest(
        wxApi,
        {
          action: "syncLibrary",
          ...batch,
          download_summary: {
            count: stats.downloads,
            updated_at_ms: now,
          },
        },
        options.timeoutMs,
      );
    }
    return data;
  })()
    .then((data) => {
      if (generation !== syncGeneration || sessionSyncSuspended) {
        return getSyncSummary({ wxApi });
      }
      const library = validateLibraryResponse(data);
      applySyncedLibrary(library);
      markSyncSuccess(library, { ...options, wxApi, now });
      cacheProfileFromData(wxApi, data, now);
      if (data && data.achievements) {
        clearCachedAchievementState({ wxApi });
      }
      return getSyncSummary({ wxApi });
    })
    .catch((error) => {
      markSyncFailure(error, { ...options, wxApi });
      throw error;
    })
    .finally(() => {
      activeSyncRequest = null;
    });

  return activeSyncRequest;
}

function scheduleLibrarySync(options = {}) {
  if (sessionSyncSuspended) return false;
  const wxApi = getWxApi(options);
  const state = readSyncState({ wxApi });
  if (!state.enabled) return false;
  if (scheduledSyncTimer) return true;
  const delayMs = Number.isFinite(Number(options.delayMs))
    ? Math.max(0, Number(options.delayMs))
    : LIBRARY_SYNC_RETRY_DELAY_MS;
  scheduledSyncTimer = setTimeout(() => {
    scheduledSyncTimer = null;
    syncLibraryNow({ ...options, wxApi }).catch(() => {
      // Retry state is persisted and will run again on launch/network recovery.
    });
  }, delayMs);
  return true;
}

function initializeLibrarySync(options = {}) {
  sessionSyncSuspended = false;
  const wxApi = getWxApi(options);
  prepareLocalSync({ ...options, wxApi });
  const scheduled = scheduleLibrarySync({
    ...options,
    wxApi,
    delayMs: Number.isFinite(Number(options.delayMs)) ? Number(options.delayMs) : 1800,
  });
  if (
    wxApi &&
    typeof wxApi.onNetworkStatusChange === "function" &&
    !initializeLibrarySync._networkListenerRegistered
  ) {
    initializeLibrarySync._networkListenerRegistered = true;
    wxApi.onNetworkStatusChange((status) => {
      if (status && status.isConnected) {
        scheduleLibrarySync({ wxApi, delayMs: 200 });
      }
    });
  }
  return scheduled;
}

function suspendLibrarySyncForSession() {
  sessionSyncSuspended = true;
  syncGeneration += 1;
  if (scheduledSyncTimer) clearTimeout(scheduledSyncTimer);
  scheduledSyncTimer = null;
}

function resetLibrarySyncForTests() {
  activeSyncRequest = null;
  if (scheduledSyncTimer) clearTimeout(scheduledSyncTimer);
  scheduledSyncTimer = null;
  sessionSyncSuspended = false;
  syncGeneration = 0;
  initializeLibrarySync._networkListenerRegistered = false;
}

module.exports = {
  LIBRARY_SYNC_RETRY_DELAY_MS,
  LIBRARY_SYNC_BATCH_SIZE,
  LIBRARY_SYNC_TIMEOUT_MS,
  createSyncBatches,
  currentLibrary,
  getSyncSummary,
  initializeLibrarySync,
  resetLibrarySyncForTests,
  scheduleLibrarySync,
  setLibrarySyncEnabled,
  suspendLibrarySyncForSession,
  syncLibraryNow,
  validateLibraryResponse,
};
