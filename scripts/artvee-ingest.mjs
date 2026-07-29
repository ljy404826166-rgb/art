#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";
import CloudBase from "@cloudbase/manager-node";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import { buildArtworkSearchTerms } from "./cloudbase/artwork-search-terms.mjs";
import { artworkDedupeKey } from "./museum-api-ingest.mjs";

const require = createRequire(import.meta.url);
const COS = require("cos-nodejs-sdk-v5");
const execFileAsync = promisify(execFile);

const ARTVEE_BASE_URL = "https://artvee.com";
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), "csv");
const DEFAULT_BUCKET = "artwork";
const DEFAULT_PER_PAGE = 30;
const DEFAULT_DELAY_MS = 35000;
const DEFAULT_PAGE_DELAY_MS = [5000, 12000];
const DEFAULT_IMAGE_DELAY_MS = [25000, 45000];
const DEFAULT_HTML_LIMIT_PER_HOUR = 180;
const DEFAULT_IMAGE_LIMIT_PER_HOUR = 0;
const DEFAULT_MAX_ARTWORK_PAGES_PER_RUN = 70;
const DEFAULT_MAX_IMAGES_PER_RUN = 200;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_CACHE_DIR = path.resolve(process.cwd(), "csv", ".artvee-cache");
const DEFAULT_CHECKPOINT_DIR = path.resolve(process.cwd(), "csv", ".artvee-state");
const DEFAULT_FAMOUS_LIST = path.resolve(process.cwd(), "data", "famous-artworks.json");
const DEFAULT_ARTIST_PRIORITY_LIST = path.resolve(process.cwd(), "data", "artist-priority.json");
const DEFAULT_MAX_IMAGE_MB = 60;
const DEFAULT_PROVIDER = "gemini";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
const DEFAULT_GEMINI_API_KEY = "";
const DEFAULT_OPENAI_MODEL = "gpt-5.4-mini";
const DEFAULT_AI_RETRIES = 2;
const UNKNOWN_VALUE = "暂不明确";
const USER_AGENT = "ArtArchiveDataBuilder/0.1";
const DEFAULT_TENCENT_COS_BUCKET = "masterpiece-1437223579";
const DEFAULT_TENCENT_COS_REGION = "ap-beijing";
const DEFAULT_TENCENT_COS_PREFIX = "ppaintings";
const DEFAULT_TENCENT_COS_DOMAIN = "https://masterpiece-1437223579.cos.ap-beijing.myqcloud.com";
const DEFAULT_CLOUDBASE_ENV_ID = "cloudbase-d6gvny27ib05e0ede";
const DEFAULT_CLOUDBASE_COLLECTION = "artworks";

const DEFAULT_FAMOUS_SEEDS = [
  { query: "mona lisa leonardo da vinci", priority: 100 },
  { query: "the last supper leonardo da vinci", priority: 99 },
  { query: "vitruvian man leonardo da vinci", priority: 98 },
  { query: "starry night van gogh", priority: 100 },
  { query: "sunflowers van gogh", priority: 98 },
  { query: "self portrait vincent van gogh", priority: 96 },
  { query: "cafe terrace at night van gogh", priority: 95 },
  { query: "irises van gogh", priority: 94 },
  { query: "the school of athens raphael", priority: 100 },
  { query: "sistine madonna raphael", priority: 94 },
  { query: "the birth of venus botticelli", priority: 100 },
  { query: "primavera botticelli", priority: 97 },
  { query: "girl with a pearl earring vermeer", priority: 100 },
  { query: "the milkmaid vermeer", priority: 94 },
  { query: "the kiss gustav klimt", priority: 100 },
  { query: "water lilies claude monet", priority: 99 },
  { query: "impression sunrise monet", priority: 98 },
  { query: "woman with a parasol monet", priority: 94 },
  { query: "the great wave hokusai", priority: 100 },
  { query: "las meninas velazquez", priority: 100 },
  { query: "the night watch rembrandt", priority: 100 },
  { query: "rembrandt self portrait", priority: 96 },
  { query: "the anatomy lesson rembrandt", priority: 95 },
  { query: "liberty leading the people delacroix", priority: 100 },
  { query: "the raft of the medusa gericault", priority: 98 },
  { query: "the third of may 1808 goya", priority: 99 },
  { query: "saturn devouring his son goya", priority: 97 },
  { query: "the swing fragonard", priority: 96 },
  { query: "wanderer above the sea of fog friedrich", priority: 99 },
  { query: "the hay wain constable", priority: 94 },
  { query: "rain steam and speed turner", priority: 94 },
  { query: "olympia manet", priority: 98 },
  { query: "luncheon on the grass manet", priority: 97 },
  { query: "a bar at the folies bergere manet", priority: 95 },
  { query: "the starry night", priority: 90 },
  { query: "mona lisa", priority: 90 },
  { query: "raphael school athens", priority: 90 },
];

