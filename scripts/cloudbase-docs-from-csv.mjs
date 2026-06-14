#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUTPUT = path.resolve(process.cwd(), "miniapp", "data", "artworks.from-csv.json");
const DEFAULT_COS_DOMAIN = "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com";
const DEFAULT_COS_PREFIX = "ppaintings";
const UNCLEAR = "暂不明确";

function parseArgs(argv) {
  const options = {
    input: "",
    output: DEFAULT_OUTPUT,
    cosDomain: process.env.TENCENT_COS_DOMAIN || DEFAULT_COS_DOMAIN,
    cosPrefix: process.env.TENCENT_COS_PREFIX || DEFAULT_COS_PREFIX,
    sourceName: "Artvee",
    sourceUrl: "https://artvee.com/",
    status: "published",
    pretty: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--in") options.input = path.resolve(required(argv, (index += 1), arg));
    else if (arg === "--out") options.output = path.resolve(required(argv, (index += 1), arg));
    else if (arg === "--cos-domain") options.cosDomain = required(argv, (index += 1), arg);
    else if (arg === "--cos-prefix") options.cosPrefix = required(argv, (index += 1), arg);
    else if (arg === "--source-name") options.sourceName = required(argv, (index += 1), arg);
    else if (arg === "--source-url") options.sourceUrl = required(argv, (index += 1), arg);
    else if (arg === "--status") options.status = required(argv, (index += 1), arg);
    else if (arg === "--pretty") options.pretty = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.input) throw new Error("--in <csv> is required.");
  options.cosDomain = options.cosDomain.replace(/\/+$/g, "");
  options.cosPrefix = options.cosPrefix.replace(/^\/+|\/+$/g, "");
  return options;
}

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [rawHeaders, ...body] = rows;
  const headers = (rawHeaders || []).map((header, index) => {
    const normalized = String(header ?? "").replace(/^\uFEFF/, "").trim();
    return normalized || `__empty_${index}`;
  });
  if (!headers.length) return [];

  return body
    .filter((values) => values.some((value) => String(value || "").trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function nullableString(value) {
  const text = String(value ?? "").trim();
  if (!text || text === "null" || text === "undefined") return null;
  return text;
}

function tagList(value) {
  return [...new Set(String(value || "")
    .split(/[,，;；、\s]+/u)
    .map((tag) => tag.trim())
    .filter(Boolean))];
}

function imageUrl(id, options) {
  const objectName = `${id}.jpg`.split("/").map(encodeURIComponent).join("/");
  return `${options.cosDomain}/${options.cosPrefix ? `${options.cosPrefix}/` : ""}${objectName}`;
}

function derivativeImageUrl(id, options, kind) {
  const objectName = `${id}.webp`.split("/").map(encodeURIComponent).join("/");
  const prefix = options.cosPrefix ? `${options.cosPrefix}/` : "";
  return `${options.cosDomain}/${prefix}derivatives/${kind}/${objectName}`;
}

function toDocument(row, options, batchId, rowNumber) {
  const id = nullableString(row.id);
  if (!id) {
    const keys = Object.keys(row).join(", ");
    throw new Error(`CSV row ${rowNumber} is missing id. Available columns: ${keys}`);
  }

  const tags = tagList(row.tags);
  const url = imageUrl(id, options);
  const now = new Date().toISOString();
  const sourceUrl = nullableString(row.source_url) || options.sourceUrl;

  return {
    _id: `artwork_${id}`,
    supabase_id: id,
    source_record_id: id,
    slug: `artvee-${id}`,
    title_cn: nullableString(row.title_cn) || UNCLEAR,
    title_en: nullableString(row.title_en),
    artist: nullableString(row.artist) || UNCLEAR,
    year_and_place: nullableString(row.year_and_place),
    location: nullableString(row.location),
    medium: nullableString(row.medium),
    dimensions: nullableString(row.dimensions),
    description: nullableString(row.description),
    tags,
    tags_text: tags.join(","),
    tag_keys: tags,
    source_name: options.sourceName,
    source_url: sourceUrl,
    image_id: id,
    thumbnail_url: derivativeImageUrl(id, options, "thumb"),
    display_url: derivativeImageUrl(id, options, "display"),
    download_url: url,
    iiif_url: null,
    status: options.status,
    created_at: now,
    updated_at: now,
    migrated_at: now,
    migration_batch: batchId,
    sync_target: "cloudbase",
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = parseCsv(fs.readFileSync(options.input, "utf8"));
  const batchId = `csv-cloudbase-${new Date().toISOString().slice(0, 10)}`;
  const docs = rows.map((row, index) => toDocument(row, options, batchId, index + 2));
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(docs, null, options.pretty ? 2 : 0)}\n`, "utf8");
  console.log(JSON.stringify({ input: options.input, output: options.output, rows: rows.length, documents: docs.length }, null, 2));
}

main();
