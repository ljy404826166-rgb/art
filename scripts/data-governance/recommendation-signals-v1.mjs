export const RECOMMENDATION_SIGNAL_VERSION = "recommendation-signals-v1";
export const RECOMMENDATION_RANDOM_VERSION = "fnv1a-v1";
export const RECOMMENDATION_BUCKET_COUNT = 10000;

const SIGNAL_DEFINITION_ROWS = [
  ["signal-era-late-19th-century", "19世纪末", "chronology"],
  ["signal-era-early-20th-century", "20世纪初", "chronology"],
  ["signal-period-arles", "阿尔勒时期", "artist_period"],
  ["signal-period-argenteuil", "阿让特伊时期", "artist_period"],
  ["signal-period-auvers", "奥维尔时期", "artist_period"],
  ["signal-motif-notre-dame-paris", "巴黎圣母院", "motif"],
  ["signal-series-poplars", "白杨树系列", "series"],
  ["signal-palette-grass-green", "草绿色调", "palette"],
  ["signal-palette-orange", "橙色调", "palette"],
  ["signal-activity-fishing", "垂钓", "activity"],
  ["signal-theme-oriental", "东方题材", "cultural_theme"],
  ["signal-activity-sewing", "缝纫", "activity"],
  ["signal-context-florentine-art", "佛罗伦萨艺术", "cultural_theme"],
  ["signal-motif-mount-fuji", "富士山", "motif"],
  ["signal-motif-maids-of-honour", "宫女", "motif"],
  ["signal-motif-ornamental-gourd", "观赏葫芦", "motif"],
  ["signal-visual-light-color-study", "光色研究", "visual_language"],
  ["signal-design-poster-decorative", "海报或装饰设计", "design_theme"],
  ["signal-theme-waka", "和歌", "cultural_theme"],
  ["signal-visual-black-white", "黑白构成", "visual_language"],
  ["signal-palette-red", "红色调", "palette"],
  ["signal-setting-outdoors", "户外", "setting"],
  ["signal-motif-flowers-fruit", "花卉或水果", "motif"],
  ["signal-theme-bird-flower-painting", "花鸟画", "cultural_theme"],
  ["signal-theme-flora-fauna", "花鸟虫兽", "cultural_theme"],
  ["signal-theme-spanish-romanticism", "西班牙浪漫主义", "cultural_theme"],
  ["signal-theme-british-romanticism", "英国浪漫主义", "cultural_theme"],
  ["signal-theme-french-romanticism", "法国浪漫主义", "cultural_theme"],
  ["signal-theme-american-impressionism", "美国印象主义", "cultural_theme"],
  ["signal-theme-modernism-pioneer", "现代主义先驱", "cultural_theme"],
  ["signal-theme-german-romanticism", "德国浪漫主义", "cultural_theme"],
  ["signal-theme-netherlandish-renaissance", "尼德兰文艺复兴", "cultural_theme"],
  ["signal-theme-hudson-river-school", "哈德逊河画派", "cultural_theme"],
  ["signal-theme-american-landscape", "美国风景画", "cultural_theme"],
  ["signal-theme-british-portraiture", "英国肖像画", "cultural_theme"],
  ["signal-theme-spanish-renaissance", "西班牙文艺复兴", "cultural_theme"],
  ["signal-theme-early-netherlandish", "早期尼德兰绘画", "cultural_theme"],
  ["signal-theme-german-expressionism", "德国表现主义", "cultural_theme"],
  ["signal-theme-orphism", "奥菲主义", "cultural_theme"],
  ["signal-theme-aestheticism", "唯美主义", "cultural_theme"],
  ["signal-setting-garden", "花园", "setting"],
  ["signal-palette-gray", "灰调色调", "palette"],
  ["signal-visual-geometric-form", "几何形态", "visual_language"],
  ["signal-palette-golden-yellow", "金黄色调", "palette"],
  ["signal-motif-goldfish", "金鱼", "motif"],
  ["signal-theme-nishiki-e", "锦绘", "cultural_theme"],
  ["signal-setting-cafe", "咖啡馆", "setting"],
  ["signal-palette-blue", "蓝色调", "palette"],
  ["signal-palette-blue-violet", "蓝紫色调", "palette"],
  ["signal-design-chapel", "礼拜堂设计", "design_theme"],
  ["signal-series-roulin-family", "鲁兰家族", "series"],
  ["signal-activity-travel", "旅行", "activity"],
  ["signal-series-martinique-women", "马提尼克女子", "series"],
  ["signal-series-famous-bridges", "名桥", "series"],
  ["signal-theme-famous-places", "名胜", "cultural_theme"],
  ["signal-palette-ink-green", "墨绿色调", "palette"],
  ["signal-motif-women", "女性", "motif"],
  ["signal-motif-madame-de-pompadour", "蓬巴杜夫人", "motif"],
  ["signal-visual-flat-structure", "平面结构", "visual_language"],
  ["signal-palette-cyan-green", "青绿色调", "palette"],
  ["signal-motif-begonia", "秋海棠", "motif"],
  ["signal-visual-figure-relationships", "人物关系", "visual_language"],
  ["signal-palette-milky-white", "乳白色调", "palette"],
  ["signal-visual-color", "色彩", "visual_language"],
  ["signal-visual-color-experiment", "色彩实验", "visual_language"],
  ["signal-design-general", "设计", "design_theme"],
  ["signal-design-study", "设计稿", "design_theme"],
  ["signal-palette-dark-gray", "深灰色调", "palette"],
  ["signal-palette-dark-blue", "深蓝色调", "palette"],
  ["signal-period-saint-remy", "圣雷米时期", "artist_period"],
  ["signal-theme-poetry-painting", "诗画", "cultural_theme"],
  ["signal-motif-letters", "书信", "motif"],
  ["signal-visual-two-figure-composition", "双人构图", "visual_language"],
  ["signal-setting-waterscape", "水景", "setting"],
  ["signal-format-drawing-or-print", "素描或版画", "design_theme"],
  ["signal-visual-perspective-study", "透视研究", "visual_language"],
  ["signal-place-vence", "旺斯", "setting"],
  ["signal-series-venice", "威尼斯系列", "series"],
  ["signal-period-vetheuil", "韦特伊时期", "artist_period"],
  ["signal-theme-warrior-prints", "武者绘", "cultural_theme"],
  ["signal-activity-laundress", "洗衣女", "activity"],
  ["signal-theme-exotic", "异域题材", "cultural_theme"],
  ["signal-visual-impressionist-color", "印象派色彩", "visual_language"],
  ["signal-visual-movement", "运动", "visual_language"],
  ["signal-palette-umber-brown", "赭棕色调", "palette"],
  ["signal-series-waterfalls-of-the-provinces", "诸国瀑布巡游", "series"],
  ["signal-setting-nature", "自然", "setting"],
  ["signal-design-total-art", "总体艺术", "design_theme"],
];