const GENERATED_METADATA_FIELDS = [
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

export const CSV_COLUMNS = [
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

const BOOLEAN_FLAGS = new Set([
  "dry-run",
  "with-ai",
  "db",
  "cloudbase-db",
  "cos-upload",
  "supabase-upload",
  "no-openai",
  "no-upload",
  "no-db",
  "no-legacy",
  "no-normalized",
  "no-grounding",
  "no-save-images",
  "no-skip-existing",
  "no-robots",
  "no-cache",
  "no-resume",
  "no-progress",
  "help",
]);

const VALUE_FLAGS = new Set([
  "bucket",
  "evidence-output",
  "cos-bucket",
  "cos-region",
  "cos-prefix",
  "cos-domain",
  "cloudbase-env-id",
  "cloudbase-collection",
  "delay-ms",
  "page-delay-ms",
  "image-delay-ms",
  "html-limit-per-hour",
  "image-limit-per-hour",
  "max-artwork-pages-per-run",
  "max-images-per-run",
  "timeout-ms",
  "max-retries",
  "max-image-mb",
  "artist-start",
  "scan-artist-start",
  "artists-url",
  "artist-priority-list",
  "per-artist",
  "ai-retries",
  "model",
  "out-dir",
  "output",
  "pages",
  "per-page",
  "provider",
  "start",
  "status",
  "user-agent",
  "cache-dir",
  "checkpoint-dir",
  "famous-list",
  "existing-index",
  "max-artist-per-run",
  "max-series-per-run",
]);

function resolveCliPath(value) {
  if (path.isAbsolute(value) || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) {
    return value;
  }
  return path.resolve(value);
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    count: 5,
    keyword: "",
    artistUrl: "",
    artistsUrl: `${ARTVEE_BASE_URL}/artists/`,
    artistStart: 1,
    scanArtistStart: 0,
    perArtist: 0,
    famousList: path.resolve(process.env.ARTVEE_FAMOUS_LIST || DEFAULT_FAMOUS_LIST),
    existingIndex: "",
    artistPriorityList: path.resolve(
      process.env.ARTVEE_ARTIST_PRIORITY_LIST || DEFAULT_ARTIST_PRIORITY_LIST,
    ),
    maxArtistPerRun: 3,
    maxSeriesPerRun: 2,
    outputDir: path.resolve(process.env.ARTVEE_OUTPUT_DIR || DEFAULT_OUTPUT_DIR),
    output: "",
    bucket: process.env.ARTVEE_BUCKET || DEFAULT_BUCKET,
    perPage: DEFAULT_PER_PAGE,
    delayMs: DEFAULT_DELAY_MS,
    pageDelayMs: [...DEFAULT_PAGE_DELAY_MS],
    imageDelayMs: [...DEFAULT_IMAGE_DELAY_MS],
    htmlLimitPerHour: DEFAULT_HTML_LIMIT_PER_HOUR,
    imageLimitPerHour: DEFAULT_IMAGE_LIMIT_PER_HOUR,
    maxArtworkPagesPerRun: DEFAULT_MAX_ARTWORK_PAGES_PER_RUN,
    maxImagesPerRun: DEFAULT_MAX_IMAGES_PER_RUN,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRetries: DEFAULT_MAX_RETRIES,
    cache: true,
    cacheDir: path.resolve(process.env.ARTVEE_CACHE_DIR || DEFAULT_CACHE_DIR),
    resume: true,
    checkpointDir: path.resolve(process.env.ARTVEE_CHECKPOINT_DIR || DEFAULT_CHECKPOINT_DIR),
    progress: true,
    pages: 0,
    start: 0,
    status: "draft",
    provider: process.env.AI_PROVIDER || DEFAULT_PROVIDER,
    model: process.env.AI_MODEL || process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    userAgent: USER_AGENT,
    maxImageMb: DEFAULT_MAX_IMAGE_MB,
    aiRetries: DEFAULT_AI_RETRIES,
    grounding: true,
    dryRun: false,
    useAI: false,
    aiDisabledRequested: false,
    directPublishRequested: false,
    upload: false,
    storageTarget: "none",
    database: false,
    databaseTarget: "none",
    legacySupabaseUploadRequested: false,
    legacyDatabaseRequested: false,
    insertLegacy: true,
    insertNormalized: true,
    saveImages: true,
    skipExisting: true,
    robotsTxt: true,
    help: false,
    evidenceOutput: "",
    cosBucket: process.env.TENCENT_COS_BUCKET || DEFAULT_TENCENT_COS_BUCKET,
    cosRegion: process.env.TENCENT_COS_REGION || DEFAULT_TENCENT_COS_REGION,
    cosPrefix: process.env.TENCENT_COS_PREFIX || DEFAULT_TENCENT_COS_PREFIX,
    cosDomain: process.env.TENCENT_COS_DOMAIN || DEFAULT_TENCENT_COS_DOMAIN,
    cosSecretId:
      process.env.TENCENT_SECRET_ID ||
      process.env.TENCENT_CLOUD_SECRET_ID ||
      process.env.TENCENTCLOUD_SECRETID ||
      "",
    cosSecretKey:
      process.env.TENCENT_SECRET_KEY ||
      process.env.TENCENT_CLOUD_SECRET_KEY ||
      process.env.TENCENTCLOUD_SECRETKEY ||
      "",
    cosSessionToken: process.env.TENCENT_SESSION_TOKEN || "",
    cloudbaseEnvId:
      process.env.CLOUDBASE_ENV_ID || process.env.TCB_ENV_ID || DEFAULT_CLOUDBASE_ENV_ID,
    cloudbaseCollection: process.env.CLOUDBASE_COLLECTION || DEFAULT_CLOUDBASE_COLLECTION,
  };

  if (!command || command === "--help" || command === "-h") {
    return { ...options, command: "help", help: true };
  }

  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const [name, inlineValue] = raw.includes("=") ? raw.split(/=(.*)/s, 2) : [raw, undefined];
    if (BOOLEAN_FLAGS.has(name)) {
      if (name === "dry-run") options.dryRun = true;
      if (name === "with-ai") options.useAI = true;
      if (name === "db") options.legacyDatabaseRequested = true;
      if (name === "cloudbase-db") {
        options.directPublishRequested = true;
      }
      if (name === "cos-upload") {
        options.directPublishRequested = true;
      }
      if (name === "supabase-upload") options.legacySupabaseUploadRequested = true;
      if (name === "no-openai") {
        options.useAI = false;
        options.aiDisabledRequested = true;
      }
      if (name === "no-upload") {
        options.upload = false;
        options.storageTarget = "none";
      }
      if (name === "no-db") {
        options.database = false;
        options.databaseTarget = "none";
      }
      if (name === "no-legacy") options.insertLegacy = false;
      if (name === "no-normalized") options.insertNormalized = false;
      if (name === "no-grounding") options.grounding = false;
      if (name === "no-save-images") options.saveImages = false;
      if (name === "no-skip-existing") options.skipExisting = false;
      if (name === "no-robots") options.robotsTxt = false;
      if (name === "no-cache") options.cache = false;
      if (name === "no-resume") options.resume = false;
      if (name === "no-progress") options.progress = false;
      if (name === "help") options.help = true;
      continue;
    }

    if (!VALUE_FLAGS.has(name)) {
      throw new Error(`Unknown option: --${name}`);
    }

    const value = inlineValue ?? rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for --${name}`);
    }
    if (inlineValue === undefined) index += 1;

    if (name === "bucket") options.bucket = value;
    if (name === "evidence-output") options.evidenceOutput = resolveCliPath(value);
    if (name === "cos-bucket") options.cosBucket = value;
    if (name === "cos-region") options.cosRegion = value;
    if (name === "cos-prefix") options.cosPrefix = value;
    if (name === "cos-domain") options.cosDomain = value;
    if (name === "cloudbase-env-id") options.cloudbaseEnvId = value;
    if (name === "cloudbase-collection") options.cloudbaseCollection = value;
    if (name === "ai-retries") options.aiRetries = parsePositiveInteger(value, "--ai-retries");
    if (name === "delay-ms") options.delayMs = parsePositiveInteger(value, "--delay-ms");
    if (name === "page-delay-ms") options.pageDelayMs = parseDelayRange(value, "--page-delay-ms");
    if (name === "image-delay-ms")
      options.imageDelayMs = parseDelayRange(value, "--image-delay-ms");
    if (name === "html-limit-per-hour")
      options.htmlLimitPerHour = parsePositiveInteger(value, "--html-limit-per-hour");
    if (name === "image-limit-per-hour")
      options.imageLimitPerHour = parsePositiveInteger(value, "--image-limit-per-hour");
    if (name === "max-artwork-pages-per-run")
      options.maxArtworkPagesPerRun = parsePositiveInteger(value, "--max-artwork-pages-per-run");
    if (name === "max-images-per-run")
      options.maxImagesPerRun = parsePositiveInteger(value, "--max-images-per-run");
    if (name === "timeout-ms") options.timeoutMs = parsePositiveInteger(value, "--timeout-ms");
    if (name === "max-retries") options.maxRetries = parsePositiveInteger(value, "--max-retries");
    if (name === "max-image-mb") options.maxImageMb = parsePositiveInteger(value, "--max-image-mb");
    if (name === "artist-start")
      options.artistStart = parsePositiveInteger(value, "--artist-start");
    if (name === "scan-artist-start")
      options.scanArtistStart = parsePositiveInteger(value, "--scan-artist-start");
    if (name === "artists-url") options.artistsUrl = normalizeArtistsUrl(value);
    if (name === "artist-priority-list") options.artistPriorityList = resolveCliPath(value);
    if (name === "per-artist") options.perArtist = parseNonNegativeInteger(value, "--per-artist");
    if (name === "model") options.model = value;
    if (name === "out-dir") options.outputDir = resolveCliPath(value);
    if (name === "output") options.output = resolveCliPath(value);
    if (name === "pages") options.pages = parsePositiveInteger(value, "--pages");
    if (name === "per-page") options.perPage = parsePositiveInteger(value, "--per-page");
    if (name === "provider") options.provider = value;
    if (name === "start") options.start = parsePositiveInteger(value, "--start");
    if (name === "status") options.status = value;
    if (name === "user-agent") options.userAgent = value;
    if (name === "cache-dir") options.cacheDir = resolveCliPath(value);
    if (name === "checkpoint-dir") options.checkpointDir = resolveCliPath(value);
    if (name === "famous-list") options.famousList = resolveCliPath(value);
    if (name === "existing-index") options.existingIndex = resolveCliPath(value);
    if (name === "max-artist-per-run")
      options.maxArtistPerRun = parsePositiveInteger(value, "--max-artist-per-run");
    if (name === "max-series-per-run")
      options.maxSeriesPerRun = parsePositiveInteger(value, "--max-series-per-run");
  }

  if (
    !["random", "search", "popular", "artist", "artists", "artists-priority", "famous"].includes(
      command,
    )
  ) {
    throw new Error(
      `Unknown command: ${command}. Use random, search, popular, artist, artists, artists-priority, or famous.`,
    );
  }

  const trailingCount =
    positional.length > 0 && /^\d+$/.test(positional.at(-1)) ? Number(positional.pop()) : undefined;
  if (command === "search") {
    options.keyword = positional.join(" ").trim();
    if (!options.keyword) throw new Error("The search command requires a keyword.");
  } else if (command === "artist") {
    options.artistUrl = normalizeArtistUrl(positional.shift() || "");
    if (!options.artistUrl)
      throw new Error("The artist command requires an Artvee artist page URL or slug.");
    if (positional.length > 0) {
      throw new Error(`artist accepts one URL/slug and a count, not: ${positional.join(" ")}`);
    }
  } else if (command === "artists" || command === "artists-priority") {
    if (positional.length > 0) {
      throw new Error(`${command} only accepts a count, not: ${positional.join(" ")}`);
    }
  } else if (command === "famous") {
    if (positional.length > 0) {
      throw new Error(`famous only accepts a count, not: ${positional.join(" ")}`);
    }
  } else if (positional.length > 0) {
    throw new Error(`${command} only accepts a count, not: ${positional.join(" ")}`);
  }

  options.count = trailingCount ?? 5;
  if (!Number.isSafeInteger(options.count) || options.count < 1) {
    throw new Error("Count must be a positive integer.");
  }

  if (!["draft", "published", "archived"].includes(options.status)) {
    throw new Error("--status must be draft, published, or archived.");
  }
  if (!["gemini", "openai"].includes(options.provider)) {
    throw new Error("--provider must be gemini or openai.");
  }
  if (!rest.some((arg) => arg === "--model" || arg.startsWith("--model="))) {
    if (options.provider === "openai" && !process.env.AI_MODEL) {
      options.model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
    }
    if (options.provider === "gemini" && !process.env.AI_MODEL) {
      options.model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
    }
  }

  if (options.dryRun) {
    options.useAI = false;
    options.upload = false;
    options.storageTarget = "none";
    options.database = false;
    options.databaseTarget = "none";
    options.saveImages = false;
  } else if (options.directPublishRequested) {
    throw new Error(
      "artvee-ingest now only creates raw evidence files. Use the reviewed publish step after Codex review and human approval.",
    );
  }

  options.cosPrefix = String(options.cosPrefix || "").replace(/^\/+|\/+$/g, "");
  options.cosDomain = String(options.cosDomain || "").replace(/\/+$/g, "");
  options.database = options.database && options.databaseTarget === "cloudbase";
  options.upload = options.upload && options.storageTarget === "cos";
  return options;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function parseDelayRange(value, label) {
  const text = String(value || "").trim();
  const parts = text.split("-").map((part) => Number(part.trim()));
  if (parts.length === 1 && Number.isSafeInteger(parts[0]) && parts[0] >= 0) {
    return [parts[0], parts[0]];
  }
  if (
    parts.length !== 2 ||
    !Number.isSafeInteger(parts[0]) ||
    !Number.isSafeInteger(parts[1]) ||
    parts[0] < 0 ||
    parts[1] < parts[0]
  ) {
    throw new Error(`${label} must be a millisecond value or range like 5000-12000.`);
  }
  return parts;
}

function normalizeArtistUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) {
    const parsed = new URL(text);
    if (!/^\/artist\/[^/]+\/?$/i.test(parsed.pathname)) {
      throw new Error("Artist URL must look like https://artvee.com/artist/<slug>/");
    }
    parsed.pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  }
  const slug = text.replace(/^\/?artist\//i, "").replace(/^\/+|\/+$/g, "");
  if (!slug) return "";
  return `${ARTVEE_BASE_URL}/artist/${encodeURIComponent(slug).replace(/%2F/gi, "/")}/`;
}

function normalizeArtistsUrl(value) {
  const text = String(value || "").trim();
  if (!text) return `${ARTVEE_BASE_URL}/artists/`;
  const parsed = new URL(text, ARTVEE_BASE_URL);
  if (!/^\/artists\/?$/i.test(parsed.pathname)) {
    throw new Error("Artists URL must look like https://artvee.com/artists/");
  }
  parsed.pathname = "/artists/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

export function resolveGeminiApiKey(env = process.env) {
  return env.GEMINI_API_KEY || env.GOOGLE_API_KEY || env.google_API_KEY || DEFAULT_GEMINI_API_KEY;
}

export function shouldPauseBeforeAi(options) {
  return Boolean(options.useAI && options.provider === "gemini" && options.delayMs > 0);
}

export function buildFamousSearchQueries(seeds = DEFAULT_FAMOUS_SEEDS) {
  const seen = new Set();
  return [...seeds]
    .map((seed, index) => ({
      query: cleanText(seed?.query || seed?.title || ""),
      priority: Number(seed?.priority || 0),
      index,
    }))
    .filter((seed) => seed.query)
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map((seed) => seed.query)
    .filter((query) => {
      const key = query.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function loadFamousSearchQueries(options) {
  try {
    const text = await readFile(options.famousList, "utf8");
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error("famous list JSON must be an array.");
    }
    const queries = buildFamousSearchQueries(parsed);
    if (queries.length > 0) return queries;
    log(`Famous list is empty; using built-in fallback: ${options.famousList}`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      log(
        `Failed to read famous list ${options.famousList}: ${error.message}; using built-in fallback.`,
      );
    }
  }
  return buildFamousSearchQueries(DEFAULT_FAMOUS_SEEDS);
}

function slugFromArtistName(value = "") {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

export function buildArtistPriorityEntries(records = []) {
  const seen = new Set();
  return [...records]
    .map((record, index) => ({
      name: cleanText(record?.name || record?.artist || ""),
      slug: cleanText(record?.slug || ""),
      url: cleanText(record?.url || ""),
      rank: Number.isSafeInteger(Number(record?.rank)) ? Number(record.rank) : index + 1,
      score: Number.isFinite(Number(record?.score)) ? Number(record.score) : 0,
      index,
    }))
    .sort(
      (left, right) =>
        left.rank - right.rank || right.score - left.score || left.index - right.index,
    )
    .map((record) => {
      const url = record.url
        ? normalizeArtistUrl(record.url)
        : normalizeArtistUrl(record.slug || slugFromArtistName(record.name));
      return {
        url,
        name: record.name || url.replace(/^https?:\/\/[^/]+\/artist\//i, "").replace(/\/$/g, ""),
        countText: "",
        priorityRank: record.rank,
        priorityScore: record.score,
      };
    })
    .filter((artist) => {
      const key = artist.url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function loadArtistPriorityEntries(options) {
  const text = await readFile(options.artistPriorityList, "utf8");
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(`Artist priority list JSON must be an array: ${options.artistPriorityList}`);
  }
  const artists = buildArtistPriorityEntries(parsed);
  if (artists.length === 0) {
    throw new Error(`Artist priority list is empty: ${options.artistPriorityList}`);
  }
  return artists;
}

export function buildListingUrl({
  command,
  keyword = "",
  artistUrl = "",
  page = 1,
  perPage = DEFAULT_PER_PAGE,
}) {
  if (command === "search" || command === "famous") {
    const params = new URLSearchParams();
    params.set("s", keyword);
    params.set("per_page", String(perPage));
    const base = page === 1 ? `${ARTVEE_BASE_URL}/main/` : `${ARTVEE_BASE_URL}/main/page/${page}/`;
    return `${base}?${params.toString()}`;
  }

  if (command === "artist") {
    const parsed = new URL(artistUrl);
    const pathname = parsed.pathname.endsWith("/") ? parsed.pathname : `${parsed.pathname}/`;
    parsed.pathname = page === 1 ? pathname : `${pathname}page/${page}/`;
    parsed.search = "";
    parsed.searchParams.set("per_page", String(perPage));
    return parsed.toString();
  }

  const params = new URLSearchParams();
  params.set("orderby", command === "random" ? "random_order" : "popularity");
  params.set("per_page", String(perPage));
  const base = page === 1 ? `${ARTVEE_BASE_URL}/` : `${ARTVEE_BASE_URL}/page/${page}/`;
  return `${base}?${params.toString()}`;
}

export function extractListingsFromHtml(html, pageUrl = ARTVEE_BASE_URL) {
  const matches = [
    ...html.matchAll(/<div\b[^>]*class=["'][^"']*\bproduct-element-top\b[^"']*["'][^>]*>/gi),
  ];
  const listings = [];
  const seen = new Set();

  for (let index = 0; index < matches.length; index += 1) {
    const tag = matches[index][0];
    const start = matches[index].index ?? 0;
    const end = matches[index + 1]?.index ?? html.length;
    const segment = html.slice(start, end);
    const attrs = getAttributes(tag);
    const href =
      extractFirst(
        segment,
        /<h3\b[^>]*class=["'][^"']*product-title[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>/i,
      ) ?? attrs["data-url"];
    const url = normalizeArtveeUrl(absoluteUrl(href, pageUrl));
    if (!url || seen.has(url)) continue;

    const sk = parseDataSk(attrs["data-sk"]);
    const titleHtml = extractFirst(
      segment,
      /<h3\b[^>]*class=["'][^"']*product-title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i,
    );
    const title = cleanText(titleHtml);
    const artistHtml = extractFirst(
      segment,
      /<div\b[^>]*class=["'][^"']*woodmart-product-brands-links[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    );
    const tagsHtml = extractFirst(
      segment,
      /<div\b[^>]*class=["'][^"']*woodmart-product-cats[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    );
    const imageUrl = absoluteUrl(
      extractFirst(segment, /<img\b[^>]*(?:data-src|src)=["']([^"']+)["']/i),
      pageUrl,
    );

    seen.add(url);
    listings.push({
      url,
      title,
      artist: cleanText(artistHtml),
      tags: extractLinkTexts(tagsHtml),
      imageUrl,
      sourceRecordId: attrs["data-id"] || "",
      popularity: Number.parseInt(attrs["data-cnt"] || "0", 10) || 0,
      dimensions: sk.sdlimagesize || "",
      hdDimensions: sk.hdlimagesize || "",
      artveeImageKey: sk.sk || "",
    });
  }

  return listings;
}

export function extractArtistsFromHtml(html, pageUrl = `${ARTVEE_BASE_URL}/artists/`) {
  const artists = [];
  const seen = new Set();
  const cardMatches = [
    ...String(html || "").matchAll(
      /<div\b[^>]*class=["'][^"']*\bwrapp-catti\b[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
    ),
  ];
  const segments = cardMatches.length ? cardMatches.map((match) => match[0]) : [String(html || "")];

  for (const segment of segments) {
    const href = extractFirst(segment, /<a\b[^>]*href=["']([^"']*\/artist\/[^"']+)["'][^>]*>/i);
    const url = normalizeArtistUrl(absoluteUrl(href, pageUrl));
    if (!url || seen.has(url)) continue;
    const name =
      cleanText(extractFirst(segment, /<span\b[^>]*>([\s\S]*?)<\/span>/i)) ||
      cleanText(
        extractFirst(segment, /<a\b[^>]*>[\s\S]*?<h3\b[^>]*>([\s\S]*?)(?:<mark\b|<\/h3>)/i),
      ) ||
      slugFromUrl(url).replace(/-/g, " ");
    const countText = cleanText(
      extractFirst(
        segment,
        /<mark\b[^>]*class=["'][^"']*\bcount\b[^"']*["'][^>]*>([\s\S]*?)<\/mark>/i,
      ),
    );
    artists.push({ url, name, countText });
    seen.add(url);
  }
  return artists;
}

export function parseArtworkPage(html, sourceUrl, listing = {}) {
  const headingHtml =
    extractFirst(
      html,
      /<h1\b[^>]*class=["'][^"']*product_title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i,
    ) ??
    extractFirst(
      html,
      /<meta\b[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    ) ??
    listing.title ??
    "";
  const { title, year } = splitTitleAndYear(cleanText(headingHtml).replace(/\s+-\s+Artvee$/i, ""));
  const artistHtml =
    extractFirst(html, /<div\b[^>]*class=["']tartist["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ??
    extractFirst(
      html,
      /<div\b[^>]*class=["'][^"']*woodmart-product-brands-links[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    );
  const standardBlock =
    extractFirst(
      html,
      /<div\b[^>]*class=["'][^"']*w3eden[^"']*dl_med[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<div\b[^>]*class=["'][^"']*w3eden/i,
    ) || html;
  const collection = cleanText(
    extractFirst(html, /In Collection:\s*([\s\S]*?)(?:<a\b|\(|<\/h2>)/i),
  );
  const license =
    cleanText(extractFirst(html, /License:\s*<\/span>([\s\S]*?)<\/h6>/i)) ||
    cleanText(extractFirst(html, /<h6\b[^>]*>([\s\S]*?public domain[\s\S]*?)<\/h6>/i));
  const ogImage = absoluteUrl(
    extractFirst(html, /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/i),
    sourceUrl,
  );
  const downloadUrl = extractStandardDownloadUrl(html, sourceUrl);
  const dimensions =
    cleanText(extractFirst(standardBlock, /Standard,\s*([^<,]+?px)/i)) || listing.dimensions || "";
  const medium = cleanText(
    extractFirst(standardBlock, /\b(JPEG|JPG|PNG|WEBP|TIFF?)\b/i),
  ).toUpperCase();
  const sourceRecordId =
    listing.sourceRecordId || extractFirst(html, /\bpostid-(\d+)\b/i) || slugFromUrl(sourceUrl);
  const tags = uniqueCompact([
    ...(listing.tags || []),
    collection,
    license.toLowerCase().includes("public domain") ? "Public domain" : "",
  ]);

  return {
    sourceUrl: normalizeArtveeUrl(sourceUrl),
    sourceRecordId,
    titleCn: hasCjk(title) ? title : "",
    titleEn: title,
    artist: cleanText(artistHtml) || listing.artist || "Unknown artist",
    location: collection,
    yearAndPlace: year,
    medium,
    dimensions,
    description: "",
    tags,
    pageText: extractPageEvidenceText(html),
    imageUrl: listing.imageUrl || ogImage,
    downloadUrl,
    license,
    popularity: listing.popularity || 0,
    artveeImageKey: listing.artveeImageKey || "",
    hdDimensions: listing.hdDimensions || "",
  };
}

function extractPageEvidenceText(html) {
  return cleanText(stripTags(String(html || ""))).slice(0, 4000);
}

function extractStandardDownloadUrl(html, sourceUrl) {
  const anchors = [
    ...html.matchAll(/<a\b([^>]*href=["'][^"']+["'][^>]*)>\s*Download\s*<\/a>/gi),
  ].map((match) => getAttributes(`<a ${match[1]}>`));
  const standard =
    anchors.find((attrs) => {
      const className = attrs.class || "";
      const href = attrs.href || "";
      return href.includes("/sdl/") || /\bsdl\b|\bdis\b/.test(className);
    }) ?? anchors.find((attrs) => attrs.href);
  return absoluteUrl(standard?.href, sourceUrl);
}

function splitTitleAndYear(text) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const match = cleaned.match(
    /^(.*)\s+\(([^()]*(?:\d{3,4}|century|Century|before|circa|c\.)[^()]*)\)\s*$/,
  );
  if (!match) return { title: cleaned, year: "" };
  return { title: match[1].trim(), year: match[2].trim() };
}

function parseDataSk(value = "") {
  if (!value) return {};
  try {
    return JSON.parse(decodeHtml(value));
  } catch {
    return {};
  }
}

function getAttributes(tag) {
  const attrs = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? "");
  }
  return attrs;
}

function extractFirst(text = "", regex) {
  const match = text.match(regex);
  return match?.[1] ?? "";
}

function extractLinkTexts(html = "") {
  if (!html) return [];
  const links = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((match) =>
    cleanText(match[1]),
  );
  return uniqueCompact(links.length ? links : [cleanText(html)]);
}

function stripTags(value = "") {
  return String(value)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function cleanText(value = "") {
  return decodeHtml(stripTags(value))
    .replace(/\s+/g, " ")
    .replace(/\s+\)/g, ")")
    .replace(/\(\s+/g, "(")
    .trim();
}

function hasCjk(value = "") {
  return /[\u3400-\u9fff]/.test(String(value));
}

function isUnknownish(value = "") {
  const text = cleanText(value).toLowerCase();
  return (
    !text ||
    text === "unknown" ||
    text === "unknown artist" ||
    text === "untitled" ||
    text === UNKNOWN_VALUE
  );
}

function isImageFileMedium(value = "") {
  return /^(jpe?g|png|webp|tiff?)$/i.test(cleanText(value));
}

function isPixelDimensions(value = "") {
  return /\b\d+\s*x\s*\d+\s*px\b/i.test(cleanText(value));
}

function knownOrUnknown(value = "") {
  const text = cleanText(value);
  return text && !isUnknownish(text) ? text : UNKNOWN_VALUE;
}

function normalizeDescription(value = "", artwork = {}) {
  const description = cleanText(value) || fallbackReaderDescription(artwork);
  if (description.length <= 400) return description;
  const clipped = description.slice(0, 399).replace(/[，、；;:\s]+$/g, "");
  return /[。！？!?]$/.test(clipped) ? clipped : `${clipped.slice(0, 399)}。`;
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#8217;/g, "'")
    .replace(/&#038;/g, "&")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function absoluteUrl(value = "", base = ARTVEE_BASE_URL) {
  if (!value) return "";
  try {
    return new URL(decodeHtml(value), base || ARTVEE_BASE_URL).toString();
  } catch {
    return "";
  }
}

function normalizeArtveeUrl(value = "") {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (
      url.hostname.endsWith("artvee.com") &&
      url.pathname.startsWith("/dl/") &&
      !url.pathname.endsWith("/")
    ) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  } catch {
    return value;
  }
}

function slugFromUrl(value = "") {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    return parts.at(-1) || url.hostname;
  } catch {
    return value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
}

function uniqueCompact(values) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

export function formatAssetName(number) {
  return `${String(number).padStart(3, "0")}_standard.jpg`;
}

function formatCsvId(number) {
  return `${String(number).padStart(3, "0")}_standard`;
}

export function extractMaxStorageNumber(objects) {
  let max = 0;
  for (const object of objects || []) {
    const match = object.name?.match(/^(\d+)_standard\.(?:jpg|jpeg|png|webp)$/i);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

export function nextStorageNumberFromMaxes(...values) {
  return Math.max(0, ...values.map((value) => Number(value) || 0)) + 1;
}

export function toCsv(rows) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((column) => csvCell(row[column] ?? "")).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join(",") : String(value ?? "");
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function csvTimestamp(date = new Date()) {
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

export function buildCsvRow(artwork, number, generatedMetadata) {
  const rawTags = generatedMetadata?.tags ?? rawArtworkTags(artwork);
  return {
    id: formatCsvId(number),
    title_cn: knownOrUnknown(generatedMetadata?.title_cn || artwork.titleCn),
    title_en: knownOrUnknown(generatedMetadata?.title_en || artwork.titleEn || artwork.titleCn),
    artist: knownOrUnknown(generatedMetadata?.artist || artwork.artist),
    location: knownOrUnknown(generatedMetadata?.location || artwork.location),
    year_and_place: knownOrUnknown(generatedMetadata?.year_and_place || artwork.yearAndPlace),
    medium: knownOrUnknown(
      generatedMetadata?.medium || (isImageFileMedium(artwork.medium) ? "" : artwork.medium),
    ),
    dimensions: knownOrUnknown(
      generatedMetadata?.dimensions ||
        (isPixelDimensions(artwork.dimensions) ? "" : artwork.dimensions),
    ),
    description: knownOrUnknown(generatedMetadata?.description),
    tags: tagsForCsv(rawTags),
  };
}

export function buildRawEvidenceRecord(artwork, csvRow, assetName, imagePath = "") {
  return {
    schema_version: 1,
    review_status: "pending",
    confidence: "unreviewed",
    review_notes: "",
    source: {
      name: "Artvee",
      url: artwork.sourceUrl || "",
      record_id: artwork.sourceRecordId || "",
    },
    raw: {
      title_cn: artwork.titleCn || "",
      title_en: artwork.titleEn || "",
      artist: artwork.artist || "",
      collection: artwork.location || "",
      year_text: artwork.yearAndPlace || "",
      file_format: artwork.medium || "",
      image_pixel_dimensions: artwork.dimensions || "",
      hd_image_pixel_dimensions: artwork.hdDimensions || "",
      license: artwork.license || "",
      tags: uniqueCompact(artwork.tags || []),
      popularity: artwork.popularity || 0,
      artvee_image_key: artwork.artveeImageKey || "",
      page_text_excerpt: artwork.pageText || "",
    },
    verified_sources: [],
    image: {
      id: csvRow.id || String(assetName || "").replace(/\.[^.]+$/, ""),
      asset_name: assetName || "",
      local_path: imagePath || "",
      preview_url: artwork.imageUrl || "",
      download_url: artwork.downloadUrl || "",
      pixel_dimensions: artwork.dimensions || "",
      file_format: artwork.medium || "",
    },
    reviewed_metadata: {
      title_cn: "",
      title_en: "",
      artist: "",
      location: "",
      year_and_place: "",
      medium: "",
      dimensions: "",
      description: "",
      tags: [],
    },
  };
}

function rawArtworkTags(artwork = {}) {
  return uniqueCompact([...(artwork.tags || []), artwork.collection, artwork.location]);
}

function tagsForCsv(values = []) {
  const tags = uniqueCompact(values).slice(0, 6);
  while (tags.length < 4) tags.push(UNKNOWN_VALUE);
  return tags.join(",");
}

export function collectListingTarget(options) {
  if (options.command === "famous") return options.count + Math.max(options.count * 3, 45);
  const skipBuffer = Math.max(options.count * 2, 30);
  return options.count + skipBuffer;
}

function listingPageLimit(options) {
  const target = collectListingTarget(options);
  if (options.pages) return options.pages;
  return Math.max(options.maxArtworkPagesPerRun || 0, Math.ceil(target / options.perPage) + 2);
}

async function* iterateListings(options) {
  if (options.command === "famous") {
    yield* iterateFamousListings(options);
    return;
  }
  if (options.command === "artists" || options.command === "artists-priority") {
    yield* iterateArtistDirectoryListings(options);
    return;
  }

  const plannedPages = listingPageLimit(options);
  const maxPages = Math.min(plannedPages, options.maxArtworkPagesPerRun || plannedPages);
  const seen = new Set();

  for (let page = 1; page <= maxPages; page += 1) {
    const url = buildListingUrl({
      command: options.command,
      keyword: options.keyword,
      artistUrl: options.artistUrl,
      page,
      perPage: options.perPage,
    });
    log(`Fetching list page ${page}: ${url}`);
    let html = "";
    try {
      html = await fetchText(url, options);
    } catch (error) {
      if (/Fetch failed 404\b/.test(error.message)) {
        log(`List page not found; stopping at page ${page}: ${url}`);
        break;
      }
      throw error;
    }
    const pageListings = extractListingsFromHtml(html, url);
    for (const item of pageListings) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      yield item;
    }
    if (pageListings.length === 0) break;
  }
}

async function* iterateArtistDirectoryListings(options) {
  let artists = [];
  const scanArtistStart = options.scanArtistStart || options.artistStart;
  if (options.command === "artists-priority") {
    log(`Loading artist priority list: ${options.artistPriorityList}`);
    artists = (await loadArtistPriorityEntries(options)).slice(scanArtistStart - 1);
  } else {
    log(`Fetching artists directory: ${options.artistsUrl}`);
    const html = await fetchText(options.artistsUrl, options);
    artists = extractArtistsFromHtml(html, options.artistsUrl).slice(scanArtistStart - 1);
  }
  const seen = new Set();

  for (let artistIndex = 0; artistIndex < artists.length; artistIndex += 1) {
    const artist = artists[artistIndex];
    let emittedForArtist = 0;
    const artistLimit = options.perArtist > 0 ? options.perArtist : Number.POSITIVE_INFINITY;
    const plannedPages =
      options.perArtist > 0
        ? Math.max(1, Math.ceil(options.perArtist / options.perPage))
        : options.pages || options.maxArtworkPagesPerRun || DEFAULT_MAX_ARTWORK_PAGES_PER_RUN;
    const maxPages = Math.min(plannedPages, options.maxArtworkPagesPerRun || plannedPages);
    const rankText = artist.priorityRank ? ` rank ${artist.priorityRank}` : "";
    log(
      `Fetching artist ${scanArtistStart + artistIndex}${rankText}: ${artist.name} (${artist.url})`,
    );

    for (let page = 1; page <= maxPages && emittedForArtist < artistLimit; page += 1) {
      const url = buildListingUrl({
        command: "artist",
        artistUrl: artist.url,
        page,
        perPage: options.perPage,
      });
      let pageHtml = "";
      try {
        pageHtml = await fetchText(url, options);
      } catch (error) {
        if (shouldTreatArtistPageErrorAsEnd(error, page)) {
          log(`Artist list pagination ended at page ${page}: ${url} (${error.message})`);
          break;
        }
        throw error;
      }
      const listings = extractListingsFromHtml(pageHtml, url);
      if (!listings.length) break;
      for (const listing of listings) {
        if (seen.has(listing.url)) continue;
        seen.add(listing.url);
        yield {
          ...listing,
          artistDirectoryName: artist.name,
          artistDirectoryUrl: artist.url,
          artistDirectoryIndex: scanArtistStart + artistIndex,
        };
        emittedForArtist += 1;
        if (emittedForArtist >= artistLimit) break;
      }
    }
  }
}

export function shouldTreatArtistPageErrorAsEnd(error, page) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /Fetch failed 404\b/i.test(message);
}

function isTransientCrawlError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /Fetch failed 5\d\d\b|fetch failed|timeout|timed out|aborted|AbortError|ECONNRESET|UND_ERR_CONNECT_TIMEOUT|maintenance page/i.test(
    message,
  );
}

function normalizeFamousArtist(value = "") {
  return (
    cleanText(value)
      .replace(/\([^)]*\)/g, "")
      .replace(/\b(follower|circle|school|studio|after|workshop|cercle)\s+of\b/gi, "")
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .toLowerCase() || "unknown"
  );
}

function normalizeFamousSeries(value = "") {
  const title = cleanText(value).toLowerCase();
  if (/album of sketches by katsushika hokusai/i.test(title))
    return "album-of-sketches-by-katsushika-hokusai";
  return title
    .replace(/\bpl\.?\s*\d+\b/gi, "")
    .replace(/\b(?:plate|no|number)\s*\d+\b/gi, "")
    .replace(/\b\d+\b/g, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim();
}

function isFamousRelatedDerivative(listing = {}) {
  const text = `${listing.title || ""} ${listing.artist || ""} ${(listing.tags || []).join(" ")}`;
  return /\b(album|pl\.|plate|study|studies|sketch|after|follower|circle|school|studio|workshop|cercle|poster|posters|lith|illustration|copy|reproduction)\b/i.test(
    text,
  );
}

function famousRequiredTitlePattern(query = "") {
  const q = query.toLowerCase();
  if (/mona lisa|gioconda/.test(q))
    return /(?:^|,\s*)(?:the\s+)?mona lisa$|^mona lisa$|la gioconda$|gioconda$/i;
  if (/starry night/.test(q)) return /^(?:the\s+)?starry night$/i;
  if (/school of athens/.test(q)) return /school of athens|skolen i athen/i;
  if (/birth of venus/.test(q)) return /birth of venus/i;
  if (/girl with a pearl earring/.test(q)) return /girl with a pearl earring/i;
  if (/\bthe kiss\b|gustav klimt/.test(q)) return /\bkiss\b|lovers/i;
  if (/great wave/.test(q)) return /great wave|kanagawa/i;
  if (/las meninas/.test(q)) return /las meninas/i;
  if (/night watch/.test(q)) return /night watch/i;
  if (/liberty leading/.test(q)) return /liberty leading/i;
  if (/last supper/.test(q)) return /last supper/i;
  if (/vitruvian man/.test(q)) return /vitruvian/i;
  if (/water lilies/.test(q)) return /water lilies|water lily|pond of water lilies/i;
  if (/impression sunrise/.test(q)) return /impression.*sunrise/i;
  if (/third of may/.test(q)) return /third of may|3rd of may|may 1808/i;
  if (/saturn devouring/.test(q)) return /saturn.*devouring/i;
  if (/wanderer above/.test(q)) return /wanderer.*sea.*fog/i;
  if (/raft of the medusa/.test(q)) return /raft of the medusa/i;
  if (/olympia/.test(q)) return /\bolympia\b/i;
  if (/primavera/.test(q)) return /primavera/i;
  if (/luncheon on the grass/.test(q)) return /luncheon on the grass/i;
  if (/cafe terrace/.test(q)) return /cafe terrace|café terrace/i;
  if (/irises/.test(q)) return /^irises$/i;
  if (/sistine madonna/.test(q)) return /sistine madonna/i;
  if (/milkmaid/.test(q)) return /milkmaid/i;
  if (/woman with a parasol/.test(q)) return /woman with a parasol/i;
  if (/hay wain/.test(q)) return /hay wain/i;
  if (/rain steam and speed/.test(q)) return /rain.*steam.*speed/i;
  if (/bar at the folies/.test(q)) return /bar.*folies|folies.*berg/i;
  return null;
}

function isFamousCandidateRelevant(listing = {}, query = "") {
  const required = famousRequiredTitlePattern(query);
  if (!required) return true;
  return required.test(cleanText(listing.title));
}

function famousListingScore(listing, query) {
  const haystack = `${listing.title || ""} ${listing.artist || ""}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 2);
  const hits = tokens.filter((token) => haystack.includes(token)).length;
  const title = cleanText(listing.title).toLowerCase();
  const artist = cleanText(listing.artist).toLowerCase();
  const queryText = query.toLowerCase();
  let score = hits * 100 + (listing.popularity || 0);
  if (/mona lisa|gioconda/.test(queryText) && /mona lisa|gioconda/.test(title)) score += 300;
  if (/starry night/.test(queryText) && /starry night/.test(title)) score += 300;
  if (/school of athens/.test(queryText) && /school of athens|skolen i athen/.test(title))
    score += 300;
  if (/birth of venus/.test(queryText) && /birth of venus/.test(title)) score += 300;
  if (/great wave/.test(queryText) && /great wave/.test(title)) score += 300;
  if (/leonardo|vinci/.test(queryText) && /leonardo|vinci/.test(artist)) score += 500;
  if (/van gogh/.test(queryText) && /gogh/.test(artist)) score += 500;
  if (/raphael/.test(queryText) && /raphael/.test(artist)) score += 500;
  if (/hokusai/.test(queryText) && /hokusai/.test(artist)) score += 500;
  if (isFamousRelatedDerivative(listing)) score -= 250;
  return score;
}

