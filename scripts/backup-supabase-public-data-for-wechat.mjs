import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_BACKUP_ROOT = "backups/supabase";
const DEFAULT_CLOUDBASE_OUTPUT = "miniapp/data/artworks.cloudbase.json";
const DEFAULT_BATCH_SIZE = 1000;
const PUBLIC_DATASETS = [
  { name: "sources", order: "created_at" },
  { name: "artists", order: "created_at" },
  { name: "artworks", order: "created_at" },
  { name: "artwork_images", order: "created_at" },
  { name: "artwork_notes", order: "created_at" },
  { name: "ingestion_runs", order: "started_at" },
  { name: "published_artworks", order: "created_at", isView: true },
];

const publishedArtworkFields = [
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
Back up Supabase public artwork data locally and generate WeChat Cloud JSON Lines.

Usage:
  node scripts/backup-supabase-public-data-for-wechat.mjs [options]

Options:
  --backup-root <path>       Backup root directory. Default: ${DEFAULT_BACKUP_ROOT}
  --cloudbase-out <path>     JSON Lines output path. Default: ${DEFAULT_CLOUDBASE_OUTPUT}
  --batch-size <number>      Read page size. Default: ${DEFAULT_BATCH_SIZE}
  --help                     Show help.

Safety:
  - Read-only Supabase access.
  - Backs up public business datasets only.
  - Does not export auth schema.
  - Does not upload/import to WeChat Cloud.
  - Does not modify or delete Supabase data.
`;
}

function parseArgs(argv) {
  const options = {
    backupRoot: DEFAULT_BACKUP_ROOT,
    cloudbaseOut: DEFAULT_CLOUDBASE_OUTPUT,
    batchSize: DEFAULT_BATCH_SIZE,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--backup-root") {
      options.backupRoot = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--cloudbase-out") {
      options.cloudbaseOut = requiredValue(argv, (index += 1), arg);
    } else if (arg === "--batch-size") {
      options.batchSize = parsePositiveInteger(requiredValue(argv, (index += 1), arg), arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
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
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
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
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.VITE_SUPABASE_ANON_KEY ||
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    env.SUPABASE_ANON_KEY;

  if (!url) throw new Error("Missing Supabase URL.");
  if (!key) throw new Error("Missing Supabase key.");

  return {
    url,
    key,
    keyKind: env.SUPABASE_SERVICE_ROLE_KEY ? "service_role" : "public",
  };
}

function timestampForPath() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function nullableString(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function normalizeTags(tags, tagsText) {
  const raw = Array.isArray(tags) ? tags : typeof tags === "string" ? tags.split(/[,，；、\s]+/u) : [];
  const fromText = typeof tagsText === "string" ? tagsText.split(/[,，；、\s]+/u) : [];
  return [...new Set([...raw, ...fromText].map((tag) => String(tag || "").trim()).filter(Boolean))];
}

function toCloudbaseArtwork(row, batchId) {
  const id = nullableString(row.id);
  if (!id) throw new Error("Encountered published artwork without id.");

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
    migration_batch: batchId,
  };
}

async function fetchAllRows(supabase, dataset, batchSize) {
  const rows = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from(dataset.name)
      .select(dataset.isView ? publishedArtworkFields : "*")
      .range(offset, offset + batchSize - 1);

    if (dataset.order) query = query.order(dataset.order, { ascending: false });

    const { data, error } = await query;
    if (error) throw new Error(`${dataset.name}: ${error.message}`);

    const batch = data || [];
    rows.push(...batch);
    if (batch.length < batchSize) break;
    offset += batch.length;
  }

  return rows;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonLines(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage().trim());
    return;
  }

  const env = resolveEnv();
  const { url, key, keyKind } = resolveSupabaseConfig(env);
  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const runId = timestampForPath();
  const batchId = `supabase-public-backup-${runId.slice(0, 10)}`;
  const backupDir = path.join(options.backupRoot, runId);
  const manifest = {
    run_id: runId,
    created_at: new Date().toISOString(),
    source: "Supabase public schema business datasets",
    key_kind: keyKind,
    datasets: [],
    cloudbase_output: options.cloudbaseOut,
    notes: [
      "Read-only backup.",
      "Auth schema and private user data were not exported.",
      "No WeChat Cloud import was performed.",
    ],
  };

  let publishedRows = [];
  for (const dataset of PUBLIC_DATASETS) {
    const rows = await fetchAllRows(supabase, dataset, options.batchSize);
    writeJson(path.join(backupDir, `${dataset.name}.json`), rows);
    manifest.datasets.push({ name: dataset.name, rows: rows.length, file: `${dataset.name}.json` });
    if (dataset.name === "published_artworks") publishedRows = rows;
    console.log(`${dataset.name}: ${rows.length} rows`);
  }

  const cloudbaseRows = publishedRows.map((row) => toCloudbaseArtwork(row, batchId));
  writeJsonLines(options.cloudbaseOut, cloudbaseRows);
  writeJson(path.join(backupDir, "published_artworks.cloudbase.jsonl"), cloudbaseRows);
  manifest.cloudbase_rows = cloudbaseRows.length;
  writeJson(path.join(backupDir, "manifest.json"), manifest);

  console.log(`Backup directory: ${backupDir}`);
  console.log(`WeChat Cloud JSON Lines: ${options.cloudbaseOut}`);
  console.log("No Supabase data was modified. No WeChat Cloud import was performed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
