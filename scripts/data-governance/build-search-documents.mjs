import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseArgs, writeJsonLines } from './generate-artist-candidates.mjs';
import { readJsonRecords } from './validate-reviewed-data.mjs';

const DEFAULT_ARTWORKS_PATH = path.resolve('miniapp/data/artworks.cloudbase.json');
const DEFAULT_DERIVED_PATH = path.resolve('miniapp/data/review/derived-artworks-patch.jsonl');
const DEFAULT_SEARCH_DOCS_OUT = path.resolve('miniapp/data/review/search-documents.jsonl');

function cleanText(value) {
  return String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function uniqueValues(values = []) {
  const seen = new Set();
  const result = [];

  values.flatMap(asArray).forEach((value) => {
    const text = cleanText(value);
    const key = text.toLocaleLowerCase();
    if (!text || seen.has(key)) return;
    seen.add(key);
    result.push(text);
  });

  return result;
}

function joinValues(values = []) {
  return uniqueValues(values).join(' ');
}

function getArtworkId(artwork, index) {
  return cleanText(artwork?._id || artwork?.id || artwork?.source_id || artwork?.supabase_id || `artwork-${index + 1}`);
}

function mergeDerivedFields(artwork, derived) {
  return {
    ...artwork,
    ...(derived || {}),
  };
}

function buildDerivedLookup(records = []) {
  const lookup = new Map();
  records.forEach((record) => {
    const id = cleanText(record?._id || record?.id || record?.artwork_id);
    if (id) lookup.set(id, record);
  });
  return lookup;
}

function createSearchText(document) {
  return joinValues([
    document.title,
    document.title_en,
    document.artist,
    document.primary_artist_id,
    document.artist_ids,
    document.artist_labels,
    document.description,
    document.tag_ids,
    document.tag_labels,
    document.tags_text,
    document.medium,
    document.year,
    document.location,
  ]);
}

export function buildSearchDocument(artwork, index = 0, derived) {
  const merged = mergeDerivedFields(artwork, derived);
  const artworkId = getArtworkId(merged, index);
  const title = cleanText(merged.title || merged.title_cn || merged.titleCn);
  const titleEn = cleanText(merged.title_en || merged.titleEn);
  const artist = cleanText(merged.artist || merged.artist_display || merged.artistDisplay);
  const artistIds = joinValues(merged.artist_ids);
  const artistLabels = joinValues(merged.artist_labels);
  const tagIds = joinValues(merged.tag_ids);
  const tagLabels = joinValues(merged.tag_labels);
  const tagsText = joinValues([
    merged.tags_text,
    merged.tags,
    merged.tag_keys,
  ]);

  const document = {
    id: artworkId,
    artwork_id: artworkId,
    title,
    title_en: titleEn,
    artist,
    artist_ids: artistIds,
    artist_labels: artistLabels,
    primary_artist_id: cleanText(merged.primary_artist_id),
    description: cleanText(merged.description),
    tag_ids: tagIds,
    tag_labels: tagLabels,
    tags_text: tagsText,
    medium: cleanText(merged.medium),
    year: cleanText(merged.year || merged.year_and_place || merged.period),
    location: cleanText(merged.location),
    source_name: cleanText(merged.source_name || merged.sourceName),
  };

  return {
    ...document,
    search_text: createSearchText(document),
  };
}

export function buildSearchDocuments({ artworks = [], derivedArtworks = [] } = {}) {
  const derivedById = buildDerivedLookup(derivedArtworks);
  return artworks
    .map((artwork, index) => buildSearchDocument(artwork, index, derivedById.get(getArtworkId(artwork, index))))
    .filter((document) => document.id);
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const artworksPath = path.resolve(args.artworks || args.input || args.in || DEFAULT_ARTWORKS_PATH);
  const derivedPath = path.resolve(args.derived || DEFAULT_DERIVED_PATH);
  const outputPath = path.resolve(args.out || DEFAULT_SEARCH_DOCS_OUT);

  const artworks = readJsonRecords(artworksPath);
  const derivedArtworks = readJsonRecords(derivedPath);
  const documents = buildSearchDocuments({ artworks, derivedArtworks });

  writeJsonLines(outputPath, documents);

  process.stdout.write(`${JSON.stringify({
    inputs: {
      artworks: artworksPath,
      derived: derivedPath,
    },
    output: outputPath,
    documentCount: documents.length,
  }, null, 2)}\n`);

  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  process.exitCode = runCli();
}