function canSelectFamousCandidate(candidate, counts, limits) {
  const artistKey = normalizeFamousArtist(candidate.artist);
  const seriesKey = normalizeFamousSeries(candidate.title);
  const maxArtist = limits.maxArtistPerRun || 3;
  const maxSeries = limits.maxSeriesPerRun || 2;
  return (
    (counts.artist.get(artistKey) || 0) < maxArtist &&
    (counts.series.get(seriesKey) || 0) < maxSeries
  );
}

function countFamousCandidate(candidate, counts) {
  const artistKey = normalizeFamousArtist(candidate.artist);
  const seriesKey = normalizeFamousSeries(candidate.title);
  counts.artist.set(artistKey, (counts.artist.get(artistKey) || 0) + 1);
  counts.series.set(seriesKey, (counts.series.get(seriesKey) || 0) + 1);
}

export function selectFamousCandidates(candidates = [], options = {}) {
  const query = options.query || "";
  const counts = {
    artist: new Map(),
    series: new Map(),
  };
  const selected = [];
  for (const candidate of [...candidates]
    .filter((item) => isFamousCandidateRelevant(item, query))
    .sort((left, right) => famousListingScore(right, query) - famousListingScore(left, query))) {
    if (!canSelectFamousCandidate(candidate, counts, options)) continue;
    countFamousCandidate(candidate, counts);
    selected.push(candidate);
  }
  return selected;
}

