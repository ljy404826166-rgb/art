import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "artwork";

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

function numericId(id) {
  const match = String(id || "").match(/^(\d+)_standard$/);
  return match ? Number(match[1]) : null;
}

function sortIds(ids) {
  return [...ids].sort((a, b) => (numericId(a) ?? 0) - (numericId(b) ?? 0));
}

function expectedUrl(supabaseUrl, id) {
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${id}.jpg`;
}

function stripUrlCacheBuster(value = "") {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value || "";
  }
}

function urlMatchesExpected(actual = "", expected = "") {
  return stripUrlCacheBuster(actual) === stripUrlCacheBuster(expected);
}

async function selectAll(supabase, table, columns, options = {}) {
  const rows = [];
  const pageSize = options.pageSize || 1000;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    let query = supabase.from(table).select(columns).range(from, to);
    if (options.order) query = query.order(options.order, { ascending: true });
    const { data, error } = await query;
    if (error) throw new Error(`${table} select failed: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function listStorage(supabase) {
  const objects = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(BUCKET).list("", {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`storage list failed: ${error.message}`);
    objects.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return objects.filter((item) => /^\d+_standard\.jpg$/.test(item.name));
}

function summarizeRanges(ids) {
  const nums = sortIds(ids)
    .map(numericId)
    .filter((value) => Number.isInteger(value));
  if (!nums.length) return [];
  const ranges = [];
  let start = nums[0];
  let previous = nums[0];
  for (const current of nums.slice(1)) {
    if (current === previous + 1) {
      previous = current;
      continue;
    }
    ranges.push(
      start === previous ? `${start}_standard` : `${start}_standard..${previous}_standard`,
    );
    start = current;
    previous = current;
  }
  ranges.push(start === previous ? `${start}_standard` : `${start}_standard..${previous}_standard`);
  return ranges;
}

function sample(rows, limit = 20) {
  return rows.slice(0, limit);
}

async function main() {
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const [paintings, artworkImages, artworks, storageObjects] = await Promise.all([
    selectAll(supabase, "paintings", "id,title_cn,title_en,artist,display_url"),
    selectAll(supabase, "artwork_images", "image_id,artwork_id,display_url,download_url"),
    selectAll(supabase, "artworks", "id,title,artist_display,source_url"),
    listStorage(supabase),
  ]);

  const paintingIds = paintings.map((row) => row.id).filter((id) => numericId(id));
  const imageIds = artworkImages.map((row) => row.image_id).filter((id) => numericId(id));
  const storageIds = storageObjects.map((item) => item.name.replace(/\.jpg$/, ""));
  const artworkIds = artworks.map((row) => row.id);

  const paintingSet = new Set(paintingIds);
  const imageSet = new Set(imageIds);
  const storageSet = new Set(storageIds);
  const artworkSet = new Set(artworkIds);

  const missingStorageForPaintings = paintingIds.filter((id) => !storageSet.has(id));
  const storageWithoutPainting = storageIds.filter((id) => !paintingSet.has(id));
  const missingArtworkImageForPaintings = paintingIds.filter((id) => !imageSet.has(id));
  const artworkImageWithoutPainting = imageIds.filter((id) => !paintingSet.has(id));

  const linkRowsWithMissingArtwork = artworkImages
    .filter((row) => numericId(row.image_id) && row.artwork_id && !artworkSet.has(row.artwork_id))
    .map((row) => ({ image_id: row.image_id, artwork_id: row.artwork_id }));

  const paintingDisplayUrlMismatches = paintings
    .filter(
      (row) =>
        numericId(row.id) && !urlMatchesExpected(row.display_url, expectedUrl(supabaseUrl, row.id)),
    )
    .map((row) => ({ id: row.id, display_url: row.display_url || "" }));

  const imageDisplayUrlMismatches = artworkImages
    .filter(
      (row) =>
        numericId(row.image_id) &&
        !urlMatchesExpected(row.display_url, expectedUrl(supabaseUrl, row.image_id)),
    )
    .map((row) => ({ image_id: row.image_id, display_url: row.display_url || "" }));

  const duplicatePaintings = Object.entries(
    paintingIds.reduce((acc, id) => {
      acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {}),
  ).filter(([, count]) => count > 1);

  const duplicateArtworkImages = Object.entries(
    imageIds.reduce((acc, id) => {
      acc[id] = (acc[id] || 0) + 1;
      return acc;
    }, {}),
  ).filter(([, count]) => count > 1);

  const storageMetadataSample = storageObjects
    .filter((item) => {
      const id = item.name.replace(/\.jpg$/, "");
      const n = numericId(id);
      return n >= 780 && n <= 930;
    })
    .map((item) => ({
      name: item.name,
      created_at: item.created_at,
      updated_at: item.updated_at,
      last_accessed_at: item.last_accessed_at,
      size: item.metadata?.size || null,
      mimetype: item.metadata?.mimetype || item.metadata?.mimetype || null,
    }));

  const report = {
    generatedAt: new Date().toISOString(),
    counts: {
      paintings: paintingIds.length,
      artworkImages: imageIds.length,
      artworks: artworks.length,
      storageObjects: storageIds.length,
    },
    idRanges: {
      paintings: summarizeRanges(paintingIds),
      storage: summarizeRanges(storageIds),
      artworkImages: summarizeRanges(imageIds),
    },
    problems: {
      missingStorageForPaintings: {
        count: missingStorageForPaintings.length,
        ranges: summarizeRanges(missingStorageForPaintings),
        sample: sample(sortIds(missingStorageForPaintings)),
      },
      storageWithoutPainting: {
        count: storageWithoutPainting.length,
        ranges: summarizeRanges(storageWithoutPainting),
        sample: sample(sortIds(storageWithoutPainting)),
      },
      missingArtworkImageForPaintings: {
        count: missingArtworkImageForPaintings.length,
        ranges: summarizeRanges(missingArtworkImageForPaintings),
        sample: sample(sortIds(missingArtworkImageForPaintings)),
      },
      artworkImageWithoutPainting: {
        count: artworkImageWithoutPainting.length,
        ranges: summarizeRanges(artworkImageWithoutPainting),
        sample: sample(sortIds(artworkImageWithoutPainting)),
      },
      linkRowsWithMissingArtwork: {
        count: linkRowsWithMissingArtwork.length,
        sample: sample(linkRowsWithMissingArtwork),
      },
      paintingDisplayUrlMismatches: {
        count: paintingDisplayUrlMismatches.length,
        sample: sample(paintingDisplayUrlMismatches),
      },
      imageDisplayUrlMismatches: {
        count: imageDisplayUrlMismatches.length,
        sample: sample(imageDisplayUrlMismatches),
      },
      duplicatePaintings,
      duplicateArtworkImages,
    },
    storageMetadataSample,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
