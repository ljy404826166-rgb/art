import fs from "node:fs";
import path from "node:path";
import { extractListingsFromHtml, parseArtworkPage, toCsv } from "./artvee-ingest.mjs";

const UNKNOWN = "暂不明确";
const USER_AGENT = "ArtArchiveDataBuilder/0.1";
const DEFAULT_URL = "https://artvee.com/artist/leonardo-da-vinci/";
const DEFAULT_OUT_DIR = "D:/art/csv";

const LEONARDO_TITLES = new Map([
  ["Ginevra de' Benci (obverse)", "吉内芙拉·德·本奇肖像（正面）"],
  ["The Mona Lisa", "蒙娜丽莎"],
  ["Wreath of Laurel, Palm, and Juniper with a Scroll inscribed Virtutem Forma Decorat", "月桂、棕榈与杜松花环及题铭卷轴"],
  ["Madonna of the Carnation", "康乃馨圣母"],
  ["Lady with an Ermine – Portrait of Cecilia Gallerani (ca.1473–1536)", "抱银貂的女子：切奇莉娅·加莱拉尼肖像"],
  ["Virgin and Child", "圣母子"],
  ["The Virgin of the Rocks", "岩间圣母"],
  ["Salvator Mundi", "救世主"],
  ["The Virgin and Child with St. Anne", "圣母子与圣安妮"],
  ["Study of a Madonna (verso)", "圣母习作（背面）"],
  ["Compositional Sketches for the Virgin Adoring the Christ Child, with and without the Infant St. John the Baptist; Diagram of a Perspectival Projection", "圣母敬拜圣婴构图习作及透视投影图"],
  ["The Head of the Virgin in Three-Quarter View Facing Right", "圣母头像，四分之三侧面向右"],
  ["Caricature of a Man with Bushy Hair", "蓬发男子讽刺头像"],
  ["Studies for the Christ Child with a Lamb", "圣婴与羔羊习作"],
  ["Head of an Old Man, and Studies of Machinery", "老人头像与机械习作"],
  ["Sheet of Studies", "习作纸页"],
  ["Head of a bear", "熊头"],
]);

const LOCATION_BY_TITLE = new Map([
  ["Ginevra de' Benci (obverse)", "美国华盛顿国家美术馆 (National Gallery of Art, Washington)"],
  ["The Mona Lisa", "法国巴黎卢浮宫 (Musée du Louvre)"],
  ["Wreath of Laurel, Palm, and Juniper with a Scroll inscribed Virtutem Forma Decorat", "美国华盛顿国家美术馆 (National Gallery of Art, Washington)（推测）"],
  ["Madonna of the Carnation", "德国慕尼黑老绘画陈列馆 (Alte Pinakothek, Munich)"],
  ["Lady with an Ermine – Portrait of Cecilia Gallerani (ca.1473–1536)", "波兰克拉科夫恰尔托雷斯基博物馆 (Czartoryski Museum, Kraków)"],
  ["Salvator Mundi", "私人收藏 (Private Collection)（推测）"],
  ["The Virgin and Child with St. Anne", "法国巴黎卢浮宫 (Musée du Louvre)"],
]);

