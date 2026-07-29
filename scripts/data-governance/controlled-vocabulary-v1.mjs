import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

export const CONTROLLED_VOCABULARY_VERSION = "controlled-vocabulary-v2";
export const TARGET_CLASSIFICATION_VERSION = "classification-v7";

export const DIMENSION_POLICIES = {
  style: {
    label_zh: "流派",
    id_prefix: "style-",
    classification_page: true,
    recommendation: true,
  },
  subject: {
    label_zh: "题材",
    id_prefix: "subject-",
    classification_page: true,
    recommendation: true,
  },
  medium: {
    label_zh: "媒介",
    id_prefix: "medium-",
    classification_page: false,
    recommendation: true,
  },
  technique: {
    label_zh: "技法",
    id_prefix: "technique-",
    classification_page: false,
    recommendation: true,
  },
  support: {
    label_zh: "载体",
    id_prefix: "support-",
    classification_page: false,
    recommendation: true,
  },
  format: {
    label_zh: "形式",
    id_prefix: "format-",
    classification_page: false,
    recommendation: true,
  },
  series: {
    label_zh: "系列",
    id_prefix: "series-",
    classification_page: false,
    recommendation: true,
  },
  period: {
    label_zh: "年代与时期",
    id_prefix: "period-",
    classification_page: true,
    recommendation: true,
  },
  region: {
    label_zh: "地区",
    id_prefix: "region-",
    classification_page: false,
    recommendation: true,
  },
  country: {
    label_zh: "国家",
    id_prefix: "country-",
    classification_page: false,
    recommendation: true,
  },
  rights: {
    label_zh: "权利状态",
    id_prefix: "rights-",
    classification_page: false,
    recommendation: false,
  },
  collection: {
    label_zh: "馆藏",
    id_prefix: "collection-",
    classification_page: false,
    recommendation: false,
  },
  source: {
    label_zh: "数据来源",
    id_prefix: "source-",
    classification_page: false,
    recommendation: false,
  },
};

const ENGLISH_LABELS = {
  "style-impressionism": "Impressionism",
  "style-expressionism": "Expressionism",
  "style-post-impressionism": "Post-Impressionism",
  "style-modernism": "Modernism",
  "style-symbolism": "Symbolism",
  "style-baroque": "Baroque",
  "style-dutch-golden-age": "Dutch Golden Age",
  "style-viennese-modernism": "Viennese Modernism",
  "style-art-nouveau": "Art Nouveau",
  "style-ukiyo-e": "Ukiyo-e",
  "style-vienna-secession": "Vienna Secession",
  "style-renaissance": "Renaissance",
  "style-commercial-art": "Commercial Art",
  "style-historicism": "Historicism",
  "style-neoclassicism": "Neoclassicism",
  "style-italian-baroque": "Italian Baroque",
  "style-spanish-baroque": "Spanish Baroque",
  "style-venetian-school": "Venetian School",
  "style-realism": "Realism",
  "style-romanticism": "Romanticism",
  "style-british-romanticism": "British Romanticism",
  "style-french-romanticism": "French Romanticism",
  "style-spanish-romanticism": "Spanish Romanticism",
  "style-german-romanticism": "German Romanticism",
  "style-american-impressionism": "American Impressionism",
  "style-netherlandish-renaissance": "Netherlandish Renaissance",
  "style-hudson-river-school": "Hudson River School",
  "style-spanish-renaissance": "Spanish Renaissance",
  "style-orphism": "Orphism",
  "style-german-expressionism": "German Expressionism",
  "style-academicism": "Academic Art",
  "style-fauvism": "Fauvism",
  "style-rococo": "Rococo",
  "style-northern-renaissance": "Northern Renaissance",
  "subject-figure": "Figure",
  "subject-portrait": "Portrait",
  "subject-landscape": "Landscape",
  "subject-genre-scene": "Genre Scene",
  "subject-abstract": "Abstract",
  "subject-still-life": "Still Life",
  "subject-nude": "Nude",
  "subject-figure-study": "Figure Study",
  "subject-life": "Life Theme",
  "subject-religious": "Religious",
  "subject-psychological-emotion": "Psychological Emotion",
  "subject-poster-design": "Poster Design",
  "subject-dance": "Dance",
  "subject-bathers": "Bathers",
  "subject-decorative-design": "Decorative Design",
  "subject-mythological": "Mythological",
  "subject-animal": "Animal",
  "subject-interior": "Interior",
  "subject-narrative": "Narrative",
  "subject-architectural-landscape": "Architectural Landscape",
  "subject-garden-landscape": "Garden Landscape",
  "subject-illustration": "Illustration",
  "subject-self-portrait": "Self-Portrait",
  "subject-floral": "Floral",
  "subject-reading": "Reading",
  "subject-history-painting": "History Painting",
  "subject-equestrian": "Equestrian",
  "subject-children": "Children",
  "subject-christian": "Christian",
  "subject-literary": "Literary",
  "subject-madonna-and-child": "Madonna and Child",
  "subject-graphic-design": "Graphic Design",
  "subject-seascape": "Seascape",
  "subject-riverside-landscape": "Riverside Landscape",
  "subject-allegorical": "Allegorical",
  "subject-theatrical": "Theatrical",
  "subject-botanical": "Botanical",
  "subject-giverny-garden": "Giverny Garden",
  "subject-psychological": "Psychological",
  "subject-caricature": "Caricature Portrait",
  "subject-urban-landscape": "Urban Landscape",
  "subject-marine-life": "Marine Life",
};

