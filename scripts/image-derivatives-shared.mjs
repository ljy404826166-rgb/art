import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export const DEFAULT_BUCKET = "artwork";
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 20;

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    dryRun: true,
    limit: DEFAULT_LIMIT,
    bucket: DEFAULT_BUCKET,
    input: "",
    output: "",
    rollbackOutput: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--dry-run") {
      args.dryRun = true;
    } else if (value === "--execute") {
      args.dryRun = false;
    } else if (value === "--limit") {
      args.limit = Number(argv[++index]);
    } else if (value === "--bucket") {
      args.bucket = String(argv[++index] || "").trim();
    } else if (value === "--input") {
      args.input = String(argv[++index] || "").trim();
    } else if (value === "--output") {
      args.output = String(argv[++index] || "").trim();
    } else if (value === "--rollback-output") {
      args.rollbackOutput = String(argv[++index] || "").trim();
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > MAX_LIMIT) {
    throw new Error(`--limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
  if (!args.bucket) {
    throw new Error("--bucket cannot be empty");
  }

  return args;
}

export function loadLocalEnv(cwd = process.cwd()) {
  for (const fileName of [".env", ".env.local"]) {
    const filePath = path.join(cwd, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const content = fs.readFileSync(filePath, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex === -1) {
        continue;
      }
      const key = trimmed.slice(0, separatorIndex).trim();
      const rawValue = trimmed.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }
}

export function getSupabaseEnv() {
  loadLocalEnv();
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!supabaseUrl) {
    throw new Error("Missing VITE_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }
  return { supabaseUrl, serviceRoleKey };
}

export function createSupabaseClient() {
  const { supabaseUrl, serviceRoleKey } = getSupabaseEnv();
  return {
    supabase: createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }),
    supabaseUrl,
  };
}

export function derivativeObjectPaths(imageId) {
  const safeImageId = String(imageId || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "-");
  if (!safeImageId) {
    throw new Error("imageId is required");
  }
  return {
    thumbnailObjectPath: `derivatives/thumb/${safeImageId}.webp`,
    displayObjectPath: `derivatives/display/${safeImageId}.webp`,
  };
}

export function publicStorageUrl(supabaseUrl, bucket, objectPath) {
  return `${String(supabaseUrl).replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${objectPath}`;
}

export function sanitizedUrlPath(value) {
  try {
    const url = new URL(value);
    return url.pathname;
  } catch {
    return "";
  }
}

export function isStoragePublicUrl(value) {
  const pathname = sanitizedUrlPath(value);
  return pathname.includes("/storage/v1/object/public/");
}

export function isEligibleImageRow(row) {
  if (!row?.thumbnail_url || !row?.display_url || !row?.download_url) {
    return false;
  }
  return (
    row.thumbnail_url === row.display_url &&
    row.display_url === row.download_url &&
    isStoragePublicUrl(row.download_url)
  );
}

export function manifestRowForImageRow(row, { supabaseUrl, bucket = DEFAULT_BUCKET }) {
  const imageId = row.image_id || row.id;
  const paths = derivativeObjectPaths(imageId);
  return {
    artworkImageId: row.id,
    artworkId: row.artwork_id || null,
    imageId,
    title: row.title_cn || row.title || "",
    sourceUrl: row.download_url,
    currentThumbnailUrl: row.thumbnail_url,
    currentDisplayUrl: row.display_url,
    currentDownloadUrl: row.download_url,
    ...paths,
    thumbnailPublicUrl: publicStorageUrl(supabaseUrl, bucket, paths.thumbnailObjectPath),
    displayPublicUrl: publicStorageUrl(supabaseUrl, bucket, paths.displayObjectPath),
  };
}

export function updatePayloadForManifestRow(row) {
  return {
    id: row.artworkImageId,
    thumbnail_url: row.thumbnailPublicUrl,
    display_url: row.displayPublicUrl,
  };
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, data) {
  const absolutePath = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(data, null, 2)}\n`);
  return absolutePath;
}

export function describeMode(dryRun) {
  return dryRun ? "dry-run" : "execute";
}
