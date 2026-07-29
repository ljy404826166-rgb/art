import crypto from "node:crypto";
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

function loadCategoryCatalog() {
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

const { CATEGORY_CATALOG_VERSION, CATEGORY_GROUPS } = loadCategoryCatalog();

const CURRENT_TERMS = CATEGORY_GROUPS.flatMap((group) =>
  group.tags.map((tag) => ({ ...tag, dimension: group.key })),
);
const CURRENT_BY_ID = new Map(CURRENT_TERMS.map((term) => [term.id, term]));

const EXISTING_ALIASES = {
  "style-post-impressionism": ["后印象派", "后印象主义"],
  "style-expressionism": ["表现主义", "表现派"],
  "style-impressionism": ["印象派", "印象主义"],
  "style-modernism": ["现代主义", "现代派"],
  "style-art-nouveau": ["新艺术运动", "新艺术", "art nouveau"],
  "style-neoclassicism": ["新古典主义", "新古典派"],
  "style-renaissance": ["文艺复兴", "文艺复兴艺术"],
  "style-realism": ["现实主义", "写实主义"],
  "style-ukiyo-e": ["日本浮世绘", "浮世绘"],
  "style-baroque": ["巴洛克", "巴洛克艺术"],
  "style-romanticism": ["浪漫主义", "浪漫派"],
  "style-british-romanticism": ["英国浪漫主义"],
  "style-french-romanticism": ["法国浪漫主义"],
  "style-spanish-romanticism": ["西班牙浪漫主义"],
  "style-german-romanticism": ["德国浪漫主义"],
  "style-american-impressionism": ["美国印象主义"],
  "style-netherlandish-renaissance": ["尼德兰文艺复兴"],
  "style-hudson-river-school": ["哈德逊河画派", "美国风景画"],
  "style-spanish-renaissance": ["西班牙文艺复兴"],
  "style-orphism": ["奥菲主义"],
  "style-german-expressionism": ["德国表现主义"],
  "style-symbolism": ["象征主义", "象征派"],
  "style-academicism": ["学院派", "学院主义", "学院艺术"],
  "style-rococo": ["洛可可", "洛可可艺术"],
  "style-fauvism": ["野兽派", "野兽主义"],
  "style-northern-renaissance": ["北方文艺复兴", "北方文艺复兴风格"],
  "style-viennese-modernism": ["维也纳现代主义"],
  "style-vienna-secession": ["维也纳分离派", "维也纳分离主义"],
  "style-historicism": ["历史主义"],
  "style-italian-baroque": ["意大利巴洛克"],
  "style-spanish-baroque": ["西班牙巴洛克"],
  "style-venetian-school": ["威尼斯画派"],
  "subject-landscape": ["风景", "风景画"],
  "subject-figure": ["人物", "人物画"],
  "subject-life": ["生命主题", "生命题材"],
  "subject-still-life": ["静物", "静物画"],
  "subject-portrait": ["肖像", "肖像画"],
  "subject-psychological-emotion": ["心理情绪", "情绪题材"],
  "subject-architectural-landscape": ["建筑景观", "建筑风景"],
  "subject-history-painting": ["历史画", "历史题材"],
  "subject-garden-landscape": ["花园景观", "花园风景"],
  "subject-self-portrait": ["自画像", "自画象"],
  "subject-reading": ["阅读题材", "阅读"],
  "subject-riverside-landscape": ["河岸风景", "河景"],
  "subject-nude": ["裸像", "裸体", "裸体画"],
  "subject-psychological": ["心理题材", "心理主题"],
  "subject-giverny-garden": ["吉维尼花园"],
  "subject-religious": ["宗教题材", "宗教画", "宗教", "宗教艺术"],
  "subject-seascape": ["海景", "海景画"],
  "subject-mythological": ["神话题材", "神话画", "神话"],
  "subject-interior": ["室内场景", "室内画", "室内"],
  "subject-madonna-and-child": ["圣母子", "圣母与圣婴"],
  "subject-christian": ["基督题材", "基督教题材", "基督教"],
  "subject-marine-life": ["海洋生物"],
  "subject-figure-study": ["人物习作", "人物研究", "人体习作"],
  "subject-theatrical": ["戏剧题材", "戏剧"],
  "subject-allegorical": ["寓意画", "寓意题材", "寓言画"],
  "subject-animal": ["动物题材", "动物画", "动物"],
  "subject-urban-landscape": ["城市风景", "城市景观", "都市风景"],
  "subject-poster-design": ["海报设计", "广告海报"],
  "subject-decorative-design": ["装饰设计", "装饰艺术设计"],
  "subject-bathers": ["沐浴者", "沐浴题材"],
  "subject-equestrian": ["赛马与马术", "马术题材"],
  "subject-abstract": ["抽象题材", "抽象艺术"],
  "subject-illustration": ["插画", "插图"],
};

const NEW_CONCEPT_RULES = [
  {
    id: "style-dutch-golden-age",
    dimension: "style",
    label: "荷兰黄金时代",
    patterns: [/^荷兰黄金时代$/u],
  },
  {
    id: "style-commercial-art",
    dimension: "style",
    label: "商业美术",
    patterns: [/^商业美术$/u],
  },
  {
    id: "subject-dance",
    dimension: "subject",
    label: "舞蹈题材",
    patterns: [/舞蹈/u, /舞者/u, /芭蕾/u, /舞会/u],
  },
  {
    id: "subject-caricature",
    dimension: "subject",
    label: "讽刺肖像",
    patterns: [/讽刺肖像/u, /漫画肖像/u, /caricature/iu],
  },
  {
    id: "subject-graphic-design",
    dimension: "subject",
    label: "平面设计",
    patterns: [/^平面设计$/u],
  },
  {
    id: "subject-floral",
    dimension: "subject",
    label: "花卉题材",
    patterns: [/^花卉$/u, /^花朵$/u, /^花束$/u],
  },
  {
    id: "subject-botanical",
    dimension: "subject",
    label: "植物题材",
    patterns: [/植物/u, /植物学/u],
  },
  {
    id: "subject-children",
    dimension: "subject",
    label: "儿童题材",
    patterns: [/儿童/u, /孩子/u, /婴儿/u, /孩童/u, /母子与儿童/u],
  },
  {
    id: "subject-genre-scene",
    dimension: "subject",
    label: "日常生活",
    patterns: [/日常生活/u, /生活场景/u, /风俗画/u, /市井/u, /江户生活/u],
  },
  {
    id: "subject-rural-life",
    dimension: "subject",
    label: "乡村生活",
    patterns: [/乡村生活/u, /农村生活/u, /农民生活/u, /田园生活/u],
  },
  {
    id: "subject-abstract",
    dimension: "subject",
    label: "抽象题材",
    patterns: [/抽象/u, /几何构成/u],
  },
  {
    id: "subject-illustration",
    dimension: "subject",
    label: "插画",
    patterns: [/^插画$/u, /^插图$/u, /^书籍插画$/u],
  },
  {
    id: "subject-music",
    dimension: "subject",
    label: "音乐题材",
    patterns: [/音乐/u, /乐器/u, /演奏/u],
  },
  {
    id: "subject-war",
    dimension: "subject",
    label: "战争题材",
    patterns: [/战争/u, /战役/u, /战斗场景/u],
  },
  {
    id: "subject-narrative",
    dimension: "subject",
    label: "叙事题材",
    patterns: [/^叙事画$/u, /^叙事题材$/u],
  },
  {
    id: "subject-bathers",
    dimension: "subject",
    label: "沐浴者",
    patterns: [/^沐浴$/u, /^沐浴者$/u, /^沐浴题材$/u],
  },
  {
    id: "subject-equestrian",
    dimension: "subject",
    label: "赛马与马术",
    patterns: [/^赛马$/u, /^马术题材$/u, /^赛马与马术$/u, /骑师/u, /赛马场/u],
  },
  {
    id: "subject-literary",
    dimension: "subject",
    label: "文学题材",
    patterns: [/^文学$/u, /^文学题材$/u],
  },
  {
    id: "subject-maritime",
    dimension: "subject",
    label: "航海题材",
    patterns: [/航海/u, /帆船/u, /船只/u, /港口/u],
  },
  {
    id: "subject-costume-fashion",
    dimension: "subject",
    label: "服饰与时尚",
    patterns: [/服饰/u, /时尚/u, /服装设计/u],
  },
];

const MULTI_EXISTING_ALIASES = new Map([
  ["光色风景", ["subject-landscape"]],
  ["自然风景", ["subject-landscape"]],
  ["室内人物", ["subject-interior", "subject-figure"]],
  ["海报或装饰设计", ["subject-poster-design", "subject-decorative-design"]],
  ["母子与儿童", ["subject-figure"]],
  ["花园", ["subject-garden-landscape"]],
  ["礼拜堂设计", ["subject-religious"]],
  ["寓意", ["subject-allegorical"]],
  ["群体肖像", ["subject-portrait", "subject-figure"]],
  ["女性人体", ["subject-nude"]],
  ["浴女", ["subject-nude"]],
  ["浴女与人体", ["subject-nude"]],
  ["人体", ["subject-nude"]],
  ["沐浴", ["subject-bathers", "subject-nude"]],
  ["沐浴者", ["subject-bathers", "subject-nude"]],
  ["赛马", ["subject-equestrian", "subject-animal"]],
  ["马", ["subject-animal"]],
  ["家庭", ["subject-genre-scene"]],
  ["咖啡馆", ["subject-genre-scene"]],
  ["巴黎生活", ["subject-genre-scene"]],
  ["现代生活", ["subject-genre-scene"]],
  ["表演", ["subject-theatrical"]],
  ["人物群像", ["subject-figure"]],
  ["宗教艺术", ["subject-religious"]],
  ["意大利巴洛克", ["style-italian-baroque", "style-baroque"]],
  ["西班牙巴洛克", ["style-spanish-baroque", "style-baroque"]],
  ["威尼斯画派", ["style-venetian-school", "style-renaissance"]],
  ["基督", ["subject-christian"]],
  ["海报艺术", ["subject-poster-design"]],
  ["海报", ["subject-poster-design"]],
  ["装饰构成", ["subject-decorative-design"]],
  ["室内光线", ["subject-interior"]],
  ["水果", ["subject-still-life"]],
]);

const NOISE_RULES = [
  {
    type: "medium",
    patterns: [
      /油画/u,
      /油彩/u,
      /水彩/u,
      /水粉/u,
      /蛋彩/u,
      /素描/u,
      /速写/u,
      /炭笔/u,
      /铅笔/u,
      /粉彩/u,
      /版画/u,
      /木刻/u,
      /石版/u,
      /纸本/u,
      /布面/u,
      /画布/u,
      /蚀刻/u,
      /铜版/u,
      /木版/u,
      /墨水/u,
      /拼贴/u,
      /雕塑/u,
      /陶瓷/u,
      /摄影/u,
      /线描与习作/u,
      /构图习作/u,
      /^线描$/u,
      /^设计稿$/u,
      /^册页$/u,
      /^插图$/u,
      /^锦绘$/u,
      /^墨绘$/u,
    ],
  },
  {
    type: "color",
    patterns: [
      /色调/u,
      /配色/u,
      /色彩/u,
      /单色/u,
      /彩色/u,
      /^(红|橙|黄|绿|蓝|紫|黑|白|灰|金|银|棕|褐)色/u,
    ],
  },
  {
    type: "rights",
    patterns: [/公共领域/u, /公版图像/u, /版权/u, /public domain/iu, /artvee/iu],
  },
  {
    type: "geography",
    patterns: [
      /^(法国|德国|意大利|荷兰|英国|美国|日本|奥地利|俄罗斯|西班牙|比利时|瑞士|挪威|丹麦|瑞典|芬兰|波兰|捷克|匈牙利|墨西哥|中国)艺术$/u,
    ],
  },
  {
    type: "uncertain",
    patterns: [/^暂不明确$/u, /^未知/u, /作者未明确/u, /归属待考/u, /^待审核$/u],
  },
  {
    type: "temporal-metadata",
    patterns: [
      /^\d{1,2}世纪(?:初|中|末)?$/u,
      /^\d{4}年代$/u,
      /^年代不详$/u,
      /^(江户时代|阿尔勒时期|圣雷米时期|奥维尔时期)$/u,
    ],
  },
  {
    type: "collection-or-series",
    patterns: [/系列$/u, /时期作品$/u],
  },
  {
    type: "generic",
    patterns: [
      /^绘画$/u,
      /^西方艺术史$/u,
      /^自然$/u,
      /^平面结构$/u,
      /^光色研究$/u,
      /^媒介推测$/u,
      /^学院训练$/u,
      /^装饰性$/u,
    ],
  },
];

const ALIAS_TO_CURRENT = new Map();
for (const [id, aliases] of Object.entries(EXISTING_ALIASES)) {
  for (const alias of aliases) ALIAS_TO_CURRENT.set(normalizeLabel(alias), id);
}
for (const term of CURRENT_TERMS) ALIAS_TO_CURRENT.set(normalizeLabel(term.label), term.id);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeLabel(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[“”‘’"'`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function cleanDisplayLabel(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,，;；、|/]+|[,，;；、|/]+$/g, "");
}

function splitSignal(value) {
  const text = cleanDisplayLabel(value);
  if (!text) return [];
  return text
    .split(/[,，;；|、]\s*/u)
    .map(cleanDisplayLabel)
    .filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function firstArtworkTitle(artwork) {
  return cleanDisplayLabel(
    artwork?.title_cn || artwork?.title_zh || artwork?.title || artwork?.title_en,
  );
}

function artworkArtistText(artwork) {
  return cleanDisplayLabel(artwork?.raw_artist_text || artwork?.artist || artwork?.artist_display);
}

function artistTextParts(value) {
  const text = cleanDisplayLabel(value);
  if (!text) return [];
  const parts = [
    text,
    text.split(/[（(]/u)[0],
    ...[...text.matchAll(/[（(]([^）)]+)[）)]/gu)].map((match) => match[1].split(",")[0]),
  ];
  return unique(parts.map(normalizeArtistText).filter((part) => part.length >= 2));
}

function normalizeArtistText(value) {
  return normalizeLabel(value)
    .replace(/\b(?:ca\.?\s*)?\d{3,4}\s*[-–—]\s*\d{3,4}\b/giu, "")
    .replace(/[\s·•・,，.。()（）[\]【】\-—–_、:：;；'’"“”/\\]+/g, "");
}

export function extractRawSignals(artwork) {
  const rawValues = [
    ...asArray(artwork?.tags),
    ...asArray(artwork?.tag_labels),
    ...asArray(artwork?.tag_keys),
    artwork?.tags_text,
    artwork?.subject,
    artwork?.genre,
    artwork?.style,
  ];
  return unique(rawValues.flatMap(splitSignal));
}

function matchesNoise(label) {
  for (const rule of NOISE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(label))) return rule.type;
  }
  return "";
}

function looksLikeStyle(label) {
  return /(主义|画派|流派|风格|文艺复兴|巴洛克|洛可可|浮世绘|分离派)$/u.test(label);
}

function looksLikeSubject(label) {
  return /(题材|肖像|风景|人物|静物|花园|花卉|植物|裸体|裸像|宗教|神话|寓意|动物|海景|城市|建筑|室内|舞蹈|舞者|芭蕾|儿童|孩子|婴儿|战争|音乐|帆船|港口|生活|习作|设计)$/u.test(
    label,
  );
}

function newConceptForLabel(label) {
  return (
    NEW_CONCEPT_RULES.find((rule) => rule.patterns.some((pattern) => pattern.test(label))) || null
  );
}

function hashCandidateId(dimension, normalizedLabel) {
  const hash = crypto.createHash("sha1").update(normalizedLabel).digest("hex").slice(0, 10);
  return `${dimension}-candidate-${hash}`;
}

function increment(map, key, artwork, displayLabel) {
  if (!map.has(key)) {
    map.set(key, {
      key,
      label: displayLabel,
      count: 0,
      aliases: new Map(),
      sample_artwork_ids: [],
      seenArtworkIds: new Set(),
    });
  }
  const entry = map.get(key);
  const artworkId = String(artwork._id || artwork.id);
  if (!entry.seenArtworkIds.has(artworkId)) {
    entry.count += 1;
    entry.seenArtworkIds.add(artworkId);
  }
  entry.aliases.set(displayLabel, (entry.aliases.get(displayLabel) || 0) + 1);
  if (entry.sample_artwork_ids.length < 10)
    entry.sample_artwork_ids.push(artwork._id || artwork.id);
}

function finalizeAggregate(entry) {
  return {
    label: entry.label,
    count: entry.count,
    aliases: [...entry.aliases.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([label, count]) => ({ label, count })),
    sample_artwork_ids: entry.sample_artwork_ids,
  };
}

function extractYearCandidates(artwork) {
  const values = [
    artwork?.year,
    artwork?.creation_year,
    artwork?.created_year,
    artwork?.creation_date,
    artwork?.date,
    artwork?.period,
    artwork?.year_and_place,
  ].filter((value) => value !== null && value !== undefined);
  const years = [];
  for (const value of values) {
    for (const match of String(value).matchAll(/(?<!\d)(1[2-9]\d{2}|20\d{2})(?!\d)/g)) {
      const year = Number(match[1]);
      if (year >= 1200 && year <= 2099) years.push(year);
    }
  }
  return unique(years);
}

export function decadeIdForArtwork(artwork) {
  const years = extractYearCandidates(artwork);
  if (!years.length) return "";
  const year = Math.min(...years);
  return `period-${Math.floor(year / 10) * 10}s`;
}

function currentIds(artwork) {
  return unique(
    [...asArray(artwork?.classification_ids), ...asArray(artwork?.tag_ids)].map((value) =>
      String(value || "").trim(),
    ),
  ).filter((id) => CURRENT_BY_ID.has(id));
}

export function analyzeTaxonomy(artworks, options = {}) {
  const currentUsage = Object.fromEntries(CURRENT_TERMS.map((term) => [term.id, 0]));
  const currentRawSupport = Object.fromEntries(CURRENT_TERMS.map((term) => [term.id, 0]));
  const mergeAliases = new Map();
  const newConcepts = new Map();
  const inferredCandidates = new Map();
  const excluded = new Map();
  const unclassified = new Map();
  const artworkSuggestions = new Map();
  const minStyleCount = Number(options.minStyleCount || 3);
  const minSubjectCount = Number(options.minSubjectCount || 5);
  const globalArtistLabels = new Set(asArray(options.artistLabels).flatMap(artistTextParts));

  for (const artwork of artworks) {
    const existingIds = currentIds(artwork);
    for (const id of existingIds) currentUsage[id] += 1;
    const artistParts = new Set([
      ...artistTextParts(artworkArtistText(artwork)),
      ...asArray(artwork?.artist_labels).flatMap(artistTextParts),
    ]);
    const suggested = new Set(existingIds);
    const labels = extractRawSignals(artwork);

    for (const displayLabel of labels) {
      const normalized = normalizeLabel(displayLabel);
      if (!normalized) continue;
      const normalizedArtist = normalizeArtistText(displayLabel);
      if (
        normalizedArtist.length >= 2 &&
        ([...artistParts].some((part) => part === normalizedArtist) ||
          globalArtistLabels.has(normalizedArtist))
      ) {
        increment(excluded, `artist:${normalized}`, artwork, displayLabel);
        continue;
      }

      const decadeMatch = normalized.match(/^(\d{4})(?:年代|s)$/u);
      if (decadeMatch) {
        const decadeId = `period-${decadeMatch[1]}s`;
        if (CURRENT_BY_ID.has(decadeId)) {
          suggested.add(decadeId);
          currentRawSupport[decadeId] += 1;
        }
        continue;
      }

      const multiCurrentIds = MULTI_EXISTING_ALIASES.get(normalized);
      if (multiCurrentIds) {
        for (const currentId of multiCurrentIds) {
          if (!CURRENT_BY_ID.has(currentId)) continue;
          currentRawSupport[currentId] += 1;
          suggested.add(currentId);
          increment(mergeAliases, `${currentId}:${normalized}`, artwork, displayLabel);
        }
        const additionalConcept = newConceptForLabel(normalized);
        if (additionalConcept) {
          if (CURRENT_BY_ID.has(additionalConcept.id)) {
            currentRawSupport[additionalConcept.id] += 1;
            increment(mergeAliases, `${additionalConcept.id}:${normalized}`, artwork, displayLabel);
          } else {
            increment(newConcepts, additionalConcept.id, artwork, displayLabel);
          }
          suggested.add(additionalConcept.id);
        }
        continue;
      }

      const currentId = ALIAS_TO_CURRENT.get(normalized);
      if (currentId) {
        currentRawSupport[currentId] += 1;
        suggested.add(currentId);
        if (normalizeLabel(CURRENT_BY_ID.get(currentId).label) !== normalized) {
          increment(mergeAliases, `${currentId}:${normalized}`, artwork, displayLabel);
        }
        continue;
      }

      const noiseType = matchesNoise(normalized);
      if (noiseType) {
        increment(excluded, `${noiseType}:${normalized}`, artwork, displayLabel);
        continue;
      }

      const newConcept = newConceptForLabel(normalized);
      if (newConcept) {
        if (CURRENT_BY_ID.has(newConcept.id)) {
          currentRawSupport[newConcept.id] += 1;
          increment(mergeAliases, `${newConcept.id}:${normalized}`, artwork, displayLabel);
        } else {
          increment(newConcepts, newConcept.id, artwork, displayLabel);
        }
        suggested.add(newConcept.id);
        continue;
      }

      const dimension = looksLikeStyle(normalized)
        ? "style"
        : looksLikeSubject(normalized)
          ? "subject"
          : "";
      if (dimension) {
        increment(
          inferredCandidates,
          hashCandidateId(dimension, normalized),
          artwork,
          displayLabel,
        );
      } else {
        increment(unclassified, normalized, artwork, displayLabel);
      }
    }

    const decadeId = decadeIdForArtwork(artwork);
    if (decadeId) suggested.add(decadeId);
    artworkSuggestions.set(String(artwork._id || artwork.id), [...suggested]);
  }

  const proposedNewTerms = [];
  for (const rule of NEW_CONCEPT_RULES) {
    if (CURRENT_BY_ID.has(rule.id)) continue;
    const aggregate = newConcepts.get(rule.id);
    if (!aggregate) continue;
    const threshold = rule.dimension === "style" ? minStyleCount : minSubjectCount;
    if (aggregate.count < threshold) continue;
    proposedNewTerms.push({
      id: rule.id,
      dimension: rule.dimension,
      status: "new_candidate",
      ...finalizeAggregate(aggregate),
      label: rule.label,
    });
  }
  for (const [id, aggregate] of inferredCandidates) {
    const dimension = id.split("-")[0];
    const threshold = dimension === "style" ? minStyleCount : minSubjectCount;
    if (aggregate.count < threshold) continue;
    proposedNewTerms.push({
      id,
      dimension,
      status: "review_candidate",
      ...finalizeAggregate(aggregate),
    });
  }

  const observedDecadeIds = unique(artworks.map(decadeIdForArtwork).filter(Boolean)).sort(
    (left, right) => Number(left.match(/\d{4}/)?.[0] || 0) - Number(right.match(/\d{4}/)?.[0] || 0),
  );
  for (const id of observedDecadeIds) {
    if (CURRENT_BY_ID.has(id)) continue;
    proposedNewTerms.push({
      id,
      dimension: "decade",
      label: id.replace("period-", ""),
      status: "new_candidate",
      count: artworks.filter((artwork) => decadeIdForArtwork(artwork) === id).length,
      aliases: [],
      sample_artwork_ids: artworks
        .filter((artwork) => decadeIdForArtwork(artwork) === id)
        .slice(0, 10)
        .map((artwork) => artwork._id || artwork.id),
    });
  }

  const currentTermDecisions = CURRENT_TERMS.map((term) => ({
    ...term,
    current_usage: currentUsage[term.id],
    raw_support: currentRawSupport[term.id],
    proposed_action: "retain",
  }));
  const aliasMerges = [...mergeAliases.entries()]
    .map(([key, aggregate]) => {
      const targetId = key.split(":")[0];
      return {
        target_id: targetId,
        target_label: CURRENT_BY_ID.get(targetId)?.label || "",
        ...finalizeAggregate(aggregate),
      };
    })
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const excludedSignals = [...excluded.values()]
    .map(finalizeAggregate)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
  const reviewSignals = [...unclassified.values()]
    .map(finalizeAggregate)
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));

  proposedNewTerms.sort(
    (left, right) =>
      left.dimension.localeCompare(right.dimension) ||
      right.count - left.count ||
      left.id.localeCompare(right.id),
  );

  return {
    current_version: CATEGORY_CATALOG_VERSION,
    draft_version: `${CATEGORY_CATALOG_VERSION}-draft`,
    current_terms: currentTermDecisions,
    alias_merges: aliasMerges,
    proposed_new_terms: proposedNewTerms,
    excluded_signals: excludedSignals,
    review_signals: reviewSignals,
    artwork_suggestions: artworkSuggestions,
    summary: {
      artworks: artworks.length,
      current_terms: CURRENT_TERMS.length,
      proposed_new_terms: proposedNewTerms.length,
      proposed_total_terms: CURRENT_TERMS.length + proposedNewTerms.length,
      recommended_new_terms: proposedNewTerms.filter((term) => term.status === "new_candidate")
        .length,
      recommended_total_terms:
        CURRENT_TERMS.length +
        proposedNewTerms.filter((term) => term.status === "new_candidate").length,
      review_candidate_terms: proposedNewTerms.filter((term) => term.status === "review_candidate")
        .length,
      alias_merge_groups: aliasMerges.length,
      excluded_signal_count: excludedSignals.length,
      review_signal_count: reviewSignals.length,
      observed_decades: observedDecadeIds.length,
    },
  };
}

export function buildArtistAliasIndex(artists) {
  const index = new Map();
  for (const artist of artists) {
    const id = String(artist?._id || artist?.id || "").trim();
    if (!id) continue;
    const aliases = unique(
      [
        id,
        artist?.name_zh,
        artist?.nameZh,
        artist?.name_en,
        artist?.nameEn,
        ...asArray(artist?.aliases),
      ].flatMap(artistTextParts),
    );
    for (const alias of aliases) {
      if (alias.length >= 2 && !index.has(alias)) index.set(alias, id);
    }
  }
  return index;
}

export function resolveArtistId(artwork, artistAliasIndex) {
  const parts = unique([
    ...artistTextParts(artworkArtistText(artwork)),
    ...asArray(artwork?.artist_labels).flatMap(artistTextParts),
  ]);
  for (const part of parts) {
    if (artistAliasIndex.has(part)) return artistAliasIndex.get(part);
  }
  return "";
}

function roundRobinBy(items, keyFn, limit) {
  const groups = new Map();
  for (const item of items) {
    const key = keyFn(item) || "(unknown)";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const queues = [...groups.values()];
  const selected = [];
  while (selected.length < limit && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      if (queue.length && selected.length < limit) selected.push(queue.shift());
    }
  }
  return selected;
}

export function buildPilot(artworks, artists, analysis, perCohort = 100) {
  const sorted = [...artworks].sort((left, right) =>
    String(left._id || left.id).localeCompare(String(right._id || right.id)),
  );
  const oldRows = sorted.filter((artwork) => currentIds(artwork).length > 0);
  const newRows = sorted.filter((artwork) => currentIds(artwork).length === 0);
  const select = (rows) => roundRobinBy(rows, artworkArtistText, perCohort);
  const artistAliases = buildArtistAliasIndex(artists);
  const artistById = new Map(artists.map((artist) => [String(artist._id || artist.id), artist]));
  const knownDraftIds = new Set([
    ...CURRENT_TERMS.map((term) => term.id),
    ...analysis.proposed_new_terms.map((term) => term.id),
  ]);

  const mapRow = (artwork, cohort) => {
    const id = String(artwork._id || artwork.id);
    const suggestedArtistId = resolveArtistId(artwork, artistAliases);
    const rawSuggestions = analysis.artwork_suggestions.get(id) || [];
    const hasSuggestedStyle = rawSuggestions.some((candidateId) =>
      candidateId.startsWith("style-"),
    );
    const artistStyleFallback = hasSuggestedStyle
      ? []
      : asArray(artistById.get(suggestedArtistId)?.style_ids);
    const classificationIds = unique(
      rawSuggestions
        .concat(artistStyleFallback)
        .filter((candidateId) => knownDraftIds.has(candidateId)),
    );
    return {
      artwork_id: id,
      cohort,
      title: firstArtworkTitle(artwork),
      artist_text: artworkArtistText(artwork),
      suggested_artist_id: suggestedArtistId,
      source_tag_ids: currentIds(artwork),
      source_signals: extractRawSignals(artwork),
      suggested_classification_ids: classificationIds,
      suggested_style_ids: classificationIds.filter((candidateId) =>
        candidateId.startsWith("style-"),
      ),
      suggested_subject_ids: classificationIds.filter((candidateId) =>
        candidateId.startsWith("subject-"),
      ),
      suggested_decade_ids: classificationIds.filter((candidateId) =>
        candidateId.startsWith("period-"),
      ),
    };
  };

  const rows = [
    ...select(oldRows).map((artwork) => mapRow(artwork, "existing-classified")),
    ...select(newRows).map((artwork) => mapRow(artwork, "new-unclassified")),
  ];
  return {
    draft_version: analysis.draft_version,
    generated_at: new Date().toISOString(),
    requested_per_cohort: perCohort,
    cohorts: {
      existing_classified: rows.filter((row) => row.cohort === "existing-classified").length,
      new_unclassified: rows.filter((row) => row.cohort === "new-unclassified").length,
    },
    checks: {
      total: rows.length,
      unknown_classification_ids: rows
        .flatMap((row) => row.suggested_classification_ids)
        .filter((id) => !knownDraftIds.has(id)).length,
      rows_without_artist_match: rows.filter((row) => !row.suggested_artist_id).length,
      rows_without_any_classification: rows.filter(
        (row) => row.suggested_classification_ids.length === 0,
      ).length,
    },
    rows,
  };
}

function sortedUnique(values) {
  return unique(values).sort((left, right) => left.localeCompare(right));
}

function sameStringArray(left, right) {
  return (
    JSON.stringify(sortedUnique(asArray(left))) === JSON.stringify(sortedUnique(asArray(right)))
  );
}

function isUnknownArtistText(value) {
  const normalized = normalizeLabel(value);
  return (
    !normalized ||
    /^(未知|暂不明确|anonymous|unknown)/iu.test(normalized) ||
    /作者未明确/u.test(normalized) ||
    /作者未记载/u.test(normalized)
  );
}

function selectRepresentativeIds(counts, total, { max = 5, minCount = 2, minRatio = 0.1 } = {}) {
  const ranked = [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
  const selected = ranked
    .filter(([, count]) => count >= minCount || (total > 0 && count / total >= minRatio))
    .slice(0, max)
    .map(([id]) => id);
  if (selected.length || !ranked.length) return selected;
  return [ranked[0][0]];
}

function countClassificationIds(assignments, prefix) {
  const counts = new Map();
  for (const assignment of assignments) {
    for (const id of assignment.classification_ids) {
      if (!id.startsWith(prefix)) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return counts;
}

export function buildMigrationPlan(artworks, artists, analysis, options = {}) {
  const acceptedNewTerms = analysis.proposed_new_terms.filter(
    (term) => term.status === "new_candidate",
  );
  const acceptedTerms = [
    ...CURRENT_TERMS.map((term) => ({
      id: term.id,
      dimension: term.dimension,
      label: term.label,
      status: "retain",
      aliases: [],
    })),
    ...acceptedNewTerms.map((term) => ({
      id: term.id,
      dimension: term.dimension,
      label: term.label,
      status: "new",
      aliases: term.aliases,
    })),
  ];
  const acceptedIds = new Set(acceptedTerms.map((term) => term.id));
  const artistAliases = buildArtistAliasIndex(artists);
  const artistById = new Map(artists.map((artist) => [String(artist._id || artist.id), artist]));
  const unresolvedKnownArtists = new Map();

  const artworkAssignments = artworks.map((artwork) => {
    const artworkId = String(artwork._id || artwork.id);
    const previousClassificationIds = currentIds(artwork);
    const previousArtistIds = unique(
      [...asArray(artwork.artist_ids), artwork.primary_artist_id, artwork.artist_id].map((value) =>
        String(value || "").trim(),
      ),
    );
    const resolvedArtistId = previousArtistIds[0] || resolveArtistId(artwork, artistAliases);
    const artistIds = previousArtistIds.length
      ? previousArtistIds
      : resolvedArtistId
        ? [resolvedArtistId]
        : [];
    const rawSuggestions = analysis.artwork_suggestions.get(artworkId) || [];
    const hasRawStyle = rawSuggestions.some((id) => id.startsWith("style-"));
    const artistStyleFallback =
      hasRawStyle || !resolvedArtistId ? [] : asArray(artistById.get(resolvedArtistId)?.style_ids);
    const classificationIds = unique([...rawSuggestions, ...artistStyleFallback]).filter((id) =>
      acceptedIds.has(id),
    );
    const artistText = artworkArtistText(artwork);

    if (!artistIds.length && !isUnknownArtistText(artistText)) {
      const key = normalizeArtistText(artistText);
      if (key) {
        if (!unresolvedKnownArtists.has(key)) {
          unresolvedKnownArtists.set(key, {
            artist_text: artistText,
            artwork_count: 0,
            sample_artwork_ids: [],
          });
        }
        const candidate = unresolvedKnownArtists.get(key);
        candidate.artwork_count += 1;
        if (candidate.sample_artwork_ids.length < 10) candidate.sample_artwork_ids.push(artworkId);
      }
    }

    return {
      _id: artworkId,
      classification_version: CATEGORY_CATALOG_VERSION,
      classification_ids: classificationIds,
      tag_ids: classificationIds,
      artist_ids: artistIds,
      primary_artist_id: artwork.primary_artist_id || artistIds[0] || "",
      changed:
        !sameStringArray(previousClassificationIds, classificationIds) ||
        !sameStringArray(previousArtistIds, artistIds) ||
        artwork.classification_version !== CATEGORY_CATALOG_VERSION,
      cohort: previousClassificationIds.length ? "existing-classified" : "new-unclassified",
      previous: {
        classification_version: artwork.classification_version || "",
        classification_ids: asArray(artwork.classification_ids),
        tag_ids: asArray(artwork.tag_ids),
        artist_ids: asArray(artwork.artist_ids),
        primary_artist_id: artwork.primary_artist_id || "",
      },
    };
  });

  const assignmentsByArtist = new Map();
  for (const assignment of artworkAssignments) {
    for (const artistId of assignment.artist_ids) {
      if (!assignmentsByArtist.has(artistId)) assignmentsByArtist.set(artistId, []);
      assignmentsByArtist.get(artistId).push(assignment);
    }
  }
  const artistAssignments = artists.map((artist) => {
    const artistId = String(artist._id || artist.id);
    const linked = assignmentsByArtist.get(artistId) || [];
    const styleCounts = countClassificationIds(linked, "style-");
    const subjectCounts = countClassificationIds(linked, "subject-");
    const decadeCounts = countClassificationIds(linked, "period-");
    const derivedStyles = selectRepresentativeIds(styleCounts, linked.length, options);
    const derivedSubjects = selectRepresentativeIds(subjectCounts, linked.length, options);
    const derivedDecades = [...decadeCounts.keys()].sort(
      (left, right) =>
        Number(left.match(/\d{4}/)?.[0] || 0) - Number(right.match(/\d{4}/)?.[0] || 0),
    );
    const styleIds = derivedStyles.length ? derivedStyles : asArray(artist.style_ids);
    const subjectIds = derivedSubjects.length ? derivedSubjects : asArray(artist.subject_ids);
    const decadeIds = derivedDecades.length ? derivedDecades : asArray(artist.decade_ids);
    return {
      _id: artistId,
      classification_version: CATEGORY_CATALOG_VERSION,
      region_id: artist.region_id || "",
      style_ids: styleIds,
      subject_ids: subjectIds,
      decade_ids: decadeIds,
      classified_artwork_count: linked.length,
      changed:
        artist.classification_version !== "classification-v3" ||
        !sameStringArray(artist.style_ids, styleIds) ||
        !sameStringArray(artist.subject_ids, subjectIds) ||
        !sameStringArray(artist.decade_ids, decadeIds) ||
        Number(artist.classified_artwork_count || 0) !== linked.length,
      previous: {
        classification_version: artist.classification_version || "",
        region_id: artist.region_id || "",
        style_ids: asArray(artist.style_ids),
        subject_ids: asArray(artist.subject_ids),
        decade_ids: asArray(artist.decade_ids),
        classified_artwork_count: Number(artist.classified_artwork_count || 0),
      },
    };
  });

  const usageCounts = Object.fromEntries(acceptedTerms.map((term) => [term.id, 0]));
  for (const assignment of artworkAssignments) {
    for (const id of assignment.classification_ids) usageCounts[id] += 1;
  }
  const catalogTerms = acceptedTerms
    .map((term) => ({ ...term, count: usageCounts[term.id] || 0 }))
    .sort((left, right) => {
      const dimensionOrder = { style: 0, subject: 1, decade: 2 };
      const dimensionDelta = dimensionOrder[left.dimension] - dimensionOrder[right.dimension];
      if (dimensionDelta) return dimensionDelta;
      if (left.dimension === "decade") {
        return Number(left.id.match(/\d{4}/)?.[0] || 0) - Number(right.id.match(/\d{4}/)?.[0] || 0);
      }
      return right.count - left.count || left.id.localeCompare(right.id);
    });

  const unknownIds = unique(
    artworkAssignments
      .flatMap((assignment) => assignment.classification_ids)
      .filter((id) => !acceptedIds.has(id)),
  );
  const duplicateArtworkIds =
    artworkAssignments.length -
    new Set(artworkAssignments.map((assignment) => assignment._id)).size;
  const emptyClassificationRows = artworkAssignments
    .filter((assignment) => assignment.classification_ids.length === 0)
    .map((assignment) => assignment._id);
  const unresolvedArtistRows = artworkAssignments
    .filter((assignment) => assignment.artist_ids.length === 0)
    .map((assignment) => assignment._id);
  const newCohort = artworkAssignments.filter(
    (assignment) => assignment.cohort === "new-unclassified",
  );

  return {
    version: CATEGORY_CATALOG_VERSION,
    accepted_terms: catalogTerms,
    artwork_assignments: artworkAssignments,
    artist_assignments: artistAssignments,
    unresolved_known_artists: [...unresolvedKnownArtists.values()].sort(
      (left, right) => right.artwork_count - left.artwork_count,
    ),
    checks: {
      artworks_total: artworkAssignments.length,
      artists_total: artistAssignments.length,
      accepted_terms_total: acceptedTerms.length,
      duplicate_artwork_ids: duplicateArtworkIds,
      unknown_classification_ids: unknownIds,
      artworks_without_classification: emptyClassificationRows.length,
      artwork_ids_without_classification: emptyClassificationRows.slice(0, 50),
      artworks_without_artist: unresolvedArtistRows.length,
      artwork_ids_without_artist: unresolvedArtistRows.slice(0, 50),
      artworks_with_artist: artworkAssignments.length - unresolvedArtistRows.length,
      artist_coverage: Number(
        (
          (artworkAssignments.length - unresolvedArtistRows.length) /
          artworkAssignments.length
        ).toFixed(4),
      ),
      new_artworks_total: newCohort.length,
      new_artworks_without_classification: newCohort.filter(
        (assignment) => assignment.classification_ids.length === 0,
      ).length,
      new_artworks_without_artist: newCohort.filter(
        (assignment) => assignment.artist_ids.length === 0,
      ).length,
      artworks_changed: artworkAssignments.filter((assignment) => assignment.changed).length,
      artists_changed: artistAssignments.filter((assignment) => assignment.changed).length,
      zero_usage_terms: catalogTerms.filter((term) => term.count === 0).map((term) => term.id),
    },
  };
}

export { CATEGORY_CATALOG_VERSION, CURRENT_TERMS, NEW_CONCEPT_RULES };
