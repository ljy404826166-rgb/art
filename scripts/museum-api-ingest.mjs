#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const UNKNOWN = "暂不明确";
const USER_AGENT = "ArtArchiveDataBuilder/0.2 (+museum open-access APIs)";
const DEFAULT_PRIORITY_LIST = path.resolve(process.cwd(), "data", "artist-priority.json");
const DEFAULT_STATE_DIR = path.resolve(process.cwd(), "csv", ".museum-api-state");
const DEFAULT_SOURCES = ["cma", "met", "aic"];
const SOURCE_LABELS = {
  cma: "Cleveland Museum of Art",
  met: "The Metropolitan Museum of Art",
  aic: "Art Institute of Chicago",
};
const ARTIST_API_NAMES = {
  "joseph-mallord-william-turner": "Joseph Mallord William Turner",
};

function artistApiName(artist) {
  return ARTIST_API_NAMES[artist.slug] || artist.name;
}

function usage() {
  return `
Usage:
  node scripts/museum-api-ingest.mjs [options]

Options:
  --count <n>                    Number of artworks to save. Default: 20
  --start <n>                    First local numeric ID. Default: 1
  --artist-start <n>             First rank in data/artist-priority.json. Default: 1
  --artist-priority-list <path>  Artist priority JSON file
  --sources <csv>                cma,met,aic. Default: cma,met,aic
  --out-dir <path>               Output directory
  --state-dir <path>             Persistent source-ID history directory
  --existing-index <path>        Read-only JSON export of existing database artworks
  --pid-file <path>              Write the running Node process ID to this file
  --timeout-ms <n>               Request timeout. Default: 30000
  --max-retries <n>              Retry count for transient failures. Default: 3
  --request-delay-ms <n>         Minimum delay between requests. Default: 1000
  --max-image-mb <n>             Maximum image size. Default: 60
  --dry-run                      Save metadata without downloading images
  --help                         Show this help
`;
}

function parsePositive(value, name, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || (allowZero ? number < 0 : number < 1)) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer.`);
  }
  return number;
}

export function parseArgs(argv) {
  const options = {
    count: 20,
    start: 1,
    artistStart: 1,
    artistPriorityList: DEFAULT_PRIORITY_LIST,
    sources: [...DEFAULT_SOURCES],
    outDir: "",
    stateDir: DEFAULT_STATE_DIR,
    existingIndex: "",
    pidFile: "",
    timeoutMs: 30000,
    maxRetries: 3,
    requestDelayMs: 1000,
    maxImageMb: 60,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help") options.help = true;
    else if (token === "--dry-run") options.dryRun = true;
    else {
      if (!token.startsWith("--")) throw new Error(`Unknown argument: ${token}`);
      const name = token.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--"))
        throw new Error(`Missing value for ${token}`);
      index += 1;
      if (name === "count") options.count = parsePositive(value, token);
      else if (name === "start") options.start = parsePositive(value, token);
      else if (name === "artist-start") options.artistStart = parsePositive(value, token);
      else if (name === "artist-priority-list") options.artistPriorityList = path.resolve(value);
      else if (name === "sources")
        options.sources = value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
      else if (name === "out-dir") options.outDir = path.resolve(value);
      else if (name === "state-dir") options.stateDir = path.resolve(value);
      else if (name === "existing-index") options.existingIndex = path.resolve(value);
      else if (name === "pid-file") options.pidFile = path.resolve(value);
      else if (name === "timeout-ms") options.timeoutMs = parsePositive(value, token);
      else if (name === "max-retries")
        options.maxRetries = parsePositive(value, token, { allowZero: true });
      else if (name === "request-delay-ms")
        options.requestDelayMs = parsePositive(value, token, { allowZero: true });
      else if (name === "max-image-mb") options.maxImageMb = parsePositive(value, token);
      else throw new Error(`Unknown option: ${token}`);
    }
  }
  for (const source of options.sources) {
    if (!DEFAULT_SOURCES.includes(source)) throw new Error(`Unsupported source: ${source}`);
  }
  if (!options.outDir) {
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    options.outDir = path.resolve(process.cwd(), "outputs", `museum-api-trial-${stamp}`);
  }
  return options;
}

export function normalizeArtistName(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(
      /\b(italian|french|dutch|flemish|american|spanish|german|austrian|english|british|japanese|russian)\b/gi,
      " ",
    )
    .replace(/\b\d{3,4}\s*[-–]\s*\d{0,4}\b/g, " ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase();
}

export function isDirectArtistMatch(expected, actual, qualifier = "") {
  if (qualifier && !/^(artist|designer|painter)$/i.test(qualifier)) return false;
  return normalizeArtistName(expected) === normalizeArtistName(actual);
}

export function isEligibleArtworkType(...values) {
  const text = values.filter(Boolean).join(" ").toLowerCase();
  return !/\b(book|books|publication|periodical|catalog|catalogue)\b/.test(text);
}

function cleanHtml(value = "") {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function writeCsv(filePath, rows) {
  const fields = [
    "id",
    "title_cn",
    "title_en",
    "artist",
    "location",
    "year_and_place",
    "medium",
    "dimensions",
    "description",
    "tags",
  ];
  const body = [
    fields.join(","),
    ...rows.map((row) => fields.map((field) => csvEscape(row[field])).join(",")),
  ].join("\r\n");
  await writeFile(filePath, `\uFEFF${body}\r\n`, "utf8");
}

async function writeJsonl(filePath, rows) {
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(filePath, body ? `${body}\n` : "", "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAicIiifUrl(url) {
  try {
    const parsed = new URL(String(url));
    return parsed.hostname === "www.artic.edu" && parsed.pathname.startsWith("/iiif/2/");
  } catch {
    return false;
  }
}

class HttpError extends Error {
  constructor(status, url, statusText = "") {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ""}: ${url}`);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
  }
}

