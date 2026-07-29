import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

function loadMiniappCatalog() {
  const filename = fileURLToPath(
    new URL("../../miniapp/data/category-catalog.js", import.meta.url),
  );
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(filename, "utf8"),
    {
      module,
      exports: module.exports,
    },
    { filename },
  );
  return module.exports;
}

const { CATEGORY_CATALOG_VERSION, CATEGORY_GROUPS } = loadMiniappCatalog();

const REGION_TERMS = [
  { id: "region-europe", label: "欧洲" },
  { id: "region-asia", label: "亚洲" },
  { id: "region-north-america", label: "北美" },
  { id: "region-latin-america", label: "拉丁美洲" },
  { id: "region-africa", label: "非洲" },
  { id: "region-oceania", label: "大洋洲" },
  { id: "region-other", label: "其他" },
];

const REGION_ALIASES = new Map([
  ["欧洲", "region-europe"],
  ["europe", "region-europe"],
  ["亚洲", "region-asia"],
  ["asia", "region-asia"],
  ["北美", "region-north-america"],
  ["北美洲", "region-north-america"],
  ["north america", "region-north-america"],
  ["拉丁美洲", "region-latin-america"],
  ["南美", "region-latin-america"],
  ["南美洲", "region-latin-america"],
  ["latin america", "region-latin-america"],
  ["south america", "region-latin-america"],
  ["非洲", "region-africa"],
  ["africa", "region-africa"],
  ["大洋洲", "region-oceania"],
  ["oceania", "region-oceania"],
]);

const COUNTRY_REGIONS = new Map([
  ["阿尔巴尼亚", "region-europe"],
  ["奥地利", "region-europe"],
  ["奧地利帝國", "region-europe"],
  ["奥地利帝国", "region-europe"],
  ["比利时", "region-europe"],
  ["保加利亚", "region-europe"],
  ["克罗地亚", "region-europe"],
  ["捷克", "region-europe"],
  ["丹麦", "region-europe"],
  ["英国", "region-europe"],
  ["英格兰", "region-europe"],
  ["苏格兰", "region-europe"],
  ["芬兰", "region-europe"],
  ["法国", "region-europe"],
  ["德国", "region-europe"],
  ["希腊", "region-europe"],
  ["匈牙利", "region-europe"],
  ["冰岛", "region-europe"],
  ["爱尔兰", "region-europe"],
  ["意大利", "region-europe"],
  ["荷兰", "region-europe"],
  ["挪威", "region-europe"],
  ["荷兰王国", "region-europe"],
  ["荷蘭共和國", "region-europe"],
  ["南尼德蘭", "region-europe"],
  ["哈布斯堡荷蘭", "region-europe"],
  ["西屬尼德蘭", "region-europe"],
  ["波兰", "region-europe"],
  ["葡萄牙", "region-europe"],
  ["罗马尼亚", "region-europe"],
  ["俄罗斯", "region-europe"],
  ["塞尔维亚", "region-europe"],
  ["斯洛伐克", "region-europe"],
  ["西班牙", "region-europe"],
  ["瑞典", "region-europe"],
  ["瑞士", "region-europe"],
  ["乌克兰", "region-europe"],
  ["大不列颠及爱尔兰联合王国", "region-europe"],
  ["大不列顛王國", "region-europe"],
  ["丹麥王國", "region-europe"],
  ["德意志国", "region-europe"],
  ["俄罗斯帝国", "region-europe"],
  ["意大利王國", "region-europe"],
  ["神聖羅馬帝國", "region-europe"],
  ["不來梅州", "region-europe"],
  ["洛林公国", "region-europe"],
  ["米兰公国", "region-europe"],
  ["教皇国", "region-europe"],
  ["威尼斯共和国", "region-europe"],
  ["萨克森王国", "region-europe"],
  ["日本", "region-asia"],
  ["中国", "region-asia"],
  ["韩国", "region-asia"],
  ["印度", "region-asia"],
  ["伊朗", "region-asia"],
  ["土耳其", "region-asia"],
  ["美国", "region-north-america"],
  ["加拿大", "region-north-america"],
  ["墨西哥", "region-latin-america"],
  ["巴西", "region-latin-america"],
  ["阿根廷", "region-latin-america"],
  ["智利", "region-latin-america"],
  ["古巴", "region-latin-america"],
  ["澳大利亚", "region-oceania"],
  ["新西兰", "region-oceania"],
  ["南非", "region-africa"],
  ["摩洛哥", "region-africa"],
  ["埃及", "region-africa"],
  ["albania", "region-europe"],
  ["austria", "region-europe"],
  ["belgium", "region-europe"],
  ["croatia", "region-europe"],
  ["czech republic", "region-europe"],
  ["czechia", "region-europe"],
  ["denmark", "region-europe"],
  ["england", "region-europe"],
  ["finland", "region-europe"],
  ["france", "region-europe"],
  ["germany", "region-europe"],
  ["hungary", "region-europe"],
  ["ireland", "region-europe"],
  ["italy", "region-europe"],
  ["netherlands", "region-europe"],
  ["norway", "region-europe"],
  ["poland", "region-europe"],
  ["portugal", "region-europe"],
  ["romania", "region-europe"],
  ["russia", "region-europe"],
  ["spain", "region-europe"],
  ["sweden", "region-europe"],
  ["switzerland", "region-europe"],
  ["ukraine", "region-europe"],
  ["united kingdom", "region-europe"],
  ["uk", "region-europe"],
  ["japan", "region-asia"],
  ["china", "region-asia"],
  ["south korea", "region-asia"],
  ["india", "region-asia"],
  ["iran", "region-asia"],
  ["turkey", "region-asia"],
  ["united states", "region-north-america"],
  ["usa", "region-north-america"],
  ["canada", "region-north-america"],
  ["mexico", "region-latin-america"],
  ["brazil", "region-latin-america"],
  ["argentina", "region-latin-america"],
  ["chile", "region-latin-america"],
  ["cuba", "region-latin-america"],
  ["australia", "region-oceania"],
  ["new zealand", "region-oceania"],
  ["south africa", "region-africa"],
  ["morocco", "region-africa"],
  ["egypt", "region-africa"],
]);

