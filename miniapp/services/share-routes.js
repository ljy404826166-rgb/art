const HOME_SHARE = {
  title: "Art Archive · 在线画廊",
  path: "/pages/home/home",
};

function compactText(value) {
  return String(value || "").trim();
}

function withOptionalImage(message, imageUrl) {
  const safeImageUrl = compactText(imageUrl);
  return safeImageUrl ? { ...message, imageUrl: safeImageUrl } : message;
}

function resolveArtworkShareImageUrl(artwork) {
  const downloadUrl = compactText(artwork && artwork.download_url);
  const candidates = [
    artwork && artwork.thumbnail_url,
    artwork && artwork.display_url,
  ];
  return candidates
    .map(compactText)
    .find((candidate) => candidate && candidate !== downloadUrl) || "";
}

function buildArtworkShareMessage(artwork) {
  const id = compactText(artwork && (artwork._id || artwork.id || artwork.source_id || artwork.supabase_id));
  if (!id) return { ...HOME_SHARE };

  const title = compactText(artwork.titleCn || artwork.title_cn || artwork.title || artwork.titleEn) || "未命名作品";
  const artist = compactText(artwork.artist);
  return withOptionalImage({
    title: artist ? `${title} · ${artist}` : `${title} · Art Archive`,
    path: `/pages/detail/detail?id=${encodeURIComponent(id)}`,
  }, resolveArtworkShareImageUrl(artwork));
}

function buildArtistShareMessage(artist) {
  const id = compactText(artist && (artist.id || artist._id));
  if (!id) return { ...HOME_SHARE };

  const nameZh = compactText(artist.nameZh || artist.name_zh || artist.name);
  const nameEn = compactText(artist.nameEn || artist.name_en);
  const name = nameZh && nameEn ? `${nameZh}（${nameEn}）` : (nameZh || nameEn || "画家");
  return withOptionalImage({
    title: `${name}· Art Archive`,
    path: `/pages/artist-detail/artist-detail?id=${encodeURIComponent(id)}`,
  }, artist.avatarUrl || artist.avatar_url);
}

module.exports = {
  buildArtworkShareMessage,
  buildArtistShareMessage,
};
