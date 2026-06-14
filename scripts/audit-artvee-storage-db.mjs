import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "artwork";
const UNKNOWN = "暂不明确";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!fs.existsSync(file)) continue;
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (ch === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value !== ""));
}

function csvRows(csvPath) {
  const table = parseCsv(fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, ""));
  const header = table[0] || [];
  return table.slice(1).map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""])));
}

function numericId(id) {
  const match = String(id || "").match(/^(\d+)_standard$/);
  return match ? Number(match[1]) : 0;
}

function expectedUrl(baseUrl, id) {
  return `${baseUrl}/storage/v1/object/public/${BUCKET}/${id}.jpg`;
}

function stripUrlCacheBuster(value = "") {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value;
  }
}

function urlMatchesExpected(actual = "", expected = "") {
  return stripUrlCacheBuster(actual) === stripUrlCacheBuster(expected);
}

async function headOk(url, retries = 2) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      return { ok: response.ok, status: response.status };
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  return { ok: false, status: 0, error: lastError?.message || String(lastError) };
}

async function listStorageIds(supabase) {
  const ids = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(BUCKET).list("", {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    if (!data?.length) break;
    ids.push(...data.map((item) => item.name).filter((name) => /^\d+_standard\.jpg$/.test(name)).map((name) => name.replace(/\.jpg$/, "")));
    if (data.length < 1000) break;
  }
  return ids;
}

async function selectInChunks(supabase, table, columns, field, values, chunkSize = 100) {
  const rows = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    const chunk = values.slice(index, index + chunkSize);
    const { data, error } = await supabase.from(table).select(columns).in(field, chunk);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

async function main() {
  loadEnv();
  const mode = process.argv.includes("--global") ? "global" : "batch";
  const csvPath = process.argv.slice(2).find((arg) => !arg.startsWith("--")) || "";
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const rows = csvPath ? csvRows(csvPath) : [];
  const ids = mode === "batch" ? rows.map((row) => row.id) : await listStorageIds(supabase);

  const paintings = await selectInChunks(
    supabase,
    "paintings",
    "id,title_cn,title_en,location,year_and_place,medium,dimensions,description,tags,display_url",
    "id",
    ids,
  );

  const links = await selectInChunks(
    supabase,
    "artwork_images",
    "image_id,display_url,download_url,artwork_id",
    "image_id",
    ids,
  );

  const artworkIds = [...new Set((links || []).map((link) => link.artwork_id).filter(Boolean))];
  const artworks = await selectInChunks(supabase, "artworks", "id,source_url", "id", artworkIds);

  const paintingById = new Map((paintings || []).map((row) => [row.id, row]));
  const linkById = new Map((links || []).map((row) => [row.image_id, row]));
  const artworkById = new Map((artworks || []).map((row) => [row.id, row]));
  const storageChecks = [];
  for (const id of ids) storageChecks.push({ id, ...(await headOk(expectedUrl(supabaseUrl, id))) });

  const unresolved = {};
  for (const key of ["title_cn", "title_en", "location", "year_and_place", "medium", "dimensions", "description", "tags"]) {
    unresolved[key] = (paintings || []).filter((row) => !row[key] || row[key] === UNKNOWN).length;
  }

  const report = {
    mode,
    csvPath: csvPath || null,
    ids: ids.length,
    firstId: ids.slice().sort((a, b) => numericId(a) - numericId(b))[0] || null,
    lastId: ids.slice().sort((a, b) => numericId(a) - numericId(b)).at(-1) || null,
    paintingsFound: paintings?.length || 0,
    missingPaintings: ids.filter((id) => !paintingById.has(id)),
    artworkImageLinksFound: links?.length || 0,
    missingArtworkImageLinks: ids.filter((id) => !linkById.has(id)),
    storageOk: storageChecks.filter((item) => item.ok).length,
    storageMissing: storageChecks.filter((item) => !item.ok),
    paintingDisplayUrlMismatches: (paintings || []).filter((row) => !urlMatchesExpected(row.display_url, expectedUrl(supabaseUrl, row.id))).map((row) => row.id),
    imageLinkUrlMismatches: (links || []).filter((row) => !urlMatchesExpected(row.display_url, expectedUrl(supabaseUrl, row.image_id))).map((row) => row.image_id),
    nonArtveeArtworkSources: (links || [])
      .map((link) => ({ image_id: link.image_id, source_url: artworkById.get(link.artwork_id)?.source_url || "" }))
      .filter((row) => row.source_url && !row.source_url.startsWith("https://artvee.com/")),
    unresolved,
    badDescriptionLengths: (paintings || [])
      .filter((row) => !row.description || row.description.length < 250 || row.description.length > 400)
      .map((row) => row.id),
  };

  console.log(JSON.stringify(report, null, 2));
}

await main();