const ALIASES_BY_ID = {
  "style-impressionism": ["印象主义", "Impressionist"],
  "style-expressionism": ["表现派"],
  "style-post-impressionism": ["后印象主义"],
  "style-modernism": ["现代派"],
  "style-symbolism": ["象征派"],
  "style-baroque": ["巴洛克艺术"],
  "style-art-nouveau": ["新艺术"],
  "style-ukiyo-e": ["浮世绘", "日本浮世绘"],
  "style-renaissance": ["文艺复兴艺术"],
  "style-neoclassicism": ["新古典派"],
  "style-realism": ["写实主义"],
  "style-romanticism": ["浪漫派"],
  "style-british-romanticism": ["British Romanticism"],
  "style-french-romanticism": ["French Romanticism"],
  "style-spanish-romanticism": ["Spanish Romanticism"],
  "style-german-romanticism": ["German Romanticism"],
  "style-american-impressionism": ["American Impressionism"],
  "style-netherlandish-renaissance": ["Netherlandish Renaissance"],
  "style-hudson-river-school": ["Hudson River School", "美国风景画"],
  "style-spanish-renaissance": ["Spanish Renaissance"],
  "style-orphism": ["Orphism"],
  "style-german-expressionism": ["German Expressionism"],
  "style-academicism": ["学院主义", "学院艺术"],
  "style-rococo": ["洛可可艺术"],
  "style-fauvism": ["野兽主义"],
  "subject-figure": ["人物"],
  "subject-portrait": ["肖像"],
  "subject-landscape": ["风景", "自然风景", "光色风景"],
  "subject-genre-scene": ["风俗画", "现代生活", "家庭", "巴黎生活", "江户生活"],
  "subject-abstract": ["抽象艺术"],
  "subject-still-life": ["静物", "花果", "水果", "日常器物"],
  "subject-nude": ["裸体", "人体", "女性人体", "男性人体"],
  "subject-figure-study": ["人物研究", "人物速写", "人物素描", "手部习作"],
  "subject-religious": ["宗教艺术", "宗教画"],
  "subject-psychological-emotion": ["情绪题材"],
  "subject-poster-design": ["海报艺术", "海报"],
  "subject-dance": ["芭蕾", "舞者", "舞蹈"],
  "subject-bathers": ["沐浴", "浴女", "浴女与人体"],
  "subject-decorative-design": ["装饰性", "装饰构成", "装饰纹样"],
  "subject-mythological": ["神话"],
  "subject-animal": ["动物", "马"],
  "subject-interior": ["室内", "室内光线", "室内人物"],
  "subject-narrative": ["叙事画", "叙事"],
  "subject-illustration": ["插图", "博物插图"],
  "subject-floral": ["花卉", "玫瑰"],
  "subject-reading": ["阅读"],
  "subject-equestrian": ["赛马"],
  "subject-children": ["儿童", "母子与儿童"],
  "subject-christian": ["基督"],
  "subject-literary": ["文学"],
  "subject-allegorical": ["寓意"],
  "subject-theatrical": ["表演"],
  "subject-botanical": ["植物"],
  "subject-caricature": ["讽刺画"],
};

