function compactText(value) {
  return String(value || "").trim();
}

function resolveSafeArtworkSource(artwork, value) {
  if (!artwork) return "";
  const source = compactText(value);
  if (!source) return "";

  const originalSources = [
    artwork.download_url,
    artwork.original_url,
  ].map(compactText);
  return originalSources.includes(source) ? "" : source;
}

function compactUnique(values) {
  const seen = {};
  return values.reduce((result, value) => {
    if (!value || seen[value]) return result;
    seen[value] = true;
    result.push(value);
    return result;
  }, []);
}

function resolveSafeArtworkImageSrc(artwork) {
  return resolveSafeArtworkSource(artwork, artwork && artwork.imageSrc);
}

function resolveArtworkImageCandidates(artwork, usage) {
  if (!artwork) return [];
  const values = usage === "detail"
    ? [artwork.display_url, artwork.thumbnail_url, artwork.imageSrc]
    : [artwork.thumbnail_url, artwork.display_url, artwork.imageSrc];
  return compactUnique(
    values.map((value) => resolveSafeArtworkSource(artwork, value)),
  );
}

module.exports = {
  resolveArtworkImageCandidates,
  resolveSafeArtworkImageSrc,
};
