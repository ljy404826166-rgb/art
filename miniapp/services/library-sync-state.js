const LIBRARY_SYNC_STATE_KEY = "artArchive:librarySync:v1";
const LIBRARY_SYNC_SNAPSHOT_KEY = "artArchive:librarySyncSnapshot:v1";
const LIBRARY_SYNC_VERSION = 2;

const RESOURCE_NAMES = ["favorites", "followedArtists", "history"];

function getWxApi(options) {
  if (options && options.wxApi) return options.wxApi;
  return typeof wx !== "undefined" ? wx : null;
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function emptyRecords() {
  return {
    favorites: {},
    followedArtists: {},
    history: {},
  };
}

function defaultSyncState() {
  return {
    version: LIBRARY_SYNC_VERSION,
    enabled: true,
    deviceId: "",
    seeded: false,
    snapshotCreatedAt: 0,
    lastSyncAt: 0,
    lastAttemptAt: 0,
    status: "pending",
    pending: true,
    errorCode: "",
    errorMessage: "",
    records: emptyRecords(),
  };
}

function normalizeRecord(record, resource) {
  const value = safeObject(record);
  const id = stringValue(value.id);
  if (!id) return null;
  const normalized = {
    id,
    updatedAt: numberValue(value.updatedAt),
    deleted: value.deleted === true,
    snapshot: value.snapshot && typeof value.snapshot === "object" ? value.snapshot : null,
  };
  if (resource === "history") {
    normalized.viewedAt = numberValue(value.viewedAt);
    normalized.deviceViewCount = Math.max(0, Math.floor(numberValue(value.deviceViewCount)));
    normalized.totalViewCount = Math.max(
      normalized.deviceViewCount,
      Math.floor(numberValue(value.totalViewCount)),
    );
  }
  return normalized;
}

function normalizeSyncState(value) {
  const input = safeObject(value);
  if (![1, LIBRARY_SYNC_VERSION].includes(input.version)) {
    return defaultSyncState();
  }
  const migrateFromManualOptIn = input.version === 1;
  const records = emptyRecords();
  const rawRecords = safeObject(input.records);
  RESOURCE_NAMES.forEach((resource) => {
    const source = safeObject(rawRecords[resource]);
    Object.keys(source).forEach((id) => {
      const record = normalizeRecord(source[id], resource);
      if (record) records[resource][record.id] = record;
    });
  });
  return {
    ...defaultSyncState(),
    version: LIBRARY_SYNC_VERSION,
    enabled: migrateFromManualOptIn ? true : input.enabled !== false,
    deviceId: stringValue(input.deviceId),
    seeded: input.seeded === true,
    snapshotCreatedAt: numberValue(input.snapshotCreatedAt),
    lastSyncAt: numberValue(input.lastSyncAt),
    lastAttemptAt: numberValue(input.lastAttemptAt),
    status: migrateFromManualOptIn
      ? "pending"
      : stringValue(input.status) || (input.enabled === false ? "disabled" : "pending"),
    pending: migrateFromManualOptIn ? true : input.pending === true,
    errorCode: migrateFromManualOptIn ? "" : stringValue(input.errorCode),
    errorMessage: migrateFromManualOptIn ? "" : stringValue(input.errorMessage),
    records,
  };
}

function readSyncState(options = {}) {
  const wxApi = getWxApi(options);
  if (!wxApi || typeof wxApi.getStorageSync !== "function") {
    return defaultSyncState();
  }
  try {
    return normalizeSyncState(wxApi.getStorageSync(LIBRARY_SYNC_STATE_KEY));
  } catch (error) {
    return defaultSyncState();
  }
}

function writeSyncState(state, options = {}) {
  const wxApi = getWxApi(options);
  const normalized = normalizeSyncState(state);
  if (wxApi && typeof wxApi.setStorageSync === "function") {
    try {
      wxApi.setStorageSync(LIBRARY_SYNC_STATE_KEY, normalized);
    } catch (error) {
      // Local-first behavior must remain available when metadata cannot be cached.
    }
  }
  return normalized;
}

function clearLocalSyncState(options = {}) {
  const wxApi = getWxApi(options);
  if (!wxApi || typeof wxApi.removeStorageSync !== "function") {
    return false;
  }
  try {
    wxApi.removeStorageSync(LIBRARY_SYNC_STATE_KEY);
    wxApi.removeStorageSync(LIBRARY_SYNC_SNAPSHOT_KEY);
    return true;
  } catch (error) {
    return false;
  }
}

function createDeviceId(now = Date.now(), random = Math.random) {
  const randomPart = Math.floor(random() * Number.MAX_SAFE_INTEGER)
    .toString(36)
    .padStart(10, "0")
    .slice(0, 12);
  return `dev_${Math.floor(now).toString(36)}_${randomPart}`;
}

function ensureDeviceId(state, options = {}) {
  const value = normalizeSyncState(state);
  if (value.deviceId) return value;
  return {
    ...value,
    deviceId: createDeviceId(
      typeof options.now === "number" ? options.now : Date.now(),
      typeof options.random === "function" ? options.random : Math.random,
    ),
  };
}

function timestampFromItem(item, keys, fallback) {
  const value = safeObject(item);
  for (const key of keys) {
    const parsed = Date.parse(value[key]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function seedResource(target, items, getId, resource, now) {
  (Array.isArray(items) ? items : []).forEach((item) => {
    const id = stringValue(getId(item));
    if (!id || target[id]) return;
    const updatedAt = timestampFromItem(
      item,
      resource === "history"
        ? ["viewedAt", "savedAt"]
        : resource === "followedArtists"
          ? ["followedAt"]
          : ["savedAt"],
      now,
    );
    target[id] = {
      id,
      updatedAt,
      deleted: false,
      snapshot: item,
      ...(resource === "history"
        ? {
            viewedAt: updatedAt,
            deviceViewCount: 1,
            totalViewCount: 1,
          }
        : {}),
    };
  });
}

function seedLocalLibrary(library, options = {}) {
  let state = ensureDeviceId(readSyncState(options), options);
  if (state.seeded) return state;
  const now = typeof options.now === "number" ? options.now : Date.now();
  const value = safeObject(library);
  const records = emptyRecords();
  seedResource(
    records.favorites,
    value.favorites,
    (item) => item && (item._id || item.id),
    "favorites",
    now,
  );
  seedResource(
    records.followedArtists,
    value.followedArtists,
    (item) => item && (item.id || item._id),
    "followedArtists",
    now,
  );
  seedResource(
    records.history,
    value.history,
    (item) => item && (item._id || item.id),
    "history",
    now,
  );
  state = {
    ...state,
    seeded: true,
    pending:
      Object.keys(records.favorites).length > 0 ||
      Object.keys(records.followedArtists).length > 0 ||
      Object.keys(records.history).length > 0,
    records,
  };
  if (state.enabled && state.pending) state.status = "pending";
  return writeSyncState(state, options);
}

function nextMutationTimestamp(now, existing) {
  return Math.max(numberValue(now), numberValue(existing && existing.updatedAt) + 1);
}

function recordLibraryMutation(resource, id, mutation = {}, options = {}) {
  if (!RESOURCE_NAMES.includes(resource)) return readSyncState(options);
  const safeId = stringValue(id);
  if (!safeId) return readSyncState(options);
  let state = ensureDeviceId(readSyncState(options), options);
  const records = {
    ...state.records,
    [resource]: {
      ...state.records[resource],
    },
  };
  const existing = records[resource][safeId] || null;
  const now = typeof options.now === "number" ? options.now : Date.now();
  const deleted = mutation.deleted === true;
  const record = {
    ...(existing || {}),
    id: safeId,
    updatedAt: nextMutationTimestamp(now, existing),
    deleted,
    snapshot:
      mutation.snapshot && typeof mutation.snapshot === "object"
        ? mutation.snapshot
        : existing && existing.snapshot
          ? existing.snapshot
          : null,
  };
  if (resource === "history") {
    const shouldIncrement = mutation.increment !== false && !deleted;
    record.viewedAt = deleted
      ? numberValue(existing && existing.viewedAt)
      : numberValue(mutation.viewedAt) || now;
    record.deviceViewCount =
      Math.max(0, Math.floor(numberValue(existing && existing.deviceViewCount))) +
      (shouldIncrement ? 1 : 0);
    record.totalViewCount = Math.max(
      record.deviceViewCount,
      Math.floor(numberValue(existing && existing.totalViewCount)),
    );
  }
  records[resource][safeId] = record;
  state = {
    ...state,
    seeded: true,
    pending: true,
    status: state.enabled ? "pending" : "disabled",
    errorCode: "",
    errorMessage: "",
    records,
  };
  return writeSyncState(state, options);
}

function createInitialSnapshot(library, options = {}) {
  const wxApi = getWxApi(options);
  let state = ensureDeviceId(readSyncState(options), options);
  if (state.snapshotCreatedAt > 0) return state;
  const createdAt = typeof options.now === "number" ? options.now : Date.now();
  if (wxApi && typeof wxApi.setStorageSync === "function") {
    try {
      wxApi.setStorageSync(LIBRARY_SYNC_SNAPSHOT_KEY, {
        version: LIBRARY_SYNC_VERSION,
        createdAt,
        library: safeObject(library),
      });
    } catch (error) {
      // The caller may still enable sync; the status page will expose failures.
    }
  }
  state = {
    ...state,
    snapshotCreatedAt: createdAt,
  };
  return writeSyncState(state, options);
}

function setLocalSyncEnabled(enabled, options = {}) {
  let state = ensureDeviceId(readSyncState(options), options);
  state = {
    ...state,
    enabled: enabled === true,
    pending: enabled === true ? state.pending : state.pending,
    status: enabled === true ? (state.pending ? "pending" : "ready") : "disabled",
    errorCode: "",
    errorMessage: "",
  };
  return writeSyncState(state, options);
}

function markSyncAttempt(options = {}) {
  const state = readSyncState(options);
  return writeSyncState(
    {
      ...state,
      lastAttemptAt: typeof options.now === "number" ? options.now : Date.now(),
      status: "syncing",
      errorCode: "",
      errorMessage: "",
    },
    options,
  );
}

function markSyncFailure(error, options = {}) {
  const state = readSyncState(options);
  return writeSyncState(
    {
      ...state,
      pending: true,
      status: state.enabled ? "error" : "disabled",
      errorCode: stringValue(error && (error.code || error.errCode)) || "SYNC_FAILED",
      errorMessage: stringValue(error && (error.message || error.errMsg)) || "同步失败",
    },
    options,
  );
}

function mergeServerRecords(state, library) {
  const records = emptyRecords();
  const mapping = {
    favorites: "favorites",
    followedArtists: "followed_artists",
    history: "history",
  };
  RESOURCE_NAMES.forEach((resource) => {
    const rows = Array.isArray(library && library[mapping[resource]])
      ? library[mapping[resource]]
      : [];
    rows.forEach((row) => {
      const id = stringValue(row && row.id);
      if (!id) return;
      records[resource][id] = {
        id,
        updatedAt: numberValue(row.updated_at_ms),
        deleted: row.deleted === true,
        snapshot: row.snapshot && typeof row.snapshot === "object" ? row.snapshot : null,
        ...(resource === "history"
          ? {
              viewedAt: numberValue(row.viewed_at_ms),
              deviceViewCount: Math.max(0, Math.floor(numberValue(row.device_view_count))),
              totalViewCount: Math.max(0, Math.floor(numberValue(row.view_count))),
            }
          : {}),
      };
    });
  });
  return {
    ...state,
    records,
  };
}

function markSyncSuccess(library, options = {}) {
  let state = readSyncState(options);
  state = mergeServerRecords(state, library);
  return writeSyncState(
    {
      ...state,
      pending: false,
      status: state.enabled ? "ready" : "disabled",
      lastSyncAt:
        numberValue(library && library.synced_at_ms) ||
        (typeof options.now === "number" ? options.now : Date.now()),
      errorCode: "",
      errorMessage: "",
    },
    options,
  );
}

function createSyncPayload(options = {}) {
  const state = readSyncState(options);
  const toRows = (resource) =>
    Object.values(state.records[resource]).map((record) => ({
      id: record.id,
      updated_at_ms: record.updatedAt,
      deleted: record.deleted === true,
      snapshot: record.snapshot || null,
      ...(resource === "history"
        ? {
            viewed_at_ms: record.viewedAt,
            device_view_count: record.deviceViewCount,
          }
        : {}),
    }));
  return {
    device_id: state.deviceId,
    favorites: toRows("favorites"),
    followed_artists: toRows("followedArtists"),
    history: toRows("history"),
  };
}

function getSyncSummary(options = {}) {
  const state = readSyncState(options);
  return {
    enabled: state.enabled,
    status: state.status,
    pending: state.pending,
    lastSyncAt: state.lastSyncAt,
    lastAttemptAt: state.lastAttemptAt,
    snapshotCreatedAt: state.snapshotCreatedAt,
    errorCode: state.errorCode,
    errorMessage: state.errorMessage,
  };
}

module.exports = {
  LIBRARY_SYNC_SNAPSHOT_KEY,
  LIBRARY_SYNC_STATE_KEY,
  LIBRARY_SYNC_VERSION,
  clearLocalSyncState,
  createDeviceId,
  createInitialSnapshot,
  createSyncPayload,
  defaultSyncState,
  getSyncSummary,
  markSyncAttempt,
  markSyncFailure,
  markSyncSuccess,
  normalizeSyncState,
  readSyncState,
  recordLibraryMutation,
  seedLocalLibrary,
  setLocalSyncEnabled,
  writeSyncState,
};
