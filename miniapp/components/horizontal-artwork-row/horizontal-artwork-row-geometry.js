const ROW_IMAGE_HEIGHT_RPX = 350;
const VIEWPORT_WIDTH_RPX = 750;
const TRACK_PADDING_RPX = 28 + 64;
const CARD_GAP_RPX = 28;
const STATUS_WIDTH_RPX = 136;

function computeRowArtworkCardWidth(imageRatio) {
  const ratio = Number(imageRatio || 0.8);
  return computeArtworkCardFrame({
    ratio,
    mediaHeight: ROW_IMAGE_HEIGHT_RPX,
    minWidth: 1,
  }).width;
}

function computeArtworkCardFrame(options = {}) {
  const ratio = Number(options.ratio || 0.8);
  const mediaHeight = Number(options.mediaHeight || ROW_IMAGE_HEIGHT_RPX);
  const minWidth = Number(options.minWidth || 1);
  return {
    height: mediaHeight,
    width: Math.max(Math.round(mediaHeight * ratio), minWidth),
  };
}

function resolveRowArtworkMeasureSrc(item) {
  if (!item) return "";
  const safeImageSrc = item.imageSrc && item.imageSrc !== item.download_url ? item.imageSrc : "";
  return item.cloud_file_id || item.thumbnail_url || item.display_url || safeImageSrc || "";
}

function fallbackCardWidth(item) {
  if (item && item.homeCardClass === "is-wide") return 476;
  if (item && item.homeCardClass === "is-compact") return 300;
  return 360;
}

function getRowArtworkKey(item, index = 0) {
  return item && (item._id || item.id || item.source_id || item.supabase_id || item.title || `index:${index}`);
}

function estimateRowMoverWidth(items, measuredWidths = {}, options = {}) {
  const list = items || [];
  const cardWidth = list.reduce((total, item, index) => {
    const key = getRowArtworkKey(item, index);
    const measured = Number(measuredWidths[key] || 0);
    return total + (measured > 0 ? measured : fallbackCardWidth(item));
  }, 0);
  const gapWidth = Math.max(0, list.length - 1) * CARD_GAP_RPX;
  const statusWidth = options.loadingMore ? STATUS_WIDTH_RPX + CARD_GAP_RPX : 0;
  return Math.max(
    VIEWPORT_WIDTH_RPX,
    TRACK_PADDING_RPX + cardWidth + gapWidth + statusWidth,
  );
}

module.exports = {
  ROW_IMAGE_HEIGHT_RPX,
  VIEWPORT_WIDTH_RPX,
  computeArtworkCardFrame,
  computeRowArtworkCardWidth,
  estimateRowMoverWidth,
  getRowArtworkKey,
  resolveRowArtworkMeasureSrc,
};