function isRetryableHttpError(error) {
  if (!(error instanceof HttpError)) return true;
  return (
    error.status === 429 || error.status >= 500 || (error.status === 403 && isAicIiifUrl(error.url))
  );
}

function retryDelayMs(error, attempt, options) {
  if (error instanceof HttpError && error.status === 403 && isAicIiifUrl(error.url)) {
    return [5000, 15000, 30000][Math.min(attempt, 2)];
  }
  return Math.max(2000, options.requestDelayMs * (attempt + 2));
}

async function request(url, options, responseType = "json") {
  options._lastRequestAt ||= 0;
  const remaining = Math.max(0, options.requestDelayMs - (Date.now() - options._lastRequestAt));
  if (remaining) await sleep(remaining);
  let lastError = null;
  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      options._lastRequestAt = Date.now();
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept: responseType === "json" ? "application/json" : "image/jpeg,image/png,image/*",
        },
      });
      if (!response.ok) {
        throw new HttpError(response.status, url, response.statusText);
      }
      if (responseType === "json") return response.json();
      const buffer = Buffer.from(await response.arrayBuffer());
      const maxBytes = options.maxImageMb * 1024 * 1024;
      if (buffer.length > maxBytes)
        throw new Error(`Image exceeds ${options.maxImageMb} MB: ${url}`);
      return {
        buffer,
        contentType: response.headers.get("content-type") || "image/jpeg",
      };
    } catch (error) {
      lastError = error;
      const permanent = error instanceof HttpError && !isRetryableHttpError(error);
      if (permanent || attempt >= options.maxRetries) throw error;
      const delay = retryDelayMs(error, attempt, options);
      console.warn(
        `[museum] Retrying ${url} after ${error.message}; attempt ${attempt + 1}/${options.maxRetries}, waiting ${delay}ms.`,
      );
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error(`Request failed: ${url}`);
}

function cmaCandidate(item, artist) {
  const creator = (item.creators || []).find((entry) =>
    isDirectArtistMatch(
      artistApiName(artist),
      String(entry.description || "").replace(/\s*\([^)]*\).*$/, ""),
      entry.qualifier || "artist",
    ),
  );
  if (
    !creator ||
    item.share_license_status !== "CC0" ||
    !item.images?.print?.url ||
    !isEligibleArtworkType(item.type, item.department)
  )
    return null;
  return {
    source: "cma",
    sourceId: String(item.id),
    sourceUrl: item.url || `https://www.clevelandart.org/art/${item.accession_number}`,
    imageUrl: item.images.print.url,
    title: item.title || UNKNOWN,
    artist: creator.description || artistApiName(artist),
    date: item.creation_date || "",
    place: compact([item.culture?.join?.(", "), item.current_location]).join("; "),
    medium: item.technique || "",
    dimensions: item.measurements || "",
    classification: compact([item.type, item.department, ...(item.collection || [])]),
    rights: "CC0",
    raw: item,
  };
}

