function compactText(value) {
  return String(value || "").trim();
}

function resolveSafeArtworkImageSrc(artwork) {
  if (!artwork) return "";
  const imageSrc = compactText(artwork.imageSrc);
  if (!imageSrc) return "";

  const originalSources = [
    artwork.download_url,
    artwork.original_url,
  ].map(compactText);
  return originalSources.includes(imageSrc) ? "" : imageSrc;
}

module.exports = {
  resolveSafeArtworkImageSrc,
};
