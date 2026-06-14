import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const DEFAULT_LIMIT = 20;
const DEFAULT_OFFSET = 0;
const DEFAULT_BUCKET = "artwork";
const DEFAULT_MANIFEST = "./image-derivatives-manifest.json";
const DEFAULT_ROLLBACK_MANIFEST = "./image-derivatives-rollback.json";
const THUMB_WIDTH = 420;
const DISPLAY_WIDTH = 1400;

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    apply: false,
    dryRun: true,
    limit: DEFAULT_LIMIT,
    offset: DEFAULT_OFFSET,
    manifest: DEFAULT_MANIFEST,
    rollbackManifest: DEFAULT_ROLLBACK_MANIFEST,
    bucket: DEFAULT_BUCKET,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") {
      args.apply = true;
      args.dryRun = false;
    } else if (value === "--dry-run") {
      args.dryRun = true;
      args.apply = false;
    } else if (value === "--limit") {
      args.limit = Number(argv[++index]);
    } else if (value === "--offset") {
      args.offset = Number(argv[++index]);
    } else if (value === "--manifest") {
      args.manifest = String(argv[++index] || "").trim();
    } else if (value === "--rollback-manifest") {
      args.rollbackManifest = String(argv[++index] || "").trim();
    } else if (value === "--bucket") {
      args.bucket = String(argv[++index] || "").trim();
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20) {
    throw new Error("--limit must be an integer between 1 and 20.");
  }
  if (!Number.isInteger(args.offset) || args.offset < 0) {
    throw new Error("--offset must be a non-negative integer.");
  }
  if (!args.manifest) throw new Error("--manifest is required.");
  if (!args.rollbackManifest) throw new Error("--rollback-manifest is required.");
  if (!args.bucket) throw new Error("--bucket is required.");
  return args;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let envValue = match[2].trim();
    if ((envValue.startsWith('"') && envValue.endsWith('"')) || (envValue.startsWith("'") && envValue.endsWith("'"))) {
      envValue = envValue.slice(1, -1);
    }
    env[match[1]] = envValue;
  }
  return env;
}

function loadEnv() {
  return {
    ...loadEnvFile(".env"),
    ...loadEnvFile(".env.local"),
    ...process.env,
  };
}

function createSupabase({ apply }) {
  const env = loadEnv();
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL or VITE_SUPABASE_URL.");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");

  return {
    supabase: createClient(supabaseUrl, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }),
    supabaseUrl,
  };
}

function isStoragePublicUrl(value) {
  return /https?:\/\/[^/]*supabase\.co\/storage\/v1\/object\/public\//i.test(String(value || ""));
}

function isEligible(row) {
  const thumbnailUrl = String(row.thumbnail_url || "").trim();
  const displayUrl = String(row.display_url || "").trim();
  const downloadUrl = String(row.download_url || "").trim();
  return Boolean(
    thumbnailUrl &&
      displayUrl &&
      downloadUrl &&
      thumbnailUrl === displayUrl &&
      displayUrl === downloadUrl &&
      isStoragePublicUrl(downloadUrl),
  );
}

function safeImageId(row) {
  const raw = String(row.image_id || row.artwork_id || row.id || "").trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!safe) throw new Error(`Unable to build image id for row ${row.id}`);
  return safe;
}

function publicUrlForObject(supabaseUrl, bucket, objectPath) {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${objectPath}`;
}

function sanitizedUrl(value) {
  const text = String(value || "");
  if (!text) return "";
  try {
    const url = new URL(text);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return text.slice(0, 160);
  }
}

function objectPaths(imageId) {
  return {
    thumbnailObjectPath: `derivatives/thumb/${imageId}.webp`,
    displayObjectPath: `derivatives/display/${imageId}.webp`,
  };
}

function buildManifestRow(row, supabaseUrl, bucket) {
  const imageId = safeImageId(row);
  const paths = objectPaths(imageId);
  return {
    artworkImageId: row.id,
    artworkId: row.artwork_id,
    imageId,
    sourceUrl: row.download_url,
    currentThumbnailUrl: row.thumbnail_url,
    currentDisplayUrl: row.display_url,
    currentDownloadUrl: row.download_url,
    thumbnailObjectPath: paths.thumbnailObjectPath,
    displayObjectPath: paths.displayObjectPath,
    thumbnailPublicUrl: publicUrlForObject(supabaseUrl, bucket, paths.thumbnailObjectPath),
    displayPublicUrl: publicUrlForObject(supabaseUrl, bucket, paths.displayObjectPath),
    sourcePath: sanitizedUrl(row.download_url),
  };
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadSharp() {
  try {
    const module = await import("sharp");
    return module.default || module;
  } catch (error) {
    throw new Error("sharp is required for --apply. Install it with: npm.cmd install --save-dev sharp");
  }
}

async function fetchSourceImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Source fetch failed (${response.status}) for ${sanitizedUrl(url)}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`Source is not an image (${contentType}) for ${sanitizedUrl(url)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function makeDerivative(sharp, buffer, width, quality) {
  return sharp(buffer)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality })
    .toBuffer();
}

