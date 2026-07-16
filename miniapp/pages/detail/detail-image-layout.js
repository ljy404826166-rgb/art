const {
  resolveArtworkImageCandidates,
} = require("../../services/artwork-image-sources");

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
  return resolveArtworkImageCandidates(item, "detail")[0] || "";
}

module.exports = {
  DETAIL_HERO_WIDTH_RPX,
  computeDetailHeroFrameStyle,
  resolveDetailMeasureSrc,
};