async function* iterateFamousListings(options) {
  const queries = await loadFamousSearchQueries(options);
  const target = collectListingTarget(options);
  const seen = new Set();
  const selectedCounts = {
    artist: new Map(),
    series: new Map(),
  };
  let yielded = 0;
  const queryLimit = Math.min(
    queries.length,
    options.pages || options.maxArtworkPagesPerRun || queries.length,
  );

  for (const query of queries.slice(0, queryLimit)) {
    const url = buildListingUrl({
      command: "famous",
      keyword: query,
      page: 1,
      perPage: options.perPage,
    });
    log(`Fetching famous search: ${query}`);
    let html = "";
    try {
      html = await fetchText(url, options);
    } catch (error) {
      if (/Fetch failed 404\b/.test(error.message)) {
        log(`Famous search not found; skipping: ${query}`);
        continue;
      }
      throw error;
    }
    const pageListings = selectFamousCandidates(extractListingsFromHtml(html, url), {
      query,
      maxArtistPerRun: options.maxArtistPerRun,
      maxSeriesPerRun: options.maxSeriesPerRun,
    });
    const primary = pageListings.find(
      (item) => !seen.has(item.url) && canSelectFamousCandidate(item, selectedCounts, options),
    );
    if (primary) {
      seen.add(primary.url);
      countFamousCandidate(primary, selectedCounts);
      yield primary;
      yielded += 1;
      if (yielded >= target) return;
    }
  }
}

async function collectListings(options) {
  const target = collectListingTarget(options);
  const listings = [];

  for await (const listing of iterateListings(options)) {
    listings.push(listing);
    if (listings.length >= target) break;
  }

  if (options.command === "popular") {
    listings.sort((left, right) => right.popularity - left.popularity);
  }
  return listings.slice(0, target);
}

async function fetchText(url, options) {
  const cached = await readTextCache(url, options);
  if (cached && !isArtveeMaintenancePage(cached)) {
    log(`Cache hit: ${url}`);
    return cached;
  }
  if (cached) log(`Ignoring stale maintenance-page cache: ${url}`);
  await ensureRobotsAllowed(url, options);
  await waitForRequestBudget(options, "html");
  let text = "";
  try {
    const response = await fetchWithRetries(
      url,
      {
        headers: {
          "user-agent": options.userAgent,
          accept: "text/html,application/xhtml+xml",
        },
      },
      options,
    );
    if (!response.ok) {
      throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
    }
    text = await response.text();
  } catch (error) {
    if (!canUseCurlHtmlFallback(error)) throw error;
    log(`Node HTML request failed (${describeFetchError(error)}); trying curl fallback: ${url}`);
    text = await fetchTextWithCurl(url, options);
  }
  if (isArtveeMaintenancePage(text)) {
    throw new Error(`Artvee maintenance page returned for ${url}`);
  }
  await writeTextCache(url, text, options);
  return text;
}

export function canUseCurlHtmlFallback(error) {
  const message = describeFetchError(error);
  return (
    process.platform === "win32" &&
    /Fetch failed 5\d\d\b|fetch failed|timeout|timed out|aborted|ECONNRESET|UND_ERR_CONNECT_TIMEOUT/i.test(
      message,
    ) &&
    !/Stop requested|Fetch failed 40[134]\b/i.test(message)
  );
}

async function fetchTextWithCurl(url, options) {
  const maxTimeSeconds = Math.max(
    45,
    Math.ceil((options.timeoutMs || DEFAULT_TIMEOUT_MS) / 1000) + 15,
  );
  try {
    const { stdout } = await execFileAsync(
      "curl.exe",
      [
        "-L",
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        String(maxTimeSeconds),
        "--user-agent",
        options.userAgent,
        "--header",
        "accept: text/html,application/xhtml+xml",
        url,
      ],
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: (maxTimeSeconds + 5) * 1000,
        windowsHide: true,
      },
    );
    if (!stdout.trim()) throw new Error("curl returned an empty HTML response");
    return stdout;
  } catch (error) {
    throw new Error(`curl HTML fallback failed: ${describeFetchError(error)}`, { cause: error });
  }
}

export function isArtveeMaintenancePage(html = "") {
  const text = String(html);
  return (
    /<title>\s*(?:Site\s+)?Under Maintenance\b/i.test(text) ||
    /\bOur website is currently undergoing scheduled maintenance\b/i.test(text)
  );
}

async function fetchImageBuffer(url, fallbackUrl, options) {
  const urls = uniqueCompact([url, fallbackUrl]);
  const maxBytes = options.maxImageMb * 1024 * 1024;
  let lastError = null;

  for (const currentUrl of urls) {
    try {
      log(`Downloading image: ${currentUrl}`);
      await waitForRequestBudget(options, "image");
      const response = await fetchWithRetries(
        currentUrl,
        {
          headers: {
            "user-agent": options.userAgent,
            accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          },
        },
        options,
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/")) {
        throw new Error(`Expected image content, got ${contentType}`);
      }
      const contentLength = Number(response.headers.get("content-length") || "0");
      if (contentLength > maxBytes) {
        throw new Error(`Image exceeds --max-image-mb (${options.maxImageMb} MB)`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > maxBytes) {
        throw new Error(`Image exceeds --max-image-mb (${options.maxImageMb} MB)`);
      }
      return { buffer, contentType };
    } catch (error) {
      lastError = error;
      log(`Image download fallback: ${error.message}`);
    }
  }

  throw lastError ?? new Error("No image URL available.");
}

function buildMetadataPrompt(artwork, researchContext = "") {
  return [
    "IMPORTANT DESCRIPTION STYLE: write reader-facing Chinese artwork prose, like a museum/app introduction.",
    "Do not write an ingestion/source report. Never mention Artvee, CSV, script, crawler, database, upload, source page, verification, missing metadata, or future review inside description.",
    "Avoid batch templates. Each description must include distinct visual details suggested by this specific title, artist, period, medium, subject, and style.",
    "For uncertain fields outside description, use 暂不明确 or （推测）; inside description, discuss visible content, background, style, and artistic value without saying the data is uncertain.",
    "请基于 Artvee 页面元数据，并在需要时使用可验证的公开资料补全作品入库信息。",
    "只返回严格 JSON，不要使用 Markdown 代码块、标题或额外说明。",
    "JSON 字段必须完整：title_cn,title_en,artist,location,year_and_place,medium,dimensions,description,tags。",
    "title_cn 必须是作品中文名称；title_en 保留英文或原文名称。",
    "artist 使用“中文名 (English name)”格式；location 使用“中文地点/机构 (English name)”格式。",
    "year_and_place 使用“年份，地点”格式；medium 使用“中文媒介 (English medium)”格式。",
    "dimensions 必须是作品实体尺寸；不要把 Artvee 下载图像的像素尺寸当作作品尺寸。",
    "如果 Artvee 和可验证资料都没有依据，字段直接填写“暂不明确”，不要编造。",
    "description 用中文写 250-400 字，介绍画面、作者、年代背景、风格和艺术价值；不能虚构无来源信息。",
    "tags 生成 4-6 个中文短标签，每个标签不要包含逗号；可包含流派、年份/年代、题材、风格、媒介或文化背景。",
    "",
    `作品标题: ${artwork.titleEn || artwork.titleCn || "Untitled"}`,
    `艺术家: ${artwork.artist || "Unknown artist"}`,
    `Artvee 年代/标题年份: ${artwork.yearAndPlace || "Artvee 未注明"}`,
    `Artvee 分类/标签: ${(artwork.tags || []).join(", ") || "Artvee 未注明"}`,
    `来源页面: ${artwork.sourceUrl}`,
    `Artvee 下载图像像素规格: ${artwork.dimensions || "Artvee 未注明"}`,
    `Artvee 文件格式: ${artwork.medium || "Artvee 未注明"}`,
    `授权信息: ${artwork.license || "Artvee 未注明"}`,
    researchContext
      ? `可验证补全资料: ${researchContext}`
      : "可验证补全资料: 暂无；不要据此编造缺失字段。",
  ].join("\n");
}

export function buildGeminiResearchRequestBody(artwork) {
  return {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: [
              "请使用可验证的公开资料核对这件艺术作品的中文标题、艺术家中文名、馆藏地点、创作年份/地点、作品媒介和实体尺寸。",
              "只总结有来源依据的信息；没有可靠依据的字段写“暂不明确”。",
              "不要输出长文，不要编造。",
              "",
              `作品标题: ${artwork.titleEn || artwork.titleCn || "Untitled"}`,
              `艺术家: ${artwork.artist || "Unknown artist"}`,
              `Artvee 来源页面: ${artwork.sourceUrl}`,
            ].join("\n"),
          },
        ],
      },
    ],
    tools: [{ google_search: {} }],
  };
}

