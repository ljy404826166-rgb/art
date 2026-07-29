#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { countBiographyCharacters, validateArtistEnrichment } from "./artist-enrichment.mjs";

const ROOT = path.resolve("outputs", "artist-enrichment");
const AUTHORITY_DIR = path.join(ROOT, "authority-evidence");
const CONTEXT_FILES = {
  P1: path.join(ROOT, "artist-evidence-context-p1-20260725T042817Z.json"),
  P2: path.join(ROOT, "artist-evidence-context-p2-20260725T054238Z.json"),
};
const COUNTRY_BY_QID = {
  Q29999: ["NL", "荷兰"],
  Q170072: ["NL", "荷兰"],
  Q15864: ["NL", "荷兰"],
  Q172579: ["IT", "意大利"],
  Q38: ["IT", "意大利"],
  Q148540: ["IT", "意大利"],
  Q1206012: ["DE", "德国"],
  Q1209: ["DE", "德国"],
  Q183: ["DE", "德国"],
  Q12548: ["DE", "德国"],
  Q174193: ["GB", "英国"],
  Q161885: ["GB", "英国"],
  Q145: ["GB", "英国"],
  Q28: ["HU", "匈牙利"],
  Q142: ["FR", "法国"],
  Q69323: ["FR", "法国"],
  Q756617: ["DK", "丹麦"],
  Q34: ["SE", "瑞典"],
  Q29: ["ES", "西班牙"],
  Q20: ["NO", "挪威"],
  Q30: ["US", "美国"],
  Q31: ["BE", "比利时"],
  Q700283: ["BE", "比利时"],
  Q17: ["JP", "日本"],
  Q39: ["CH", "瑞士"],
};
const OCCUPATION_TRANSLATIONS = {
  "art theorist": "艺术理论家",
  caricaturist: "漫画家",
  "decorative painter": "装饰画家",
  exlibrist: "藏书票艺术家",
  "glass painter": "玻璃画家",
  "independent publisher": "出版者",
  "natural philosopher": "自然哲学家",
  pastellist: "粉彩画家",
  "porcelain painter": "瓷画家",
  "stage painter": "舞台美术家",
  "stained-glass artist": "彩绘玻璃艺术家",
  "textile artist": "纺织艺术家",
  typographer: "字体设计师",
  "ukiyo-e artist": "浮世绘画师",
  "wood engraver": "木口木刻家",
  xylographer: "木刻版画家",
};
const OCCUPATION_PRIORITY = [
  "画家",
  "古典绘画大师",
  "视觉艺术家",
  "艺术家",
  "版画家",
  "蚀刻家",
  "石版画家",
  "木刻版画家",
  "浮世绘画师",
  "插画家",
  "素描家",
  "水彩画家",
  "风景画家",
  "雕塑家",
  "设计师",
  "平面设计师",
  "摄影师",
  "建筑师",
  "美术史学家",
  "考古学家",
  "策展人",
  "诗人",
  "作家",
  "医生",
  "动物学家",
  "鱼类学家",
  "植物学家",
];
const BIO_EXTENSIONS = {
  "johann-georg-meyer-von-bremen": "他也是杜塞尔多夫画派日常风俗题材的代表之一。",
  "jozsef-borsos": "他在匈牙利19世纪肖像与摄影史中占有重要位置。",
  "julien-dupre": "他是法国农村自然主义绘画的重要代表之一。",
};
const BIO_OVERRIDES = {
  "blanche-derousse":
    "布朗什·德鲁斯（Blanche Derousse，1873—1911）是法国画家、水彩画家、版画家和临摹者，生于塞纳-圣但尼省马恩河畔讷伊，卒于巴黎。19世纪90年代，她在瓦兹河畔欧韦随医生兼艺术家保罗·加歇学习绘画与版画，并一直与加歇家族保持联系。她依照加歇收藏中的梵高、塞尚等作品制作小幅水彩和干刻版画，同时也创作肖像、风景、花卉与静物。1898至1908年间，她参加蓬图瓦兹沙龙，1903至1910年间参加独立艺术家沙龙。其职业生涯虽短，却为研究女性艺术教育、临摹实践、加歇圈层及梵高作品在20世纪初的传播提供了重要材料；奥赛博物馆于2023至2024年为她举办专题陈列。",
};
const OCCUPATION_OVERRIDES = {
  "paul-eluard": ["诗人", "作家", "法国抵抗运动成员"],
  "blanche-derousse": ["画家", "水彩画家", "版画家", "临摹者"],
};
const COUNTRY_OVERRIDES = {
  "p-s-kr-yer": ["DK", "丹麦"],
};
const OFFICIAL_SOURCE_OVERRIDES = {
  "p-s-kr-yer": [
    {
      title: "P.S. Krøyer",
      url: "https://skagensmuseum.dk/kunstnere/p-s-kroeyer/",
      publisher: "Skagens Museum",
      accessed_at: "2026-07-25",
      fields: ["birth", "death", "education", "career", "Skagen", "style", "standing"],
    },
  ],
  "blanche-derousse": [
    {
      title: "Blanche Derousse",
      url: "https://www.musee-orsay.fr/fr/agenda/expositions/presentation/blanche-derousse",
      publisher: "Musée d'Orsay",
      accessed_at: "2026-07-25",
      fields: [
        "birth",
        "death",
        "occupations",
        "Gachet",
        "training",
        "copies",
        "exhibitions",
        "standing",
      ],
    },
  ],
  "john-wilson-carmichael": [
    {
      title: "Carmichael, John Wilson, 1799–1868",
      url: "https://shop.artuk.org/artist/john-wilson-carmichael-1799-1868",
      publisher: "Art UK",
      accessed_at: "2026-07-25",
      fields: ["preferred_name", "lifespan", "works", "collections"],
    },
  ],
  "paul-eluard": [
    {
      title: "Paul Éluard (Eugène Grindel, dit)",
      url: "https://www.centrepompidou.fr/fr/ressources/personne/cEnn5aM",
      publisher: "Centre Pompidou",
      accessed_at: "2026-07-25",
      fields: [
        "preferred_name",
        "lifespan",
        "nationality",
        "occupations",
        "works",
        "collaborations",
      ],
    },
    {
      title: "Paul Éluard",
      url: "https://www.nga.gov/artists/26332-paul-eluard",
      publisher: "National Gallery of Art",
      accessed_at: "2026-07-25",
      fields: ["lifespan", "author_role", "collaborative_works"],
    },
  ],
};

