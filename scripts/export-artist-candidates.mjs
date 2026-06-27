#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_INPUT = path.resolve(process.cwd(), "miniapp", "data", "artworks.cloudbase.json");
const DEFAULT_OUTPUT = path.resolve(process.cwd(), "miniapp", "data", "artists.candidates.jsonl");
const UNKNOWN_ARTIST_RE = /^(?:未知|暂不明确|作者未明确记载|unknown|unclear|anonymous|佚名)(?:\s*[（(].*[）)])?$/i;
const CJK_RE = /[\u3400-\u9fff]/u;
const PERIOD_RE = /(?:\d{2,4}年代|\d{1,2}世纪|世纪|文艺复兴|巴洛克|印象派|后印象派|表现主义|新艺术运动|浮世绘)/u;

const countryMap = new Map([
  ["american", "美国"],
  ["austrian", "奥地利"],
  ["british", "英国"],
  ["dutch", "荷兰"],
  ["flemish", "佛兰德"],
  ["french", "法国"],
  ["german", "德国"],
  ["italian", "意大利"],
  ["japanese", "日本"],
  ["norwegian", "挪威"],
  ["russian", "俄罗斯"],
  ["spanish", "西班牙"],
  ["swiss", "瑞士"],
]);

function usage() {
  return `
Export candidate artist records from current WeChat Cloud artwork data.

Usage:
  node scripts/export-artist-candidates.mjs [options]

Options:
  --in <path>       Input artwork JSON/JSONL. Default: miniapp/data/artworks.cloudbase.json
  --out <path>      Output artist candidate JSON Lines. Default: miniapp/data/artists.candidates.jsonl
  --help           Show this help.

Safety:
  - Reads only local exported artwork data.
  - Does not connect to WeChat Cloud.
  - Does not write any online database.
  - Marks every artist as review_status="candidate".
`;
}

function parseArgs(argv) {
  const options = {
    input: DEFAULT_INPUT,
    output: DEFAULT_OUTPUT,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--in") options.input = path.resolve(requiredValue(argv, (index += 1), arg));
    else if (arg === "--out") options.output = path.resolve(requiredValue(argv, (index += 1), arg));
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function readRows(filePath) {
  const text = fs.readFileSync(filePath, "utf8").trim();
  if (!text) return [];
  if (text.startsWith("[")) return JSON.parse(text);
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function compactText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTags(row) {
  const values = [];
  if (Array.isArray(row.tags)) values.push(...row.tags);
  if (Array.isArray(row.tag_keys)) values.push(...row.tag_keys);
  if (typeof row.tags_text === "string") values.push(...row.tags_text.split(/[,，;；、\s]+/u));
  return values.map(compactText).filter(Boolean);
}

function parseArtistText(rawValue) {
  const raw = compactText(rawValue);
  let nameZh = raw;
  let nameEn = "";
  let lifespanText = "";
  let birthYear = 0;
  let deathYear = 0;
  let country = "";

  const fullWidthMatch = raw.match(/^(.*?)（(.*?)）$/u);
  const asciiMatch = raw.match(/^(.*?)\((.*?)\)$/u);
  const match = fullWidthMatch || asciiMatch;
  if (match) {
    const before = compactText(match[1]);
    const inside = compactText(match[2]);
    const parts = inside.split(",").map(compactText).filter(Boolean);

    if (CJK_RE.test(before)) {
      nameZh = before;
      nameEn = parts[0] || "";
    } else {
      nameEn = before;
      nameZh = before;
      const maybeCountry = parts.find((part) => countryMap.has(part.toLowerCase()));
      country = maybeCountry ? countryMap.get(maybeCountry.toLowerCase()) : "";
    }

    const yearMatch = inside.match(/(\d{3,4})\s*[–—-]\s*(\d{2,4})/u);
    if (yearMatch) {
      birthYear = Number(yearMatch[1]);
      deathYear = normalizeDeathYear(Number(yearMatch[2]), birthYear);
      lifespanText = `${birthYear}-${deathYear}`;
    }
  } else if (!CJK_RE.test(raw)) {
    nameEn = raw;
  }

  return {
    raw,
    nameZh: nameZh || nameEn || raw,
    nameEn: nameEn || raw,
    birthYear,
    deathYear,
    lifespanText: lifespanText || "待审核",
    country: country || "待审核",
  };
}

function normalizeDeathYear(value, birthYear) {
  if (value >= 1000) return value;
  const century = Math.floor(birthYear / 100) * 100;
  const candidate = century + value;
  return candidate >= birthYear ? candidate : candidate + 100;
}

function slugify(value, fallbackSource) {
  const normalizedName = String(value || "").replace(/\bde\b/gi, " ");
  const slug = normalizedName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug;
  return `artist-${crypto.createHash("sha1").update(fallbackSource).digest("hex").slice(0, 10)}`;
}

function avatarText(nameZh, nameEn) {
  const cjk = [...String(nameZh || "")].find((char) => CJK_RE.test(char));
  if (cjk) return cjk;
  return String(nameEn || "?").trim().slice(0, 1).toUpperCase() || "?";
}

function unique(values) {
  return [...new Set(values.map(compactText).filter(Boolean))];
}

function topValues(counts, limit) {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans-CN"))
    .slice(0, limit)
    .map(([value]) => value);
}

function increment(map, value) {
  const text = compactText(value);
  if (!text) return;
  map.set(text, (map.get(text) || 0) + 1);
}

function collectArtists(rows) {
  const groups = new Map();
  let skippedUnknown = 0;
  let skippedMissing = 0;

  for (const row of rows) {
    const rawArtist = compactText(row.artist);
    if (!rawArtist) {
      skippedMissing += 1;
      continue;
    }
    if (UNKNOWN_ARTIST_RE.test(rawArtist)) {
      skippedUnknown += 1;
      continue;
    }

    const parsed = parseArtistText(rawArtist);
    const id = slugify(parsed.nameEn, rawArtist);
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        parsed,
        rawArtists: new Map(),
        tags: new Map(),
        periods: new Map(),
        titles: [],
        count: 0,
      });
    }

    const group = groups.get(id);
    group.count += 1;
    increment(group.rawArtists, rawArtist);
    for (const tag of parseTags(row)) {
      if ([parsed.nameZh, parsed.nameEn, rawArtist].includes(tag)) continue;
      if (PERIOD_RE.test(tag)) increment(group.periods, tag);
      increment(group.tags, tag);
    }
    const title = compactText(row.title_cn) || compactText(row.title_en);
    if (title && !group.titles.includes(title) && group.titles.length < 8) group.titles.push(title);
  }

  return { groups: [...groups.values()], skippedMissing, skippedUnknown };
}

