#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_REPORT_DIR = path.resolve(process.cwd(), "csv", "cloudbase");

const DEFAULT_COLLECTIONS = {
  artworks: "artworks",
  artists: "artists",
  vocabTerms: "vocab_terms",
  artworkArtistLinks: "artwork_artist_links",
  artworkTagLinks: "artwork_tag_links",
};

const DEFAULT_THRESHOLDS = {
  artistCoverage: 0.8,
  tagCoverage: 0.9,
};

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const raw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function env() {
  return { ...parseEnvFile(".env"), ...parseEnvFile(".env.local"), ...process.env };
}

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function positiveInt(value, flag) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return number;
}

function ratio(value, flag) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw new Error(`${flag} must be a number between 0 and 1.`);
  }
  return number;
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function parseArgs(argv = []) {
  const options = {
    envId: process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID || DEFAULT_ENV_ID,
    collections: { ...DEFAULT_COLLECTIONS },
    reportDir: DEFAULT_REPORT_DIR,
    out: "",
    pageSize: 1000,
    sampleSize: 20,
    strict: false,
    thresholds: { ...DEFAULT_THRESHOLDS },
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--strict") options.strict = true;
    else if (arg === "--env-id") options.envId = required(argv, (index += 1), arg);
    else if (arg === "--artworks") options.collections.artworks = required(argv, (index += 1), arg);
    else if (arg === "--artists") options.collections.artists = required(argv, (index += 1), arg);
    else if (arg === "--vocab-terms")
      options.collections.vocabTerms = required(argv, (index += 1), arg);
    else if (arg === "--artwork-artist-links") {
      options.collections.artworkArtistLinks = required(argv, (index += 1), arg);
    } else if (arg === "--artwork-tag-links") {
      options.collections.artworkTagLinks = required(argv, (index += 1), arg);
    } else if (arg === "--report-dir")
      options.reportDir = path.resolve(required(argv, (index += 1), arg));
    else if (arg === "--out") options.out = path.resolve(required(argv, (index += 1), arg));
    else if (arg === "--page-size")
      options.pageSize = positiveInt(required(argv, (index += 1), arg), arg);
    else if (arg === "--sample-size")
      options.sampleSize = positiveInt(required(argv, (index += 1), arg), arg);
    else if (arg === "--min-artist-coverage") {
      options.thresholds.artistCoverage = ratio(required(argv, (index += 1), arg), arg);
    } else if (arg === "--min-tag-coverage") {
      options.thresholds.tagCoverage = ratio(required(argv, (index += 1), arg), arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.pageSize > 1000) throw new Error("--page-size must be <= 1000.");
  return options;
}

function usage() {
  return `Usage:
  node scripts/data-governance/audit-normalized-cloud-data.mjs [options]

Read-only CloudBase audit for normalized artwork, artist, tag, and relationship data.

Options:
  --env-id <id>                         CloudBase env id.
  --artworks <collection>               Artworks collection name. Default: artworks
  --artists <collection>                Artists collection name. Default: artists
  --vocab-terms <collection>            Vocab terms collection name. Default: vocab_terms
  --artwork-artist-links <collection>   Artist relationship collection name.
  --artwork-tag-links <collection>      Tag relationship collection name.
  --report-dir <dir>                    Report directory. Default: csv/cloudbase
  --out <file>                          Explicit report output path.
  --page-size <n>                       Query page size, max 1000.
  --sample-size <n>                     Number of unresolved samples to include.
  --min-artist-coverage <0..1>          Strict artist coverage threshold. Default: 0.8
  --min-tag-coverage <0..1>             Strict tag coverage threshold. Default: 0.9
  --strict                              Exit non-zero when thresholds or critical checks fail.
  --help                                Show this message.

This script never writes CloudBase data. It only issues QUERY commands.
`;
}

function createClient(options, config) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error("Missing Tencent credentials. Set TENCENT_SECRET_ID and TENCENT_SECRET_KEY.");
  }
  return CloudBase.init({ envId: options.envId, secretId, secretKey });
}

function parseCommandRows(data) {
  const outer = JSON.parse(data || "[]");
  return outer.map((row) => JSON.parse(row));
}