async function uploadDerivative(supabase, bucket, objectPath, buffer) {
  const { error } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(`Upload failed for ${objectPath}: ${error.message}`);
}

async function objectExists(supabase, bucket, objectPath) {
  const directory = path.posix.dirname(objectPath);
  const fileName = path.posix.basename(objectPath);
  const { data, error } = await supabase.storage.from(bucket).list(directory, {
    limit: 100,
    search: fileName,
  });
  if (error) throw new Error(`Storage object check failed for ${objectPath}: ${error.message}`);
  return Array.isArray(data) && data.some((item) => item.name === fileName);
}

async function validateCurrentArtworkImage(supabase, row) {
  const { data, error } = await supabase
    .from("artwork_images")
    .select("id,artwork_id,image_id,thumbnail_url,display_url,download_url")
    .eq("image_id", row.imageId)
    .limit(2);

  if (error) throw new Error(`DB validation failed for ${row.imageId}: ${error.message}`);
  if (!Array.isArray(data) || data.length !== 1) {
    return { ok: false, reason: "skipped_db_changed", detail: "image_id lookup did not return exactly one row" };
  }

  const current = data[0];
  if (current.id !== row.artworkImageId || !isEligible(current)) {
    return { ok: false, reason: "skipped_db_changed", detail: "current DB URLs are no longer eligible" };
  }

  return { ok: true, current };
}

async function updateArtworkImage(supabase, row) {
  const validation = await validateCurrentArtworkImage(supabase, row);
  if (!validation.ok) {
    return {
      updated: false,
      skipped: true,
      reason: validation.reason,
      detail: validation.detail,
    };
  }

  const { error } = await supabase
    .from("artwork_images")
    .update({
      thumbnail_url: row.thumbnailPublicUrl,
      display_url: row.displayPublicUrl,
    })
    .eq("id", row.artworkImageId);
  if (error) throw new Error(`DB update failed for ${row.artworkImageId}: ${error.message}`);
  return { updated: true, skipped: false, reason: "" };
}

