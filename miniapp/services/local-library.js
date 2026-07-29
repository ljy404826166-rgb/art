const FAVORITE_IDS_KEY = "artArchive:favoriteArtworkIds";
const FAVORITE_ITEMS_KEY = "artArchive:favoriteArtworkItems";
const HISTORY_IDS_KEY = "artArchive:historyArtworkIds";
const HISTORY_ITEMS_KEY = "artArchive:historyArtworkItems";
const DOWNLOAD_IDS_KEY = "artArchive:downloadArtworkIds";
const DOWNLOAD_ITEMS_KEY = "artArchive:downloadArtworkItems";
const FOLLOWED_ARTIST_IDS_KEY = "artArchive:followedArtistIds";
const FOLLOWED_ARTIST_ITEMS_KEY = "artArchive:followedArtistItems";
const HISTORY_LIMIT = 80;
const DOWNLOAD_LIMIT = 80;

function readArray(key) {
  try {
    const value = wx.getStorageSync(key);
    return Array.isArray(value) ? value : [];
  } catch (error) {
    return [];
  }
}

function writeArray(key, value) {
  try {
    wx.setStorageSync(key, Array.isArray(value) ? value : []);
  } catch (error) {
    // Local library is a convenience layer; storage failures should not block browsing.
  }
}

function getSyncStateService() {
  try {
    return typeof require === "function" ? require("./library-sync-state") : null;
  } catch (error) {
    return null;
  }
}

function localSyncSeed() {
  const service = getSyncStateService();
  if (!service || typeof service.seedLocalLibrary !== "function") return;
  service.seedLocalLibrary({
    favorites: getFavoriteArtworks(),
    followedArtists: getFollowedArtists(),
    history: getHistoryArtworks(),
  });
}

function recordSyncMutation(resource, id, mutation) {
  const service = getSyncStateService();
  if (!service || typeof service.recordLibraryMutation !== "function") return;
  service.recordLibraryMutation(resource, id, mutation);
  try {
    const syncService = typeof require === "function" ? require("./user-library-sync") : null;
    if (syncService && typeof syncService.scheduleLibrarySync === "function") {
      syncService.scheduleLibrarySync();
    }
  } catch (error) {
    // Cloud sync is optional; local writes must always remain successful.
  }
}

function getArtworkId(artwork) {
  if (!artwork) return "";
  return String(artwork._id || artwork.id || artwork.source_id || artwork.supabase_id || "");
}

function getArtistId(artist) {
  if (!artist) return "";
  return String(artist.id || artist._id || "");
}

function compactArtwork(artwork) {
  if (!artwork) return null;
  const id = getArtworkId(artwork);
  if (!id) return null;

  return {
    _id: artwork._id || id,
    id,
    source_id: artwork.source_id || "",
    supabase_id: artwork.supabase_id || "",
    title: artwork.title || "",
    titleCn: artwork.titleCn || artwork.title_cn || artwork.title || "",
    titleEn: artwork.titleEn || artwork.title_en || "",
    artist: artwork.artist || "",
    thumbnail_url: artwork.thumbnail_url || "",
    display_url: artwork.display_url || "",
    cloud_file_id: artwork.cloud_file_id || "",
    medium: artwork.medium || "",
    dimensions: artwork.dimensions || "",
    tags: Array.isArray(artwork.tags) ? artwork.tags : [],
    tag_keys: Array.isArray(artwork.tag_keys) ? artwork.tag_keys : [],
    year: artwork.year || "",
    location: artwork.location || "",
    sourceName: artwork.sourceName || artwork.source_name || "",
    description: artwork.description || "",
    savedAt: new Date().toISOString(),
  };
}

function compactArtist(artist) {
  if (!artist) return null;
  const id = getArtistId(artist);
  if (!id) return null;
  const portraitStatus = String(artist.portraitStatus || artist.portrait_status || "").trim();
  const portraitApproved = portraitStatus === "approved";

  return {
    id,
    nameZh: artist.nameZh || "",
    nameEn: artist.nameEn || "",
    lifespan: artist.lifespan || "",
    country: artist.country || "",
    region: artist.region || "",
    styles: Array.isArray(artist.styles) ? artist.styles : [],
    periods: Array.isArray(artist.periods) ? artist.periods : [],
    aliases: Array.isArray(artist.aliases) ? artist.aliases : [],
    avatarText: artist.avatarText || String(artist.nameZh || artist.nameEn || "?").slice(0, 1),
    portraitUrl: portraitApproved
      ? String(artist.portraitUrl || artist.portrait_url || "").trim()
      : "",
    portraitSource: portraitApproved
      ? String(artist.portraitSource || artist.portrait_source || "").trim()
      : "",
    portraitLicense: portraitApproved
      ? String(artist.portraitLicense || artist.portrait_license || "").trim()
      : "",
    portraitCredit: portraitApproved
      ? String(artist.portraitCredit || artist.portrait_credit || "").trim()
      : "",
    portraitKind: portraitApproved
      ? String(artist.portraitKind || artist.portrait_kind || "").trim()
      : "",
    portraitArtworkId: portraitApproved
      ? String(artist.portraitArtworkId || artist.portrait_artwork_id || "").trim()
      : "",
    portraitStatus,
    portraitSnapshotVersion: 1,
    artworkCount: artist.artworkCount || 0,
    tags: Array.isArray(artist.tags) ? artist.tags : [],
    followedAt: new Date().toISOString(),
  };
}