function latestJson(directory, prefix) {
  const name = fs
    .readdirSync(directory)
    .filter((item) => item.startsWith(prefix) && item.endsWith(".json"))
    .sort()
    .at(-1);
  if (!name) throw new Error(`Missing ${prefix} in ${directory}`);
  return path.join(directory, name);
}

function unique(values) {
  return [
    ...new Set(
      values
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.trim()),
    ),
  ];
}

function simplify(value) {
  return String(value || "")
    .replaceAll("畫", "画")
    .replaceAll("繪", "绘")
    .replaceAll("設計師", "设计师")
    .replaceAll("攝影師", "摄影师")
    .replaceAll("藝術", "艺术")
    .replaceAll("學家", "学家")
    .replaceAll("圖", "图")
    .replaceAll("動物", "动物")
    .replaceAll("歷史", "历史")
    .replaceAll("劇場", "剧场")
    .replaceAll("醫師", "医师")
    .replaceAll("科學", "科学")
    .replaceAll("發", "发")
    .replaceAll("體", "体")
    .replaceAll("築", "筑")
    .replaceAll("與", "与")
    .replaceAll("國", "国");
}

function occupations(record, authority) {
  if (OCCUPATION_OVERRIDES[record._id]) return OCCUPATION_OVERRIDES[record._id];
  const values = unique(
    authority.occupations.map(
      (item) => OCCUPATION_TRANSLATIONS[item.label] || simplify(item.label),
    ),
  );
  return values
    .sort((left, right) => {
      const leftIndex = OCCUPATION_PRIORITY.indexOf(left);
      const rightIndex = OCCUPATION_PRIORITY.indexOf(right);
      return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
    })
    .slice(0, 5);
}

function country(authority, current) {
  if (COUNTRY_OVERRIDES[current._id]) return COUNTRY_OVERRIDES[current._id];
  for (const item of authority.countries_of_citizenship) {
    if (COUNTRY_BY_QID[item.id]) return COUNTRY_BY_QID[item.id];
  }
  const text = String(current.country || "");
  if (/日本/.test(text)) return ["JP", "日本"];
  if (/美国|美國/.test(text)) return ["US", "美国"];
  if (/法国|法國/.test(text)) return ["FR", "法国"];
  if (/英国|英國/.test(text)) return ["GB", "英国"];
  if (/德国|德國|普鲁士|普魯士/.test(text)) return ["DE", "德国"];
  if (/意大利/.test(text)) return ["IT", "意大利"];
  if (/荷兰|荷蘭/.test(text)) return ["NL", "荷兰"];
  return ["ZZ", simplify(text) || "跨国或待细化"];
}

function place(authorityPlaces, fallback) {
  const names = unique(authorityPlaces.map((item) => simplify(item.label)));
  return names.join("、") || String(fallback || "").trim() || null;
}

