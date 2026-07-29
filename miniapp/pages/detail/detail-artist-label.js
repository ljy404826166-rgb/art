function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function comparable(value) {
  return clean(value)
    .normalize("NFKC")
    .replace(/[\s·.,，。'’"-]+/g, "")
    .toLowerCase();
}

function joinArtistNames(nameZh, nameEn) {
  const zh = clean(nameZh);
  const en = clean(nameEn);
  if (zh && en && comparable(zh) !== comparable(en)) return `${zh}（${en}）`;
  return zh || en;
}

function shortenRawArtistText(value) {
  const text = clean(value);
  if (!text) return "";

  const bilingual = text.match(/^(.+?)\s*[（(]\s*([^,，)）]+)(?:[,，][^)）]*)?[)）]\s*$/);
  if (bilingual) return joinArtistNames(bilingual[1], bilingual[2]);

  return clean(text.split(/[,，]/)[0])
    .replace(/\s*[（(]?\s*(?:ca\.?\s*)?\d{3,4}\s*[-–—]\s*\d{0,4}\s*[)）]?\s*$/i, "")
    .trim();
}

function formatArtistButtonText(artist, fallbackText) {
  const record = artist || {};
  return (
    joinArtistNames(record.nameZh || record.name_zh, record.nameEn || record.name_en) ||
    shortenRawArtistText(fallbackText)
  );
}

module.exports = {
  formatArtistButtonText,
  shortenRawArtistText,
};