function compactDownloadArtwork(artwork, status = "completed") {
  const item = compactArtwork(artwork);
  if (!item) return null;

  return {
    ...item,
    download_url: artwork.download_url || "",
    status,
    downloadedAt: new Date().toISOString(),
  };
}

function removeById(items, id, getId) {
  return items.filter((item) => getId(item) !== id);
}

function getFavoriteArtworkIds() {
  return readArray(FAVORITE_IDS_KEY);
}

function getFavoriteArtworks() {
  return readArray(FAVORITE_ITEMS_KEY);
}

function isFavoriteArtwork(id) {
  const safeId = String(id || "");
  return safeId ? getFavoriteArtworkIds().includes(safeId) : false;
}

function saveFavoriteArtwork(artwork) {
  const item = compactArtwork(artwork);
  if (!item) return false;

  localSyncSeed();
  const id = getArtworkId(item);
  const ids = getFavoriteArtworkIds().filter((value) => value !== id);
  const items = removeById(getFavoriteArtworks(), id, getArtworkId);

  writeArray(FAVORITE_IDS_KEY, [id, ...ids]);
  writeArray(FAVORITE_ITEMS_KEY, [item, ...items]);
  recordSyncMutation("favorites", id, {
    deleted: false,
    snapshot: item,
  });
  return true;
}

function removeFavoriteArtwork(id) {
  const safeId = String(id || "");
  if (!safeId) return false;

  localSyncSeed();
  writeArray(
    FAVORITE_IDS_KEY,
    getFavoriteArtworkIds().filter((value) => value !== safeId),
  );
  writeArray(FAVORITE_ITEMS_KEY, removeById(getFavoriteArtworks(), safeId, getArtworkId));
  recordSyncMutation("favorites", safeId, {
    deleted: true,
  });
  return true;
}

function toggleFavoriteArtwork(artwork) {
  const id = getArtworkId(artwork);
  if (!id) return false;

  if (isFavoriteArtwork(id)) {
    removeFavoriteArtwork(id);
    return false;
  }

  saveFavoriteArtwork(artwork);
  return true;
}

function recordHistoryArtwork(artwork) {
  const item = compactArtwork(artwork);
  if (!item) return false;

  localSyncSeed();
  const id = getArtworkId(item);
  const ids = getHistoryArtworkIds().filter((value) => value !== id);
  const items = removeById(getHistoryArtworks(), id, getArtworkId);
  const historyItem = {
    ...item,
    viewedAt: new Date().toISOString(),
  };

  writeArray(HISTORY_IDS_KEY, [id, ...ids].slice(0, HISTORY_LIMIT));
  writeArray(HISTORY_ITEMS_KEY, [historyItem, ...items].slice(0, HISTORY_LIMIT));
  recordSyncMutation("history", id, {
    deleted: false,
    snapshot: historyItem,
    viewedAt: Date.parse(historyItem.viewedAt) || Date.now(),
  });
  return true;
}

function getHistoryArtworkIds() {
  return readArray(HISTORY_IDS_KEY);
}

function getHistoryArtworks() {
  return readArray(HISTORY_ITEMS_KEY);
}

function clearHistoryArtworks() {
  localSyncSeed();
  const ids = getHistoryArtworkIds();
  writeArray(HISTORY_IDS_KEY, []);
  writeArray(HISTORY_ITEMS_KEY, []);
  ids.forEach((id) => {
    recordSyncMutation("history", id, {
      deleted: true,
      increment: false,
    });
  });
}

function clearLocalHistoryArtworks() {
  writeArray(HISTORY_IDS_KEY, []);
  writeArray(HISTORY_ITEMS_KEY, []);
}

function clearLocalPersonalLibrary() {
  writeArray(FAVORITE_IDS_KEY, []);
  writeArray(FAVORITE_ITEMS_KEY, []);
  writeArray(HISTORY_IDS_KEY, []);
  writeArray(HISTORY_ITEMS_KEY, []);
  writeArray(FOLLOWED_ARTIST_IDS_KEY, []);
  writeArray(FOLLOWED_ARTIST_ITEMS_KEY, []);
  return getLibraryStats();
}

function getDownloadArtworkIds() {
  return readArray(DOWNLOAD_IDS_KEY);
}

function getDownloadArtworks() {
  return readArray(DOWNLOAD_ITEMS_KEY);
}

function recordDownloadArtwork(artwork, status) {
  const item = compactDownloadArtwork(artwork, status);
  if (!item) return false;

  const id = getArtworkId(item);
  const ids = getDownloadArtworkIds().filter((value) => value !== id);
  const items = removeById(getDownloadArtworks(), id, getArtworkId);

  writeArray(DOWNLOAD_IDS_KEY, [id, ...ids].slice(0, DOWNLOAD_LIMIT));
  writeArray(DOWNLOAD_ITEMS_KEY, [item, ...items].slice(0, DOWNLOAD_LIMIT));
  return true;
}

