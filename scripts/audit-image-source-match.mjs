import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { parseArtworkPage } from "./artvee-ingest.mjs";

const BUCKET = "artwork";
const IMAGE_DIR = "D:/art/csv/images";

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

function idsInRange(start, end) {
  const ids = [];
  for (let number = start; number <= end; number += 1) ids.push(`${number}_standard`);
  return ids;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function fetchBuffer(url) {
  const response = await fetch(url, { headers: { "user-agent": "ArtArchiveDataBuilder/0.1" } });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    bytes: buffer.length,
    hash: sha256(buffer),
    contentType: response.headers.get("content-type") || "",
  };
}

async function fetchArtworkExpected(sourceUrl) {
  if (!sourceUrl) return { sourceUrl, error: "missing source_url" };
  const response = await fetch(sourceUrl, {
    headers: { "user-agent": "ArtArchiveDataBuilder/0.1", accept: "text/html" },
  });
  if (!response.ok) return { sourceUrl, error: `source page HTTP ${response.status}` };
  const artwork = parseArtworkPage(await response.text(), sourceUrl);
  const imageUrl = artwork.downloadUrl || artwork.imageUrl;
  if (!imageUrl)
    return {
      sourceUrl,
      title: artwork.titleEn,
      artist: artwork.artist,
      error: "missing Artvee image URL",
    };
  try {
    return {
      sourceUrl,
      title: artwork.titleEn,
      artist: artwork.artist,
      expectedImageUrl: imageUrl,
      expected: await fetchBuffer(imageUrl),
    };
  } catch (error) {
    return {
      sourceUrl,
      title: artwork.titleEn,
      artist: artwork.artist,
      expectedImageUrl: imageUrl,
      error: error.message,
    };
  }
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
  const start = Number(process.argv[2] || 787);
  const end = Number(process.argv[3] || start);
  const ids = idsInRange(start, end);
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const paintings = await selectInChunks(
    supabase,
    "paintings",
    "id,title_cn,title_en,artist,display_url",
    "id",
    ids,
  );
  const links = await selectInChunks(
    supabase,
    "artwork_images",
    "image_id,artwork_id,display_url,download_url",
    "image_id",
    ids,
  );
  const artworkIds = [...new Set(links.map((row) => row.artwork_id).filter(Boolean))];
  const artworks = artworkIds.length
    ? await selectInChunks(
        supabase,
        "artworks",
        "id,title,artist_display,source_url,source_payload",
        "id",
        artworkIds,
      )
    : [];
  const paintingById = new Map(paintings.map((row) => [row.id, row]));
  const linkById = new Map(links.map((row) => [row.image_id, row]));
  const artworkById = new Map(artworks.map((row) => [row.id, row]));

  const results = [];
  for (const id of ids) {
    const storageUrl = `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${id}.jpg`;
    const localPath = path.join(IMAGE_DIR, `${id}.jpg`);
    const painting = paintingById.get(id) || null;
    const link = linkById.get(id) || null;
    const artwork = link ? artworkById.get(link.artwork_id) || null : null;
    const storage = await fetchBuffer(storageUrl).catch((error) => ({ error: error.message }));
    const local = fs.existsSync(localPath)
      ? { bytes: fs.statSync(localPath).size, hash: sha256(fs.readFileSync(localPath)) }
      : { error: "missing local file" };
    const expected = await fetchArtworkExpected(artwork?.source_url || "");
    results.push({
      id,
      paintingTitle: painting?.title_en || "",
      paintingArtist: painting?.artist || "",
      artworkTitle: artwork?.title || "",
      artworkArtist: artwork?.artist_display || "",
      sourceUrl: artwork?.source_url || "",
      storage,
      local,
      expected: expected.expected || null,
      expectedTitle: expected.title || "",
      expectedArtist: expected.artist || "",
      expectedError: expected.error || "",
      storageMatchesLocal: Boolean(storage.hash && local.hash && storage.hash === local.hash),
      storageMatchesExpected: Boolean(
        storage.hash && expected.expected?.hash && storage.hash === expected.expected.hash,
      ),
      localMatchesExpected: Boolean(
        local.hash && expected.expected?.hash && local.hash === expected.expected.hash,
      ),
    });
  }

  console.log(
    JSON.stringify(
      {
        range: `${start}_standard..${end}_standard`,
        count: results.length,
        storageMatchesExpected: results.filter((row) => row.storageMatchesExpected).length,
        storageMismatchesExpected: results
          .filter((row) => !row.storageMatchesExpected)
          .map((row) => row.id),
        storageMatchesLocal: results.filter((row) => row.storageMatchesLocal).length,
        localMatchesExpected: results.filter((row) => row.localMatchesExpected).length,
        sample: results.slice(0, 10),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
