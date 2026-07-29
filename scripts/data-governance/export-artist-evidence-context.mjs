#!/usr/bin/env node

import CloudBase from "@cloudbase/manager-node";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "outputs", "artist-enrichment");
const ALLOWED_PRIORITIES = new Set(["P0", "P1", "P2"]);

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(argv = []) {
  const options = {
    priority: "P0",
    artistIds: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--priority") {
      options.priority = required(argv, (index += 1), arg).toUpperCase();
    } else if (arg === "--artist-id") {
      options.artistIds.push(required(argv, (index += 1), arg));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!ALLOWED_PRIORITIES.has(options.priority)) {
    throw new Error("--priority must be P0, P1, or P2.");
  }
  return options;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const result = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = rawLine.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
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

function environment() {
  return { ...parseEnvFile(".env"), ...parseEnvFile(".env.local"), ...process.env };
}

function createClient(envId, config) {
  const secretId =
    config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
  const secretKey =
    config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
  if (!secretId || !secretKey) throw new Error("Missing Tencent Cloud credentials.");
  return CloudBase.init({ envId, secretId, secretKey });
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

function parseCommandRows(data) {
  return JSON.parse(data || "[]").map((row) => normalizeExtendedJson(JSON.parse(row)));
}

async function queryCollection(database, collection, projection = {}) {
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

function latestAuditPath() {
  const files = fs
    .readdirSync(DEFAULT_OUTPUT_DIR)
    .filter((name) => /^artist-enrichment-audit-.*\.json$/.test(name))
    .sort();
  if (!files.length) throw new Error("No artist enrichment audit found.");
  return path.join(DEFAULT_OUTPUT_DIR, files.at(-1));
}

function cleanText(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase();
}

function artistNames(artist) {
  return [artist.name_zh, artist.name_en, ...(Array.isArray(artist.aliases) ? artist.aliases : [])]
    .map(cleanText)
    .filter(Boolean);
}

function artworkArtistLabels(artwork) {
  return [artwork.artist, artwork.artist_name, artwork.artist_zh, artwork.artist_en, artwork.ARTIST]
    .map(cleanText)
    .filter(Boolean);
}

export function buildArtistEvidenceContext({ p0Ids, artists, artworks, artworkArtistLinks }) {
  const wanted = new Set(p0Ids);
  const artworkById = new Map(artworks.map((artwork) => [String(artwork._id), artwork]));
  const linksByArtist = new Map();
  for (const link of artworkArtistLinks) {
    const artistId = String(link.artist_id || "");
    if (!wanted.has(artistId)) continue;
    const list = linksByArtist.get(artistId) || [];
    list.push(link);
    linksByArtist.set(artistId, list);
  }

  return artists
    .filter((artist) => wanted.has(String(artist._id)))
    .map((artist) => {
      const names = new Set(artistNames(artist));
      const directLinks = linksByArtist.get(String(artist._id)) || [];
      const directArtworkIds = new Set(
        directLinks.map((link) => String(link.artwork_id || "")).filter(Boolean),
      );
      const labelMatches = artworks.filter((artwork) =>
        artworkArtistLabels(artwork).some((label) => names.has(label)),
      );
      const linkedArtworks = [
        ...directLinks.map((link) => ({
          link,
          artwork: artworkById.get(String(link.artwork_id || "")) || null,
          match_type: "relationship",
        })),
        ...labelMatches
          .filter((artwork) => !directArtworkIds.has(String(artwork._id)))
          .map((artwork) => ({
            link: null,
            artwork,
            match_type: "artist_label",
          })),
      ];
      return {
        artist,
        linked_artworks: linkedArtworks.map(({ link, artwork, match_type: matchType }) => ({
          match_type: matchType,
          role: link?.role || null,
          link_review_status: link?.review_status || null,
          artwork: artwork
            ? {
                _id: artwork._id,
                title: artwork.title_cn || artwork.title || artwork.TITLE || "",
                title_en: artwork.title_en || "",
                artist: artwork.artist || artwork.ARTIST || artwork.artist_name || "",
                artist_en: artwork.artist_en || "",
                date: artwork.year_and_place || artwork.date || artwork.DATE || "",
                medium: artwork.medium || "",
                location: artwork.location || "",
                tags: artwork.tags || artwork.TAGS || artwork.tag_labels || [],
                source_url: artwork.source_url || artwork.sourceUrl || "",
                image_url: artwork.image_url || artwork.imageUrl || "",
              }
            : null,
        })),
      };
    })
    .sort((left, right) => String(left.artist._id).localeCompare(String(right.artist._id)));
}

function timestamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const auditPath = latestAuditPath();
  const audit = JSON.parse(fs.readFileSync(auditPath, "utf8"));
  const requestedIds = new Set(options.artistIds);
  const targetIds = audit.artists
    .filter((artist) =>
      requestedIds.size
        ? requestedIds.has(String(artist._id))
        : artist.research_priority === options.priority,
    )
    .map((artist) => String(artist._id));
  const app = createClient(DEFAULT_ENV_ID, environment());
  const [artists, artworks, artworkArtistLinks] = await Promise.all([
    queryCollection(app.database, "artists"),
    queryCollection(app.database, "artworks", {
      _id: 1,
      title_cn: 1,
      title: 1,
      TITLE: 1,
      title_en: 1,
      artist: 1,
      ARTIST: 1,
      artist_name: 1,
      artist_zh: 1,
      artist_en: 1,
      year_and_place: 1,
      date: 1,
      DATE: 1,
      medium: 1,
      location: 1,
      tags: 1,
      TAGS: 1,
      tag_labels: 1,
      source_url: 1,
      sourceUrl: 1,
      image_url: 1,
      imageUrl: 1,
    }),
    queryCollection(app.database, "artwork_artist_links"),
  ]);
  const records = buildArtistEvidenceContext({
    p0Ids: targetIds,
    artists,
    artworks,
    artworkArtistLinks,
  });
  const report = {
    generated_at: new Date().toISOString(),
    env_id: DEFAULT_ENV_ID,
    source_audit: auditPath,
    dry_run: true,
    summary: {
      priority: requestedIds.size ? "explicit_ids" : options.priority,
      target_artists: targetIds.length,
      records_exported: records.length,
      linked_artworks: records.reduce((total, record) => total + record.linked_artworks.length, 0),
      artists_without_artwork_context: records
        .filter((record) => record.linked_artworks.length === 0)
        .map((record) => record.artist._id),
    },
    records,
  };
  fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true });
  const outputPath = path.join(
    DEFAULT_OUTPUT_DIR,
    `artist-evidence-context-${requestedIds.size ? "selected" : options.priority.toLowerCase()}-${timestamp()}.json`,
  );
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ output: outputPath, ...report.summary }, null, 2));
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
