const FAVORITE_IDS_KEY = "artArchive:favoriteArtworkIds";
const FAVORITE_ITEMS_KEY = "artArchive:favoriteArtworkItems";
const HISTORY_IDS_KEY = "artArchive:historyArtworkIds";
const HISTORY_ITEMS_KEY = "artArchive:historyArtworkItems";
const FOLLOWED_ARTIST_IDS_KEY = "artArchive:followedArtistIds";
const FOLLOWED_ARTIST_ITEMS_KEY = "artArchive:followedArtistItems";
const HISTORY_LIMIT = 80;

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
    artworkCount: artist.artworkCount || 0,
    tags: Array.isArray(artist.tags) ? artist.tags : [],
    followedAt: new Date().toISOString(),
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

  const id = getArtworkId(item);
  const ids = getFavoriteArtworkIds().filter((value) => value !== id);
  const items = removeById(getFavoriteArtworks(), id, getArtworkId);

  writeArray(FAVORITE_IDS_KEY, [id, ...ids]);
  writeArray(FAVORITE_ITEMS_KEY, [item, ...items]);
  return true;
}

function removeFavoriteArtwork(id) {
  const safeId = String(id || "");
  if (!safeId) return false;

  writeArray(FAVORITE_IDS_KEY, getFavoriteArtworkIds().filter((value) => value !== safeId));
  writeArray(FAVORITE_ITEMS_KEY, removeById(getFavoriteArtworks(), safeId, getArtworkId));
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

  const id = getArtworkId(item);
  const ids = getHistoryArtworkIds().filter((value) => value !== id);
  const items = removeById(getHistoryArtworks(), id, getArtworkId);
  const historyItem = {
    ...item,
    viewedAt: new Date().toISOString(),
  };

  writeArray(HISTORY_IDS_KEY, [id, ...ids].slice(0, HISTORY_LIMIT));
  writeArray(HISTORY_ITEMS_KEY, [historyItem, ...items].slice(0, HISTORY_LIMIT));
  return true;
}

function getHistoryArtworkIds() {
  return readArray(HISTORY_IDS_KEY);
}

function getHistoryArtworks() {
  return readArray(HISTORY_ITEMS_KEY);
}

function clearHistoryArtworks() {
  writeArray(HISTORY_IDS_KEY, []);
  writeArray(HISTORY_ITEMS_KEY, []);
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

  const id = getArtistId(item);
  if (isFollowedArtist(id)) {
    writeArray(FOLLOWED_ARTIST_IDS_KEY, getFollowedArtistIds().filter((value) => value !== id));
    writeArray(FOLLOWED_ARTIST_ITEMS_KEY, removeById(getFollowedArtists(), id, getArtistId));
    return false;
  }

  const ids = getFollowedArtistIds().filter((value) => value !== id);
  const items = removeById(getFollowedArtists(), id, getArtistId);
  writeArray(FOLLOWED_ARTIST_IDS_KEY, [id, ...ids]);
  writeArray(FOLLOWED_ARTIST_ITEMS_KEY, [item, ...items]);
  return true;
}

function getLibraryStats() {
  return {
    favorites: getFavoriteArtworkIds().length,
    history: getHistoryArtworkIds().length,
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
  getFollowedArtistIds,
  getFollowedArtists,
  isFollowedArtist,
  toggleFollowedArtist,
  getLibraryStats,
};