export const RECOMMENDATION_SIGNAL_TYPES = {
  palette: "色彩倾向",
  visual_language: "视觉语言",
  setting: "场景与环境",
  motif: "图像母题",
  activity: "人物活动",
  cultural_theme: "文化主题",
  chronology: "宽泛年代",
  artist_period: "画家创作阶段",
  series: "系列与专题",
  design_theme: "设计与形式专题",
};

export function buildRecommendationSignalCatalog() {
  return SIGNAL_DEFINITION_ROWS.map(([id, label, type], index) => ({
    _id: id,
    type,
    label_zh: label,
    aliases: [label],
    description: `${RECOMMENDATION_SIGNAL_TYPES[type]}推荐信号`,
    review_status: "reviewed",
    publish_status: "published",
    usage_scopes: ["recommendation", "search"],
    classification_filter: false,
    sort_order: (index + 1) * 10,
    version: RECOMMENDATION_SIGNAL_VERSION,
  }));
}

export function buildRecommendationSignalIndex(signals) {
  const index = new Map();
  signals.forEach((signal) => {
    [signal.label_zh, ...(signal.aliases || [])].forEach((label) => {
      const normalized = String(label || "")
        .normalize("NFKC")
        .trim();
      if (!normalized) return;
      if (!index.has(normalized)) index.set(normalized, []);
      if (!index.get(normalized).includes(signal._id)) {
        index.get(normalized).push(signal._id);
      }
    });
  });
  return index;
}