function buildOpenAIMetadataSchema() {
  const stringField = (description) => ({ type: "string", description });
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      title_cn: stringField("作品中文名称；无可靠依据时填“暂不明确”。"),
      title_en: stringField("作品英文或原文名称；无可靠依据时填“暂不明确”。"),
      artist: stringField("艺术家，格式为“中文名 (English name)”；无可靠依据时填“暂不明确”。"),
      location: stringField(
        "馆藏或地点，格式为“中文地点/机构 (English name)”；无可靠依据时填“暂不明确”。",
      ),
      year_and_place: stringField(
        "年份和地点，格式如“1888年，法国阿尔勒”；无可靠依据时填“暂不明确”。",
      ),
      medium: stringField(
        "作品媒介，格式如“布面油画 (Oil on canvas)”；不要填写 JPG/PNG 等文件格式。",
      ),
      dimensions: stringField("作品实体尺寸；不要填写像素尺寸；无可靠依据时填“暂不明确”。"),
      description: stringField("250-400 字中文作品简介。"),
      tags: {
        type: "array",
        minItems: 4,
        maxItems: 6,
        items: {
          type: "string",
          description: "中文短标签，不包含逗号。",
        },
      },
    },
    required: GENERATED_METADATA_FIELDS,
  };
}

function buildGeminiResponseSchema() {
  const stringField = (description) => ({ type: "STRING", description });
  return {
    type: "OBJECT",
    properties: {
      title_cn: stringField("作品中文名称；无可靠依据时填“暂不明确”。"),
      title_en: stringField("作品英文或原文名称；无可靠依据时填“暂不明确”。"),
      artist: stringField("艺术家，格式为“中文名 (English name)”；无可靠依据时填“暂不明确”。"),
      location: stringField(
        "馆藏或地点，格式为“中文地点/机构 (English name)”；无可靠依据时填“暂不明确”。",
      ),
      year_and_place: stringField(
        "年份和地点，格式如“1888年，法国阿尔勒”；无可靠依据时填“暂不明确”。",
      ),
      medium: stringField(
        "作品媒介，格式如“布面油画 (Oil on canvas)”；不要填写 JPG/PNG 等文件格式。",
      ),
      dimensions: stringField("作品实体尺寸；不要填写像素尺寸；无可靠依据时填“暂不明确”。"),
      description: stringField("250-400 字中文作品简介。"),
      tags: {
        type: "ARRAY",
        minItems: 4,
        maxItems: 6,
        items: {
          type: "STRING",
          description: "中文短标签，不包含逗号。",
        },
      },
    },
    required: GENERATED_METADATA_FIELDS,
  };
}
export function buildOpenAIRequestBody(artwork, options) {
  return {
    model: options.model,
    input: buildMetadataPrompt(artwork),
    max_output_tokens: 1400,
    text: {
      format: {
        type: "json_schema",
        name: "artwork_metadata",
        strict: true,
        schema: buildOpenAIMetadataSchema(),
      },
    },
  };
}

export function buildGeminiRequestBody(artwork, options = {}) {
  return {
    contents: [
      {
        role: "user",
        parts: [{ text: buildMetadataPrompt(artwork, options.researchContext || "") }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: buildGeminiResponseSchema(),
    },
  };
}

async function generateArtworkMetadata(artwork, options) {
  if (!options.useAI) {
    return null;
  }

  if (options.provider === "gemini") {
    return generateGeminiArtworkMetadata(artwork, options);
  }
  return generateOpenAIArtworkMetadata(artwork, options);
}

async function generateOpenAIArtworkMetadata(artwork, options) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required for description and tag generation. Omit --with-ai for raw website-only metadata.",
    );
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(buildOpenAIRequestBody(artwork, options)),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API failed ${response.status}: ${body.slice(0, 500)}`);
  }

  const data = await response.json();
  const metadataText = extractOpenAIText(data);
  if (!metadataText) throw new Error("OpenAI API returned an empty metadata response.");
  return normalizeGeneratedMetadata(parseGeneratedMetadata(metadataText), artwork);
}

async function generateGeminiArtworkMetadata(artwork, options) {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is required for Gemini description and tag generation. Omit --with-ai for raw website-only metadata.",
    );
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent`;
  let researchContext = "";
  if (options.grounding) {
    const researchData = await postGeminiGenerate(
      endpoint,
      apiKey,
      buildGeminiResearchRequestBody(artwork),
      options,
    );
    researchContext = extractGeminiText(researchData).slice(0, 4000);
    log(`Waiting ${Math.round(options.delayMs / 1000)} seconds before structured Gemini request.`);
    await sleep(options.delayMs);
  }

  const data = await postGeminiGenerate(
    endpoint,
    apiKey,
    buildGeminiRequestBody(artwork, { ...options, researchContext }),
    options,
  );
  const metadataText = extractGeminiText(data);
  if (!metadataText) throw new Error("Gemini API returned an empty metadata response.");
  return normalizeGeneratedMetadata(parseGeneratedMetadata(metadataText), artwork);
}

async function postGeminiGenerate(endpoint, apiKey, body, options) {
  const attempts = Math.max(1, (options.aiRetries || 0) + 1);
  let data = null;
  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });

    if (response.ok) {
      data = await response.json();
      break;
    }

    lastStatus = response.status;
    lastBody = await response.text();
    if (!isRetriableGeminiStatus(response.status) || attempt >= attempts) break;
    log(
      `Gemini API ${response.status}; retrying after ${Math.round(options.delayMs / 1000)} seconds (${attempt}/${attempts - 1}).`,
    );
    await sleep(options.delayMs);
  }

  if (!data) {
    throw new Error(`Gemini API failed ${lastStatus}: ${lastBody.slice(0, 500)}`);
  }
  return data;
}

export function isRetriableGeminiStatus(status) {
  return status === 429 || status === 503;
}

function extractGeminiText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part.text || "")
    .join("\n")
    .trim();
}

function extractOpenAIText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const chunks = [];
  for (const output of data.output || []) {
    for (const content of output.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n").trim();
}

function parseGeneratedMetadata(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return { description: cleaned, tags: [] };
    try {
      return JSON.parse(match[0]);
    } catch {
      return { description: cleaned, tags: [] };
    }
  }
}