const MEDIUM_BY_TITLE = new Map([
  ["Ginevra de' Benci (obverse)", "木板油画 (Oil on panel)"],
  ["The Mona Lisa", "杨木板油画 (Oil on poplar panel)"],
  ["Wreath of Laurel, Palm, and Juniper with a Scroll inscribed Virtutem Forma Decorat", "木板蛋彩与油彩（推测）"],
  ["Madonna of the Carnation", "木板油画 (Oil on panel)"],
  ["Lady with an Ermine – Portrait of Cecilia Gallerani (ca.1473–1536)", "木板油画 (Oil on walnut panel)"],
  ["The Virgin and Child with St. Anne", "木板油画 (Oil on panel)"],
  ["Salvator Mundi", "木板油画 (Oil on walnut panel)（推测）"],
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function csvTimestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeYear(value) {
  return clean(value)
    .replace(/^c\.\s*/i, "约")
    .replace(/^circa\s+/i, "约")
    .replace(/^ca\.\s*/i, "约")
    .replace(/^probably\s+/i, "约");
}

function titleCn(titleEn) {
  return LEONARDO_TITLES.get(titleEn) || `${titleEn}（暂译）`;
}

function locationFor(artwork) {
  return LOCATION_BY_TITLE.get(artwork.titleEn) || UNKNOWN;
}

function mediumFor(artwork) {
  if (MEDIUM_BY_TITLE.has(artwork.titleEn)) return MEDIUM_BY_TITLE.get(artwork.titleEn);
  if ((artwork.tags || []).includes("Drawings")) return "纸本素描（推测）";
  if ((artwork.tags || []).includes("Religion") || (artwork.tags || []).includes("Figurative")) return "木板油画（推测）";
  return UNKNOWN;
}

function yearAndPlaceFor(artwork) {
  const year = normalizeYear(artwork.yearAndPlace);
  if (!year) return UNKNOWN;
  if (/147|148/.test(year)) return `${year}，意大利佛罗伦萨（推测）`;
  if (/1490|1495/.test(year)) return `${year}，意大利米兰（推测）`;
  if (/150|151/.test(year)) return `${year}，意大利或法国（推测）`;
  return `${year}（推测）`;
}

function subjectFor(artwork) {
  const title = `${artwork.titleEn} ${titleCn(artwork.titleEn)}`.toLowerCase();
  if (/mona lisa|ginevra|lady|portrait|head|caricature|肖像|头像|女子|男子/.test(title)) return "portrait";
  if (/madonna|virgin|christ|salvator|圣母|圣婴|救世主/.test(title)) return "religion";
  if (/wreath|laurel|scroll|花环|卷轴/.test(title)) return "emblem";
  if (/machinery|projection|studies|sketches|study|sheet|bear|机械|透视|习作|熊/.test(title)) return "drawing";
  return "drawing";
}

function tagsFor(artwork) {
  const subject = subjectFor(artwork);
  const tags = ["达·芬奇", "文艺复兴"];
  if (subject === "portrait") tags.push("肖像画");
  if (subject === "religion") tags.push("宗教题材");
  if (subject === "drawing") tags.push("纸本习作");
  if (subject === "emblem") tags.push("寓意图像");
  const year = normalizeYear(artwork.yearAndPlace).match(/\d{4}/)?.[0];
  if (year) tags.push(`${year.slice(0, 2)}世纪`);
  if ((artwork.tags || []).includes("Public domain")) tags.push("公共领域");
  return [...new Set(tags)].slice(0, 6).join(",");
}

function descriptionFor(artwork) {
  const cn = titleCn(artwork.titleEn);
  const subject = subjectFor(artwork);
  const year = yearAndPlaceFor(artwork);
  const medium = mediumFor(artwork);
  if (subject === "portrait") {
    return `这幅《${cn}》体现了达·芬奇对人物心理和面部神情的持续探索。画面并不满足于记录身份，而是通过微妙的视线、手势、身体转向和柔和明暗，让人物呈现出难以完全言说的内在状态。达·芬奇擅长以渐隐法削弱轮廓，使皮肤、衣饰和背景之间形成细腻过渡，观者因此会感到人物像是处在呼吸与沉思之间。若按现有年代归属来看，作品大致处在${year}，媒介记录为${medium}。它的艺术价值在于把文艺复兴肖像从外在相似推进到精神刻画，使人物成为理性观察、自然研究和诗性想象共同作用的结果。`;
  }
  if (subject === "religion") {
    return `这幅《${cn}》属于达·芬奇宗教题材脉络中的作品，画面围绕圣母、圣婴或救世主题展开，却并不只强调神圣叙事本身。达·芬奇更关注人物之间的目光、手势和身体姿态如何形成安静而复杂的情感结构，使宗教场景带有亲密的人性温度。柔和的明暗、稳定的金字塔式构图和含蓄的空间层次，让画面在庄严之外呈现出沉思气质。若按现有年代归属来看，作品大致处在${year}，媒介记录为${medium}。它显示达·芬奇如何把科学式观察、理想化人体和精神象征融合在一起，是理解盛期文艺复兴图像语言的重要线索。`;
  }
  if (subject === "emblem") {
    return `这件《${cn}》以月桂、棕榈、杜松和题铭卷轴构成寓意性图像，画面不像叙事绘画那样展开故事，而是通过植物、文字和对称结构表达品德、身份与纪念意味。达·芬奇在这类图像中展现出对自然形态和象征秩序的双重兴趣：植物被细致观察，同时又服务于人文主义语境中的道德含义。若按现有年代归属来看，作品大致处在${year}，媒介记录为${medium}。它的价值在于连接肖像、徽记和文艺复兴知识文化，使装饰性元素承担起关于美德、名誉和人格理想的表达功能。`;
  }
  return `这件《${cn}》体现了达·芬奇作为画家、工程师和观察者的综合能力。纸页上的头像、机械、透视或构图研究并不是单纯草稿，而是艺术家思考世界的工作现场：线条记录形体，也记录运动、比例和空间关系。与完成度很高的油画相比，这类习作更能显露达·芬奇如何从观察出发，把人体、自然、机械和宗教构图纳入同一套分析方法。若按现有年代归属来看，作品大致处在${year}，媒介记录为${medium}。它的艺术价值在于保留了创作发生时的推敲过程，使观者能够接近文艺复兴艺术背后的知识结构和实验精神。`;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
  return response.text();
}

async function main() {
  const artistUrl = process.argv[2] || DEFAULT_URL;
  const outDir = process.argv[3] || DEFAULT_OUT_DIR;
  await fs.promises.mkdir(outDir, { recursive: true });

  const listHtml = await fetchText(artistUrl);
  const listings = extractListingsFromHtml(listHtml, artistUrl).slice(0, 17);
  const rows = [];

  for (let index = 0; index < listings.length; index += 1) {
    if (index > 0) await sleep(2500);
    const listing = listings[index];
    const artwork = parseArtworkPage(await fetchText(listing.url), listing.url, listing);
    rows.push({
      id: `${String(index + 1).padStart(3, "0")}_standard`,
      title_cn: titleCn(artwork.titleEn),
      title_en: artwork.titleEn,
      artist: "列奥纳多·达·芬奇 (Leonardo da Vinci)",
      location: locationFor(artwork),
      year_and_place: yearAndPlaceFor(artwork),
      medium: mediumFor(artwork),
      dimensions: UNKNOWN,
      description: descriptionFor(artwork),
      tags: tagsFor(artwork),
    });
  }

  const outputPath = path.join(outDir, `artvee-artist-leonardo-da-vinci-${csvTimestamp()}.csv`);
  await fs.promises.writeFile(outputPath, `\uFEFF${toCsv(rows)}`, "utf8");

  const badDescriptions = rows
    .filter((row) => row.description.length < 250 || row.description.length > 400)
    .map((row) => ({ id: row.id, length: row.description.length }));
  console.log(JSON.stringify({
    artistUrl,
    outputPath,
    rows: rows.length,
    badDescriptions,
    unresolved: {
      location: rows.filter((row) => row.location === UNKNOWN).length,
      dimensions: rows.filter((row) => row.dimensions === UNKNOWN).length,
      medium: rows.filter((row) => row.medium === UNKNOWN).length,
      year_and_place: rows.filter((row) => row.year_and_place === UNKNOWN).length,
    },
  }, null, 2));
}

await main();