const STYLE_ALIASES = {
  impressionism: "style-impressionism",
  "post-impressionism": "style-post-impressionism",
  postimpressionism: "style-post-impressionism",
  expressionism: "style-expressionism",
  modernism: "style-modernism",
  "art nouveau": "style-art-nouveau",
  neoclassicism: "style-neoclassicism",
  renaissance: "style-renaissance",
  realism: "style-realism",
  "ukiyo-e": "style-ukiyo-e",
  ukiyoe: "style-ukiyo-e",
  baroque: "style-baroque",
  romanticism: "style-romanticism",
  symbolism: "style-symbolism",
  academicism: "style-academicism",
  rococo: "style-rococo",
  fauvism: "style-fauvism",
  "northern renaissance": "style-northern-renaissance",
  "viennese modernism": "style-viennese-modernism",
  "vienna secession": "style-vienna-secession",
  historicism: "style-historicism",
  "american impressionism": "style-american-impressionism",
  "british romanticism": "style-british-romanticism",
  "french romanticism": "style-french-romanticism",
  "german expressionism": "style-german-expressionism",
  "german romanticism": "style-german-romanticism",
  "hudson river school": "style-hudson-river-school",
  "netherlandish renaissance": "style-netherlandish-renaissance",
  orphism: "style-orphism",
  "spanish renaissance": "style-spanish-renaissance",
  "spanish romanticism": "style-spanish-romanticism",
};

const VALID_IDS = new Set(CATEGORY_GROUPS.flatMap((group) => group.tags.map((tag) => tag.id)));
const STYLE_LABEL_IDS = new Map(
  CATEGORY_GROUPS.find((group) => group.key === "style").tags.map((tag) => [
    normalizeText(tag.label),
    tag.id,
  ]),
);

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isPublishedArtwork(row) {
  const status = normalizeText(row?.status || row?.publish_status || row?.review_status);
  return !status || status === "published" || status === "reviewed";
}

function artworkArtistIds(row) {
  return unique(
    [...asArray(row?.artist_ids), row?.primary_artist_id, row?.artist_id].map((value) =>
      String(value ?? "").trim(),
    ),
  );
}