function clearDownloadArtworks() {
  writeArray(DOWNLOAD_IDS_KEY, []);
  writeArray(DOWNLOAD_ITEMS_KEY, []);
}

function getFollowedArtistIds() {
  return readArray(FOLLOWED_ARTIST_IDS_KEY);
}

function getFollowedArtists() {
  return readArray(FOLLOWED_ARTIST_ITEMS_KEY);
}

function isFollowedArtist(id) {
  const safeId = String(id || "");
  return safeId ? getFollowedArtistIds().includes(safeId) : false;
}

function toggleFollowedArtist(artist) {
  const item = compactArtist(artist);
  if (!item) return false;

  localSyncSeed();
  const id = getArtistId(item);
  if (isFollowedArtist(id)) {
    writeArray(
      FOLLOWED_ARTIST_IDS_KEY,
      getFollowedArtistIds().filter((value) => value !== id),
    );
    writeArray(FOLLOWED_ARTIST_ITEMS_KEY, removeById(getFollowedArtists(), id, getArtistId));
    recordSyncMutation("followedArtists", id, {
      deleted: true,
    });
    return false;
  }

  const ids = getFollowedArtistIds().filter((value) => value !== id);
  const items = removeById(getFollowedArtists(), id, getArtistId);
  writeArray(FOLLOWED_ARTIST_IDS_KEY, [id, ...ids]);
  writeArray(FOLLOWED_ARTIST_ITEMS_KEY, [item, ...items]);
  recordSyncMutation("followedArtists", id, {
    deleted: false,
    snapshot: item,
  });
  return true;
}

function applySyncedLibrary(library) {
  const value = library && typeof library === "object" ? library : {};
  const existingFavorites = new Map(
    getFavoriteArtworks().map((item) => [getArtworkId(item), item]),
  );
  const existingArtists = new Map(getFollowedArtists().map((item) => [getArtistId(item), item]));
  const existingHistory = new Map(getHistoryArtworks().map((item) => [getArtworkId(item), item]));

  const activeRows = (rows) =>
    (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.deleted !== true && row.id)
      .sort(
        (left, right) =>
          Number(right.updated_at_ms || right.viewed_at_ms || 0) -
          Number(left.updated_at_ms || left.viewed_at_ms || 0),
      );

  const favorites = activeRows(value.favorites).map((row) => {
    const fallback = existingFavorites.get(String(row.id)) || {};
    return {
      ...fallback,
      ...(row.snapshot || {}),
      _id: (row.snapshot && row.snapshot._id) || fallback._id || row.id,
      id: row.id,
    };
  });
  const followedArtists = activeRows(value.followed_artists).map((row) => {
    const fallback = existingArtists.get(String(row.id)) || {};
    return {
      ...fallback,
      ...(row.snapshot || {}),
      id: row.id,
    };
  });
  const history = activeRows(value.history)
    .sort((left, right) => Number(right.viewed_at_ms || 0) - Number(left.viewed_at_ms || 0))
    .slice(0, HISTORY_LIMIT)
    .map((row) => {
      const fallback = existingHistory.get(String(row.id)) || {};
      return {
        ...fallback,
        ...(row.snapshot || {}),
        _id: (row.snapshot && row.snapshot._id) || fallback._id || row.id,
        id: row.id,
        viewedAt: new Date(Number(row.viewed_at_ms) || Date.now()).toISOString(),
        viewCount: Math.max(1, Number(row.view_count) || 1),
      };
    });

  writeArray(FAVORITE_IDS_KEY, favorites.map(getArtworkId).filter(Boolean));
  writeArray(FAVORITE_ITEMS_KEY, favorites);
  writeArray(FOLLOWED_ARTIST_IDS_KEY, followedArtists.map(getArtistId).filter(Boolean));
  writeArray(FOLLOWED_ARTIST_ITEMS_KEY, followedArtists);
  writeArray(HISTORY_IDS_KEY, history.map(getArtworkId).filter(Boolean));
  writeArray(HISTORY_ITEMS_KEY, history);
  return getLibraryStats();
}

function getLibraryStats() {
  return {
    favorites: getFavoriteArtworkIds().length,
    history: getHistoryArtworkIds().length,
    downloads: getDownloadArtworkIds().length,
    followedArtists: getFollowedArtistIds().length,
  };
}

module.exports = {
  getFavoriteArtworkIds,
  getFavoriteArtworks,
  isFavoriteArtwork,
  saveFavoriteArtwork,
  removeFavoriteArtwork,
  toggleFavoriteArtwork,
  recordHistoryArtwork,
  getHistoryArtworks,
  clearHistoryArtworks,
  clearLocalHistoryArtworks,
  clearLocalPersonalLibrary,
  getDownloadArtworks,
  recordDownloadArtwork,
  clearDownloadArtworks,
  getFollowedArtistIds,
  getFollowedArtists,
  isFollowedArtist,
  toggleFollowedArtist,
  applySyncedLibrary,
  getLibraryStats,
};