async function queryCollection(database, collection, { pageSize, projection } = {}) {
  const rows = [];
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

async function queryOptionalCollection(database, collection, options) {
  try {
    return { ok: true, rows: await queryCollection(database, collection, options) };
  } catch (error) {
    return { ok: false, rows: [], error: error.message };
  }
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value) {
  return cleanText(value).length > 0;
}

function hasNonEmptyArray(value) {
  return asArray(value).some(hasText);
}

function isPublishedArtwork(row) {
  const status = cleanText(row?.status || row?.publish_status || row?.review_status).toLowerCase();
  return status === "" || status === "published" || status === "reviewed";
}

function unique(values) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function firstKnownTitle(row) {
  return cleanText(
    row?.title_cn || row?.title_zh || row?.title || row?.title_en || row?.name || row?._id,
  );
}

function artistText(row) {
  return cleanText(
    row?.raw_artist_text ||
      row?.artist ||
      row?.artist_display ||
      asArray(row?.artist_labels).join(" "),
  );
}

function tagTexts(row) {
  return unique([
    ...asArray(row?.tag_keys),
    ...asArray(row?.tags),
    ...asArray(row?.tag_labels),
    row?.tags_text,
    row?.medium,
    row?.medium_text,
    row?.period,
    row?.year_and_place,
  ]);
}

function groupCount(rows, key) {
  return rows.reduce((acc, row) => {
    const value = cleanText(row?.[key]) || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function countByReviewStatus(rows) {
  return groupCount(rows, "review_status");
}

function sampleRows(rows, sampleSize, mapper) {
  return rows.slice(0, sampleSize).map(mapper);
}

export function buildAuditReport(
  {
    artworks = [],
    artists = [],
    vocabTerms = [],
    artworkArtistLinks = [],
    artworkTagLinks = [],
    collectionErrors = {},
  } = {},
  {
    envId = "",
    collections = DEFAULT_COLLECTIONS,
    thresholds = DEFAULT_THRESHOLDS,
    sampleSize = 20,
  } = {},
) {
  const publishedArtworks = artworks.filter(isPublishedArtwork);
  const artworksWithPrimaryArtistId = publishedArtworks.filter((row) =>
    hasText(row.primary_artist_id),
  );
  const artworksWithArtistIds = publishedArtworks.filter((row) => hasNonEmptyArray(row.artist_ids));
  const artworksWithTagIds = publishedArtworks.filter((row) => hasNonEmptyArray(row.tag_ids));
  const unresolvedArtistRows = publishedArtworks.filter(
    (row) => !hasNonEmptyArray(row.artist_ids) && hasText(artistText(row)),
  );
  const unmatchedTagRows = publishedArtworks.filter(
    (row) => !hasNonEmptyArray(row.tag_ids) && tagTexts(row).length > 0,
  );
  const duplicateArtworkIds = unique(
    publishedArtworks
      .map((row) => cleanText(row._id))
      .filter((id, index, ids) => id && ids.indexOf(id) !== index),
  );

  const artistCoverage = publishedArtworks.length
    ? artworksWithArtistIds.length / publishedArtworks.length
    : 0;
  const tagCoverage = publishedArtworks.length
    ? artworksWithTagIds.length / publishedArtworks.length
    : 0;
  const reviewedArtists = artists.filter((row) => row.review_status === "reviewed");
  const candidateArtists = artists.filter((row) => row.review_status === "candidate");

  const checks = [
    {
      id: "artist_ids_coverage",
      ok: artistCoverage >= thresholds.artistCoverage,
      actual: Number(artistCoverage.toFixed(4)),
      expected_min: thresholds.artistCoverage,
    },
    {
      id: "tag_ids_coverage",
      ok: tagCoverage >= thresholds.tagCoverage,
      actual: Number(tagCoverage.toFixed(4)),
      expected_min: thresholds.tagCoverage,
    },
    {
      id: "duplicate_artwork_ids",
      ok: duplicateArtworkIds.length === 0,
      actual: duplicateArtworkIds.length,
      expected: 0,
    },
  ];

  for (const [collection, error] of Object.entries(collectionErrors)) {
    if (error) {
      checks.push({
        id: `collection_query_${collection}`,
        ok: false,
        error,
      });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    env_id: envId,
    collections,
    thresholds,
    summary: {
      artworks_total: artworks.length,
      published_artworks_total: publishedArtworks.length,
      primary_artist_id_non_empty: artworksWithPrimaryArtistId.length,
      artist_ids_non_empty: artworksWithArtistIds.length,
      tag_ids_non_empty: artworksWithTagIds.length,
      artist_ids_coverage: Number(artistCoverage.toFixed(4)),
      tag_ids_coverage: Number(tagCoverage.toFixed(4)),
      artists_total: artists.length,
      reviewed_artists: reviewedArtists.length,
      candidate_artists: candidateArtists.length,
      artist_review_status: countByReviewStatus(artists),
      vocab_terms_total: vocabTerms.length,
      vocab_review_status: countByReviewStatus(vocabTerms),
      artwork_artist_links_total: artworkArtistLinks.length,
      artwork_artist_link_roles: groupCount(artworkArtistLinks, "role"),
      artwork_tag_links_total: artworkTagLinks.length,
      artwork_tag_link_types: groupCount(artworkTagLinks, "tag_type"),
      unresolved_artist_record_count: unresolvedArtistRows.length,
      unresolved_artist_text_count: unique(unresolvedArtistRows.map(artistText)).length,
      unmatched_tag_record_count: unmatchedTagRows.length,
      unmatched_tag_text_count: unique(unmatchedTagRows.flatMap(tagTexts)).length,
      duplicate_artwork_id_count: duplicateArtworkIds.length,
    },
    checks,
    samples: {
      unresolved_artists: sampleRows(unresolvedArtistRows, sampleSize, (row) => ({
        _id: row._id,
        title: firstKnownTitle(row),
        artist_text: artistText(row),
      })),
      unmatched_tags: sampleRows(unmatchedTagRows, sampleSize, (row) => ({
        _id: row._id,
        title: firstKnownTitle(row),
        tag_texts: tagTexts(row),
      })),
      duplicate_artwork_ids: duplicateArtworkIds.slice(0, sampleSize),
    },
    ok: checks.every((check) => check.ok),
  };
}

async function collectCloudData(app, options) {
  const queryOptions = { pageSize: options.pageSize };
  const [artworks, artists, vocabTerms, artworkArtistLinks, artworkTagLinks] = await Promise.all([
    queryOptionalCollection(app.database, options.collections.artworks, {
      ...queryOptions,
      projection: {
        _id: 1,
        status: 1,
        publish_status: 1,
        review_status: 1,
        title: 1,
        title_cn: 1,
        title_zh: 1,
        title_en: 1,
        artist: 1,
        artist_display: 1,
        raw_artist_text: 1,
        primary_artist_id: 1,
        artist_ids: 1,
        artist_labels: 1,
        tag_ids: 1,
        tag_keys: 1,
        tags: 1,
        tag_labels: 1,
        tags_text: 1,
        medium: 1,
        medium_text: 1,
        period: 1,
        year_and_place: 1,
      },
    }),
    queryOptionalCollection(app.database, options.collections.artists, queryOptions),
    queryOptionalCollection(app.database, options.collections.vocabTerms, queryOptions),
    queryOptionalCollection(app.database, options.collections.artworkArtistLinks, queryOptions),
    queryOptionalCollection(app.database, options.collections.artworkTagLinks, queryOptions),
  ]);

  return {
    artworks: artworks.rows,
    artists: artists.rows,
    vocabTerms: vocabTerms.rows,
    artworkArtistLinks: artworkArtistLinks.rows,
    artworkTagLinks: artworkTagLinks.rows,
    collectionErrors: {
      [options.collections.artworks]: artworks.error,
      [options.collections.artists]: artists.error,
      [options.collections.vocabTerms]: vocabTerms.error,
      [options.collections.artworkArtistLinks]: artworkArtistLinks.error,
      [options.collections.artworkTagLinks]: artworkTagLinks.error,
    },
  };
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return 0;
  }

  const app = createClient(options, env());
  const data = await collectCloudData(app, options);
  const report = buildAuditReport(data, options);
  const outputPath =
    options.out || path.join(options.reportDir, `normalized-cloud-audit-${timestamp()}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ ...report, report_path: outputPath }, null, 2)}\n`);

  if (options.strict && !report.ok) {
    return 1;
  }
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