async function* cmaCandidates(artist, options) {
  const limit = 100;
  for (let skip = 0; ; skip += limit) {
    const url = new URL("https://openaccess-api.clevelandart.org/api/artworks/");
    url.searchParams.set("artists", artistApiName(artist));
    url.searchParams.set("has_image", "1");
    url.searchParams.set("cc0", "1");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("skip", String(skip));
    const payload = await request(url, options);
    const items = payload.data || [];
    for (const item of items) {
      const candidate = cmaCandidate(item, artist);
      if (candidate) yield candidate;
    }
    if (!items.length || skip + items.length >= Number(payload.info?.total || 0)) break;
  }
}

function metCandidate(item, artist) {
  const directRole =
    /^(artist|designer|painter|draftsman|engraver|etcher|printmaker|sculptor)$/i.test(
      item.artistRole || "artist",
    );
  if (
    !item.isPublicDomain ||
    !item.primaryImage ||
    !isDirectArtistMatch(artistApiName(artist), item.artistDisplayName) ||
    String(item.artistPrefix || "").trim() ||
    !directRole ||
    !isEligibleArtworkType(item.objectName, item.classification, item.department)
  )
    return null;
  return {
    source: "met",
    sourceId: String(item.objectID),
    sourceUrl: item.objectURL || `https://www.metmuseum.org/art/collection/search/${item.objectID}`,
    imageUrl: item.primaryImage,
    title: item.title || UNKNOWN,
    artist: item.artistDisplayName || artistApiName(artist),
    date: item.objectDate || "",
    place: compact([item.culture, item.country, item.city]).join("; "),
    medium: item.medium || "",
    dimensions: item.dimensions || "",
    classification: compact([
      item.classification,
      item.department,
      ...(item.tags || []).map((tag) => tag.term),
    ]),
    rights: "Public Domain",
    raw: item,
  };
}

async function* metCandidates(artist, options) {
  const url = new URL("https://collectionapi.metmuseum.org/public/collection/v1/search");
  url.searchParams.set("artistOrCulture", "true");
  url.searchParams.set("hasImages", "true");
  url.searchParams.set("q", artistApiName(artist));
  const payload = await request(url, options);
  for (const objectId of payload.objectIDs || []) {
    let item;
    try {
      item = await request(
        `https://collectionapi.metmuseum.org/public/collection/v1/objects/${objectId}`,
        options,
      );
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        console.log(`[museum] MET object ${objectId} is no longer available; continuing.`);
        continue;
      }
      throw error;
    }
    const candidate = metCandidate(item, artist);
    if (candidate) yield candidate;
  }
}

function aicCandidate(item, artist, iiifUrl) {
  const primaryArtistDisplay = String(item.artist_display || "")
    .split(/\r?\n/, 1)[0]
    .trim();
  if (
    !item.is_public_domain ||
    !item.image_id ||
    !isDirectArtistMatch(artistApiName(artist), item.artist_title) ||
    !isDirectArtistMatch(artistApiName(artist), primaryArtistDisplay) ||
    !isEligibleArtworkType(
      item.artwork_type_title,
      item.classification_title,
      item.department_title,
    )
  )
    return null;
  return {
    source: "aic",
    sourceId: String(item.id),
    sourceUrl: item.api_link || `https://www.artic.edu/artworks/${item.id}`,
    imageUrl: `${iiifUrl}/${item.image_id}/full/!1686,1686/0/default.jpg`,
    imageFallbackUrl: `${iiifUrl}/${item.image_id}/full/!843,843/0/default.jpg`,
    title: item.title || UNKNOWN,
    artist: item.artist_display || item.artist_title || artistApiName(artist),
    date: item.date_display || "",
    place: item.place_of_origin || "",
    medium: item.medium_display || "",
    dimensions: item.dimensions || "",
    classification: compact([item.classification_title, item.department_title]),
    rights: "Public Domain",
    raw: item,
  };
}