export function normalizeGeneratedMetadata(value, artwork = {}) {
  const titleEn = knownOrUnknown(
    value?.title_en || value?.titleEn || artwork.titleEn || artwork.titleCn,
  );
  const generatedTitleCn = cleanText(value?.title_cn || value?.titleCn || artwork.titleCn || "");
  const artist = knownOrUnknown(value?.artist || artwork.artist);
  const location = knownOrUnknown(value?.location || artwork.location);
  const yearAndPlace = knownOrUnknown(
    value?.year_and_place || value?.yearAndPlace || artwork.yearAndPlace,
  );
  const rawMedium = cleanText(value?.medium || artwork.medium || "");
  const medium = knownOrUnknown(isImageFileMedium(rawMedium) ? "" : rawMedium);
  const rawDimensions = cleanText(value?.dimensions || artwork.dimensions || "");
  const dimensions = knownOrUnknown(isPixelDimensions(rawDimensions) ? "" : rawDimensions);
  const description = normalizeDescription(
    value?.description || value?.summary || value?.text || "",
    artwork,
  );
  const rawTags = Array.isArray(value?.tags)
    ? value.tags
    : String(value?.tags || "").split(/[,锛?锛涖€乗n]/);
  const tags = uniqueCompact(rawTags.map((tag) => cleanText(tag).replace(/^#+/, "")));
  const filledTags = uniqueCompact([...tags, ...fallbackTags(artwork)]).slice(0, 6);
  return {
    title_cn:
      generatedTitleCn && hasCjk(generatedTitleCn) && !isUnknownish(generatedTitleCn)
        ? generatedTitleCn
        : UNKNOWN_VALUE,
    title_en: titleEn,
    artist,
    location,
    year_and_place: yearAndPlace,
    medium,
    dimensions,
    description,
    tags: filledTags.slice(0, Math.max(4, Math.min(6, filledTags.length))),
  };
}

function fallbackDescription(artwork) {
  const title = artwork.titleEn || artwork.titleCn || "Untitled";
  const artist = artwork.artist || "Unknown artist";
  const year = artwork.yearAndPlace ? `，年代信息为 ${artwork.yearAndPlace}` : "";
  const tags = artwork.tags?.length ? `，Artvee 分类包含 ${artwork.tags.join("、")}` : "";
  return `《${title}》由 ${artist} 创作或署名${year}${tags}。这条记录保留 Artvee 页面公开提供的标题、作者、图像规格与授权信息；正式入库前建议人工复核原始来源、作品年代、媒介和馆藏信息。`;
}

function fallbackTags(artwork = {}) {
  const tags = [];
  const year = artwork.yearAndPlace || "";
  if (/\b(1[5-9]\d{2}|20\d{2})/.test(year)) {
    const yearNumber = Number(year.match(/\b(1[5-9]\d{2}|20\d{2})/)?.[1]);
    if (yearNumber) tags.push(`${Math.floor(yearNumber / 10) * 10}年代`);
  }
  const title = `${artwork.titleEn || ""} ${artwork.titleCn || ""}`.toLowerCase();
  if (/portrait|self-portrait|人物|肖像/.test(title)) tags.push("人物肖像");
  if (/landscape|field|garden|river|sea|mountain|风景|田野|花园/.test(title)) tags.push("风景题材");
  if (/flower|plant|still life|花|植物|静物/.test(title)) tags.push("植物主题");
  if (artwork.medium && !isImageFileMedium(artwork.medium)) tags.push(artwork.medium);
  tags.push("公共领域", "艺术史");
  return tags;
}

function fallbackReaderDescription(artwork) {
  const title = artwork.titleEn || artwork.titleCn || "Untitled";
  const artist = artwork.artist || "Unknown artist";
  const year = artwork.yearAndPlace ? `，可放在${artwork.yearAndPlace}这一时间语境中理解` : "";
  const tags = artwork.tags?.length ? `，题材线索包括${artwork.tags.slice(0, 3).join("、")}` : "";
  return `《${title}》与${artist}的创作或相关艺术传统相连${year}${tags}。画面适合从题材、构图、色彩和媒介关系进入：人物、景物或物件并不是孤立陈列，而是在整体节奏中形成观看顺序。作品的价值也在于保留了特定时代的视觉趣味，使观者能够通过线条、明暗、姿态和空间安排理解艺术家如何组织图像。它适合作为欣赏风格、题材和图像传播方式的入口，而不是单纯的资料说明。`;
}
async function loadDotEnvFile(filePath) {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function loadEnvironment() {
  await loadDotEnvFile(path.resolve(process.cwd(), ".env.local"));
  await loadDotEnvFile(path.resolve(process.cwd(), ".env"));
}

function createSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for upload/database writes.",
    );
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function sequencePathFor(options, bucket) {
  const key = [bucket || DEFAULT_BUCKET, "storage-sequence"].join("-");
  return path.join(
    options?.checkpointDir || DEFAULT_CHECKPOINT_DIR,
    `${key.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}.json`,
  );
}

async function readStorageSequenceNumber(options, bucket) {
  try {
    const state = JSON.parse(await readFile(sequencePathFor(options, bucket), "utf8"));
    return Number(state.maxNumber || 0) || 0;
  } catch {
    return 0;
  }
}

async function writeStorageSequenceNumber(options, bucket, number) {
  if (options?.dryRun || !number) return;
  const filePath = sequencePathFor(options, bucket);
  const current = await readStorageSequenceNumber(options, bucket);
  const maxNumber = Math.max(current, Number(number) || 0);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        version: 1,
        bucket,
        maxNumber,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function extractMaxCsvIdNumber(rows = [], column = "id") {
  let max = 0;
  for (const row of rows || []) {
    const match = String(row?.[column] || "").match(/^(\d+)_standard$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max;
}

async function getMaxNumberFromTable(supabase, table, column) {
  let max = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .range(from, from + 999);
    if (error) throw new Error(`Failed to read ${table}.${column}: ${error.message}`);
    max = Math.max(max, extractMaxCsvIdNumber(data || [], column));
    if (!data || data.length < 1000) break;
  }
  return max;
}

async function getNextStorageNumber(supabase, bucket, startOverride = 0, options = {}) {
  if (startOverride) return startOverride;
  const objects = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list("", {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`Failed to list storage bucket ${bucket}: ${error.message}`);
    objects.push(...(data || []));
    if (!data || data.length < limit) break;
    offset += data.length;
  }
  const storageMax = extractMaxStorageNumber(objects);
  const sequenceMax = await readStorageSequenceNumber(options, bucket);
  const paintingsMax = await getMaxNumberFromTable(supabase, "paintings", "id").catch(() => 0);
  const imageLinksMax = await getMaxNumberFromTable(supabase, "artwork_images", "image_id").catch(
    () => 0,
  );
  return nextStorageNumberFromMaxes(storageMax, sequenceMax, paintingsMax, imageLinksMax);
}

async function ensureArtveeSource(supabase) {
  const payload = {
    slug: "artvee",
    name: "Artvee",
    base_url: ARTVEE_BASE_URL,
    source_type: "aggregator",
    rights_notes:
      "Artvee page states public-domain availability; verify original source and rights before publishing.",
  };
  const { data, error } = await supabase
    .from("sources")
    .upsert(payload, { onConflict: "slug" })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Failed to ensure Artvee source: ${error.message}`);
  if (!data?.id) throw new Error("Failed to read Artvee source id after upsert.");
  return data.id;
}

async function findExistingArtwork(supabase, sourceUrl) {
  const { data, error } = await supabase
    .from("artworks")
    .select("id")
    .eq("source_url", sourceUrl)
    .limit(1);
  if (error) throw new Error(`Failed to check existing artwork: ${error.message}`);
  return data?.[0]?.id || "";
}

async function ensureArtist(supabase, artist) {
  const name = artist || "Unknown artist";
  const normalized = name.trim().toLowerCase();
  const { data: existing, error: selectError } = await supabase
    .from("artists")
    .select("id")
    .eq("normalized_name", normalized)
    .limit(1);
  if (selectError) throw new Error(`Failed to query artist: ${selectError.message}`);
  if (existing?.[0]?.id) return existing[0].id;

  const { data, error } = await supabase
    .from("artists")
    .insert({ name })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Failed to insert artist: ${error.message}`);
  return data?.id || null;
}

async function upsertNormalizedArtwork(
  supabase,
  sourceId,
  artwork,
  csvRow,
  publicUrl,
  assetName,
  status,
) {
  const artistId = await ensureArtist(supabase, csvRow.artist);
  const payload = {
    source_id: sourceId,
    source_record_id: artwork.sourceRecordId,
    slug: `artvee-${slugFromUrl(artwork.sourceUrl)}`,
    title: csvRow.title_cn || csvRow.title_en || "Untitled",
    artist_id: artistId,
    artist_display: csvRow.artist || "Unknown artist",
    date_display: csvRow.year_and_place || null,
    place_of_origin: csvRow.location || null,
    medium: csvRow.medium || null,
    description: csvRow.description,
    educational_summary: csvRow.description,
    license: artwork.license || "Artvee public domain statement; verify before publication.",
    is_public_domain: (artwork.license || "").toLowerCase().includes("public domain"),
    source_url: artwork.sourceUrl,
    source_payload: {
      title_en: csvRow.title_en,
      dimensions: csvRow.dimensions,
      location: csvRow.location,
      artvee_image_key: artwork.artveeImageKey,
      popularity: artwork.popularity,
      original_image_url: artwork.imageUrl,
      standard_download_url: artwork.downloadUrl,
      storage_object: assetName,
    },
    tags: uniqueCompact(csvRow.tags.split(",")),
    status,
  };

  const { data, error } = await supabase
    .from("artworks")
    .upsert(payload, { onConflict: "source_id,source_record_id" })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Failed to upsert artwork: ${error.message}`);
  if (!data?.id) throw new Error("Failed to read artwork id after upsert.");

  const imagePayload = {
    artwork_id: data.id,
    image_kind: "primary",
    image_id: assetName.replace(/\.[^.]+$/, ""),
    thumbnail_url: artwork.imageUrl || publicUrl,
    display_url: publicUrl,
    download_url: publicUrl,
    credit_line: `Image downloaded from Artvee source page: ${artwork.sourceUrl}`,
  };
  const { error: imageError } = await supabase
    .from("artwork_images")
    .upsert(imagePayload, { onConflict: "artwork_id,image_kind" });
  if (imageError) throw new Error(`Failed to upsert artwork image: ${imageError.message}`);
}

async function upsertLegacyPainting(supabase, csvRow, publicUrl) {
  const payload = {
    ...csvRow,
    display_url: publicUrl,
  };
  const { error } = await supabase.from("paintings").upsert(payload, { onConflict: "id" });
  if (error) throw new Error(`Failed to upsert legacy painting row: ${error.message}`);
}

export function tencentCosObjectKey(assetName, options = {}) {
  const prefix = String(options.cosPrefix || "").replace(/^\/+|\/+$/g, "");
  const name = String(assetName || "").replace(/^\/+/g, "");
  return prefix ? `${prefix}/${name}` : name;
}

function encodeCosKey(key) {
  return String(key || "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

export function tencentCosPublicUrl(key, options = {}) {
  const encodedKey = encodeCosKey(key);
  const domain = String(options.cosDomain || "").replace(/\/+$/g, "");
  if (domain) return `${domain}/${encodedKey}`;
  return `https://${options.cosBucket}.cos.${options.cosRegion}.myqcloud.com/${encodedKey}`;
}

function tencentCosDerivativeUrl(assetName, kind, options = {}) {
  const baseName = String(assetName || "").replace(/\.[^.]+$/, "");
  return tencentCosPublicUrl(
    tencentCosObjectKey(`derivatives/${kind}/${baseName}.webp`, options),
    options,
  );
}

export function buildCloudbaseArtworkDocument(artwork, csvRow, publicUrl, assetName, options = {}) {
  const imageId = String(assetName || csvRow.id || "").replace(/\.[^.]+$/, "");
  const sourceRecordId = artwork.sourceRecordId || csvRow.source_record_id || csvRow.id || imageId;
  const tags = uniqueCompact(String(csvRow.tags || "").split(","));
  const now = new Date().toISOString();
  const document = {
    _id: `artwork_${imageId}`,
    id: imageId,
    source_name: "Artvee",
    source_record_id: sourceRecordId,
    source_url: artwork.sourceUrl || "",
    slug: `artvee-${slugFromUrl(artwork.sourceUrl || sourceRecordId)}`,
    title_cn: csvRow.title_cn || "",
    title_en: csvRow.title_en || "",
    title: csvRow.title_cn || csvRow.title_en || "Untitled",
    artist: csvRow.artist || "Unknown artist",
    artist_display: csvRow.artist || "Unknown artist",
    location: csvRow.location || "",
    year_and_place: csvRow.year_and_place || "",
    medium: csvRow.medium || "",
    dimensions: csvRow.dimensions || "",
    description: csvRow.description || "",
    license: artwork.license || "Artvee public domain statement; verify before publication.",
    is_public_domain: String(artwork.license || "")
      .toLowerCase()
      .includes("public domain"),
    status: options.status || "draft",
    image_id: imageId,
    thumbnail_url: tencentCosDerivativeUrl(assetName, "thumb", options),
    display_url: tencentCosDerivativeUrl(assetName, "display", options),
    download_url: publicUrl || "",
    original_url: publicUrl || "",
    artvee_image_key: artwork.artveeImageKey || "",
    artvee_image_url: artwork.imageUrl || "",
    artvee_download_url: artwork.downloadUrl || "",
    popularity: artwork.popularity || 0,
    tags,
    tag_keys: tags,
    sync_target: "cloudbase",
    migrated_at: now,
    synced_at: now,
    created_at: now,
    updated_at: now,
  };
  document.search_terms = buildArtworkSearchTerms(document);
  document.search_terms_version = "search-terms-v1";
  return document;
}

function cosCall(cos, method, params) {
  return new Promise((resolve, reject) => {
    cos[method](params, (error, data) => {
      if (error) reject(error);
      else resolve(data);
    });
  });
}

async function cosObjectExists(cos, params) {
  try {
    await cosCall(cos, "headObject", params);
    return true;
  } catch (error) {
    if (
      String(error?.statusCode || "") === "403" ||
      String(error?.statusCode || "") === "404" ||
      /forbidden|not found|NoSuchKey|Not Found/i.test(String(error?.message || ""))
    ) {
      return false;
    }
    throw error;
  }
}

function createTencentCosClient(options) {
  const missing = [];
  if (!options.cosBucket) missing.push("TENCENT_COS_BUCKET or --cos-bucket");
  if (!options.cosRegion) missing.push("TENCENT_COS_REGION or --cos-region");
  if (!options.cosSecretId) missing.push("TENCENT_SECRET_ID");
  if (!options.cosSecretKey) missing.push("TENCENT_SECRET_KEY");
  if (missing.length) throw new Error(`Missing Tencent COS config: ${missing.join(", ")}`);
  return new COS({
    SecretId: options.cosSecretId,
    SecretKey: options.cosSecretKey,
    SecurityToken: options.cosSessionToken || undefined,
  });
}

async function uploadImageToTencentCos(cos, options, assetName, image) {
  const key = tencentCosObjectKey(assetName, options);
  const baseParams = {
    Bucket: options.cosBucket,
    Region: options.cosRegion,
    Key: key,
  };
  if (await cosObjectExists(cos, baseParams)) {
    return tencentCosPublicUrl(key, options);
  }
  await cosCall(cos, "putObject", {
    ...baseParams,
    Body: image.buffer,
    ContentLength: image.buffer.length,
    ContentType: image.contentType || "image/jpeg",
    CacheControl: "public, max-age=31536000, immutable",
  });
  return tencentCosPublicUrl(key, options);
}

async function listTencentCosObjects(cos, options) {
  const objects = [];
  let marker = "";
  const prefix = options.cosPrefix ? `${options.cosPrefix}/` : "";
  while (true) {
    const data = await cosCall(cos, "getBucket", {
      Bucket: options.cosBucket,
      Region: options.cosRegion,
      Prefix: prefix,
      Marker: marker,
      MaxKeys: 1000,
    });
    for (const item of data.Contents || []) {
      objects.push({ name: path.basename(item.Key || ""), key: item.Key || "" });
    }
    if (String(data.IsTruncated || "").toLowerCase() !== "true") break;
    marker = data.NextMarker || data.Contents?.at(-1)?.Key || "";
    if (!marker) break;
  }
  return objects;
}

async function getNextTencentCosNumber(cos, options) {
  if (options.start) return options.start;
  const objects = await listTencentCosObjects(cos, options);
  const storageMax = extractMaxStorageNumber(objects);
  const sequenceMax = await readStorageSequenceNumber(options, options.cosBucket);
  return nextStorageNumberFromMaxes(storageMax, sequenceMax);
}

function createCloudbaseApp(options) {
  const missing = [];
  if (!options.cloudbaseEnvId) missing.push("CLOUDBASE_ENV_ID or --cloudbase-env-id");
  if (!options.cosSecretId) missing.push("TENCENT_SECRET_ID");
  if (!options.cosSecretKey) missing.push("TENCENT_SECRET_KEY");
  if (missing.length) throw new Error(`Missing CloudBase config: ${missing.join(", ")}`);
  return CloudBase.init({
    envId: options.cloudbaseEnvId,
    secretId: options.cosSecretId,
    secretKey: options.cosSecretKey,
  });
}

async function upsertCloudbaseArtwork(database, collection, doc) {
  return database.runCommands({
    MgoCommands: [
      {
        TableName: collection,
        CommandType: "UPDATE",
        Command: JSON.stringify({
          update: collection,
          updates: [{ q: { _id: doc._id }, u: { $set: doc }, upsert: true }],
        }),
      },
    ],
  });
}

async function uploadImage(supabase, bucket, assetName, image) {
  const { error } = await supabase.storage.from(bucket).upload(assetName, image.buffer, {
    contentType: image.contentType || "image/jpeg",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error(`Failed to upload ${assetName}: ${error.message}`);
  const { data } = supabase.storage.from(bucket).getPublicUrl(assetName);
  return data.publicUrl;
}

function isAlreadyUploadedError(error) {
  return /already exists|duplicate|resource already exists/i.test(error?.message || "");
}

export async function uploadImageWithRetry(supabase, bucket, assetName, image, options = {}) {
  const maxRetries = Number.isInteger(options.maxRetries)
    ? Math.max(0, options.maxRetries)
    : DEFAULT_MAX_RETRIES;
  const attempts = maxRetries + 1;
  const retryDelayMs = Number.isInteger(options.retryDelayMs)
    ? Math.max(0, options.retryDelayMs)
    : 2000;
  const uploadFn = options.uploadFn || uploadImage;
  const sleepFn = options.sleepFn || sleep;
  const logFn = options.logFn || log;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const publicUrl = await uploadFn(supabase, bucket, assetName, image);
      return { uploaded: true, publicUrl, error: "" };
    } catch (error) {
      lastError = error;
      if (isAlreadyUploadedError(error)) {
        const { data } = supabase.storage.from(bucket).getPublicUrl(assetName);
        logFn(`Upload target already exists; using existing Storage object: ${assetName}`);
        return { uploaded: true, publicUrl: data.publicUrl, error: "" };
      }
      if (attempt < attempts) {
        logFn(
          `Upload failed for ${assetName} (attempt ${attempt}/${attempts}): ${error.message}. Retrying.`,
        );
        await sleepFn(retryDelayMs * attempt);
      }
    }
  }

  const message = lastError?.message || "unknown upload error";
  logFn(
    `Upload failed for ${assetName} after ${attempts} attempts: ${message}; continuing without Storage upload.`,
  );
  return { uploaded: false, publicUrl: "", error: message };
}

async function saveImage(outputDir, assetName, buffer) {
  const imageDir = path.join(outputDir, "images");
  await mkdir(imageDir, { recursive: true });
  const filePath = path.join(imageDir, assetName);
  await writeFile(filePath, buffer);
  return filePath;
}

async function writeCsv(outputPath, rows) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `\uFEFF${toCsv(rows)}`, "utf8");
}

async function writeJsonl(outputPath, records) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  await writeFile(outputPath, body ? `${body}\n` : "", "utf8");
}

function outputPathFor(options) {
  if (options.output) return options.output;
  const label = labelForOptions(options);
  return path.join(options.outputDir, `artvee-${label}-${csvTimestamp()}.csv`);
}

function evidencePathFor(options, outputPath) {
  if (options.evidenceOutput) return options.evidenceOutput;
  return outputPath.replace(/\.csv$/i, ".evidence.jsonl");
}

function slugLabel(value, fallback) {
  return (
    String(value || "")
      .replace(/^https?:\/\/[^/]+/i, "")
      .replace(/\/page\/\d+\/?$/i, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || fallback
  );
}

function labelForOptions(options) {
  if (options.command === "search") return `search-${slugLabel(options.keyword, "keyword")}`;
  if (options.command === "famous") return "famous";
  if (options.command === "artists")
    return `artists-from-${String(options.artistStart).padStart(3, "0")}`;
  if (options.command === "artists-priority")
    return `artists-priority-from-${String(options.artistStart).padStart(3, "0")}`;
  if (options.command === "artist") {
    const pathLabel = (() => {
      try {
        return new URL(options.artistUrl).pathname.replace(/^\/artist\//i, "");
      } catch {
        return options.artistUrl;
      }
    })();
    return `artist-${slugLabel(pathLabel, "artist")}`;
  }
  return options.command;
}

function checkpointKeyFor(options) {
  const keyword = options.command === "search" ? options.keyword : "";
  const artist = options.command === "artist" ? options.artistUrl : "";
  const artists =
    options.command === "artists"
      ? `${options.artistsUrl}-${options.artistStart}-${options.perArtist}`
      : "";
  const artistsPriority =
    options.command === "artists-priority"
      ? `${options.artistPriorityList}-${options.artistStart}-${options.perArtist}`
      : "";
  const famous = options.command === "famous" ? options.famousList : "";
  const storageScope =
    options.storageTarget === "cos"
      ? [options.cosBucket, options.cosPrefix].filter(Boolean).join("-")
      : options.bucket;
  const raw = [
    options.command,
    keyword,
    artist,
    artists,
    artistsPriority,
    famous,
    storageScope,
    options.status,
  ]
    .filter(Boolean)
    .join("-");
  return (
    raw
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "artvee"
  );
}

function checkpointPathFor(options) {
  return path.join(
    options.checkpointDir || DEFAULT_CHECKPOINT_DIR,
    `${checkpointKeyFor(options)}.checkpoint.json`,
  );
}

function historyPathFor(options) {
  return path.join(
    options.checkpointDir || DEFAULT_CHECKPOINT_DIR,
    `${checkpointKeyFor(options)}.history.json`,
  );
}

function failurePathFor(outputPath) {
  return outputPath.replace(/\.csv$/i, ".failures.jsonl");
}

export function buildCheckpointState({
  options,
  outputPath,
  evidencePath = evidencePathFor(options, outputPath),
  rows,
  evidenceRows = [],
  processedSourceUrls,
  nextNumber,
  imagesThisRun,
  uploadFailures = [],
  skippedSemantic = 0,
  status = "running",
}) {
  return {
    version: 1,
    key: checkpointKeyFor(options),
    status,
    outputPath,
    evidencePath,
    command: options.command,
    keyword: options.keyword,
    artistUrl: options.artistUrl,
    artistsUrl: options.artistsUrl,
    artistStart: options.artistStart,
    scanArtistStart: options.scanArtistStart || options.artistStart,
    perArtist: options.perArtist,
    artistPriorityList: options.artistPriorityList,
    famousList: options.famousList,
    count: options.count,
    bucket: options.bucket,
    normalizedStatus: options.status,
    dryRun: options.dryRun,
    rows,
    evidenceRows,
    processedSourceUrls: [...processedSourceUrls],
    nextNumber,
    imagesThisRun,
    uploadFailures,
    skippedSemantic,
    existingIndex: options.existingIndex || "",
    updatedAt: new Date().toISOString(),
  };
}

async function readCheckpoint(options) {
  if (options.dryRun) return null;
  if (!options.resume) return null;
  try {
    const state = JSON.parse(await readFile(checkpointPathFor(options), "utf8"));
    if (state?.status !== "running") return null;
    if (state.key !== checkpointKeyFor(options)) return null;
    return state;
  } catch {
    return null;
  }
}

async function writeCheckpoint(options, state) {
  if (options.dryRun) return;
  if (!options.resume) return;
  const filePath = checkpointPathFor(options);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function mergeProcessedSourceUrls(...sources) {
  const merged = new Set();
  for (const source of sources) {
    for (const url of source || []) {
      if (url) merged.add(url);
    }
  }
  return merged;
}

async function readProcessedSourceHistory(options) {
  const urls = new Set();
  for (const filePath of [historyPathFor(options), checkpointPathFor(options)]) {
    try {
      const state = JSON.parse(await readFile(filePath, "utf8"));
      if (state.key && state.key !== checkpointKeyFor(options)) continue;
      if (state.dryRun) continue;
      const values = Array.isArray(state) ? state : state.processedSourceUrls || state.urls || [];
      for (const url of values) {
        if (url) urls.add(url);
      }
    } catch {
      // Missing or invalid history should not stop a crawl.
    }
  }
  return urls;
}

async function writeProcessedSourceHistory(options, processedSourceUrls) {
  if (options.dryRun) return;
  const filePath = historyPathFor(options);
  const existing = await readProcessedSourceHistory(options);
  const urls = [...mergeProcessedSourceUrls(existing, processedSourceUrls)];
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify(
      {
        version: 1,
        key: checkpointKeyFor(options),
        command: options.command,
        keyword: options.keyword,
        artistUrl: options.artistUrl,
        artistsUrl: options.artistsUrl,
        artistStart: options.artistStart,
        perArtist: options.perArtist,
        artistPriorityList: options.artistPriorityList,
        bucket: options.bucket,
        normalizedStatus: options.status,
        urls,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function loadExistingSemanticDedupeKeys(filePath) {
  const keys = new Set();
  if (!filePath) return keys;
  const payload = JSON.parse(await readFile(filePath, "utf8"));
  const rows = Array.isArray(payload)
    ? payload
    : payload.artworks || payload.rows || payload.documents || payload.items || [];
  if (!Array.isArray(rows)) {
    throw new Error(`Existing semantic index must contain an artworks or rows array: ${filePath}`);
  }
  for (const row of rows) {
    const key =
      row.semanticKey ||
      row.dedupeKey ||
      artworkDedupeKey(
        row.title_en || row.titleEn || row.title || row.title_cn || "",
        row.artist || row.artist_display || row.artistEn || "",
      );
    if (key) keys.add(key);
  }
  return keys;
}

async function appendFailure(outputPath, failure) {
  const filePath = failurePathFor(outputPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(
    filePath,
    `${JSON.stringify({ ...failure, at: new Date().toISOString() })}\n`,
    "utf8",
  );
}

export function formatProgressLine({ current, total, stage = "", width = 28 }) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const safeCurrent = Math.max(0, Math.min(Number(current) || 0, safeTotal));
  const percent = Math.floor((safeCurrent / safeTotal) * 100);
  const filled = Math.round((safeCurrent / safeTotal) * width);
  const bar = `${"#".repeat(filled)}${"-".repeat(Math.max(0, width - filled))}`;
  return `[${bar}] ${safeCurrent}/${safeTotal} ${percent}% ${stage}`.trim();
}

function createProgressReporter(options) {
  if (!options.progress) {
    return {
      update() {},
      done() {},
    };
  }
  const enabled = process.stdout.isTTY || process.env.CI !== "true";
  return {
    update(current, stage) {
      if (!enabled) return;
      process.stdout.write(
        `\r[artvee] ${formatProgressLine({ current, total: options.count, stage })}`,
      );
    },
    done(current, stage) {
      if (!enabled) return;
      process.stdout.write(
        `\r[artvee] ${formatProgressLine({ current, total: options.count, stage })}\n`,
      );
    },
  };
}

async function ingest(options) {
  await mkdir(options.outputDir, { recursive: true });
  const checkpoint = await readCheckpoint(options);
  const historicalProcessedSourceUrls = await readProcessedSourceHistory(options);
  const outputPath = checkpoint?.outputPath || outputPathFor(options);
  const evidencePath = checkpoint?.evidencePath || evidencePathFor(options, outputPath);
  const cosClient =
    options.upload && options.storageTarget === "cos" ? createTencentCosClient(options) : null;
  const cloudbaseApp =
    options.database && options.databaseTarget === "cloudbase" ? createCloudbaseApp(options) : null;
  if (cloudbaseApp)
    await cloudbaseApp.database.createCollectionIfNotExists(options.cloudbaseCollection);
  let nextNumber =
    checkpoint?.nextNumber ||
    (cosClient ? await getNextTencentCosNumber(cosClient, options) : options.start || 1);

  log(`Output CSV: ${outputPath}`);
  log(`Evidence JSONL: ${evidencePath}`);
  if (options.legacySupabaseUploadRequested)
    log("--supabase-upload is disabled; use --cos-upload for Tencent COS uploads.");
  if (options.legacyDatabaseRequested)
    log("--db is disabled; use --cloudbase-db for WeChat Cloud Database writes.");
  if (cosClient) log(`Next COS asset: ${formatAssetName(nextNumber)}`);
  if (cloudbaseApp) log(`CloudBase collection: ${options.cloudbaseCollection}`);
  if (checkpoint)
    log(
      `Resuming checkpoint with ${checkpoint.rows?.length || 0} CSV rows: ${checkpointPathFor(options)}`,
    );

  const rows = Array.isArray(checkpoint?.rows) ? [...checkpoint.rows] : [];
  const evidenceRows = Array.isArray(checkpoint?.evidenceRows) ? [...checkpoint.evidenceRows] : [];
  const uploadFailures = Array.isArray(checkpoint?.uploadFailures)
    ? [...checkpoint.uploadFailures]
    : [];
  const existingSemanticDedupeKeys = await loadExistingSemanticDedupeKeys(options.existingIndex);
  const internalSemanticDedupeKeys = new Set(
    rows.map((row) => artworkDedupeKey(row.title_en, row.artist)).filter(Boolean),
  );
  let skippedSemantic = checkpoint?.skippedSemantic || 0;
  const processedSourceUrls = mergeProcessedSourceUrls(
    historicalProcessedSourceUrls,
    checkpoint?.processedSourceUrls || [],
  );
  if (historicalProcessedSourceUrls.size > 0 && !checkpoint) {
    log(
      `Loaded ${historicalProcessedSourceUrls.size} previously processed Artvee URLs for de-duplication.`,
    );
  }
  if (existingSemanticDedupeKeys.size > 0) {
    log(`Loaded ${existingSemanticDedupeKeys.size} cross-source semantic de-duplication keys.`);
  }
  let imagesThisRun = checkpoint?.imagesThisRun || 0;
  let sawListing = false;
  const progress = createProgressReporter(options);
  progress.update(rows.length, "starting");

  for await (const listing of iterateListings(options)) {
    sawListing = true;
    if (rows.length >= options.count) break;
    if (processedSourceUrls.has(listing.url)) continue;
    if (imagesThisRun >= options.maxImagesPerRun) {
      log(`Reached max images per run (${options.maxImagesPerRun}); stopping.`);
      break;
    }

    try {
      progress.update(rows.length, `fetching ${rows.length + 1}/${options.count}`);
      log(`Fetching artwork page: ${listing.url}`);
      const html = await fetchText(listing.url, options);
      const artwork = parseArtworkPage(html, listing.url, listing);
      if (!artwork.downloadUrl && !artwork.imageUrl && !options.dryRun) {
        log(`Skipping artwork without a downloadable image: ${listing.url}`);
        processedSourceUrls.add(listing.url);
        await writeCheckpoint(
          options,
          buildCheckpointState({
            options,
            outputPath,
            rows,
            evidenceRows,
            processedSourceUrls,
            nextNumber,
            imagesThisRun,
            uploadFailures,
            skippedSemantic,
          }),
        );
        continue;
      }

      const rawSemanticKey = artworkDedupeKey(artwork.titleEn || artwork.titleCn, artwork.artist);
      if (
        rawSemanticKey &&
        (existingSemanticDedupeKeys.has(rawSemanticKey) ||
          internalSemanticDedupeKeys.has(rawSemanticKey))
      ) {
        skippedSemantic += 1;
        processedSourceUrls.add(listing.url);
        log(`Skipping semantic duplicate before image download: ${rawSemanticKey}`);
        await writeCheckpoint(
          options,
          buildCheckpointState({
            options,
            outputPath,
            rows,
            evidenceRows,
            processedSourceUrls,
            nextNumber,
            imagesThisRun,
            uploadFailures,
            skippedSemantic,
          }),
        );
        continue;
      }

      if (shouldPauseBeforeAi(options)) {
        log(`Waiting ${Math.round(options.delayMs / 1000)} seconds before Gemini request.`);
        await sleep(options.delayMs);
      }
      const generatedMetadata = await generateArtworkMetadata(artwork, options);
      const number = nextNumber;
      const assetName = formatAssetName(number);
      if (cosClient) await writeStorageSequenceNumber(options, options.cosBucket, number);
      let publicUrl = artwork.imageUrl || "";
      let storageUploaded = true;
      let imagePath = "";

      if (options.upload || options.saveImages) {
        progress.update(rows.length, `downloading ${assetName}`);
        const image = await fetchImageBuffer(artwork.downloadUrl, artwork.imageUrl, options);
        if (options.saveImages) {
          imagePath = await saveImage(options.outputDir, assetName, image.buffer);
          log(`Saved image: ${imagePath}`);
        }
        if (cosClient) {
          const uploadResult = await uploadImageWithRetry(
            cosClient,
            options.cosBucket,
            assetName,
            image,
            {
              maxRetries: options.maxRetries,
              uploadFn: (client, _bucket, name, imageData) =>
                uploadImageToTencentCos(client, options, name, imageData),
            },
          );
          storageUploaded = uploadResult.uploaded;
          if (uploadResult.uploaded) {
            publicUrl = uploadResult.publicUrl;
            log(`Uploaded COS image: ${assetName}`);
          } else {
            uploadFailures.push({
              assetName,
              error: uploadResult.error,
              sourceUrl: artwork.sourceUrl,
            });
          }
        }
        imagesThisRun += 1;
      }

      const csvRow = buildCsvRow(artwork, number, generatedMetadata);
      const finalSemanticKey = artworkDedupeKey(csvRow.title_en, csvRow.artist);
      if (!finalSemanticKey) {
        throw new Error(`Artwork has no usable semantic de-duplication key: ${listing.url}`);
      }
      rows.push(csvRow);
      internalSemanticDedupeKeys.add(finalSemanticKey);
      evidenceRows.push(buildRawEvidenceRecord(artwork, csvRow, assetName, imagePath));

      if (cloudbaseApp && options.database && (!options.upload || storageUploaded)) {
        progress.update(rows.length, `writing CloudBase ${csvRow.id}`);
        const doc = buildCloudbaseArtworkDocument(artwork, csvRow, publicUrl, assetName, options);
        await upsertCloudbaseArtwork(cloudbaseApp.database, options.cloudbaseCollection, doc);
        log(`Upserted CloudBase row: ${doc._id}`);
      } else if (cloudbaseApp && options.database && options.upload && !storageUploaded) {
        log(`Skipped CloudBase row for ${csvRow.id} because COS upload failed.`);
      }

      await writeCsv(outputPath, rows);
      await writeJsonl(evidencePath, evidenceRows);
      processedSourceUrls.add(listing.url);
      nextNumber += 1;
      progress.update(rows.length, `saved ${csvRow.id}`);
      await writeCheckpoint(
        options,
        buildCheckpointState({
          options,
          outputPath,
          rows,
          evidenceRows,
          processedSourceUrls,
          nextNumber,
          imagesThisRun,
          uploadFailures,
          skippedSemantic,
        }),
      );
    } catch (error) {
      if (/Stop requested by remote status|robots\.txt disallows/i.test(error.message)) throw error;
      if (isTransientCrawlError(error)) {
        log(`Pausing at failed artwork ${listing.url}: ${error.message}`);
        await appendFailure(outputPath, {
          sourceUrl: listing.url,
          title: listing.title,
          error: error.message,
        });
        await writeCheckpoint(
          options,
          buildCheckpointState({
            options,
            outputPath,
            rows,
            evidenceRows,
            processedSourceUrls,
            nextNumber,
            imagesThisRun,
            uploadFailures,
            skippedSemantic,
          }),
        );
        throw error;
      }
      log(`Skipping failed artwork ${listing.url}: ${error.message}`);
      await appendFailure(outputPath, {
        sourceUrl: listing.url,
        title: listing.title,
        error: error.message,
      });
      // A failed fetch is not a completed artwork. Keep it out of the
      // de-duplication history so a later checkpoint resume/batch can retry it.
      await writeCheckpoint(
        options,
        buildCheckpointState({
          options,
          outputPath,
          rows,
          evidenceRows,
          processedSourceUrls,
          nextNumber,
          imagesThisRun,
          uploadFailures,
          skippedSemantic,
        }),
      );
      if (rows.length >= options.count) break;
    }
  }

  if (!sawListing) throw new Error("No Artvee listings were found.");

  if (rows.length < options.count) {
    log(
      `Requested ${options.count}; imported ${rows.length}. Some listings were skipped or unavailable.`,
    );
  }
  if (uploadFailures.length > 0) {
    log(`Storage upload failures: ${uploadFailures.length}. CSV rows were kept for later retry.`);
  }
  await writeCsv(outputPath, rows);
  await writeJsonl(evidencePath, evidenceRows);
  await writeCheckpoint(
    options,
    buildCheckpointState({
      options,
      outputPath,
      rows,
      evidenceRows,
      processedSourceUrls,
      nextNumber,
      imagesThisRun,
      uploadFailures,
      skippedSemantic,
      status: rows.length >= options.count ? "completed" : "running",
    }),
  );
  await writeProcessedSourceHistory(options, processedSourceUrls);
  progress.done(rows.length, "finished");
  return { outputPath, count: rows.length, uploadFailures, skippedSemantic };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay([min, max] = [0, 0]) {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function cachePathFor(url, options) {
  const hash = createHash("sha256").update(url).digest("hex");
  return path.join(options.cacheDir || DEFAULT_CACHE_DIR, `${hash}.html`);
}

async function readTextCache(url, options) {
  if (!options.cache) return "";
  try {
    return await readFile(cachePathFor(url, options), "utf8");
  } catch {
    return "";
  }
}

async function writeTextCache(url, text, options) {
  if (!options.cache) return;
  const filePath = cachePathFor(url, options);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, text, "utf8");
}

async function waitForInterval(options, stateKey, label, delay) {
  if (delay <= 0) return;
  const now = Date.now();
  const last = options[stateKey] || 0;
  const remaining = last ? Math.max(0, delay - (now - last)) : 0;
  if (remaining > 0) {
    log(`Waiting ${Math.ceil(remaining / 1000)} seconds before next ${label}.`);
    await sleep(remaining);
  }
  options[stateKey] = Date.now();
}

async function waitForRequestBudget(options, kind) {
  const isImage = kind === "image";
  const crawlDelayMs = isImage ? 0 : options._robotsCrawlDelayMs || 0;
  const baseRange = isImage ? options.imageDelayMs : options.pageDelayMs;
  const range = crawlDelayMs
    ? [Math.max(baseRange[0], crawlDelayMs), Math.max(baseRange[1], crawlDelayMs)]
    : baseRange;
  const stateKey = isImage ? "_lastImageRequestAt" : "_lastHtmlRequestAt";
  await waitForInterval(options, stateKey, `${kind} request`, randomDelay(range));

  const limit = isImage ? options.imageLimitPerHour : options.htmlLimitPerHour;
  const timestampsKey = isImage ? "_imageRequestTimestamps" : "_htmlRequestTimestamps";
  if (!limit) return;
  const now = Date.now();
  const hourAgo = now - 60 * 60 * 1000;
  const timestamps = (options[timestampsKey] || []).filter((timestamp) => timestamp > hourAgo);
  if (timestamps.length >= limit) {
    const waitMs = timestamps[0] + 60 * 60 * 1000 - now;
    log(
      `Hourly ${kind} limit reached (${limit}/hour); waiting ${Math.ceil(waitMs / 1000)} seconds.`,
    );
    await sleep(waitMs);
  }
  options[timestampsKey] = [...timestamps, Date.now()];
}

async function fetchWithRetries(url, init, options) {
  const attempts = Math.max(1, (options.maxRetries || 0) + 1);
  let lastError = null;
  options._fetchDispatcher ||= new UndiciAgent({
    connect: {
      timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
    },
  });
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
      const response = await undiciFetch(url, {
        ...init,
        dispatcher: options._fetchDispatcher,
        signal: controller.signal,
      });
      if ([403, 429].includes(response.status)) {
        throw new Error(`Stop requested by remote status ${response.status}: ${url}`);
      }
      if (response.status >= 500 && attempt < attempts) {
        log(
          `HTTP ${response.status}; retrying after ${Math.round((options.pageDelayMs?.[1] || 30000) / 1000)} seconds (${attempt}/${attempts - 1}).`,
        );
        await sleep(options.pageDelayMs?.[1] || 30000);
        continue;
      }
      return response;
    } catch (error) {
      const detail = describeFetchError(error);
      lastError = new Error(detail, { cause: error });
      if (attempt >= attempts || /Stop requested/.test(detail)) throw lastError;
      log(`Request failed (${detail}); retrying (${attempt}/${attempts - 1}).`);
      await sleep(options.pageDelayMs?.[1] || 30000);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error(`Request failed: ${url}`);
}

export function describeFetchError(error) {
  const parts = [error?.message, error?.cause?.code, error?.cause?.message]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return [...new Set(parts)].join(" | ") || "unknown fetch error";
}

async function ensureRobotsAllowed(url, options) {
  if (!options.robotsTxt) return;
  const parsed = new URL(url);
  const origin = parsed.origin;
  options._robotsCache ||= new Map();
  if (!options._robotsCache.has(origin)) {
    const robotsUrl = `${origin}/robots.txt`;
    let rules = [];
    try {
      const response = await fetchWithRetries(
        robotsUrl,
        {
          headers: { "user-agent": options.userAgent, accept: "text/plain,*/*" },
        },
        { ...options, robotsTxt: false, maxRetries: 0 },
      );
      rules = response.ok ? parseRobotsTxt(await response.text(), options.userAgent) : [];
    } catch (error) {
      log(`robots.txt check unavailable (${error.message}); continuing cautiously.`);
    }
    options._robotsCache.set(origin, rules);
  }
  const pathName = `${parsed.pathname}${parsed.search}`;
  const robots = options._robotsCache.get(origin);
  if (robots?.crawlDelayMs) {
    options._robotsCrawlDelayMs = Math.max(options._robotsCrawlDelayMs || 0, robots.crawlDelayMs);
  }
  const disallowed = (robots?.disallow || []).find((rule) => pathName.startsWith(rule));
  if (disallowed) {
    throw new Error(`robots.txt disallows ${pathName} via ${disallowed}`);
  }
}

export function parseRobotsTxt(text, userAgent) {
  const rules = { disallow: [], crawlDelayMs: 0 };
  let applies = false;
  const bot = String(userAgent || "").toLowerCase();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const [fieldRaw, ...valueParts] = line.split(":");
    const field = fieldRaw.trim().toLowerCase();
    const value = valueParts.join(":").trim();
    if (field === "user-agent") {
      const agent = value.toLowerCase();
      applies = agent === "*" || (bot && bot.includes(agent));
      continue;
    }
    if (applies && field === "disallow" && value) rules.disallow.push(value);
    if (applies && field === "crawl-delay" && value) {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds > 0) {
        rules.crawlDelayMs = Math.max(rules.crawlDelayMs, Math.round(seconds * 1000));
      }
    }
  }
  return rules;
}

function log(message) {
  console.log(`[artvee] ${message}`);
}

function usage() {
  return `
Usage:
  node scripts/artvee-ingest.mjs random <count> [options]
  node scripts/artvee-ingest.mjs search <keyword> <count> [options]
  node scripts/artvee-ingest.mjs popular <count> [options]
  node scripts/artvee-ingest.mjs famous <count> [options]
  node scripts/artvee-ingest.mjs artist <artist-url-or-slug> <count> [options]
  node scripts/artvee-ingest.mjs artists <count> [options]
  node scripts/artvee-ingest.mjs artists-priority <count> [options]

Examples:
  npm run artvee:ingest -- random 5 --status published
  npm run artvee:ingest -- search "van gogh" 10 --status draft
  npm run artvee:ingest -- popular 15 --pages 3
  npm run artvee:ingest -- famous 50 --status published
  npm run artvee:ingest -- artist https://artvee.com/artist/leonardo-da-vinci/ 17 --status published
  npm run artvee:ingest -- artists 30 --status published
  npm run artvee:ingest -- artists-priority 100 --status published

Options:
  --status draft|published|archived  Artwork status. Default: draft
  --evidence-output <path>           Raw evidence JSONL path. Default: alongside CSV
  --start <number>                   Override storage numbering start
  --out-dir <path>                   Output folder. Default: ./csv
  --output <path>                    Exact CSV output path
  --pages <number>                   Max list pages to scan
  --famous-list <path>               JSON query list for famous mode. Default: ./data/famous-artworks.json
  --artists-url <url>                Artist directory URL. Default: https://artvee.com/artists/
  --artist-priority-list <path>      Ranked artist list for artists-priority. Default: ./data/artist-priority.json
  --existing-index <path>            Read-only JSON artworks/rows index for cross-source semantic de-duplication
  --artist-start <number>            Artist directory start position, 1-based. Default: 1
  --scan-artist-start <number>       Resume scanning at this artist without changing checkpoint identity
  --per-artist <number>              Optional cap per directory artist. Default: 0, unlimited
  --max-artist-per-run <number>      Famous mode artist cap. Default: 3
  --max-series-per-run <number>      Famous mode title-series cap. Default: 2
  --delay-ms <number>                Legacy Gemini delay. Default: 35000
  --page-delay-ms <min-max>          Random delay between HTML requests. Default: 5000-12000
  --image-delay-ms <min-max>         Random delay between image requests. Default: 25000-45000
  --html-limit-per-hour <number>     HTML request cap. Default: 180
  --image-limit-per-hour <number>    Image request cap. Default: disabled
  --max-artwork-pages-per-run <n>    Max listing/detail pages per run. Default: 70
  --max-images-per-run <number>      Max downloaded images per run. Default: ${DEFAULT_MAX_IMAGES_PER_RUN}
  --timeout-ms <number>              Per-request timeout. Default: 15000
  --max-retries <number>             HTTP retry count for timeouts/5xx. Default: 1
  --no-robots                        Skip robots.txt checks
  --cache-dir <path>                 HTML cache folder. Default: ./csv/.artvee-cache
  --no-cache                         Disable HTML cache
  --checkpoint-dir <path>            Resume checkpoint folder. Default: ./csv/.artvee-state
  --no-resume                        Disable checkpoint resume state
  --no-progress                      Disable terminal progress bar
  --ai-retries <number>              Gemini retry count for 429/503. Default: ${DEFAULT_AI_RETRIES}
  --provider gemini|openai           AI provider. Default: ${DEFAULT_PROVIDER}
  --model <model>                    Model. Default: ${DEFAULT_GEMINI_MODEL}
  --with-ai                          Legacy optional model metadata generation for local experiments
  --no-grounding                     Disable Gemini Google Search grounding
  --no-openai                        Disable AI metadata generation
  --cos-upload                       Disabled in ingest. Use artvee-publish-reviewed after review
  --cloudbase-db                     Disabled in ingest. Use artvee-publish-reviewed after review
  --db                               Legacy Supabase flag; disabled. Use --cloudbase-db
  --supabase-upload                  Legacy Supabase flag; disabled. Use --cos-upload
  --no-upload                        Do not upload image files
  --no-db                            Do not write database documents
  --no-legacy                        Legacy Supabase option; no effect for CloudBase
  --no-normalized                    Legacy Supabase option; no effect for CloudBase
  --no-save-images                   Do not save local image copies under csv/images
  --dry-run                          Parse pages only; no OpenAI, image download, upload, or DB writes
`.trim();
}

const invokedScriptPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const currentModulePath = fileURLToPath(import.meta.url);
const isDirectInvocation =
  invokedScriptPath &&
  path.basename(invokedScriptPath).toLowerCase() === path.basename(currentModulePath).toLowerCase();

if (isDirectInvocation) {
  try {
    await loadEnvironment();
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }
    const result = await ingest(options);
    log(`CSV written: ${result.outputPath}`);
    log(`Rows written: ${result.count}`);
  } catch (error) {
    console.error(`[artvee] ${error.message}`);
    process.exit(1);
  }
}
