import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseArgs, writeJsonLines } from "./generate-artist-candidates.mjs";
import { readJsonRecords } from "./validate-reviewed-data.mjs";

const DEFAULT_ARTWORKS_PATH = path.resolve("miniapp/data/artworks.cloudbase.json");
const DEFAULT_ARTISTS_PATH = path.resolve("miniapp/data/review/candidate-artists.jsonl");
const DEFAULT_VOCAB_PATH = path.resolve("miniapp/data/review/candidate-tags.jsonl");
const DEFAULT_ARTIST_LINKS_OUT = path.resolve(
  "miniapp/data/review/candidate-artwork-artist-links.jsonl",
);
const DEFAULT_TAG_LINKS_OUT = path.resolve("miniapp/data/review/candidate-artwork-tag-links.jsonl");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function cleanText(value) {
  return String(value ?? "")
    .replace(/\uFEFF/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueValues(values = []) {
  const result = [];
  const seen = new Set();

  values.forEach((value) => {
    const text = cleanText(value);
    const normalized = normalizeLookupText(text);
    if (!text || seen.has(normalized)) return;

    seen.add(normalized);
    result.push(text);
  });

  return result;
}

export function normalizeLookupText(value) {
  return cleanText(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/&/g, "and")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .toLocaleLowerCase();
}

function getArtworkId(artwork, index) {
  return (
    artwork?._id ||
    artwork?.id ||
    artwork?.source_id ||
    artwork?.supabase_id ||
    `artwork-${index + 1}`
  );
}

function splitBilingualArtistText(value) {
  const raw = cleanText(value);
  const match = raw.match(/^(.*?)\s*[（(]\s*([^,，)）]+).*?[)）]\s*$/u);
  if (!match) {
    return [raw];
  }

  return uniqueValues([raw, match[1], match[2]]);
}

export function classifyArtworkArtistRelation(value) {
  const raw = cleanText(value);
  if (!raw) {
    return {
      role: "unknown",
      targetText: "",
    };
  }

  const afterMatch = raw.match(/^\s*after\s+(.+)$/i);
  if (afterMatch) {
    return {
      role: "after",
      targetText: cleanText(afterMatch[1]),
    };
  }

  const workshopMatch = raw.match(/^\s*(studio|workshop)\s+of\s+(.+)$/i);
  if (workshopMatch) {
    return {
      role: "workshop",
      targetText: cleanText(workshopMatch[2]),
    };
  }

  return {
    role: "creator",
    targetText: raw,
  };
}

function buildArtistLookup(artists = []) {
  const exact = new Map();
  const aliases = [];

  artists.forEach((artist) => {
    const candidates = uniqueValues([
      artist?._id,
      artist?.display_name,
      artist?.name_zh,
      artist?.name_en,
      ...asArray(artist?.aliases),
      ...asArray(artist?.source_artist_texts),
    ]);

    candidates.forEach((candidate) => {
      splitBilingualArtistText(candidate).forEach((alias) => {
        const normalized = normalizeLookupText(alias);
        if (!normalized) return;

        if (!exact.has(normalized)) {
          exact.set(normalized, artist);
        }
        aliases.push({
          normalized,
          artist,
        });
      });
    });
  });

  aliases.sort((a, b) => b.normalized.length - a.normalized.length);
  return { exact, aliases };
}

function findArtistByText(lookup, text) {
  const candidates = splitBilingualArtistText(text);

  for (const candidate of candidates) {
    const normalized = normalizeLookupText(candidate);
    if (lookup.exact.has(normalized)) {
      return lookup.exact.get(normalized);
    }
  }

  for (const candidate of candidates) {
    const normalized = normalizeLookupText(candidate);
    if (!normalized) continue;

    const found = lookup.aliases.find((entry) => {
      if (entry.normalized.length < 3) return false;
      return normalized.includes(entry.normalized) || entry.normalized.includes(normalized);
    });

    if (found) {
      return found.artist;
    }
  }

  return null;
}

function formatArtistLabel(artist, fallback) {
  return cleanText(
    artist?.display_name || artist?.name_zh || artist?.name_en || fallback || "unknown",
  );
}

function createArtworkArtistLink({
  artworkId,
  artist,
  role,
  matched,
  sourceArtistText,
  targetText,
}) {
  const artistId = matched ? artist._id : "unknown";
  const finalRole = matched ? role : "unknown";

  return {
    _id: `${artworkId}--${finalRole}--${artistId}`,
    artwork_id: artworkId,
    artist_id: artistId,
    artist_label: formatArtistLabel(artist, targetText || sourceArtistText),
    role: finalRole,
    confidence: matched ? 0.9 : 0.25,
    match_source: matched ? "artist_text" : "unmatched_artist_text",
    matched,
    source_field: "artist",
    source_text: sourceArtistText,
    source_artist_text: sourceArtistText,
    target_text: targetText,
    review_status: "candidate",
  };
}

export function generateArtworkArtistLinks(artworks = [], artists = []) {
  const lookup = buildArtistLookup(artists);

  return artworks.map((artwork, index) => {
    const artworkId = getArtworkId(artwork, index);
    const sourceArtistText = cleanText(
      artwork?.artist || artwork?.artist_label || artwork?.creator,
    );
    const relation = classifyArtworkArtistRelation(sourceArtistText);
    const artist = findArtistByText(lookup, relation.targetText);

    return createArtworkArtistLink({
      artworkId,
      artist,
      role: relation.role,
      matched: Boolean(artist),
      sourceArtistText,
      targetText: relation.targetText,
    });
  });
}

function buildVocabLookup(vocabTerms = []) {
  const lookup = new Map();

  vocabTerms.forEach((term) => {
    const candidates = uniqueValues([
      term?._id,
      term?.label_zh,
      term?.label_en,
      term?.label,
      ...asArray(term?.aliases),
    ]);

    candidates.forEach((candidate) => {
      const normalized = normalizeLookupText(candidate);
      if (normalized && !lookup.has(normalized)) {
        lookup.set(normalized, term);
      }
    });
  });

  return lookup;
}

function findVocabTerm(lookup, label) {
  const normalized = normalizeLookupText(label);
  return normalized ? lookup.get(normalized) || null : null;
}

function createArtworkTagLink({ artworkId, term, sourceTagText }) {
  return {
    _id: `${artworkId}--${term._id}`,
    artwork_id: artworkId,
    tag_id: term._id,
    tag_label: cleanText(term.label_zh || term.label_en || sourceTagText),
    tag_type: term.type,
    confidence: 0.9,
    match_source: "tag_text",
    source_field: "tag_keys",
    source_text: sourceTagText,
    source_tag_text: sourceTagText,
    review_status: "candidate",
  };
}

export function generateArtworkTagLinks(artworks = [], vocabTerms = []) {
  const lookup = buildVocabLookup(vocabTerms);
  const links = [];

  artworks.forEach((artwork, index) => {
    const artworkId = getArtworkId(artwork, index);
    const tags = uniqueValues([
      ...asArray(artwork?.tag_keys),
      ...asArray(artwork?.tags),
      ...asArray(artwork?.tag_labels),
    ]);

    tags.forEach((tag) => {
      const term = findVocabTerm(lookup, tag);
      if (!term) return;

      links.push(createArtworkTagLink({ artworkId, term, sourceTagText: tag }));
    });
  });

  return links;
}

export function generateArtworkLinks({ artworks = [], artists = [], vocabTerms = [] } = {}) {
  const artistLinks = generateArtworkArtistLinks(artworks, artists);
  const tagLinks = generateArtworkTagLinks(artworks, vocabTerms);
  const summary = {
    artworks_total: artworks.length,
    artist_links_total: artistLinks.length,
    tag_links_total: tagLinks.length,
    unmatched_artist_count: artistLinks.filter((link) => !link.matched).length,
    unknown_relation_count: artistLinks.filter((link) => link.role === "unknown").length,
  };

  return {
    artistLinks,
    tagLinks,
    summary,
  };
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const artworksPath = path.resolve(
    args.artworks || args.input || args.in || DEFAULT_ARTWORKS_PATH,
  );
  const artistsPath = path.resolve(args.artists || DEFAULT_ARTISTS_PATH);
  const vocabPath = path.resolve(args.vocab || args["vocab-terms"] || DEFAULT_VOCAB_PATH);
  const artistOutputPath = path.resolve(args["artist-out"] || DEFAULT_ARTIST_LINKS_OUT);
  const tagOutputPath = path.resolve(args["tag-out"] || DEFAULT_TAG_LINKS_OUT);

  const artworks = readJsonRecords(artworksPath);
  const artists = readJsonRecords(artistsPath);
  const vocabTerms = readJsonRecords(vocabPath);
  const result = generateArtworkLinks({ artworks, artists, vocabTerms });

  writeJsonLines(artistOutputPath, result.artistLinks);
  writeJsonLines(tagOutputPath, result.tagLinks);

  const summary = {
    inputs: {
      artworks: artworksPath,
      artists: artistsPath,
      vocab: vocabPath,
    },
    outputs: {
      artist_links: artistOutputPath,
      tag_links: tagOutputPath,
    },
    ...result.summary,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  process.exitCode = runCli();
}
