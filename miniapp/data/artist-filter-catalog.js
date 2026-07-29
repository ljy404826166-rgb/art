const { CATEGORY_CATALOG_VERSION, CATEGORY_GROUPS } = require("./category-catalog");

const ARTIST_FILTER_CATALOG_VERSION = `${CATEGORY_CATALOG_VERSION}-artists-20260729`;

const REGION_TAGS = [
  { id: "region-europe", label: "欧洲", count: 107 },
  { id: "region-north-america", label: "北美", count: 9 },
  { id: "region-asia", label: "亚洲", count: 2 },
  { id: "region-other", label: "其他", count: 14 },
];

const ARTIST_TAG_COUNTS = {
  style: {
    "style-impressionism": 10,
    "style-symbolism": 10,
    "style-neoclassicism": 8,
    "style-realism": 10,
    "style-renaissance": 10,
    "style-romanticism": 5,
    "style-academicism": 5,
    "style-baroque": 5,
    "style-dutch-golden-age": 4,
    "style-expressionism": 3,
    "style-modernism": 4,
    "style-post-impressionism": 4,
    "style-art-nouveau": 3,
    "style-fauvism": 2,
    "style-rococo": 3,
    "style-french-romanticism": 2,
    "style-hudson-river-school": 2,
    "style-netherlandish-renaissance": 2,
    "style-american-impressionism": 1,
    "style-british-romanticism": 1,
    "style-commercial-art": 1,
    "style-german-expressionism": 1,
    "style-german-romanticism": 1,
    "style-historicism": 1,
    "style-italian-baroque": 1,
    "style-orphism": 1,
    "style-spanish-baroque": 1,
    "style-spanish-renaissance": 1,
    "style-spanish-romanticism": 1,
    "style-ukiyo-e": 1,
    "style-venetian-school": 1,
    "style-vienna-secession": 1,
    "style-viennese-modernism": 1,
  },
  subject: {
    "subject-portrait": 43,
    "subject-landscape": 47,
    "subject-figure": 36,
    "subject-history-painting": 11,
    "subject-poster-design": 6,
    "subject-christian": 5,
    "subject-still-life": 8,
    "subject-decorative-design": 6,
    "subject-figure-study": 4,
    "subject-nude": 5,
    "subject-genre-scene": 23,
    "subject-self-portrait": 6,
    "subject-reading": 5,
    "subject-madonna-and-child": 3,
    "subject-mythological": 8,
    "subject-narrative": 3,
    "subject-religious": 12,
    "subject-animal": 6,
    "subject-abstract": 5,
    "subject-architectural-landscape": 1,
    "subject-bathers": 6,
    "subject-botanical": 1,
    "subject-dance": 1,
    "subject-garden-landscape": 1,
    "subject-graphic-design": 1,
    "subject-illustration": 4,
    "subject-interior": 1,
    "subject-life": 1,
    "subject-marine-life": 2,
    "subject-psychological-emotion": 1,
    "subject-riverside-landscape": 1,
    "subject-urban-landscape": 1,
  },
  decade: {
    "period-1430s": 1,
    "period-1460s": 1,
    "period-1470s": 2,
    "period-1480s": 2,
    "period-1490s": 3,
    "period-1500s": 3,
    "period-1510s": 2,
    "period-1520s": 1,
    "period-1530s": 1,
    "period-1590s": 1,
    "period-1600s": 1,
    "period-1610s": 2,
    "period-1620s": 1,
    "period-1630s": 3,
    "period-1640s": 1,
    "period-1650s": 2,
    "period-1660s": 3,
    "period-1670s": 1,
    "period-1760s": 1,
    "period-1770s": 1,
    "period-1780s": 1,
    "period-1790s": 3,
    "period-1800s": 3,
    "period-1810s": 4,
    "period-1820s": 4,
    "period-1830s": 1,
    "period-1840s": 2,
    "period-1850s": 2,
    "period-1860s": 4,
    "period-1870s": 9,
    "period-1880s": 10,
    "period-1890s": 14,
    "period-1900s": 7,
    "period-1910s": 10,
    "period-1920s": 6,
    "period-1930s": 4,
    "period-1940s": 3,
    "period-1950s": 1,
    "period-1960s": 1,
  },
};

const GROUP_NAMES = {
  style: "流派",
  subject: "作品题材",
};

const ARTIST_TAXONOMY_GROUP_KEYS = new Set(["style", "subject"]);

const taxonomyGroups = CATEGORY_GROUPS.filter((group) =>
  ARTIST_TAXONOMY_GROUP_KEYS.has(group.key),
).map((group) => ({
  key: group.key,
  name: GROUP_NAMES[group.key] || group.name,
  tags: group.tags
    .filter((tag) => ARTIST_TAG_COUNTS[group.key][tag.id] > 0)
    .map((tag) => ({
      ...tag,
      count: ARTIST_TAG_COUNTS[group.key][tag.id],
    })),
}));

const ARTIST_FILTER_GROUPS = [
  { key: "region", name: "地区", tags: REGION_TAGS },
  ...taxonomyGroups,
];

const ARTIST_CLASSIFICATION_LABELS = Object.fromEntries([
  ...REGION_TAGS.map((tag) => [tag.id, tag.label]),
  ...CATEGORY_GROUPS.flatMap((group) => group.tags.map((tag) => [tag.id, tag.label])),
]);

module.exports = {
  ARTIST_CLASSIFICATION_LABELS,
  ARTIST_FILTER_CATALOG_VERSION,
  ARTIST_FILTER_GROUPS,
};
