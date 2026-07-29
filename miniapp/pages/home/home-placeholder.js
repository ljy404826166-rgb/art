const DEFAULT_SEARCH_PLACEHOLDER = "搜索画作";

function artworkTitle(item) {
  if (!item) return "";
  const candidates = [item.title_cn, item.title, item.name, item.title_en, item.titleEn];
  return (
    candidates
      .map((value) => String(value || "").trim())
      .find((value) => value && value !== "未命名作品") || ""
  );
}

function pickRandomArtworkTitle(artworks, options) {
  const random = options && typeof options.random === "function" ? options.random : Math.random;
  const fallback =
    String((options && options.fallback) || DEFAULT_SEARCH_PLACEHOLDER).trim() ||
    DEFAULT_SEARCH_PLACEHOLDER;
  const seen = {};
  const titles = [];

  (artworks || []).forEach((item) => {
    const title = artworkTitle(item);
    if (!title || seen[title]) return;
    seen[title] = true;
    titles.push(title);
  });

  if (!titles.length) return fallback;
  const sample = Number(random());
  const normalized = Number.isFinite(sample) ? Math.max(0, Math.min(0.999999999, sample)) : 0;
  return titles[Math.floor(normalized * titles.length)];
}

module.exports = {
  DEFAULT_SEARCH_PLACEHOLDER,
  artworkTitle,
  pickRandomArtworkTitle,
};
