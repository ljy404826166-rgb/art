import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readJsonRecords } from "./validate-reviewed-data.mjs";

const DEFAULT_ARTWORKS_PATH = path.resolve("miniapp/data/artworks.cloudbase.json");

const SLUG_CHAR_MAP = new Map([
  ["克", "ke"],
  ["洛", "luo"],
  ["德", "de"],
  ["莫", "mo"],
  ["奈", "nai"],
  ["印", "yin"],
  ["象", "xiang"],
  ["派", "pai"],
  ["油", "you"],
  ["画", "hua"],
  ["世", "shi"],
  ["纪", "ji"],
  ["纸", "zhi"],
  ["本", "ben"],
  ["素", "su"],
  ["描", "miao"],
  ["版", "ban"],
  ["水", "shui"],
  ["彩", "cai"],
  ["风", "feng"],
  ["景", "jing"],
  ["肖", "xiao"],
  ["像", "xiang"],
  ["文", "wen"],
  ["艺", "yi"],
  ["复", "fu"],
  ["兴", "xing"],
  ["表", "biao"],
  ["现", "xian"],
  ["主", "zhu"],
  ["义", "yi"],
  ["巴", "ba"],
  ["洛", "luo"],
  ["后", "hou"],
  ["浮", "fu"],
  ["绘", "hui"],
  ["荷", "he"],
  ["兰", "lan"],
  ["日", "ri"],
  ["法", "fa"],
  ["国", "guo"],
  ["意", "yi"],
  ["大", "da"],
  ["利", "li"],
]);

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
}

export function uniquePush(target, value) {
  if (!isNonEmptyString(value)) return;
  const normalized = value.trim();
  if (!target.some((item) => item.trim().toLocaleLowerCase() === normalized.toLocaleLowerCase())) {
    target.push(normalized);
  }
}

export function transliterateForSlug(value) {
  const tokens = [];
  let current = "";

  function flushCurrent() {
    if (current) {
      tokens.push(current);
      current = "";
    }
  }

  Array.from(String(value ?? "")).forEach((char) => {
    if (/^[a-zA-Z0-9]$/.test(char)) {
      current += char.toLocaleLowerCase();
      return;
    }

    if (SLUG_CHAR_MAP.has(char)) {
      const mapped = SLUG_CHAR_MAP.get(char);
      if (/^[0-9]+$/.test(current)) {
        current += mapped;
      } else {
        flushCurrent();
        tokens.push(mapped);
      }
      return;
    }

    flushCurrent();
  });

  flushCurrent();
  return tokens.join("-");
}

export function slugifyText(value) {
  return transliterateForSlug(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function toCandidateId(prefix, value) {
  const slug = slugifyText(value);
  return prefix ? `${prefix}-${slug || "unknown"}` : slug || "unknown";
}

function cleanArtistText(value) {
  return String(value ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseArtistText(value) {
  const raw = cleanArtistText(value);
  if (!raw) {
    return null;
  }

  const match = raw.match(
    /^(.*?)\s*[（(]\s*([^,，()（）]+)\s*[,，]\s*([0-9]{3,4})\s*[-–—]\s*([0-9]{3,4})\s*[)）]\s*$/u,
  );
  if (match) {
    return {
      raw,
      name_zh: cleanArtistText(match[1]),
      name_en: cleanArtistText(match[2]),
      birth_year: Number(match[3]),
      death_year: Number(match[4]),
    };
  }

  const nameOnlyMatch = raw.match(/^(.*?)\s*[（(]\s*([^()（）]+?)\s*[)）]\s*$/u);
  if (nameOnlyMatch) {
    return {
      raw,
      name_zh: cleanArtistText(nameOnlyMatch[1]),
      name_en: cleanArtistText(nameOnlyMatch[2])
        .replace(/\s*[,，].*$/, "")
        .trim(),
      birth_year: null,
      death_year: null,
    };
  }

  return {
    raw,
    name_zh: raw,
    name_en: raw,
    birth_year: null,
    death_year: null,
  };
}

function getArtworkId(artwork, index) {
  return artwork?._id || artwork?.id || artwork?.supabase_id || `artwork-${index + 1}`;
}

export function generateArtistCandidates(artworks = []) {
  const byId = new Map();

  artworks.forEach((artwork, index) => {
    const parsed = parseArtistText(artwork?.artist);
    if (!parsed) return;

    const idBase =
      parsed.name_en && parsed.name_en !== parsed.raw ? parsed.name_en : parsed.name_zh;
    const candidateId = slugifyText(idBase);
    if (!candidateId) return;

    const existing = byId.get(candidateId) || {
      _id: candidateId,
      name_zh: parsed.name_zh,
      name_en: parsed.name_en,
      birth_year: parsed.birth_year,
      death_year: parsed.death_year,
      aliases: [],
      review_status: "candidate",
      source_artwork_ids: [],
      source_artist_texts: [],
      artwork_count: 0,
    };

    uniquePush(existing.aliases, parsed.name_zh);
    uniquePush(existing.aliases, parsed.name_en);
    uniquePush(existing.aliases, parsed.raw);
    uniquePush(existing.source_artist_texts, parsed.raw);

    const artworkId = getArtworkId(artwork, index);
    if (!existing.source_artwork_ids.includes(artworkId)) {
      existing.source_artwork_ids.push(artworkId);
      existing.artwork_count += 1;
    }

    byId.set(candidateId, existing);
  });

  return Array.from(byId.values()).sort((a, b) => {
    if (b.artwork_count !== a.artwork_count) return b.artwork_count - a.artwork_count;
    return a._id.localeCompare(b._id);
  });
}

export function writeJsonLines(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const content = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(filePath, content ? `${content}\n` : "", "utf8");
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const inputPath = path.resolve(args.input || args.in || DEFAULT_ARTWORKS_PATH);
  const outputPath = args.out ? path.resolve(args.out) : null;
  const artworks = readJsonRecords(inputPath);
  const candidates = generateArtistCandidates(artworks);
  const summary = {
    input: inputPath,
    output: outputPath,
    candidateCount: candidates.length,
  };

  if (outputPath) {
    writeJsonLines(outputPath, candidates);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  process.exitCode = runCli();
}
