const ROW_IMAGE_HEIGHT_RPX = 350;

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

function getRowArtworkKey(item, index = 0) {
  return item && (item._id || item.id || item.source_id || item.supabase_id || item.title || `index:${index}`);
}

function shouldResetRowScroll(previousItems, nextItems) {
  const previous = previousItems || [];
  const next = nextItems || [];
  if (!previous.length) return false;
  if (next.length < previous.length) return true;

  return previous.some((item, index) => (
    getRowArtworkKey(item, index) !== getRowArtworkKey(next[index], index)
  ));
}

module.exports = {
  ROW_IMAGE_HEIGHT_RPX,
  computeArtworkCardFrame,
  computeRowArtworkCardWidth,
  getRowArtworkKey,
  resolveRowArtworkMeasureSrc,
  shouldResetRowScroll,
};