export function stableRecommendationBucket(artworkId, bucketCount = RECOMMENDATION_BUCKET_COUNT) {
  const normalizedBucketCount = Math.max(1, Math.floor(Number(bucketCount) || 1));
  const text = `${RECOMMENDATION_RANDOM_VERSION}:${String(artworkId || "")}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % normalizedBucketCount;
}

function hasArtworkImage(artwork) {
  return Boolean(
    artwork.thumbnail_url ||
    artwork.display_url ||
    artwork.image_url ||
    artwork.cloud_file_id ||
    artwork.image,
  );
}

function hasArtworkTitle(artwork) {
  return Boolean(artwork.title_cn || artwork.title_zh || artwork.title_en || artwork.title);
}

function hasDescription(artwork) {
  return Boolean(artwork.description || artwork.description_zh || artwork.summary);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function deriveRecommendationArtwork({
  artwork,
  normalizedArtwork,
  signalIds = [],
  updatedAt = "2026-07-28T00:00:00.000Z",
}) {
  const relationIds = [
    ...asArray(normalizedArtwork.classification_ids),
    ...asArray(normalizedArtwork.tag_ids),
    ...asArray(normalizedArtwork.artist_ids),
    ...signalIds,
  ];
  const reasons = [];
  if (String(artwork.status || "") !== "published") reasons.push("not_published");
  if (!hasArtworkImage(artwork)) reasons.push("missing_image");
  if (!relationIds.length) reasons.push("missing_recommendation_dimensions");

  const qualityScore =
    (hasArtworkImage(artwork) ? 0.45 : 0) +
    (hasArtworkTitle(artwork) ? 0.15 : 0) +
    (asArray(normalizedArtwork.artist_ids).length ? 0.15 : 0) +
    (asArray(normalizedArtwork.classification_ids).length ||
    asArray(normalizedArtwork.tag_ids).length
      ? 0.15
      : 0) +
    (hasDescription(artwork) ? 0.1 : 0);

  return {
    _id: artwork._id,
    recommendation_signal_ids: [...new Set(signalIds)].sort(),
    recommendation_status: reasons.length ? "ineligible" : "eligible",
    recommendation_ineligibility_reasons: reasons,
    recommendation_quality_score: Number(qualityScore.toFixed(2)),
    random_bucket: stableRecommendationBucket(artwork._id),
    recommendation_signal_version: RECOMMENDATION_SIGNAL_VERSION,
    recommendation_random_version: RECOMMENDATION_RANDOM_VERSION,
    recommendation_updated_at: updatedAt,
  };
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

export function buildChannelStats(artworkIds, artworkById) {
  const artists = new Map();
  artworkIds.forEach((artworkId) => {
    const artwork = artworkById.get(artworkId);
    asArray(artwork?.artist_ids).forEach((artistId) => {
      artists.set(artistId, (artists.get(artistId) || 0) + 1);
    });
  });
  const sortedArtists = [...artists.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  return {
    artwork_count: artworkIds.length,
    unique_artist_count: artists.size,
    top_artist_id: sortedArtists[0]?.[0] || "",
    top_artist_count: sortedArtists[0]?.[1] || 0,
    top_artist_share: ratio(sortedArtists[0]?.[1] || 0, artworkIds.length),
  };
}

export function deriveChannelPolicy(stats, { forceArtistId = "" } = {}) {
  const artistFocusId = forceArtistId || (stats.top_artist_share >= 0.7 ? stats.top_artist_id : "");
  const channelMode = artistFocusId ? "artist_focus" : "cross_artist";
  const capacityReady = stats.artwork_count >= 8;
  const diversityReady =
    channelMode === "artist_focus"
      ? Boolean(artistFocusId)
      : stats.unique_artist_count >= 3 && stats.top_artist_share <= 0.65;
  return {
    channel_mode: channelMode,
    artist_scope_id: artistFocusId,
    capacity_ready: capacityReady,
    diversity_ready: diversityReady,
    auto_feature_eligible: capacityReady && diversityReady,
    channel_status: capacityReady ? "published" : "long_tail",
  };
}