function artworkClassificationIds(row) {
  return unique(
    [...asArray(row?.classification_ids), ...asArray(row?.tag_ids)].map((value) =>
      String(value ?? "").trim(),
    ),
  ).filter((id) => VALID_IDS.has(id));
}

function countIds(artworks, prefix) {
  const counts = new Map();
  for (const artwork of artworks) {
    for (const id of artworkClassificationIds(artwork)) {
      if (!id.startsWith(prefix)) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return counts;
}

function rankedIds(counts) {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id]) => id);
}

function selectRepresentativeIds(counts, total, { max = 5, minCount = 2, minRatio = 0.1 } = {}) {
  const selected = [...counts.entries()]
    .filter(([, count]) => count >= minCount || (total > 0 && count / total >= minRatio))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, max)
    .map(([id]) => id);
  if (selected.length || !counts.size) return selected;
  return rankedIds(counts).slice(0, 1);
}

function mappedLegacyStyleIds(artist) {
  return unique(
    asArray(artist?.styles).map((style) => {
      const normalized = normalizeText(style);
      return STYLE_LABEL_IDS.get(normalized) || STYLE_ALIASES[normalized] || "";
    }),
  );
}

export function resolveRegionId(artist) {
  const region = normalizeText(artist?.region || artist?.region_label);
  if (REGION_ALIASES.has(region)) return REGION_ALIASES.get(region);
  const country = normalizeText(artist?.country || artist?.nationality);
  return COUNTRY_REGIONS.get(country) || "region-other";
}

export function deriveArtistClassification(artist, linkedArtworks, options = {}) {
  const artworks = asArray(linkedArtworks).filter(isPublishedArtwork);
  const styleCounts = countIds(artworks, "style-");
  const subjectCounts = countIds(artworks, "subject-");
  const decadeCounts = countIds(artworks, "period-");
  const derivedStyleIds = selectRepresentativeIds(styleCounts, artworks.length, options);
  const fallbackStyleIds = mappedLegacyStyleIds(artist);

  return {
    classification_version: CATEGORY_CATALOG_VERSION,
    region_id: resolveRegionId(artist),
    style_ids: derivedStyleIds.length
      ? derivedStyleIds
      : fallbackStyleIds.slice(0, options.max || 5),
    subject_ids: selectRepresentativeIds(subjectCounts, artworks.length, options),
    decade_ids: rankedIds(decadeCounts).sort(
      (left, right) =>
        Number(left.match(/\d{4}/)?.[0] || 0) - Number(right.match(/\d{4}/)?.[0] || 0),
    ),
    classified_artwork_count: artworks.length,
  };
}

export function deriveAllArtistClassifications(artists, artworks, options = {}) {
  const artworksByArtist = new Map();
  for (const artwork of asArray(artworks)) {
    if (!isPublishedArtwork(artwork)) continue;
    for (const artistId of artworkArtistIds(artwork)) {
      if (!artworksByArtist.has(artistId)) artworksByArtist.set(artistId, []);
      artworksByArtist.get(artistId).push(artwork);
    }
  }

  return asArray(artists).map((artist) => {
    const artistId = String(artist?._id || artist?.id || "").trim();
    const linkedArtworks = artworksByArtist.get(artistId) || [];
    return {
      artist,
      artistId,
      linkedArtworks,
      derived: deriveArtistClassification(artist, linkedArtworks, options),
    };
  });
}

export function selectPilotArtists(rows, limit = 20) {
  const priorityIds = [
    "leonardo-da-vinci",
    "claude-monet",
    "vincent-van-gogh",
    "edvard-munch",
    "alphonse-mucha",
    "rembrandt-van-rijn",
    "johannes-vermeer",
    "katsushika-hokusai",
  ];
  const byId = new Map(rows.map((row) => [row.artistId, row]));
  const selected = priorityIds.map((id) => byId.get(id)).filter(Boolean);
  const selectedIds = new Set(selected.map((row) => row.artistId));
  const remaining = rows
    .filter((row) => !selectedIds.has(row.artistId))
    .sort(
      (left, right) =>
        right.derived.classified_artwork_count - left.derived.classified_artwork_count ||
        left.artistId.localeCompare(right.artistId),
    );
  return [...selected, ...remaining].slice(0, limit);
}

export { CATEGORY_CATALOG_VERSION, CATEGORY_GROUPS, REGION_TERMS };