function rollbackRowFor(row) {
  return {
    image_id: row.imageId,
    artwork_image_id: row.artworkImageId,
    previous_thumbnail_url: row.currentThumbnailUrl,
    previous_display_url: row.currentDisplayUrl,
    previous_download_url: row.currentDownloadUrl,
    new_thumbnail_url: row.thumbnailPublicUrl,
    new_display_url: row.displayPublicUrl,
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const args = parseArgs();
  const { supabase, supabaseUrl } = createSupabase({ apply: args.apply });
  const from = args.offset;
  const to = args.offset + args.limit - 1;

  const { data, error } = await supabase
    .from("artwork_images")
    .select("id,artwork_id,image_id,thumbnail_url,display_url,download_url,created_at")
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw new Error(`Failed to read artwork_images: ${error.message}`);

  const rows = data || [];
  const eligibleRows = rows.filter(isEligible);
  const manifestRows = eligibleRows.map((row) => buildManifestRow(row, supabaseUrl, args.bucket));
  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: args.apply ? "apply" : "dry-run",
    dryRun: args.dryRun,
    apply: args.apply,
    bucket: args.bucket,
    limit: args.limit,
    offset: args.offset,
    sourceTable: "artwork_images",
    derivativeFormat: "webp",
    thumbnail: { width: THUMB_WIDTH, quality: 75 },
    display: { width: DISPLAY_WIDTH, quality: 82 },
    readRows: rows.length,
    eligibleRows: eligibleRows.length,
    skippedRows: rows.length - eligibleRows.length,
    rows: manifestRows,
  };

  if (!args.apply) {
    writeJson(args.manifest, manifest);
    console.log(JSON.stringify({
      mode: "dry-run",
      manifest: args.manifest,
      readRows: rows.length,
      eligibleRows: eligibleRows.length,
      skippedRows: rows.length - eligibleRows.length,
      note: "No images downloaded, no files uploaded, no database rows updated.",
    }, null, 2));
    return;
  }

  const sharp = await loadSharp();
  const processedRows = [];
  const rollbackRows = [];

  for (const row of manifestRows) {
    const thumbnailExists = await objectExists(supabase, args.bucket, row.thumbnailObjectPath);
    const displayExists = await objectExists(supabase, args.bucket, row.displayObjectPath);
    if (thumbnailExists || displayExists) {
      const skipped = {
        ...row,
        updated: false,
        skipped: true,
        reason: "skipped_object_exists",
        thumbnailObjectExists: thumbnailExists,
        displayObjectExists: displayExists,
      };
      processedRows.push(skipped);
      console.log(JSON.stringify({
        imageId: row.imageId,
        thumbnailObjectPath: row.thumbnailObjectPath,
        displayObjectPath: row.displayObjectPath,
        updated: false,
        skipped: true,
        reason: "skipped_object_exists",
        thumbnailObjectExists: thumbnailExists,
        displayObjectExists: displayExists,
      }));
      continue;
    }

    let thumbnailBuffer;
    let displayBuffer;
    try {
      const source = await fetchSourceImage(row.sourceUrl);
      thumbnailBuffer = await makeDerivative(sharp, source, THUMB_WIDTH, 75);
      displayBuffer = await makeDerivative(sharp, source, DISPLAY_WIDTH, 82);
    } catch (error) {
      const failed = {
        ...row,
        updated: false,
        skipped: true,
        reason: "source_or_derivative_failed",
        error: error instanceof Error ? error.message : String(error),
      };
      processedRows.push(failed);
      console.log(JSON.stringify({
        imageId: row.imageId,
        updated: false,
        skipped: true,
        reason: failed.reason,
        error: failed.error,
      }));
      continue;
    }

    try {
      await uploadDerivative(supabase, args.bucket, row.thumbnailObjectPath, thumbnailBuffer);
      await uploadDerivative(supabase, args.bucket, row.displayObjectPath, displayBuffer);
    } catch (error) {
      const failed = {
        ...row,
        thumbnailBytes: thumbnailBuffer.length,
        displayBytes: displayBuffer.length,
        updated: false,
        skipped: true,
        reason: "upload_failed",
        error: error instanceof Error ? error.message : String(error),
      };
      processedRows.push(failed);
      console.log(JSON.stringify({
        imageId: row.imageId,
        updated: false,
        skipped: true,
        reason: failed.reason,
        error: failed.error,
      }));
      continue;
    }

    const updateResult = await updateArtworkImage(supabase, row);
    if (updateResult.updated) rollbackRows.push(rollbackRowFor(row));

    processedRows.push({
      ...row,
      thumbnailBytes: thumbnailBuffer.length,
      displayBytes: displayBuffer.length,
      updated: updateResult.updated,
      skipped: updateResult.skipped,
      reason: updateResult.reason,
    });

    console.log(JSON.stringify({
      imageId: row.imageId,
      sourcePath: row.sourcePath,
      thumbnailObjectPath: row.thumbnailObjectPath,
      displayObjectPath: row.displayObjectPath,
      thumbnailBytes: thumbnailBuffer.length,
      displayBytes: displayBuffer.length,
      updated: updateResult.updated,
      skipped: updateResult.skipped,
      reason: updateResult.reason,
    }));
  }

  writeJson(args.manifest, {
    ...manifest,
    processedAt: new Date().toISOString(),
    rows: processedRows,
  });
  writeJson(args.rollbackManifest, {
    version: 1,
    generatedAt: new Date().toISOString(),
    sourceManifest: args.manifest,
    note: "Rollback restores database URLs only. It does not delete derivative Storage objects.",
    rows: rollbackRows,
  });

  console.log(JSON.stringify({
    mode: "apply",
    manifest: args.manifest,
    rollbackManifest: args.rollbackManifest,
    readRows: rows.length,
    eligibleRows: eligibleRows.length,
    uploadedObjects: processedRows.filter((row) => row.updated).length * 2,
    updatedRows: processedRows.filter((row) => row.updated).length,
    skippedRows: processedRows.filter((row) => row.skipped).length,
    note: "download_url preserved; original objects were not deleted or overwritten.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