function candidateFromGroup(group, dateText) {
  const { parsed } = group;
  const tags = topValues(group.tags, 6);
  const periods = topValues(group.periods, 2);
  const aliases = unique([
    parsed.raw,
    parsed.nameZh,
    parsed.nameEn,
    ...topValues(group.rawArtists, 5),
  ]);

  return {
    _id: group.id,
    name_zh: parsed.nameZh,
    name_en: parsed.nameEn,
    birth_year: parsed.birthYear,
    death_year: parsed.deathYear,
    lifespan_text: parsed.lifespanText,
    country: parsed.country,
    region: "待审核",
    styles: tags.length ? tags.slice(0, 3) : ["待审核"],
    periods: periods.length ? periods : ["待审核"],
    active_period: periods[0] || parsed.lifespanText || "待审核",
    representative_works: group.titles.slice(0, 4),
    aliases,
    bio_zh: "候选记录：该画家来自当前微信云数据库 artworks 集合的 artist 字段，尚未完成人工审核。",
    tags: tags.length ? tags : ["待审核"],
    avatar_text: avatarText(parsed.nameZh, parsed.nameEn),
    authority_ids: {
      ulan: "",
      wikidata: "",
      viaf: "",
    },
    sources: [
      {
        title: "Current WeChat Cloud artworks export",
        url: "miniapp/data/artworks.cloudbase.json",
        fields: ["artist", "title_cn", "title_en", "tags", `source_artwork_count:${group.count}`],
      },
    ],
    review_status: "candidate",
    reviewed_by: "",
    reviewed_at: "",
    updated_at: dateText,
  };
}

function writeJsonLines(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage().trim());
    return;
  }

  const rows = readRows(options.input);
  const { groups, skippedMissing, skippedUnknown } = collectArtists(rows);
  const today = new Date().toISOString().slice(0, 10);
  const candidates = groups
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .map((group) => candidateFromGroup(group, today));

  writeJsonLines(options.output, candidates);

  console.log(`Read artworks: ${rows.length}`);
  console.log(`Wrote ${path.relative(process.cwd(), options.output).replace(/\\/g, "/")}`);
  console.log(`Candidate artists: ${candidates.length}`);
  console.log("Reviewed artists: 0");
  console.log(`Skipped missing artist rows: ${skippedMissing}`);
  console.log(`Skipped unknown artist rows: ${skippedUnknown}`);
  console.log("Top candidate artists:");
  for (const group of groups.sort((a, b) => b.count - a.count).slice(0, 10)) {
    console.log(`- ${group.count} ${group.parsed.raw}`);
  }
}

main();
