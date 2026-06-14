#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_IMAGE_DIR = path.resolve(process.cwd(), "csv", "images");
const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), "csv", "cos-migration");
const DEFAULT_COS_DOMAIN = "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com";
const DEFAULT_COS_PREFIX = "ppaintings";
const OLD_STORAGE_RE = /supabase\.co\/storage\/v1\/object\/public\/artwork\//i;
const JPG_RE = /^[A-Za-z0-9_-]+\.jpg$/i;

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function env() {
  return {
    ...parseEnvFile(".env"),
    ...parseEnvFile(".env.local"),
    ...process.env,
  };
}

function parseArgs(argv) {
  const options = {
    run: false,
    imageDir: DEFAULT_IMAGE_DIR,
    reportDir: DEFAULT_REPORT_DIR,
    cosDomain: process.env.TENCENT_COS_DOMAIN || DEFAULT_COS_DOMAIN,
    cosPrefix: process.env.TENCENT_COS_PREFIX || DEFAULT_COS_PREFIX,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--run") {
      options.run = true;
    } else if (arg === "--image-dir") {
      options.imageDir = path.resolve(required(argv, (i += 1), arg));
    } else if (arg === "--report-dir") {
      options.reportDir = path.resolve(required(argv, (i += 1), arg));
    } else if (arg === "--cos-domain") {
      options.cosDomain = required(argv, (i += 1), arg);
    } else if (arg === "--cos-prefix") {
      options.cosPrefix = required(argv, (i += 1), arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  options.cosDomain = options.cosDomain.replace(/\/+$/g, "");
  options.cosPrefix = options.cosPrefix.replace(/^\/+|\/+$/g, "");
  return options;
}

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function imageIds(imageDir) {
  return new Set(
    fs
      .readdirSync(imageDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && JPG_RE.test(entry.name))
      .map((entry) => entry.name.replace(/\.jpg$/i, "")),
  );
}

function cosUrl(id, options) {
  const objectName = `${id}.jpg`.split("/").map(encodeURIComponent).join("/");
  return `${options.cosDomain}/${options.cosPrefix ? `${options.cosPrefix}/` : ""}${objectName}`;
}

async function selectAll(supabase, table, columns, orderColumn) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table} select failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function updateInSeries(items, worker) {
  const failures = [];
  for (const item of items) {
    try {
      await worker(item);
    } catch (error) {
      failures.push({ item, error: error.message });
    }
  }
  return failures;
}

function log(message) {
  console.log(`[cos-db-url] ${message}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = env();
  const supabaseUrl = config.SUPABASE_URL || config.VITE_SUPABASE_URL;
  const serviceKey = config.SUPABASE_SERVICE_ROLE_KEY || config.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");

  const idsWithImages = imageIds(options.imageDir);
  fs.mkdirSync(options.reportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const backupPath = path.join(options.reportDir, `supabase-image-url-backup-${timestamp}.json`);
  const reportPath = path.join(options.reportDir, `supabase-image-url-migration-${timestamp}.json`);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const paintings = await selectAll(supabase, "paintings", "id,display_url", "id");
  const imageLinks = await selectAll(
    supabase,
    "artwork_images",
    "id,image_id,thumbnail_url,display_url,download_url",
    "image_id",
  );

  fs.writeFileSync(
    backupPath,
    `${JSON.stringify({ created_at: new Date().toISOString(), paintings, artwork_images: imageLinks }, null, 2)}\n`,
    "utf8",
  );

  const paintingTargets = paintings
    .filter((row) => idsWithImages.has(row.id))
    .map((row) => ({ ...row, next_display_url: cosUrl(row.id, options) }))
    .filter((row) => row.display_url !== row.next_display_url);
  const imageTargets = imageLinks
    .filter((row) => idsWithImages.has(row.image_id))
    .map((row) => ({
      ...row,
      next_thumbnail_url: cosUrl(row.image_id, options),
      next_display_url: cosUrl(row.image_id, options),
      next_download_url: cosUrl(row.image_id, options),
    }))
    .filter(
      (row) =>
        row.thumbnail_url !== row.next_thumbnail_url
        || row.display_url !== row.next_display_url
        || row.download_url !== row.next_download_url,
    );

  const summary = {
    dry_run: !options.run,
    image_files: idsWithImages.size,
    paintings_total: paintings.length,
    artwork_images_total: imageLinks.length,
    paintings_old_supabase_urls: paintings.filter((row) => OLD_STORAGE_RE.test(row.display_url || "")).length,
    artwork_images_old_supabase_urls: imageLinks.filter((row) =>
      [row.thumbnail_url, row.display_url, row.download_url].some((value) => OLD_STORAGE_RE.test(value || "")),
    ).length,
    paintings_to_update: paintingTargets.length,
    artwork_images_to_update: imageTargets.length,
    paintings_skipped_no_local_image: paintings.filter((row) => !idsWithImages.has(row.id)).map((row) => row.id),
    artwork_images_skipped_no_local_image: imageLinks.filter((row) => !idsWithImages.has(row.image_id)).map((row) => row.image_id),
    backup_path: backupPath,
    report_path: reportPath,
    failures: [],
  };

  log(`Backup written: ${backupPath}`);
  log(`Paintings to update: ${summary.paintings_to_update}/${summary.paintings_total}`);
  log(`Artwork image links to update: ${summary.artwork_images_to_update}/${summary.artwork_images_total}`);

  if (options.run) {
    const paintingFailures = await updateInSeries(paintingTargets, async (row) => {
      const { error } = await supabase.from("paintings").update({ display_url: row.next_display_url }).eq("id", row.id);
      if (error) throw new Error(error.message);
    });
    const imageFailures = await updateInSeries(imageTargets, async (row) => {
      const { error } = await supabase
        .from("artwork_images")
        .update({
          thumbnail_url: row.next_thumbnail_url,
          display_url: row.next_display_url,
          download_url: row.next_download_url,
        })
        .eq("id", row.id);
      if (error) throw new Error(error.message);
    });
    summary.failures = [
      ...paintingFailures.map((failure) => ({ table: "paintings", id: failure.item.id, error: failure.error })),
      ...imageFailures.map((failure) => ({ table: "artwork_images", id: failure.item.image_id, row_id: failure.item.id, error: failure.error })),
    ];
  }

  fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  log(`Report written: ${reportPath}`);
  console.log(JSON.stringify(summary, null, 2));
  if (summary.failures.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