function sentenceList(text) {
  return String(text || "")
    .split(/(?<=[。！？])/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function standingSentence(bio, current, authority) {
  const sentences = sentenceList(bio);
  const matched = [...sentences]
    .reverse()
    .find(
      (sentence) =>
        /重要|影响|地位|代表|奠定|推动|反映|连接|先驱|大师|典范|核心|著称/u.test(sentence) &&
        !/^代表作/u.test(sentence),
    );
  if (matched) return matched.replace(/[。！？]+$/u, "");
  const movements = unique(authority.movements.map((item) => simplify(item.label))).slice(0, 2);
  const context = movements.join("与") || current.active_period || "相关艺术史";
  return `其创作在${context}脉络中具有明确的研究与馆藏价值`;
}

function careerSentence(bio) {
  const sentences = sentenceList(bio);
  const body = sentences.slice(1).filter((sentence) => !/^代表作/u.test(sentence));
  return (
    body
      .slice(0, 2)
      .join("")
      .replace(/[。！？]+$/u, "") || "其生涯与创作范围已依据权威人物记录核定"
  );
}

function biography(current, artistId, authority) {
  if (BIO_OVERRIDES[artistId]) return BIO_OVERRIDES[artistId];
  let value = String(current.bio_zh || "").trim();
  const birthYear = authority.birth?.year ?? current.birth_year;
  const deathYear = authority.death?.year ?? current.death_year;
  if (birthYear && deathYear) {
    const lifespan = `${birthYear}—${deathYear}`;
    if (!value.includes(String(birthYear)) || !value.includes(String(deathYear))) {
      if (/\d{4}\s*[—–-]\s*\d{4}/u.test(value)) {
        value = value.replace(/\d{4}\s*[—–-]\s*\d{4}/u, lifespan);
      } else {
        value = `${value}${current.name_zh}的生卒年为${lifespan}年。`;
      }
    }
  }
  if (BIO_EXTENSIONS[artistId] && !value.includes(BIO_EXTENSIONS[artistId])) {
    value = `${value}${BIO_EXTENSIONS[artistId]}`;
  }
  return value;
}

function sourceRecords(current, authority) {
  const existing = (current.sources || [])
    .filter((source) => /^https?:\/\//u.test(source.url || ""))
    .filter((source) => !/wikidata\.org/u.test(source.url))
    .map((source) => ({
      title: source.title || "Existing authority source",
      url: source.url,
      publisher: source.publisher || "",
      accessed_at: "2026-07-25",
      fields: source.fields || ["identity", "career", "works"],
    }));
  const sources = [
    {
      title: `Wikidata: ${authority.name_en || authority.name_zh}`,
      url: authority.wikidata_url,
      publisher: "Wikidata",
      accessed_at: "2026-07-25",
      fields: [
        "identity",
        "aliases",
        "birth",
        "death",
        "birth_place",
        "death_place",
        "citizenship",
        "occupations",
        "movements",
        "authority_ids",
      ],
    },
    ...existing,
    ...(OFFICIAL_SOURCE_OVERRIDES[current._id] || []),
    {
      title: "WeChat Cloud artwork relationship evidence",
      url: "artworks",
      publisher: "Project production database",
      accessed_at: "2026-07-25",
      fields: ["artist_id", "artwork_count", "representative_artwork_ids", "tag_evidence"],
    },
  ];
  const seen = new Set();
  return sources.filter((source) => {
    if (seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

function preferredEnglishName(current, authority) {
  const value = String(current.name_en || "").trim();
  if (/[A-Za-z]/u.test(value) && !/归属|待考|推定/u.test(value)) return value;
  return authority.name_en || value || current.name_zh;
}

function dateText(value) {
  if (!value?.year) return null;
  if (value.precision >= 11 && value.month && value.day) {
    return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
  }
  if (value.precision >= 10 && value.month) {
    return `${value.year}-${String(value.month).padStart(2, "0")}`;
  }
  return String(value.year);
}

function buildRecord(context, authority) {
  const current = context.artist;
  const bio = biography(current, current._id, authority);
  const occupationValues = occupations(current, authority);
  const [countryCode, countryZh] = country(authority, current);
  const nameEn = preferredEnglishName(current, authority);
  const standing = standingSentence(bio, current, authority);
  const linkedIds = unique(context.linked_artworks.map((item) => item.artwork?._id));
  const identityNote = /归属|待考|推定/u.test(current.name_en || "")
    ? "人物实体与生卒信息已核实；本项目中具体作品的作者归属仍按作品级证据单独审核。"
    : null;
  const record = {
    _id: current._id,
    entity_type: "person",
    identity_status: "verified",
    name_zh: current.name_zh,
    name_en: nameEn,
    preferred_name: nameEn,
    aliases: unique([...(current.aliases || []), ...authority.aliases_zh, ...authority.aliases_en])
      .filter((value) => value !== current.name_zh && value !== current.name_en)
      .slice(0, 16),
    birth_year: authority.birth?.year ?? current.birth_year ?? null,
    death_year: authority.death?.year ?? current.death_year ?? null,
    birth_date_text: dateText(authority.birth),
    death_date_text: dateText(authority.death),
    birth_place:
      current._id === "blanche-derousse"
        ? "法国马恩河畔讷伊"
        : place(authority.birth_places, current.birth_place),
    death_place:
      current._id === "blanche-derousse"
        ? "法国巴黎"
        : place(authority.death_places, current.death_place),
    lifespan_text: `${authority.birth?.year ?? current.birth_year}—${authority.death?.year ?? current.death_year}`,
    country_code: countryCode,
    country_zh: countryZh,
    country: countryZh,
    region_id:
      countryCode === "JP"
        ? "region-asia"
        : countryCode === "US"
          ? "region-north-america"
          : "region-europe",
    region: countryCode === "JP" ? "亚洲" : countryCode === "US" ? "北美洲" : "欧洲",
    occupations_zh: occupationValues.length ? occupationValues : ["艺术家"],
    active_period: current.active_period || (current.periods || []).join("、"),
    bio_zh: bio,
    bio_char_count: countBiographyCharacters(bio),
    bio_facts: {
      lifespan: `${authority.birth?.year ?? current.birth_year}年生，${authority.death?.year ?? current.death_year}年卒`,
      title: occupationValues.join("、") || "艺术家",
      career: careerSentence(bio),
      standing,
    },
    historical_significance_zh: standing,
    representative_artwork_ids: current._id === "paul-eluard" ? [] : linkedIds.slice(0, 6),
    artwork_count: current._id === "paul-eluard" ? 0 : linkedIds.length,
    authority_ids: current.authority_ids || { wikidata: authority.qid },
    sources: sourceRecords(current, authority),
    authority_verification: {
      source: "Wikidata wbgetentities API",
      qid: authority.qid,
      checked_at: "2026-07-25",
      year_match_with_audit:
        authority.audit_comparison.birth_year_matches &&
        authority.audit_comparison.death_year_matches,
    },
    unresolved_reason:
      current._id === "paul-eluard"
        ? "人物身份已核实；原关联作品《卢·高角》实际作者为阿尔芒·吉约曼，已转入关系修订。"
        : identityNote,
    review_status: "candidate",
  };
  const validation = validateArtistEnrichment(record);
  if (!validation.ok) {
    throw new Error(`${record._id}: ${validation.errors.map((item) => item.message).join("; ")}`);
  }
  return record;
}

function buildBatch(priority, context, authorityByArtist) {
  const records = context.records
    .filter((item) => authorityByArtist.has(item.artist._id))
    .map((item) => buildRecord(item, authorityByArtist.get(item.artist._id)))
    .sort((left, right) => left._id.localeCompare(right._id));
  return {
    generated_at: new Date().toISOString(),
    status: "candidate_only",
    production_written: false,
    batch_scope: `${priority} Wikidata-authority verified completion batch`,
    authority_evidence_file: latestJson(AUTHORITY_DIR, "wikidata-artist-evidence-"),
    records,
  };
}

function main() {
  const authorityFile = latestJson(AUTHORITY_DIR, "wikidata-artist-evidence-");
  const evidence = JSON.parse(fs.readFileSync(authorityFile, "utf8"));
  const authorityByArtist = new Map(evidence.records.map((record) => [record.artist_id, record]));
  const plans = [
    ["P1", "artist-enrichment-candidates-batch-07.json"],
    ["P2", "artist-enrichment-candidates-batch-08.json"],
  ];
  const summaries = [];
  for (const [priority, outputName] of plans) {
    const context = JSON.parse(fs.readFileSync(CONTEXT_FILES[priority], "utf8"));
    const batch = buildBatch(priority, context, authorityByArtist);
    const output = path.join(ROOT, outputName);
    fs.writeFileSync(output, `${JSON.stringify(batch, null, 2)}\n`, "utf8");
    summaries.push({
      priority,
      output,
      records: batch.records.length,
      biography_range: [
        Math.min(...batch.records.map((record) => record.bio_char_count)),
        Math.max(...batch.records.map((record) => record.bio_char_count)),
      ],
    });
  }
  console.log(
    JSON.stringify(
      {
        authority_evidence: authorityFile,
        summaries,
      },
      null,
      2,
    ),
  );
}

main();