const PARENT_BY_ID = {
  "style-italian-baroque": "style-baroque",
  "style-spanish-baroque": "style-baroque",
  "style-northern-renaissance": "style-renaissance",
  "style-netherlandish-renaissance": "style-northern-renaissance",
  "style-spanish-renaissance": "style-renaissance",
  "style-venetian-school": "style-renaissance",
  "style-british-romanticism": "style-romanticism",
  "style-french-romanticism": "style-romanticism",
  "style-spanish-romanticism": "style-romanticism",
  "style-german-romanticism": "style-romanticism",
  "style-american-impressionism": "style-impressionism",
  "style-hudson-river-school": "style-romanticism",
  "style-german-expressionism": "style-expressionism",
  "subject-portrait": "subject-figure",
  "subject-self-portrait": "subject-portrait",
  "subject-nude": "subject-figure",
  "subject-figure-study": "subject-figure",
  "subject-bathers": "subject-nude",
  "subject-children": "subject-figure",
  "subject-seascape": "subject-landscape",
  "subject-riverside-landscape": "subject-landscape",
  "subject-garden-landscape": "subject-landscape",
  "subject-giverny-garden": "subject-garden-landscape",
  "subject-architectural-landscape": "subject-landscape",
  "subject-urban-landscape": "subject-landscape",
  "subject-christian": "subject-religious",
  "subject-madonna-and-child": "subject-christian",
  "subject-psychological-emotion": "subject-psychological",
  "subject-equestrian": "subject-animal",
  "subject-marine-life": "subject-animal",
};