async function requestArtworkImage(candidate, options) {
  try {
    const image = await request(candidate.imageUrl, options, "buffer");
    return { ...image, sourceUrl: candidate.imageUrl };
  } catch (error) {
    if (!candidate.imageFallbackUrl) throw error;
    console.warn(
      `[museum] Primary image failed after retries; falling back to 843px: ${candidate.imageFallbackUrl}`,
    );
    const image = await request(candidate.imageFallbackUrl, options, "buffer");
    return { ...image, sourceUrl: candidate.imageFallbackUrl };
  }
}

async function* aicCandidates(artist, options) {
  const limit = 100;
  const fields = [
    "id",
    "title",
    "artist_title",
    "artist_display",
    "date_display",
    "place_of_origin",
    "medium_display",
    "dimensions",
    "image_id",
    "is_public_domain",
    "api_link",
    "artwork_type_title",
    "classification_title",
    "department_title",
    "credit_line",
  ].join(",");
  for (let page = 1; ; page += 1) {
    const url = new URL("https://api.artic.edu/api/v1/artworks/search");
    url.searchParams.set("query[match_phrase][artist_title]", artistApiName(artist));
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("page", String(page));
    url.searchParams.set("fields", fields);
    const payload = await request(url, options);
    const items = payload.data || [];
    const iiifUrl = payload.config?.iiif_url || "https://www.artic.edu/iiif/2";
    for (const item of items) {
      const candidate = aicCandidate(item, artist, iiifUrl);
      if (candidate) yield candidate;
    }
    if (!items.length || page >= Number(payload.pagination?.total_pages || 0)) break;
  }
}

const SOURCE_FACTORIES = {
  cma: cmaCandidates,
  met: metCandidates,
  aic: aicCandidates,
};

function sourceKey(candidate) {
  return `${candidate.source}:${candidate.sourceId}`;
}

