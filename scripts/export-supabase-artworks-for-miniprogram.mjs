import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUTPUT = "miniapp/data/artworks.json";
const DEFAULT_BATCH_SIZE = 500;
const MAX_BATCH_SIZE = 1000;
const MIGRATION_BATCH = `published-artworks-${new Date().toISOString().slice(0, 10)}`;

const exportColumns = [
  "id",
  "slug",
  "title_cn",
  "title_en",
  "artist",
  "year_and_place",
  "location",
  "medium",
  "dimensions",
  "description",
  "tags",
  "tags_text",
  "source_name",
  "source_url",
  "image_id",
  "thumbnail_url",
  "display_url",
  "download_url",
  "iiif_url",
  "created_at",
  "updated_at",
].join(",");

function usage() {
  return `
Export public Supabase artworks for WeChat Cloud Database.

Usage:
  node scripts/export-supabase-artworks-for-miniprogram.mjs [options]

Options:
  --out <path>          Output JSON path. Default: ${DEFAULT_OUTPUT}
  --limit <number>      Maximum rows to export. Useful for pilot runs.
  --offset <number>     Start offset. Default: 0
  --batch-size <number> Supabase page size. Default: ${DEFAULT_BATCH_SIZE}, max: ${MAX_BATCH_SIZE}
  --pretty              Pretty-print JSON.
  --include-missing-images
                        Also export records without thumbnail_url/display_url.
  --help                Show this help.

Required environment:
  VITE_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL
  VITE_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or VITE_SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY

Safety:
  - Reads only public.published_artworks.
  - Does not export user/RBAC/Auth data.
  - Does not modify Supabase.
  - Does not import into WeChat Cloud.
`;
}

function parseArgs(argv) {
  const options = {
    out: DEFAULT_OUTPUT,
    limit: null,
    offset: 0,
    batchSize: DEFAULT_BATCH_SIZE,
    pretty: false,
    includeMissingImages: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--pretty") {
      options.pretty = true;
    } else if (arg === "--include-missing-images") {
      options.includeMissingImages = true;
    } else if (arg === "--out") {
      options.out = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--limit") {
      options.limit = parseNonNegativeInteger(requiredValue(argv, (index += 1), arg), arg);
    } else if (arg === "--offset") {
      options.offset = parseNonNegativeInteger(requiredValue(argv, (index += 1), arg), arg);
    } else if (arg === "--batch-size") {
      options.batchSize = parseNonNegativeInteger(requiredValue(argv, (index += 1), arg), arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.batchSize = Math.max(1, Math.min(options.batchSize, MAX_BATCH_SIZE));
  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function parseNonNegativeInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`${flag} must be a non-negative integer.`);
  return parsed;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function resolveEnv() {
  return {
    ...readEnvFile(".env"),
    ...readEnvFile(".env.local"),
    ...process.env,
  };
}

function resolveSupabaseConfig(env) {
  const url = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const anonKey =
    env.VITE_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    env.SUPABASE_ANON_KEY;

  if (!url)
    throw new Error("Missing Supabase URL. Set VITE_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.");
  if (!anonKey) throw new Error("Missing Supabase anon/publishable key.");

  return { url, anonKey };
}

function nullableString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeTags(tags, tagsText) {
  const raw = Array.isArray(tags)
    ? tags
    : typeof tags === "string"
      ? tags.split(/[,，；、\s]+/u)
      : [];
  const fromText = typeof tagsText === "string" ? tagsText.split(/[,，；、\s]+/u) : [];
  return [...new Set([...raw, ...fromText].map((tag) => String(tag || "").trim()).filter(Boolean))];
}

function toWechatArtwork(row) {
  const id = nullableString(row.id);
  if (!id) throw new Error("Encountered artwork without id.");

  const tags = normalizeTags(row.tags, row.tags_text);
  const thumbnailUrl = nullableString(row.thumbnail_url) || nullableString(row.display_url);
  const displayUrl = nullableString(row.display_url) || nullableString(row.thumbnail_url);

  return {
    _id: `artwork_${id}`,
    supabase_id: id,
    slug: nullableString(row.slug),
    title_cn: nullableString(row.title_cn) || "未命名作品",
    title_en: nullableString(row.title_en),
    artist: nullableString(row.artist) || "Unknown artist",
    year_and_place: nullableString(row.year_and_place),
    location: nullableString(row.location),
    medium: nullableString(row.medium),
    dimensions: nullableString(row.dimensions),
    description: nullableString(row.description),
    tags,
    tags_text: nullableString(row.tags_text) || tags.join(","),
    tag_keys: tags,
    source_name: nullableString(row.source_name),
    source_url: nullableString(row.source_url),
    image_id: nullableString(row.image_id),
    thumbnail_url: thumbnailUrl,
    display_url: displayUrl,
    download_url: nullableString(row.download_url),
    iiif_url: nullableString(row.iiif_url),
    created_at: nullableString(row.created_at),
    updated_at: nullableString(row.updated_at),
    status: "published",
    migrated_at: new Date().toISOString(),
    migration_batch: MIGRATION_BATCH,
  };
}

async function fetchRows(supabase, options) {
  const rows = [];
  let offset = options.offset;
  const target = options.limit;

  while (target === null || rows.length < target) {
    const remaining =
      target === null ? options.batchSize : Math.min(options.batchSize, target - rows.length);
    if (remaining <= 0) break;

    const from = offset;
    const to = offset + remaining - 1;
    const { data, error } = await supabase
      .from("published_artworks")
      .select(exportColumns)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (error) throw new Error(`Failed to read published_artworks: ${error.message}`);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < remaining) break;
    offset += batch.length;
  }

  return rows;
}

function validateDocuments(documents) {
  const seen = new Set();
  const duplicateIds = [];
  const missingImages = [];
  const missingTags = [];

  for (const document of documents) {
    if (seen.has(document._id)) duplicateIds.push(document._id);
    seen.add(document._id);
    if (!document.thumbnail_url && !document.display_url) missingImages.push(document._id);
    if (!document.tag_keys.length) missingTags.push(document._id);
  }

  if (duplicateIds.length) {
    throw new Error(`Duplicate WeChat document ids: ${duplicateIds.slice(0, 10).join(", ")}`);
  }

  return {
    total: documents.length,
    missingImages,
    missingTags,
  };
}

function writeJson(filePath, value, pretty) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, pretty ? 2 : 0)}\n`, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage().trim());
    return;
  }

  const env = resolveEnv();
  const { url, anonKey } = resolveSupabaseConfig(env);
  const supabase = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const rows = await fetchRows(supabase, options);
  const documents = rows.map(toWechatArtwork);
  const missingImageDocuments = documents.filter(
    (document) => !document.thumbnail_url && !document.display_url,
  );
  const exportDocuments = options.includeMissingImages
    ? documents
    : documents.filter((document) => document.thumbnail_url || document.display_url);
  const validation = validateDocuments(exportDocuments);
  writeJson(options.out, exportDocuments, options.pretty);
  if (missingImageDocuments.length) {
    writeJson(
      path.join(path.dirname(options.out), "artworks.missing-images.json"),
      missingImageDocuments,
      true,
    );
  }

  console.log(`Exported ${exportDocuments.length} public artworks to ${options.out}`);
  if (!options.includeMissingImages && missingImageDocuments.length) {
    console.log(`Skipped records without image URLs: ${missingImageDocuments.length}`);
  }
  console.log(`Missing image URLs: ${validation.missingImages.length}`);
  console.log(`Records without tags: ${validation.missingTags.length}`);
  console.log("No Supabase data was modified. No WeChat Cloud import was performed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