const ADDITIONAL_TERMS = [
  {
    _id: "subject-group-portrait",
    type: "subject",
    label_zh: "群体肖像",
    label_en: "Group Portrait",
    aliases: ["人物群像", "群像"],
    parent_id: "subject-portrait",
  },
  {
    _id: "subject-music",
    type: "subject",
    label_zh: "音乐题材",
    label_en: "Music",
    aliases: ["音乐", "乐器", "演奏"],
  },
  {
    _id: "subject-labor",
    type: "subject",
    label_zh: "劳动题材",
    label_en: "Labor",
    aliases: ["劳动"],
  },
  {
    _id: "subject-costume-fashion",
    type: "subject",
    label_zh: "服饰与时尚",
    label_en: "Costume and Fashion",
    aliases: ["服装研究", "服饰", "时尚"],
  },
  {
    _id: "medium-oil-painting",
    type: "medium",
    label_zh: "油画",
    label_en: "Oil Painting",
    aliases: ["布面油画", "木板油画", "Oil on canvas", "Oil on panel"],
  },
  {
    _id: "medium-drawing",
    type: "medium",
    label_zh: "素描",
    label_en: "Drawing",
    aliases: ["纸本素描", "Drawing"],
  },
  {
    _id: "medium-print",
    type: "medium",
    label_zh: "版画",
    label_en: "Print",
    aliases: ["黑白版画", "Print"],
  },
  {
    _id: "medium-watercolor",
    type: "medium",
    label_zh: "水彩",
    label_en: "Watercolor",
    aliases: ["水彩画", "Watercolour"],
  },
  {
    _id: "medium-gouache",
    type: "medium",
    label_zh: "水粉",
    label_en: "Gouache",
    aliases: ["水粉画"],
  },
  {
    _id: "medium-pastel",
    type: "medium",
    label_zh: "粉彩",
    label_en: "Pastel",
    aliases: ["粉彩画"],
  },
  {
    _id: "medium-ink",
    type: "medium",
    label_zh: "墨绘",
    label_en: "Ink",
    aliases: ["水墨", "墨水"],
  },
  {
    _id: "medium-tempera",
    type: "medium",
    label_zh: "蛋彩",
    label_en: "Tempera",
    aliases: ["蛋彩画"],
  },
  {
    _id: "medium-mixed-media",
    type: "medium",
    label_zh: "混合媒介",
    label_en: "Mixed Media",
    aliases: ["综合材料"],
  },
  {
    _id: "medium-mural",
    type: "medium",
    label_zh: "壁画",
    label_en: "Mural",
    aliases: [],
  },
  {
    _id: "technique-etching",
    type: "technique",
    label_zh: "蚀刻",
    label_en: "Etching",
    aliases: ["蚀刻版画"],
    parent_id: "medium-print",
  },
  {
    _id: "technique-lithography",
    type: "technique",
    label_zh: "石版画",
    label_en: "Lithography",
    aliases: ["石印"],
    parent_id: "medium-print",
  },
  {
    _id: "technique-woodcut",
    type: "technique",
    label_zh: "木刻",
    label_en: "Woodcut",
    aliases: ["木版画"],
    parent_id: "medium-print",
  },
  {
    _id: "technique-engraving",
    type: "technique",
    label_zh: "雕版",
    label_en: "Engraving",
    aliases: ["雕版画"],
    parent_id: "medium-print",
  },
  {
    _id: "technique-line-drawing",
    type: "technique",
    label_zh: "线描",
    label_en: "Line Drawing",
    aliases: ["线描与习作"],
    parent_id: "medium-drawing",
  },
  {
    _id: "technique-cut-paper",
    type: "technique",
    label_zh: "剪纸",
    label_en: "Cut Paper",
    aliases: ["剪纸艺术"],
  },
  {
    _id: "technique-collage",
    type: "technique",
    label_zh: "拼贴",
    label_en: "Collage",
    aliases: ["拼贴艺术"],
  },
  {
    _id: "support-paper",
    type: "support",
    label_zh: "纸本",
    label_en: "Paper",
    aliases: ["纸本作品", "纸本风景", "纸本肖像"],
  },
  {
    _id: "support-canvas",
    type: "support",
    label_zh: "画布",
    label_en: "Canvas",
    aliases: ["布面"],
  },
  {
    _id: "support-panel",
    type: "support",
    label_zh: "木板",
    label_en: "Panel",
    aliases: ["板面"],
  },
  {
    _id: "format-study",
    type: "format",
    label_zh: "习作",
    label_en: "Study",
    aliases: ["准备素描", "构图习作", "局部研究", "构图研究", "造型研究"],
  },
  {
    _id: "format-album-leaf",
    type: "format",
    label_zh: "册页",
    label_en: "Album Leaf",
    aliases: [],
  },
  {
    _id: "format-book-design",
    type: "format",
    label_zh: "书籍设计",
    label_en: "Book Design",
    aliases: ["书籍装帧"],
  },
  {
    _id: "series-water-lilies",
    type: "series",
    label_zh: "睡莲系列",
    label_en: "Water Lilies",
    aliases: [],
    artist_id: "claude-monet",
  },
  {
    _id: "series-haystacks",
    type: "series",
    label_zh: "麦垛系列",
    label_en: "Haystacks",
    aliases: [],
    artist_id: "claude-monet",
  },
  {
    _id: "series-rouen-cathedral",
    type: "series",
    label_zh: "鲁昂大教堂系列",
    label_en: "Rouen Cathedral",
    aliases: [],
    artist_id: "claude-monet",
  },
  {
    _id: "series-london",
    type: "series",
    label_zh: "伦敦系列",
    label_en: "London Series",
    aliases: [],
    artist_id: "claude-monet",
  },
  {
    _id: "series-thirty-six-views-mount-fuji",
    type: "series",
    label_zh: "富岳三十六景",
    label_en: "Thirty-six Views of Mount Fuji",
    aliases: [],
    artist_id: "katsushika-hokusai",
  },
  {
    _id: "rights-public-domain",
    type: "rights",
    label_zh: "公共领域",
    label_en: "Public Domain",
    aliases: ["公版图像", "公版", "Public domain"],
  },
  {
    _id: "region-europe",
    type: "region",
    label_zh: "欧洲",
    label_en: "Europe",
    aliases: [],
  },
  {
    _id: "region-north-america",
    type: "region",
    label_zh: "北美",
    label_en: "North America",
    aliases: [],
  },
  {
    _id: "region-asia",
    type: "region",
    label_zh: "亚洲",
    label_en: "Asia",
    aliases: [],
  },
  {
    _id: "region-other",
    type: "region",
    label_zh: "其他地区",
    label_en: "Other Regions",
    aliases: [],
  },
  {
    _id: "country-france",
    type: "country",
    label_zh: "法国",
    label_en: "France",
    aliases: ["法国艺术"],
    parent_id: "region-europe",
  },
  {
    _id: "country-italy",
    type: "country",
    label_zh: "意大利",
    label_en: "Italy",
    aliases: ["意大利艺术"],
    parent_id: "region-europe",
  },
  {
    _id: "country-netherlands",
    type: "country",
    label_zh: "荷兰",
    label_en: "Netherlands",
    aliases: ["荷兰艺术"],
    parent_id: "region-europe",
  },
  {
    _id: "country-japan",
    type: "country",
    label_zh: "日本",
    label_en: "Japan",
    aliases: ["日本艺术"],
    parent_id: "region-asia",
  },
  ...[15, 16, 17, 18, 19, 20].map((century) => ({
    _id: `period-${century}th-century`,
    type: "period",
    period_kind: "century",
    label_zh: `${century}世纪`,
    label_en: `${century}th century`,
    aliases: [],
  })),
  {
    _id: "period-edo",
    type: "period",
    period_kind: "era",
    label_zh: "江户时代",
    label_en: "Edo Period",
    aliases: ["江户时期"],
  },
];