function semanticFingerprint(candidate) {
  const value = [
    normalizeArtistName(candidate.artist),
    String(candidate.title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim(),
    String(candidate.date || "").match(/\d{4}/)?.[0] || "",
  ].join("|");
  return createHash("sha256").update(value).digest("hex");
}

function normalizeTitleForDedupe(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function artistNameForDedupe(value = "") {
  const text = String(value);
  const hasCjk = /[\u3400-\u9fff]/.test(text);
  const latinParenthetical = hasCjk
    ? [...text.matchAll(/[（(]([^）)]+)[）)]/g)]
        .map((match) => match[1])
        .find((part) => /[A-Za-z]{2}/.test(part))
    : "";
  return normalizeArtistName(
    (latinParenthetical || text.split(/\r?\n/, 1)[0])
      .replace(/[，,]\s*\d{3,4}[\s\S]*$/, "")
      .replace(/\b\d{3,4}\s*[-–—]\s*\d{0,4}\b/g, ""),
  );
}

export function artworkDedupeKey(title, artist) {
  const normalizedTitle = normalizeTitleForDedupe(title);
  const normalizedArtist = artistNameForDedupe(artist);
  return normalizedTitle && normalizedArtist ? `${normalizedArtist}|${normalizedTitle}` : "";
}

async function loadExistingDedupeIndex(filePath) {
  if (!filePath) return { keys: new Set(), records: new Map(), count: 0 };
  const payload = await readJson(filePath, null);
  if (!payload) throw new Error(`Unable to read existing artwork index: ${filePath}`);
  const artworks = Array.isArray(payload) ? payload : payload.artworks;
  if (!Array.isArray(artworks))
    throw new Error(`Existing artwork index must contain an artworks array: ${filePath}`);
  const keys = new Set();
  const records = new Map();
  for (const artwork of artworks) {
    const key = artworkDedupeKey(
      artwork.title_en || artwork.title || artwork.title_cn,
      artwork.artist || artwork.artist_display,
    );
    if (!key) continue;
    keys.add(key);
    if (!records.has(key)) {
      records.set(key, {
        id: artwork.image_id || artwork.id || artwork._id || "",
        title_en: artwork.title_en || artwork.title || "",
        artist: artwork.artist || artwork.artist_display || "",
      });
    }
  }
  return { keys, records, count: artworks.length };
}

function buildCsvRow(candidate, number) {
  return {
    id: `${number}_standard`,
    title_cn: UNKNOWN,
    title_en: candidate.title || UNKNOWN,
    artist: candidate.artist || UNKNOWN,
    location: compact([SOURCE_LABELS[candidate.source], candidate.place]).join("; ") || UNKNOWN,
    year_and_place: compact([candidate.date, candidate.place]).join("; ") || UNKNOWN,
    medium: candidate.medium || UNKNOWN,
    dimensions: candidate.dimensions || UNKNOWN,
    description: UNKNOWN,
    tags: compact([
      ...candidate.classification,
      candidate.rights,
      `Source:${SOURCE_LABELS[candidate.source]}`,
    ]).join(","),
  };
}

function checkpointPath(options) {
  return path.join(options.outDir, "checkpoint.json");
}

function historyPath(options) {
  return path.join(options.stateDir, "museum-api-history.json");
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function saveState(options, state) {
  await writeCsv(state.outputCsv, state.rows);
  await writeJsonl(state.evidenceJsonl, state.evidence);
  await writeFile(
    checkpointPath(options),
    `${JSON.stringify(
      {
        version: 1,
        status: state.status,
        outputCsv: state.outputCsv,
        evidenceJsonl: state.evidenceJsonl,
        rows: state.rows,
        evidence: state.evidence,
        skippedExisting: state.skippedExisting,
        skippedInternal: state.skippedInternal,
        skippedHistory: state.skippedHistory,
        skippedAttribution: state.skippedAttribution,
        processedKeys: [...state.processedKeys],
        nextNumber: state.nextNumber,
        artistStart: options.artistStart,
        sources: options.sources,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function initializeState(options) {
  await mkdir(options.outDir, { recursive: true });
  await mkdir(path.join(options.outDir, "images"), { recursive: true });
  await mkdir(options.stateDir, { recursive: true });
  const checkpoint = await readJson(checkpointPath(options), null);
  if (checkpoint?.status === "running") {
    return {
      ...checkpoint,
      status: "running",
      processedKeys: new Set(checkpoint.processedKeys || []),
    };
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return {
    status: "running",
    outputCsv: path.join(options.outDir, `museum-api-artworks-${stamp}.csv`),
    evidenceJsonl: path.join(options.outDir, `museum-api-artworks-${stamp}.evidence.jsonl`),
    rows: [],
    evidence: [],
    skippedExisting: [],
    skippedInternal: [],
    skippedHistory: [],
    skippedAttribution: [],
    processedKeys: new Set(),
    nextNumber: options.start,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  if (options.pidFile) {
    await mkdir(path.dirname(options.pidFile), { recursive: true });
    await writeFile(options.pidFile, `${process.pid}\n`, "utf8");
  }
  const artists = JSON.parse(await readFile(options.artistPriorityList, "utf8"))
    .filter((artist) => artist.rank >= options.artistStart)
    .sort((left, right) => left.rank - right.rank);
  const history = await readJson(historyPath(options), { processedKeys: [], semanticKeys: [] });
  const existingIndex = await loadExistingDedupeIndex(options.existingIndex);
  const state = await initializeState(options);
  state.skippedExisting ||= [];
  state.skippedInternal ||= [];
  state.skippedHistory ||= [];
  state.skippedAttribution ||= [];
  state.processedKeys = new Set([...(history.processedKeys || []), ...state.processedKeys]);
  const historicalDedupeKeys = new Set(history.semanticKeys || []);
  const internalDedupeKeys = new Set(
    state.rows.map((row) => artworkDedupeKey(row.title_en, row.artist)).filter(Boolean),
  );
  console.log(`[museum] Output CSV: ${state.outputCsv}`);
  console.log(
    `[museum] Starting with ${state.rows.length}/${options.count} rows at ID ${state.nextNumber}.`,
  );
  if (options.existingIndex) {
    console.log(
      `[museum] Loaded ${existingIndex.count} database artworks and ${existingIndex.keys.size} semantic dedupe keys.`,
    );
  }

  try {
    for (const artist of artists) {
      if (state.rows.length >= options.count) break;
      console.log(`[museum] Artist rank ${artist.rank}: ${artist.name}`);
      const streams = options.sources.map((source) => ({
        source,
        iterator: SOURCE_FACTORIES[source](artist, options),
        active: true,
      }));
      while (streams.some((stream) => stream.active) && state.rows.length < options.count) {
        for (const stream of streams) {
          if (!stream.active || state.rows.length >= options.count) continue;
          const result = await stream.iterator.next();
          if (result.done) {
            stream.active = false;
            continue;
          }
          const candidate = result.value;
          const key = sourceKey(candidate);
          if (state.processedKeys.has(key)) continue;
          const dedupeKey = artworkDedupeKey(candidate.title, candidate.artist);
          if (dedupeKey && historicalDedupeKeys.has(dedupeKey)) {
            console.log(`[museum] Skipping prior-batch duplicate ${key} ${candidate.title}.`);
            state.skippedHistory.push({
              source_key: key,
              source_url: candidate.sourceUrl,
              title_en: candidate.title,
              artist: candidate.artist,
            });
            state.processedKeys.add(key);
            await saveState(options, state);
            continue;
          }
          if (dedupeKey && internalDedupeKeys.has(dedupeKey)) {
            console.log(`[museum] Skipping internal duplicate ${key} ${candidate.title}.`);
            state.skippedInternal.push({
              source_key: key,
              source_url: candidate.sourceUrl,
              title_en: candidate.title,
              artist: candidate.artist,
            });
            state.processedKeys.add(key);
            await saveState(options, state);
            continue;
          }
          if (dedupeKey && existingIndex.keys.has(dedupeKey)) {
            const existing = existingIndex.records.get(dedupeKey);
            console.log(
              `[museum] Skipping database duplicate ${key} ${candidate.title} (${existing?.id || "existing"}).`,
            );
            state.skippedExisting.push({
              source_key: key,
              source_url: candidate.sourceUrl,
              title_en: candidate.title,
              artist: candidate.artist,
              existing,
            });
            state.processedKeys.add(key);
            await saveState(options, state);
            continue;
          }
          console.log(
            `[museum] ${state.rows.length + 1}/${options.count} ${key} ${candidate.title}`,
          );
          let savedImageUrl = candidate.imageUrl;
          if (!options.dryRun) {
            const image = await requestArtworkImage(candidate, options);
            savedImageUrl = image.sourceUrl;
            await writeFile(
              path.join(options.outDir, "images", `${state.nextNumber}_standard.jpg`),
              image.buffer,
            );
          }
          const row = buildCsvRow(candidate, state.nextNumber);
          state.rows.push(row);
          if (dedupeKey) internalDedupeKeys.add(dedupeKey);
          state.evidence.push({
            schema_version: 1,
            source: {
              institution: SOURCE_LABELS[candidate.source],
              provider: candidate.source,
              object_id: candidate.sourceId,
              object_url: candidate.sourceUrl,
              api_rights: candidate.rights,
            },
            priority_artist: artist,
            canonical_fingerprint: semanticFingerprint(candidate),
            image: {
              id: row.id,
              asset_name: `${row.id}.jpg`,
              source_url: savedImageUrl,
              local_path: options.dryRun
                ? ""
                : path.join(options.outDir, "images", `${row.id}.jpg`),
            },
            raw: candidate.raw,
          });
          state.processedKeys.add(key);
          state.nextNumber += 1;
          await saveState(options, state);
        }
      }
    }
    state.status = state.rows.length >= options.count ? "completed" : "running";
    await saveState(options, state);
    if (state.status === "completed") {
      await writeFile(
        historyPath(options),
        `${JSON.stringify(
          {
            version: 1,
            processedKeys: [...state.processedKeys],
            semanticKeys: [
              ...new Set([
                ...(history.semanticKeys || []),
                ...state.rows
                  .map((row) => artworkDedupeKey(row.title_en, row.artist))
                  .filter(Boolean),
              ]),
            ],
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
    console.log(
      `[museum] Finished with ${state.rows.length}/${options.count} rows; status=${state.status}.`,
    );
  } catch (error) {
    state.status = "running";
    await saveState(options, state);
    console.error(`[museum] Paused with a recoverable checkpoint: ${error.message}`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]).toLowerCase() : "";
const modulePath = path.resolve(fileURLToPath(import.meta.url)).toLowerCase();
if (invokedPath === modulePath || path.basename(invokedPath) === path.basename(modulePath)) {
  await main();
}
