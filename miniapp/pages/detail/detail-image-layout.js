const DETAIL_HERO_WIDTH_RPX = 694;

function normalizeRatio(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return ratio;
}

function computeDetailHeroFrameStyle(imageRatio) {
  const ratio = normalizeRatio(imageRatio);
  if (!ratio) return "";
  const height = Math.max(1, Math.round(DETAIL_HERO_WIDTH_RPX / ratio));
  return `height: ${height}rpx; min-height: ${height}rpx;`;
}

function resolveDetailMeasureSrc(item) {
  if (!item) return "";
  const safeImageSrc = item.imageSrc && item.imageSrc !== item.download_url ? item.imageSrc : "";
  return item.cloud_file_id || item.display_url || item.thumbnail_url || safeImageSrc || "";
}

module.exports = {
  DETAIL_HERO_WIDTH_RPX,
  computeDetailHeroFrameStyle,
  resolveDetailMeasureSrc,
};
