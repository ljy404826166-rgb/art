#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  atomicWrite,
  buildCommonsCandidate,
  buildManualSearchRecord,
  buildProjectCandidate,
  cacheKey,
  candidateAuditSummary,
  jsonlText,
  readJsonl,
  selectCandidates,
  sha256,
  stringValue,
  wikidataP18FileNames,
} from "./portrait-candidate-lib.mjs";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const DEFAULT_INPUT_DIR = path.resolve("outputs", "artist-portraits", "20260726T064155Z");
const USER_AGENT = "ArtArchivePortraitResearch/1.0 (read-only candidate metadata collection)";

function required(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(argv = []) {
  const options = {
    inputDir: DEFAULT_INPUT_DIR,
    outputDir: "",
    cacheDir: path.resolve("outputs", "artist-portraits", ".cache"),
    offline: false,
    refresh: false,
    requestDelayMs: 150,
    limit: 0,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--input-dir") options.inputDir = path.resolve(required(argv, ++index, arg));
    else if (arg === "--output-dir") options.outputDir = path.resolve(required(argv, ++index, arg));
    else if (arg === "--cache-dir") options.cacheDir = path.resolve(required(argv, ++index, arg));
    else if (arg === "--offline") options.offline = true;
    else if (arg === "--refresh") options.refresh = true;
    else if (arg === "--request-delay-ms") {
      options.requestDelayMs = Number(required(argv, ++index, arg));
    } else if (arg === "--limit") {
      options.limit = Number(required(argv, ++index, arg));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(options.requestDelayMs) || options.requestDelayMs < 0) {
    throw new Error("--request-delay-ms must be a non-negative integer.");
  }
  if (!Number.isInteger(options.limit) || options.limit < 0) {
    throw new Error("--limit must be a non-negative integer.");
  }
  if (!options.outputDir) {
    options.outputDir = path.join(
      path.dirname(options.inputDir),
      `${path.basename(options.inputDir)}-task3`,
    );
  }
  return options;
}

function usage() {
  return `Usage:
  node scripts/artist-portraits/fetch-portrait-candidates.mjs [options]

Options:
  --input-dir <path>        Task 1 scope directory.
  --output-dir <path>       Task 3 output directory.
  --cache-dir <path>        Persistent read-through API cache.
  --offline                 Use the cache and project candidates only.
  --refresh                 Ignore existing API cache entries.
  --request-delay-ms <n>    Delay between external API batches. Default: 150.
  --limit <n>               Limit eligible artists for a controlled test.

This command only reads public APIs and local scope files. It never writes CloudBase or COS.
`;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function requestJson(url, { fetchFn = fetch, attempts = 4, timeoutMs = 20_000 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(url, {
        headers: {
          accept: "application/json",
          "user-agent": USER_AGENT,
        },
        signal: controller.signal,
      });
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status} for ${new URL(url).hostname}`);
      if (response.status < 500 && response.status !== 429) throw lastError;
      const retryAfter = Number(response.headers.get("retry-after") || 0) * 1000;
      if (attempt < attempts) await wait(Math.max(retryAfter, attempt * 750));
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(attempt * 750);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function cacheFile(cacheDir, namespace, key) {
  return path.join(cacheDir, namespace, `${cacheKey(key)}.json`);
}

function readCache(filePath, refresh) {
  if (refresh || !fs.existsSync(filePath)) return undefined;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeCache(filePath, value) {
  atomicWrite(filePath, `${JSON.stringify(value)}\n`);
}

export async function fetchWikidataEntities(qids, options = {}) {
  const result = new Map();
  const failures = [];
  const missing = [];
  for (const qid of [...new Set(qids.filter(Boolean))]) {
    const filePath = cacheFile(options.cacheDir, "wikidata-entities", qid);
    const cached = readCache(filePath, options.refresh);
    if (cached) result.set(qid, cached);
    else missing.push(qid);
  }
  if (options.offline) return { entities: result, failures };

  for (const batch of chunks(missing, 25)) {
    const url = new URL(WIKIDATA_API);
    url.searchParams.set("action", "wbgetentities");
    url.searchParams.set("ids", batch.join("|"));
    url.searchParams.set("props", "labels|claims");
    url.searchParams.set("languages", "zh|zh-hans|en");
    url.searchParams.set("languagefallback", "1");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    try {
      const payload = await requestJson(url, options);
      const returnedEntities = Array.isArray(payload.entities)
        ? payload.entities
        : Object.values(payload.entities || {});
      for (const entity of returnedEntities) {
        if (!entity?.id) continue;
        result.set(entity.id, entity);
        writeCache(cacheFile(options.cacheDir, "wikidata-entities", entity.id), entity);
      }
      for (const qid of batch) {
        if (!result.has(qid))
          failures.push({
            stage: "wikidata_entity",
            key: qid,
            error: "entity_missing_from_response",
          });
      }
    } catch (error) {
      failures.push(
        ...batch.map((qid) => ({
          stage: "wikidata_entity",
          key: qid,
          error: error.message,
        })),
      );
    }
    if (options.requestDelayMs) await wait(options.requestDelayMs);
  }
  return { entities: result, failures };
}

export async function fetchCommonsPages(fileNames, options = {}) {
  const result = new Map();
  const failures = [];
  const missing = [];
  for (const fileName of [...new Set(fileNames.filter(Boolean))]) {
    const filePath = cacheFile(options.cacheDir, "commons-files", fileName);
    const cached = readCache(filePath, options.refresh);
    if (cached) result.set(fileName, cached);
    else missing.push(fileName);
  }
  if (options.offline) return { pages: result, failures };

  for (const batch of chunks(missing, 20)) {
    const url = new URL(COMMONS_API);
    url.searchParams.set("action", "query");
    url.searchParams.set("prop", "imageinfo");
    url.searchParams.set("titles", batch.map((name) => `File:${name}`).join("|"));
    url.searchParams.set("iiprop", "url|size|mime|sha1|extmetadata");
    url.searchParams.set("iiurlwidth", "640");
    url.searchParams.set("iiextmetadatalanguage", "en");
    url.searchParams.set(
      "iiextmetadatafilter",
      [
        "Artist",
        "Attribution",
        "Credit",
        "LicenseShortName",
        "LicenseUrl",
        "UsageTerms",
        "Copyrighted",
        "Restrictions",
        "ImageDescription",
        "ObjectName",
      ].join("|"),
    );
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    try {
      const payload = await requestJson(url, options);
      const pages = payload?.query?.pages || [];
      for (const page of pages) {
        const title = stringValue(page.title).replace(/^File:/iu, "");
        if (!title) continue;
        result.set(title, page);
        writeCache(cacheFile(options.cacheDir, "commons-files", title), page);
      }
      for (const fileName of batch) {
        if (!result.has(fileName))
          failures.push({
            stage: "commons_file",
            key: fileName,
            error: "file_missing_from_response",
          });
      }
    } catch (error) {
      failures.push(
        ...batch.map((fileName) => ({
          stage: "commons_file",
          key: fileName,
          error: error.message,
        })),
      );
    }
    if (options.requestDelayMs) await wait(options.requestDelayMs);
  }
  return { pages: result, failures };
}

export async function probeProjectImage(urlValue, options = {}) {
  const imageUrl = stringValue(urlValue);
  if (!imageUrl) return { error: "image_url_missing" };
  const filePath = cacheFile(options.cacheDir, "project-image-info", imageUrl);
  const cached = readCache(filePath, options.refresh);
  if (cached) return cached;
  if (options.offline) return { error: "offline_cache_miss" };
  try {
    const infoUrl = new URL(imageUrl);
    infoUrl.searchParams.set("imageInfo", "");
    const response = await requestJson(infoUrl, {
      ...options,
      attempts: 2,
    });
    const value = {
      width: Number(response.ImageWidth || response.width || 0),
      height: Number(response.ImageHeight || response.height || 0),
      byte_size: Number(response.FileSize || response.size || 0),
      mime: stringValue(response.Format || response.format)
        ? `image/${stringValue(response.Format || response.format)
            .toLowerCase()
            .replace("jpg", "jpeg")}`
        : "",
      sha1: "",
    };
    writeCache(filePath, value);
    return value;
  } catch (error) {
    return { error: error.message };
  }
}

function topProjectRowsForProbe(rows) {
  const counts = new Map();
  return rows.filter((row) => {
    const count = counts.get(row.artist_id) || 0;
    if (count >= 3) return false;
    counts.set(row.artist_id, count + 1);
    return true;
  });
}

function outputManifest(files, generatedAt, summary) {
  return {
    generated_at: generatedAt,
    read_only: true,
    production_writes: 0,
    summary,
    files: [...files.entries()].map(([name, content]) => ({
      name,
      bytes: Buffer.byteLength(content),
      sha256: sha256(content),
    })),
  };
}

export async function collectPortraitCandidates({ scope, existingRows, options }) {
  const failures = [];
  const eligibleArtists = scope.queue
    .filter((artist) => artist.search_eligible)
    .slice(0, options.limit || undefined);
  const artistById = new Map(eligibleArtists.map((artist) => [artist.artist_id, artist]));
  const scopedRows = existingRows.filter((row) => artistById.has(row.artist_id));
  const probeRows = new Set(topProjectRowsForProbe(scopedRows).map((row) => row.candidate_id));
  const projectCandidates = [];
  for (const row of scopedRows) {
    const probe = probeRows.has(row.candidate_id)
      ? await probeProjectImage(row.display_url || row.image_url || row.download_url, options)
      : { error: "not_probed_outside_top_three" };
    projectCandidates.push(buildProjectCandidate(row, artistById.get(row.artist_id), probe));
  }

  const projectEligibleArtistIds = new Set(
    projectCandidates
      .filter((candidate) => candidate.automated_assessment.eligible_for_manual_review)
      .map((candidate) => candidate.artist_id),
  );
  const externalTargets = eligibleArtists.filter(
    (artist) => !projectEligibleArtistIds.has(artist.artist_id),
  );
  const qidTargets = externalTargets.filter((artist) => artist.wikidata_qid);
  const wikidata = await fetchWikidataEntities(
    qidTargets.map((artist) => artist.wikidata_qid),
    options,
  );
  failures.push(...wikidata.failures);

  const fileNames = [];
  for (const artist of qidTargets) {
    fileNames.push(...wikidataP18FileNames(wikidata.entities.get(artist.wikidata_qid)));
  }
  const commons = await fetchCommonsPages(fileNames, options);
  failures.push(...commons.failures);

  const commonsCandidates = [];
  const manualSearch = [];
  for (const artist of externalTargets) {
    const entity = wikidata.entities.get(artist.wikidata_qid);
    const p18Names = wikidataP18FileNames(entity);
    let eligibleP18 = 0;
    for (const fileName of p18Names) {
      const page = commons.pages.get(fileName);
      const failure = failures.find(
        (item) => item.stage === "commons_file" && item.key === fileName,
      );
      const candidate = buildCommonsCandidate({
        artist,
        entity,
        fileName,
        commonsPage: page,
        apiError: failure?.error || (!page ? "commons_metadata_missing" : ""),
      });
      if (candidate.automated_assessment.eligible_for_manual_review) eligibleP18 += 1;
      commonsCandidates.push(candidate);
    }
    if (!artist.wikidata_qid) {
      manualSearch.push(buildManualSearchRecord(artist, "wikidata_qid_missing"));
    } else if (!entity) {
      manualSearch.push(buildManualSearchRecord(artist, "wikidata_api_unavailable"));
    } else if (!p18Names.length) {
      manualSearch.push(buildManualSearchRecord(artist, "wikidata_p18_missing"));
    } else if (!eligibleP18) {
      manualSearch.push(buildManualSearchRecord(artist, "no_eligible_p18"));
    }
  }

  const selection = selectCandidates([...projectCandidates, ...commonsCandidates]);
  failures.push(...selection.duplicates, ...selection.overflow);
  return {
    candidates: selection.selected,
    manualSearch,
    failures,
    processedArtistIds: eligibleArtists.map((artist) => artist.artist_id),
    rawCounts: {
      project_candidates: projectCandidates.length,
      commons_candidates: commonsCandidates.length,
      external_targets: externalTargets.length,
    },
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return null;
  }
  const scopePath = path.join(options.inputDir, "scope.json");
  const existingPath = path.join(options.inputDir, "existing-artwork-candidates.jsonl");
  if (!fs.existsSync(scopePath) || !fs.existsSync(existingPath)) {
    throw new Error(`Task 1 scope artifacts are missing from ${options.inputDir}`);
  }
  const scope = JSON.parse(fs.readFileSync(scopePath, "utf8"));
  const existingRows = readJsonl(existingPath);
  const result = await collectPortraitCandidates({ scope, existingRows, options });
  const generatedAt = new Date().toISOString();
  const summary = {
    ...candidateAuditSummary(result.candidates, result.manualSearch),
    ...result.rawCounts,
    failures: result.failures.length,
    eligible_scope_artists: scope.queue.filter((artist) => artist.search_eligible).length,
    processed_scope_artists: options.limit
      ? Math.min(options.limit, scope.queue.filter((artist) => artist.search_eligible).length)
      : scope.queue.filter((artist) => artist.search_eligible).length,
  };
  const files = new Map([
    ["portrait-candidates.jsonl", jsonlText(result.candidates)],
    ["portrait-manual-search.jsonl", jsonlText(result.manualSearch)],
    ["portrait-candidate-failures.jsonl", jsonlText(result.failures)],
    [
      "candidate-summary.json",
      `${JSON.stringify(
        {
          generated_at: generatedAt,
          input_dir: options.inputDir,
          offline: options.offline,
          production_writes: 0,
          processed_artist_ids: result.processedArtistIds,
          summary,
        },
        null,
        2,
      )}\n`,
    ],
  ]);
  files.set(
    "candidate-manifest.json",
    `${JSON.stringify(outputManifest(files, generatedAt, summary), null, 2)}\n`,
  );
  for (const [name, content] of files) {
    atomicWrite(path.join(options.outputDir, name), content);
  }
  console.log(
    JSON.stringify(
      {
        output_dir: options.outputDir,
        summary,
      },
      null,
      2,
    ),
  );
  return { outputDir: options.outputDir, summary, ...result };
}

const isMain =
  process.argv[1] &&
  path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
