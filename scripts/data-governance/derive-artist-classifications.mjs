#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATEGORY_CATALOG_VERSION,
  REGION_TERMS,
  deriveAllArtistClassifications,
  selectPilotArtists,
} from "./artist-classification.mjs";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), "outputs", "artist-classification");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

function env() {
  return { ...parseEnvFile(".env"), ...parseEnvFile(".env.local"), ...process.env };
}

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function positiveInteger(value, flag) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error(`${flag} must be a positive integer.`);
  return number;
}

export function parseArgs(argv = []) {
  const options = {
    run: false,
    envId: process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID || DEFAULT_ENV_ID,
    artistsCollection: "artists",
    artworksCollection: "artworks",
    reportDir: DEFAULT_REPORT_DIR,
    pilot: 0,
    batchSize: 20,
    max: 5,
    minCount: 2,
    minRatio: 0.1,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--run") options.run = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--env-id") options.envId = required(argv, (index += 1), arg);
    else if (arg === "--artists") options.artistsCollection = required(argv, (index += 1), arg);
    else if (arg === "--artworks") options.artworksCollection = required(argv, (index += 1), arg);
    else if (arg === "--report-dir")
      options.reportDir = path.resolve(required(argv, (index += 1), arg));
    else if (arg === "--pilot")
      options.pilot = positiveInteger(required(argv, (index += 1), arg), arg);
    else if (arg === "--batch-size")
      options.batchSize = positiveInteger(required(argv, (index += 1), arg), arg);
    else if (arg === "--max") options.max = positiveInteger(required(argv, (index += 1), arg), arg);
    else if (arg === "--min-count")
      options.minCount = positiveInteger(required(argv, (index += 1), arg), arg);
    else if (arg === "--min-ratio") options.minRatio = Number(required(argv, (index += 1), arg));
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.batchSize > 50) throw new Error("--batch-size must be <= 50.");
  if (!Number.isFinite(options.minRatio) || options.minRatio < 0 || options.minRatio > 1) {
    throw new Error("--min-ratio must be between 0 and 1.");
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/data-governance/derive-artist-classifications.mjs [options]

Builds non-destructive artist classification fields from linked published artworks.
Dry-run is the default. Add --run to update existing artist documents.

Options:
  --run                    Write derived fields to CloudBase.
  --pilot <n>              Restrict output/write to n representative artists.
  --env-id <id>            CloudBase environment id.
  --artists <collection>   Artists collection. Default: artists
  --artworks <collection>  Artworks collection. Default: artworks
  --report-dir <dir>       Report directory.
  --batch-size <n>         Update batch size, max 50. Default: 20
  --max <n>                Maximum style/subject ids per artist. Default: 5
  --min-count <n>          Absolute frequency threshold. Default: 2
  --min-ratio <0..1>       Relative frequency threshold. Default: 0.1
`;
}

function createClient(options, config) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error("Missing Tencent Cloud credentials.");
  return CloudBase.init({ envId: options.envId, secretId, secretKey });
}

function parseCommandRows(data) {
  const outer = JSON.parse(data || "[]");
  return outer.map((row) => normalizeExtendedJson(JSON.parse(row)));
}

function normalizeExtendedJson(value) {
  if (Array.isArray(value)) return value.map(normalizeExtendedJson);
  if (!value || typeof value !== "object") return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$numberInt") return Number(value.$numberInt);
  if (keys.length === 1 && keys[0] === "$numberLong") return Number(value.$numberLong);
  if (keys.length === 1 && keys[0] === "$numberDouble") return Number(value.$numberDouble);
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeExtendedJson(child)]),
  );
}

async function queryCollection(database, collection, projection) {
  const rows = [];
  const pageSize = 1000;
  for (let skip = 0; ; skip += pageSize) {
    const result = await database.runCommands({
      MgoCommands: [
        {
          TableName: collection,
          CommandType: "QUERY",
          Command: JSON.stringify({
            find: collection,
            filter: {},
            projection,
            skip,
            limit: pageSize,
          }),
        },
      ],
    });
    const batch = parseCommandRows(result.Data?.[0]);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function updateBatch(database, collection, rows, updatedAt) {
  return database.runCommands({
    MgoCommands: [
      {
        TableName: collection,
        CommandType: "UPDATE",
        Command: JSON.stringify({
          update: collection,
          updates: rows.map((row) => ({
            q: { _id: row.artistId },
            u: {
              $set: {
                ...row.derived,
                classification_updated_at: updatedAt,
              },
            },
            upsert: false,
          })),
        }),
      },
    ],
  });
}

function countIds(rows, field) {
  const counts = {};
  for (const row of rows) {
    for (const id of row.derived[field] || []) counts[id] = (counts[id] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    ),
  );
}

function reportRow(row) {
  return {
    artist_id: row.artistId,
    name_zh: row.artist.name_zh || row.artist.nameZh || "",
    name_en: row.artist.name_en || row.artist.nameEn || "",
    source_region: row.artist.region || "",
    source_country: row.artist.country || row.artist.nationality || "",
    source_styles: row.artist.styles || [],
    previous_derived_fields: {
      classification_version: row.artist.classification_version || "",
      region_id: row.artist.region_id || "",
      style_ids: row.artist.style_ids || [],
      subject_ids: row.artist.subject_ids || [],
      decade_ids: row.artist.decade_ids || [],
      classified_artwork_count: row.artist.classified_artwork_count || 0,
      classification_updated_at: row.artist.classification_updated_at || "",
    },
    derived_fields: row.derived,
  };
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  const app = createClient(options, env());
  const [artists, artworks] = await Promise.all([
    queryCollection(app.database, options.artistsCollection, {
      _id: 1,
      id: 1,
      name_zh: 1,
      nameZh: 1,
      name_en: 1,
      nameEn: 1,
      region: 1,
      country: 1,
      nationality: 1,
      styles: 1,
      classification_version: 1,
      region_id: 1,
      style_ids: 1,
      subject_ids: 1,
      decade_ids: 1,
      classified_artwork_count: 1,
      classification_updated_at: 1,
    }),
    queryCollection(app.database, options.artworksCollection, {
      _id: 1,
      status: 1,
      publish_status: 1,
      review_status: 1,
      artist_ids: 1,
      primary_artist_id: 1,
      artist_id: 1,
      classification_ids: 1,
      tag_ids: 1,
    }),
  ]);
  const derivedAll = deriveAllArtistClassifications(artists, artworks, options);
  const selected = options.pilot ? selectPilotArtists(derivedAll, options.pilot) : derivedAll;
  const updatedAt = new Date().toISOString();
  const unresolvedRegions = selected
    .filter((row) => row.derived.region_id === "region-other")
    .map((row) => ({
      artist_id: row.artistId,
      name: row.artist.name_zh || row.artist.name_en || "",
      region: row.artist.region || "",
      country: row.artist.country || row.artist.nationality || "",
    }));
  const noLinkedArtworks = selected
    .filter((row) => row.derived.classified_artwork_count === 0)
    .map((row) => row.artistId);
  const report = {
    generated_at: updatedAt,
    dry_run: !options.run,
    env_id: options.envId,
    collections: {
      artists: options.artistsCollection,
      artworks: options.artworksCollection,
    },
    taxonomy_version: CATEGORY_CATALOG_VERSION,
    policy: {
      max_ids_per_style_or_subject: options.max,
      min_count: options.minCount,
      min_ratio: options.minRatio,
      decade_order: "oldest_to_newest",
      original_fields_preserved: true,
    },
    totals: {
      artists_read: artists.length,
      artworks_read: artworks.length,
      artists_selected: selected.length,
      artists_with_linked_artworks: selected.length - noLinkedArtworks.length,
      artists_without_linked_artworks: noLinkedArtworks.length,
      unresolved_regions: unresolvedRegions.length,
    },
    region_terms: REGION_TERMS,
    artist_tag_counts: {
      regions: countIds(
        selected.map((row) => ({
          derived: { region_ids: [row.derived.region_id] },
        })),
        "region_ids",
      ),
      styles: countIds(selected, "style_ids"),
      subjects: countIds(selected, "subject_ids"),
      decades: countIds(selected, "decade_ids"),
    },
    unresolved_regions: unresolvedRegions,
    artists_without_linked_artworks: noLinkedArtworks,
    artists: selected.map(reportRow),
    write: {
      attempted_batches: 0,
      completed_batches: 0,
      failures: [],
    },
  };

  if (options.run) {
    const batches = chunk(selected, options.batchSize);
    report.write.attempted_batches = batches.length;
    for (let index = 0; index < batches.length; index += 1) {
      try {
        await updateBatch(app.database, options.artistsCollection, batches[index], updatedAt);
        report.write.completed_batches += 1;
      } catch (error) {
        report.write.failures.push({
          batch: index + 1,
          artist_ids: batches[index].map((row) => row.artistId),
          error: error.message,
        });
        break;
      }
    }
  }

  fs.mkdirSync(options.reportDir, { recursive: true });
  const mode = options.pilot ? `pilot-${options.pilot}` : "full";
  const reportPath = path.join(
    options.reportDir,
    `artist-classification-${mode}-${timestamp()}.json`,
  );
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        report: reportPath,
        dry_run: report.dry_run,
        ...report.totals,
        write: report.write,
      },
      null,
      2,
    ),
  );
  if (report.write.failures.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url))
) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
