import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    apply: false,
    manifest: "./image-derivatives-rollback.json",
    limit: 20,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--apply") {
      args.apply = true;
    } else if (value === "--dry-run") {
      args.apply = false;
    } else if (value === "--manifest") {
      args.manifest = String(argv[++index] || "").trim();
    } else if (value === "--limit") {
      args.limit = Number(argv[++index]);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!args.manifest) throw new Error("--manifest is required.");
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20) {
    throw new Error("--limit must be an integer between 1 and 20.");
  }
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

function createSupabase() {
  const env = loadEnv();
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL or VITE_SUPABASE_URL.");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");

  return createClient(supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function readRollbackManifest(filePath) {
  const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!Array.isArray(manifest.rows)) {
    throw new Error("Rollback manifest must contain a rows array.");
  }
  return manifest;
}

async function rollbackRow(supabase, row) {
  const { error } = await supabase
    .from("artwork_images")
    .update({
      thumbnail_url: row.previous_thumbnail_url,
      display_url: row.previous_display_url,
      download_url: row.previous_download_url,
    })
    .eq("id", row.artwork_image_id);

  if (error) throw new Error(`Rollback failed for ${row.image_id}: ${error.message}`);
}

async function main() {
  const args = parseArgs();
  const manifest = readRollbackManifest(args.manifest);
  const rows = manifest.rows.slice(0, args.limit);

  if (!args.apply) {
    console.log(JSON.stringify({
      mode: "dry-run",
      manifest: args.manifest,
      candidateRows: rows.length,
      note: "No database rows updated and no Storage objects deleted. Re-run with --apply to restore URLs.",
    }, null, 2));
    return;
  }

  const supabase = createSupabase();
  let restoredRows = 0;
  for (const row of rows) {
    await rollbackRow(supabase, row);
    restoredRows += 1;
    console.log(JSON.stringify({
      imageId: row.image_id,
      artworkImageId: row.artwork_image_id,
      restored: true,
    }));
  }

  console.log(JSON.stringify({
    mode: "apply",
    manifest: args.manifest,
    restoredRows,
    note: "Rollback restored database URLs only. Derivative Storage objects were not deleted.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
