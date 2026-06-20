const fallbackArtworks = [
  {
    _id: "artwork_starry_night",
    supabase_id: "starry_night",
    slug: "starry-night",
    title_cn: "星月夜",
    title_en: "The Starry Night",
    artist: "Vincent van Gogh",
    year_and_place: "1889年，法国圣雷米",
    location: "Museum of Modern Art, New York",
    medium: "布面油画",
    dimensions: "73.7 x 92.1 cm",
    description: "以旋转的夜空、村庄和柏树构成强烈视觉节奏，是后印象派最具代表性的作品之一。",
    tags: ["后印象派", "夜景", "油画"],
    tag_keys: ["后印象派", "夜景", "油画"],
    thumbnail_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/320px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
    display_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/640px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg",
    download_url: "",
    cloud_file_id: "",
    source_name: "Wikimedia Commons",
    source_url: "https://commons.wikimedia.org/",
    status: "published",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    _id: "artwork_girl_pearl",
    supabase_id: "girl_pearl",
    slug: "girl-with-a-pearl-earring",
    title_cn: "戴珍珠耳环的少女",
    title_en: "Girl with a Pearl Earring",
    artist: "Johannes Vermeer",
    year_and_place: "约1665年，荷兰",
    location: "Mauritshuis, The Hague",
    medium: "布面油画",
    dimensions: "44.5 x 39 cm",
    description: "以柔和光线和凝视瞬间著称，常被称为北方的蒙娜丽莎。",
    tags: ["巴洛克", "肖像画", "油画"],
    tag_keys: ["巴洛克", "肖像画", "油画"],
    thumbnail_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Meisje_met_de_parel.jpg/320px-Meisje_met_de_parel.jpg",
    display_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/d/d7/Meisje_met_de_parel.jpg/640px-Meisje_met_de_parel.jpg",
    download_url: "",
    cloud_file_id: "",
    source_name: "Wikimedia Commons",
    source_url: "https://commons.wikimedia.org/",
    status: "published",
    created_at: "2026-01-02T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  },
  {
    _id: "artwork_great_wave",
    supabase_id: "great_wave",
    slug: "great-wave",
    title_cn: "神奈川冲浪里",
    title_en: "The Great Wave off Kanagawa",
    artist: "Katsushika Hokusai",
    year_and_place: "约1830-1832年，日本",
    location: "The Metropolitan Museum of Art",
    medium: "木版画",
    dimensions: "25.7 x 37.8 cm",
    description: "巨浪与远处富士山形成张力，是浮世绘传播最广的代表作之一。",
    tags: ["浮世绘", "版画", "海浪"],
    tag_keys: ["浮世绘", "版画", "海浪"],
    thumbnail_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/The_Great_Wave_off_Kanagawa.jpg/320px-The_Great_Wave_off_Kanagawa.jpg",
    display_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0a/The_Great_Wave_off_Kanagawa.jpg/640px-The_Great_Wave_off_Kanagawa.jpg",
    download_url: "",
    cloud_file_id: "",
    source_name: "Wikimedia Commons",
    source_url: "https://commons.wikimedia.org/",
    status: "published",
    created_at: "2026-01-03T00:00:00.000Z",
    updated_at: "2026-01-03T00:00:00.000Z",
  },
  {
    _id: "artwork_grainstack",
    supabase_id: "grainstack",
    slug: "grainstack",
    title_cn: "麦垛：雾中太阳",
    title_en: "Grainstack, Sun in the Mist",
    artist: "Claude Monet",
    year_and_place: "1891年",
    location: "Artvee",
    medium: "布面油画",
    dimensions: "尺寸暂未收录",
    description: "莫奈以连续主题观察光线和空气变化，画面强调色彩、雾气和时间流动。",
    tags: ["印象派", "风景", "油画"],
    tag_keys: ["印象派", "风景", "油画"],
    thumbnail_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Claude_Monet_-_Grainstack%2C_Sun_in_the_Mist_-_Google_Art_Project.jpg/320px-Claude_Monet_-_Grainstack%2C_Sun_in_the_Mist_-_Google_Art_Project.jpg",
    display_url:
      "https://upload.wikimedia.org/wikipedia/commons/thumb/6/69/Claude_Monet_-_Grainstack%2C_Sun_in_the_Mist_-_Google_Art_Project.jpg/640px-Claude_Monet_-_Grainstack%2C_Sun_in_the_Mist_-_Google_Art_Project.jpg",
    download_url: "",
    cloud_file_id: "",
    source_name: "Artvee",
    source_url: "https://artvee.com/",
    status: "published",
    created_at: "2026-01-04T00:00:00.000Z",
    updated_at: "2026-01-04T00:00:00.000Z",
  },
];

const fallbackGroups = [
  { name: "流派", tags: ["印象派", "后印象派", "巴洛克", "浮世绘"] },
  { name: "题材", tags: ["肖像画", "风景", "夜景", "海浪"] },
  { name: "媒介", tags: ["油画", "版画", "木版画"] },
];

function normalizeLocation(location) {
  let value = String(location || "").trim();
  if (!value) return "收藏地暂未收录";

  const sourceOnlyLocations = ["artvee", "wikimedia commons"];
  if (sourceOnlyLocations.includes(value.toLowerCase())) {
    return "收藏地暂未收录";
  }

  value = value
    .replace(/相关语境.*$/i, "")
    .replace(/[（(]\s*(推测|推断|估计)\s*[）)]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[，,、；;：:]\s*$/g, "")
    .trim();

  if (!value || sourceOnlyLocations.includes(value.toLowerCase())) {
    return "收藏地暂未收录";
  }

  return value;
}

function normalizeYear(value) {
  const text = String(value || "").trim();
  if (!text) return "年代暂未收录";

  const match = text.match(/(约|大约|约公元|公元|c\.|ca\.|circa)?\s*(\d{3,4})(?:\s*[–—-]\s*(\d{2,4}))?\s*年?/i);
  if (!match) return text.split(/[，,；;]/)[0].trim() || "年代暂未收录";

  const prefix = /^(约|大约)$/i.test(match[1] || "") ? "约" : "";
  const start = match[2];
  const end = match[3] ? `-${match[3]}` : "";
  const hasYearSuffix = /年/.test(match[0]);
  return `${prefix}${start}${end}${hasYearSuffix ? "年" : ""}`;
}

function normalizeMedium(medium) {
  let value = String(medium || "").trim();
  if (!value) return "材质暂未收录";

  value = value
    .replace(/或其?\s*Artvee\s*图像记录/gi, "")
    .replace(/Artvee\s*图像记录/gi, "")
    .replace(/[（(]\s*(推测|推断|估计)\s*[）)]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[，,、；;：:]\s*$/g, "")
    .trim();

  if (!value || /^Artvee$/i.test(value)) return "材质暂未收录";
  return value;
}

function normalizeArtwork(record) {
  const item = record || {};
  const id = item._id || (item.supabase_id ? `artwork_${item.supabase_id}` : "");
  const tags = Array.isArray(item.tag_keys) ? item.tag_keys : Array.isArray(item.tags) ? item.tags : [];
  const title = item.title_cn || item.title || "未命名作品";
  const sourceName = item.source_name || "";

  return {
    _id: id,
    id,
    supabaseId: item.supabase_id || String(id).replace(/^artwork_/, ""),
    title,
    titleCn: title,
    titleEn: item.title_en || "",
    artist: item.artist || "Unknown artist",
    year: normalizeYear(item.year_and_place),
    location: normalizeLocation(item.location),
    medium: normalizeMedium(item.medium),
    dimensions: item.dimensions || "尺寸暂未收录",
    description: item.description || "这条作品资料仍在完善。",
    tags,
    tag_keys: tags,
    cloud_file_id: item.cloud_file_id || "",
    display_url: item.display_url || "",
    download_url: item.download_url || "",
    thumbnail_url: item.thumbnail_url || "",
    imageSrc: item.cloud_file_id || item.display_url || item.thumbnail_url || "",
    sourceName: sourceName || "来源暂未收录",
    sourceUrl: item.source_url || "",
    createdAt: item.created_at || "",
    updatedAt: item.updated_at || "",
  };
}

function fallbackById(id) {
  const wanted = String(id || "");
  return fallbackArtworks.find((item) => item._id === wanted || item.supabase_id === wanted || `artwork_${item.supabase_id}` === wanted) || null;
}

module.exports = {
  fallbackArtworks,
  fallbackGroups,
  fallbackById,
  normalizeArtwork,
};
