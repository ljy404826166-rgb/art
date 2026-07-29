const crypto = require("node:crypto");

const LIBRARY_SCHEMA_VERSION = 1;
const MAX_MUTATIONS_PER_RESOURCE = 500;
const QUERY_PAGE_SIZE = 100;
const FUTURE_CLOCK_TOLERANCE_MS = 24 * 60 * 60 * 1000;

const RESOURCE_CONFIG = {
  favorites: {
    collection: "user_favorites",
    itemField: "artwork_id",
    snapshotType: "artwork",
  },
  followed_artists: {
    collection: "user_followed_artists",
    itemField: "artist_id",
    snapshotType: "artist",
  },
  history: {
    collection: "user_history",
    itemField: "artwork_id",
    snapshotType: "artwork",
  },
};

class LibrarySyncError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LibrarySyncError";
    this.code = code;
    this.publicMessage = message;
  }
}

function stringValue(value, maxLength = 0) {
  const text = typeof value === "string" ? value.trim() : "";
  return maxLength > 0 ? text.slice(0, maxLength) : text;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function stringArray(value, limit = 30, maxLength = 100) {
  return (Array.isArray(value) ? value : [])
    .map((item) => stringValue(item, maxLength))
    .filter(Boolean)
    .slice(0, limit);
}

function validateDeviceId(value) {
  const deviceId = stringValue(value, 80);
  if (!/^dev_[a-z0-9_-]{8,76}$/iu.test(deviceId)) {
    throw new LibrarySyncError("LIBRARY_DEVICE_INVALID", "当前设备同步标识无效，请重试");
  }
  return deviceId;
}

function validateItemId(value) {
  const id = stringValue(value, 180);
  if (!id || /[\u0000-\u001f\u007f]/u.test(id)) {
    throw new LibrarySyncError("LIBRARY_ITEM_INVALID", "个人数据中包含无效记录");
  }
  return id;
}

function validateTimestamp(value, now) {
  const timestamp = Math.floor(numberValue(value));
  if (timestamp <= 0 || timestamp > now + FUTURE_CLOCK_TOLERANCE_MS) {
    throw new LibrarySyncError(
      "LIBRARY_TIMESTAMP_INVALID",
      "个人数据时间信息无效，请校准设备时间后重试",
    );
  }
  return timestamp;
}

function sanitizeArtworkSnapshot(value) {
  const item = value && typeof value === "object" ? value : {};
  return {
    _id: stringValue(item._id || item.id, 180),
    id: stringValue(item.id || item._id, 180),
    source_id: stringValue(item.source_id, 180),
    supabase_id: stringValue(item.supabase_id, 180),
    title: stringValue(item.title, 240),
    titleCn: stringValue(item.titleCn || item.title_cn, 240),
    titleEn: stringValue(item.titleEn || item.title_en, 240),
    artist: stringValue(item.artist, 240),
    thumbnail_url: stringValue(item.thumbnail_url, 1000),
    display_url: stringValue(item.display_url, 1000),
    cloud_file_id: stringValue(item.cloud_file_id, 1000),
    medium: stringValue(item.medium, 240),
    dimensions: stringValue(item.dimensions, 240),
    tags: stringArray(item.tags),
    tag_keys: stringArray(item.tag_keys),
    year: stringValue(item.year, 100),
    location: stringValue(item.location, 240),
    sourceName: stringValue(item.sourceName || item.source_name, 240),
    description: stringValue(item.description, 1200),
    savedAt: stringValue(item.savedAt, 80),
    viewedAt: stringValue(item.viewedAt, 80),
  };
}

function sanitizeArtistSnapshot(value) {
  const item = value && typeof value === "object" ? value : {};
  return {
    id: stringValue(item.id || item._id, 180),
    nameZh: stringValue(item.nameZh || item.name_zh, 240),
    nameEn: stringValue(item.nameEn || item.name_en, 240),
    lifespan: stringValue(item.lifespan, 120),
    country: stringValue(item.country, 120),
    region: stringValue(item.region, 120),
    styles: stringArray(item.styles),
    periods: stringArray(item.periods),
    aliases: stringArray(item.aliases),
    avatarText: stringValue(item.avatarText, 10),
    portraitUrl: stringValue(item.portraitUrl, 1000),
    portraitSource: stringValue(item.portraitSource, 1000),
    portraitLicense: stringValue(item.portraitLicense, 240),
    portraitCredit: stringValue(item.portraitCredit, 500),
    portraitKind: stringValue(item.portraitKind, 120),
    portraitArtworkId: stringValue(item.portraitArtworkId, 180),
    portraitStatus: stringValue(item.portraitStatus, 80),
    portraitSnapshotVersion: 1,
    artworkCount: Math.max(0, Math.floor(numberValue(item.artworkCount))),
    tags: stringArray(item.tags),
    followedAt: stringValue(item.followedAt, 80),
  };
}

function sanitizeSnapshot(value, type) {
  if (!value || typeof value !== "object") return null;
  return type === "artist" ? sanitizeArtistSnapshot(value) : sanitizeArtworkSnapshot(value);
}

function documentId(openid, resource, itemId) {
  const digest = crypto
    .createHash("sha256")
    .update(`${openid}\u0000${resource}\u0000${itemId}`)
    .digest("hex");
  return `lib_${digest.slice(0, 48)}`;
}

function normalizeMutation(value, resource, now) {
  const config = RESOURCE_CONFIG[resource];
  const mutation = value && typeof value === "object" ? value : {};
  const normalized = {
    id: validateItemId(mutation.id),
    updatedAt: validateTimestamp(mutation.updated_at_ms, now),
    deleted: mutation.deleted === true,
    snapshot: sanitizeSnapshot(mutation.snapshot, config.snapshotType),
  };
  if (resource === "history") {
    normalized.viewedAt = validateTimestamp(mutation.viewed_at_ms || mutation.updated_at_ms, now);
    normalized.deviceViewCount = Math.min(
      1000000,
      Math.max(0, Math.floor(numberValue(mutation.device_view_count))),
    );
  }
  return normalized;
}

function normalizeMutations(event, now) {
  const output = {};
  Object.keys(RESOURCE_CONFIG).forEach((resource) => {
    const rows = Array.isArray(event && event[resource]) ? event[resource] : [];
    if (rows.length > MAX_MUTATIONS_PER_RESOURCE) {
      throw new LibrarySyncError("LIBRARY_BATCH_TOO_LARGE", "本次同步数据过多，请分批重试");
    }
    const deduplicated = new Map();
    rows.forEach((row) => {
      const mutation = normalizeMutation(row, resource, now);
      const existing = deduplicated.get(mutation.id);
      if (
        !existing ||
        mutation.updatedAt > existing.updatedAt ||
        (mutation.updatedAt === existing.updatedAt && mutation.deleted && !existing.deleted)
      ) {
        deduplicated.set(mutation.id, mutation);
      }
    });
    output[resource] = [...deduplicated.values()];
  });
  return output;
}

function isDocumentNotFound(error) {
  const code = stringValue(error && (error.code || error.errCode));
  const message = stringValue(error && (error.message || error.errMsg));
  return /not.?found|not.?exist/i.test(`${code} ${message}`);
}

async function readDocument(collection, id) {
  try {
    const result = await collection.doc(id).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    if (isDocumentNotFound(error)) return null;
    throw error;
  }
}

function shouldApplyMutation(existing, mutation) {
  if (!existing) return true;
  const currentTimestamp = numberValue(existing.client_updated_at_ms);
  if (mutation.updatedAt > currentTimestamp) return true;
  if (mutation.updatedAt < currentTimestamp) return false;
  return mutation.deleted === true && existing.deleted !== true;
}

function mergeHistoryCounts(existing, deviceId, mutation) {
  const counts = {
    ...(existing && existing.device_view_counts && typeof existing.device_view_counts === "object"
      ? existing.device_view_counts
      : {}),
  };
  counts[deviceId] = Math.max(Math.floor(numberValue(counts[deviceId])), mutation.deviceViewCount);
  return counts;
}

function totalHistoryCount(counts) {
  return Object.values(counts).reduce((total, value) => total + Math.floor(numberValue(value)), 0);
}

async function applyMutation({ database, openid, deviceId, resource, mutation, serverDate }) {
  const config = RESOURCE_CONFIG[resource];
  const collection = database.collection(config.collection);
  const id = documentId(openid, resource, mutation.id);
  const existing = await readDocument(collection, id);
  const applies = shouldApplyMutation(existing, mutation);
  const now = serverDate();
  const itemField = config.itemField;
  const base = existing || {
    _openid: openid,
    [itemField]: mutation.id,
    created_at: now,
    schema_version: LIBRARY_SCHEMA_VERSION,
  };
  let document = {
    ...base,
    updated_at: now,
  };

  if (resource === "history") {
    const counts = mergeHistoryCounts(existing, deviceId, mutation);
    document = {
      ...document,
      device_view_counts: counts,
      view_count: totalHistoryCount(counts),
      viewed_at_ms: Math.max(numberValue(existing && existing.viewed_at_ms), mutation.viewedAt),
    };
  }

  if (applies) {
    document = {
      ...document,
      client_updated_at_ms: mutation.updatedAt,
      deleted: mutation.deleted,
      snapshot: mutation.snapshot || (existing && existing.snapshot) || null,
    };
  }

  await collection.doc(id).set({ data: document });
  return document;
}

async function readAllForUser(database, resource, openid) {
  const config = RESOURCE_CONFIG[resource];
  const collection = database.collection(config.collection);
  const rows = [];
  let skip = 0;
  while (true) {
    let query = collection.where({ _openid: openid });
    if (typeof query.orderBy === "function") {
      query = query.orderBy("client_updated_at_ms", "desc");
    }
    if (typeof query.skip === "function") query = query.skip(skip);
    const result = await query.limit(QUERY_PAGE_SIZE).get();
    const batch = result && Array.isArray(result.data) ? result.data : [];
    rows.push(...batch);
    if (batch.length < QUERY_PAGE_SIZE) break;
    skip += batch.length;
  }
  return rows;
}

function sanitizeLibraryRow(row, resource, deviceId) {
  const config = RESOURCE_CONFIG[resource];
  return {
    id: stringValue(row && row[config.itemField]),
    updated_at_ms: numberValue(row && row.client_updated_at_ms),
    deleted: row && row.deleted === true,
    snapshot: row && row.snapshot && typeof row.snapshot === "object" ? row.snapshot : null,
    ...(resource === "history"
      ? {
          viewed_at_ms: numberValue(row && row.viewed_at_ms),
          view_count: Math.floor(numberValue(row && row.view_count)),
          device_view_count: Math.floor(
            numberValue(row && row.device_view_counts && row.device_view_counts[deviceId]),
          ),
        }
      : {}),
  };
}

async function syncLibrary({ database, openid, deviceId, event, serverDate, now = Date.now() }) {
  const safeDeviceId = validateDeviceId(deviceId);
  const mutations = normalizeMutations(event, now);

  for (const resource of Object.keys(RESOURCE_CONFIG)) {
    for (const mutation of mutations[resource]) {
      await applyMutation({
        database,
        openid,
        deviceId: safeDeviceId,
        resource,
        mutation,
        serverDate,
      });
    }
  }

  const [favorites, followedArtists, history] = await Promise.all([
    readAllForUser(database, "favorites", openid),
    readAllForUser(database, "followed_artists", openid),
    readAllForUser(database, "history", openid),
  ]);

  return {
    synced_at_ms: now,
    favorites: favorites.map((row) => sanitizeLibraryRow(row, "favorites", safeDeviceId)),
    followed_artists: followedArtists.map((row) =>
      sanitizeLibraryRow(row, "followed_artists", safeDeviceId),
    ),
    history: history.map((row) => sanitizeLibraryRow(row, "history", safeDeviceId)),
  };
}

module.exports = {
  LIBRARY_SCHEMA_VERSION,
  LibrarySyncError,
  MAX_MUTATIONS_PER_RESOURCE,
  RESOURCE_CONFIG,
  documentId,
  normalizeMutations,
  sanitizeLibraryRow,
  sanitizeSnapshot,
  shouldApplyMutation,
  syncLibrary,
  totalHistoryCount,
  validateDeviceId,
};