export const ARTIST_ALIAS_OVERLAY = {
  塞尚: "artist-607b032dd4",
  "保罗·塞尚": "artist-607b032dd4",
  "Paul Cézanne": "artist-607b032dd4",
  "Paul Cezanne": "artist-607b032dd4",
  雷诺阿: "pierre-auguste-renoir",
  马蒂斯: "henri-matisse",
  蒙克: "edvard-munch",
  莫奈: "claude-monet",
  梵高: "vincent-van-gogh",
  康定斯基: "wassily-kandinsky",
  克里姆特: "gustav-klimt",
  伦勃朗: "rembrandt-van-rijn",
  鲁本斯: "peter-paul-rubens",
  德加: "edgar-degas",
  北斋: "katsushika-hokusai",
};

export const INTERNAL_OR_NOISE_LABELS = new Set([
  "年代不详",
  "媒介推测",
  "西方艺术史",
  "绘画",
  "学院训练",
]);

function cleanText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeVocabularyLabel(value) {
  return cleanText(value)
    .replace(/[“”‘’"'`]/g, "")
    .toLocaleLowerCase("zh-CN");
}

function unique(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function inferBaseType(groupKey) {
  return groupKey === "decade" ? "period" : groupKey;
}

function baseUsageScopes(type, periodKind = "") {
  const scopes = ["search", "metadata"];
  if (DIMENSION_POLICIES[type]?.recommendation) scopes.push("recommendation");
  if (
    DIMENSION_POLICIES[type]?.classification_page &&
    (type !== "period" || periodKind === "decade")
  )
    scopes.push("classification_filter");
  if (type === "rights") scopes.push("eligibility");
  return scopes;
}

function enrichTerm(term, { existing = false, sortOrder = 0 } = {}) {
  const periodKind =
    term.type === "period"
      ? cleanText(term.period_kind || (/^period-\d{4}s$/.test(term._id) ? "decade" : ""))
      : "";
  return {
    _id: cleanText(term._id),
    type: cleanText(term.type),
    period_kind: periodKind,
    label_zh: cleanText(term.label_zh),
    label_en: cleanText(term.label_en),
    aliases: unique(term.aliases || []),
    parent_id: cleanText(term.parent_id),
    artist_id: cleanText(term.artist_id),
    review_status: "reviewed",
    publish_status: existing ? "published" : "draft",
    display_enabled: Boolean(
      existing &&
      DIMENSION_POLICIES[term.type]?.classification_page &&
      (term.type !== "period" || periodKind === "decade"),
    ),
    usage_scopes: baseUsageScopes(term.type, periodKind),
    sort_order: Number(sortOrder || 0),
    taxonomy_version: CONTROLLED_VOCABULARY_VERSION,
    target_classification_version: TARGET_CLASSIFICATION_VERSION,
  };
}

export function loadCategoryCatalog(
  catalogPath = path.resolve(process.cwd(), "miniapp", "data", "category-catalog.js"),
) {
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(catalogPath, "utf8"),
    {
      module,
      exports: module.exports,
    },
    { filename: catalogPath },
  );
  return module.exports;
}

export function buildControlledVocabulary(categoryCatalog = loadCategoryCatalog()) {
  const baseTerms = categoryCatalog.CATEGORY_GROUPS.flatMap((group) =>
    group.tags.map((tag, index) => {
      const type = inferBaseType(group.key);
      const isDecade = type === "period";
      return enrichTerm(
        {
          _id: tag.id,
          type,
          period_kind: isDecade ? "decade" : "",
          label_zh: tag.label,
          label_en: isDecade ? tag.label : ENGLISH_LABELS[tag.id],
          aliases: [
            ...(ALIASES_BY_ID[tag.id] || []),
            ...(isDecade ? [`${String(tag.label).slice(0, 4)}年代`] : []),
          ],
          parent_id: PARENT_BY_ID[tag.id] || "",
        },
        {
          existing: true,
          sortOrder: (index + 1) * 10,
        },
      );
    }),
  );
  const additionalTerms = ADDITIONAL_TERMS.map((term, index) =>
    enrichTerm(term, {
      existing: false,
      sortOrder: 1000 + (index + 1) * 10,
    }),
  );
  return [...baseTerms, ...additionalTerms];
}

export function buildVocabularyIndex(terms) {
  const index = new Map();
  terms.forEach((term) => {
    unique([term.label_zh, term.label_en, ...term.aliases]).forEach((label) => {
      const normalized = normalizeVocabularyLabel(label);
      if (!normalized) return;
      if (!index.has(normalized)) index.set(normalized, []);
      index.get(normalized).push(term._id);
    });
  });
  return index;
}

export function resolveControlledVocabularyLabel(label, terms) {
  return [...new Set(buildVocabularyIndex(terms).get(normalizeVocabularyLabel(label)) || [])];
}

export function validateControlledVocabulary(terms) {
  const errors = [];
  const warnings = [];
  const idCounts = new Map();
  const termById = new Map();
  terms.forEach((term) => {
    idCounts.set(term._id, (idCounts.get(term._id) || 0) + 1);
    termById.set(term._id, term);
    const policy = DIMENSION_POLICIES[term.type];
    if (!policy) errors.push({ code: "unknown_type", term_id: term._id, type: term.type });
    else if (!term._id.startsWith(policy.id_prefix)) {
      errors.push({
        code: "invalid_id_prefix",
        term_id: term._id,
        expected_prefix: policy.id_prefix,
      });
    }
    if (!term.label_zh) errors.push({ code: "missing_label_zh", term_id: term._id });
    if (!term.label_en) warnings.push({ code: "missing_label_en", term_id: term._id });
    if (term.publish_status === "published" && term.review_status !== "reviewed") {
      errors.push({ code: "published_not_reviewed", term_id: term._id });
    }
    if (
      term.usage_scopes.includes("classification_filter") &&
      !(
        ["style", "subject"].includes(term.type) ||
        (term.type === "period" && term.period_kind === "decade")
      )
    )
      errors.push({ code: "invalid_classification_filter_scope", term_id: term._id });
  });
  [...idCounts.entries()]
    .filter(([, count]) => count > 1)
    .forEach(([termId]) => errors.push({ code: "duplicate_term_id", term_id: termId }));

  terms.forEach((term) => {
    if (term.parent_id && !termById.has(term.parent_id)) {
      errors.push({
        code: "missing_parent",
        term_id: term._id,
        parent_id: term.parent_id,
      });
    }
  });

  const aliasConflicts = [...buildVocabularyIndex(terms).entries()]
    .filter(([, ids]) => new Set(ids).size > 1)
    .map(([label, ids]) => ({ label, term_ids: [...new Set(ids)] }));
  aliasConflicts.forEach((conflict) =>
    errors.push({
      code: "alias_conflict",
      ...conflict,
    }),
  );

  return {
    version: CONTROLLED_VOCABULARY_VERSION,
    term_count: terms.length,
    counts_by_type: terms.reduce((result, term) => {
      result[term.type] = (result[term.type] || 0) + 1;
      return result;
    }, {}),
    published_terms: terms.filter((term) => term.publish_status === "published").length,
    draft_terms: terms.filter((term) => term.publish_status === "draft").length,
    classification_filter_terms: terms.filter((term) =>
      term.usage_scopes.includes("classification_filter"),
    ).length,
    published_classification_filter_terms: terms.filter(
      (term) =>
        term.publish_status === "published" && term.usage_scopes.includes("classification_filter"),
    ).length,
    draft_classification_filter_terms: terms.filter(
      (term) =>
        term.publish_status === "draft" && term.usage_scopes.includes("classification_filter"),
    ).length,
    recommendation_terms: terms.filter((term) => term.usage_scopes.includes("recommendation"))
      .length,
    alias_count: [...buildVocabularyIndex(terms).keys()].length,
    errors,
    warnings,
    ok: errors.length === 0,
  };
}

export function buildLegacyTagRouting(legacyRows, terms) {
  return legacyRows.map((row) => {
    const termIds = resolveControlledVocabularyLabel(row.label, terms);
    const explicitArtistId = row.artist_matches?.[0] || ARTIST_ALIAS_OVERLAY[row.label] || "";
    let route_type = "recommendation_signal_candidate";
    let target_ids = [];
    if (termIds.length === 1) {
      route_type = "controlled_vocabulary";
      target_ids = termIds;
    } else if (termIds.length > 1) {
      route_type = "manual_review";
      target_ids = termIds;
    } else if (explicitArtistId) {
      route_type = "artist_dimension";
      target_ids = [explicitArtistId];
    } else if (INTERNAL_OR_NOISE_LABELS.has(row.label)) {
      route_type = "internal_or_noise";
    }
    return {
      label: row.label,
      artwork_count: row.artwork_count,
      route_type,
      target_ids,
      top_artist_id: row.top_artist_id,
      top_artist_share: row.top_artist_share,
    };
  });
}

export function buildArtistDimensionCatalog(artistRows) {
  return artistRows.map((artist) => {
    const isReviewedPerson = artist.entity_type === "person" && artist.review_status === "reviewed";
    const publicEligible = isReviewedPerson && artist.has_artworks;
    let status = "candidate_identity";
    if (artist.review_status === "rejected") status = "rejected";
    else if (artist.entity_type !== "person") status = "non_painter_entity";
    else if (artist.review_status === "reviewed" && !artist.has_artworks) {
      status = "blocked_no_resolved_artworks";
    } else if (publicEligible) status = "eligible";
    return {
      dimension_type: "artist",
      channel_key: `artist:${artist.id}`,
      query_field: "artist_ids",
      target_artist_id: artist.id,
      label: artist.artist_name,
      entity_type: artist.entity_type,
      identity_review_status: artist.review_status,
      artwork_count: artist.artwork_count,
      public_dimension_status: status,
      recommendation_eligible: publicEligible,
      default_home_channel_ready: publicEligible && artist.artwork_count >= 8,
    };
  });
}
