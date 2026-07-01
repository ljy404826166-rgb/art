import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { parseArgs, writeJsonLines } from './generate-artist-candidates.mjs';
import { readJsonRecords } from './validate-reviewed-data.mjs';

const DEFAULT_ARTWORKS_PATH = path.resolve('miniapp/data/artworks.cloudbase.json');
const DEFAULT_ARTIST_LINKS_PATH = path.resolve('miniapp/data/review/candidate-artwork-artist-links.jsonl');
const DEFAULT_TAG_LINKS_PATH = path.resolve('miniapp/data/review/candidate-artwork-tag-links.jsonl');
const DEFAULT_PATCH_OUT = path.resolve('miniapp/data/review/derived-artworks-patch.jsonl');
const DEFAULT_ROLLBACK_OUT = path.resolve('miniapp/data/review/derived-artworks-rollback.jsonl');

const ARTIST_ROLE_PRIORITY = new Map([
  ['creator', 0],
  ['attributed_to', 1],
  ['workshop', 2],
  ['after', 3],
  ['publisher', 4],
  ['subject', 5],
  ['unknown', 6],
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\uFEFF/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniquePush(target, value) {
  if (!isNonEmptyString(value)) return;
  if (!target.includes(value)) {
    target.push(value);
  }
}

function getArtworkId(artwork, index) {
  return artwork?._id || artwork?.id || artwork?.source_id || artwork?.supabase_id || `artwork-${index + 1}`;
}

function groupByArtworkId(records = []) {
  const groups = new Map();

  records.forEach((record) => {
    const artworkId = cleanText(record?.artwork_id);
    if (!artworkId) return;

    if (!groups.has(artworkId)) {
      groups.set(artworkId, []);
    }
    groups.get(artworkId).push(record);
  });

  return groups;
}

function getArtistRolePriority(role) {
  return ARTIST_ROLE_PRIORITY.has(role) ? ARTIST_ROLE_PRIORITY.get(role) : 99;
}

function sortArtistLinks(links = []) {
  return [...links].sort((a, b) => {
    const priorityDiff = getArtistRolePriority(a.role) - getArtistRolePriority(b.role);
    if (priorityDiff !== 0) return priorityDiff;
    return cleanText(a.artist_id).localeCompare(cleanText(b.artist_id));
  });
}

function isUsableArtistLink(link) {
  return (
    link?.matched !== false &&
    cleanText(link?.artist_id) !== '' &&
    cleanText(link?.artist_id) !== 'unknown' &&
    cleanText(link?.role) !== 'unknown'
  );
}

function buildArtistFields(links = []) {
  const usableLinks = sortArtistLinks(links.filter(isUsableArtistLink));
  const artistIds = [];
  const artistLabels = [];
  const artistRelationRoles = [];

  usableLinks.forEach((link) => {
    uniquePush(artistIds, cleanText(link.artist_id));
    uniquePush(artistLabels, cleanText(link.artist_label));
    uniquePush(artistRelationRoles, cleanText(link.role));
  });

  return {
    primary_artist_id: artistIds[0] || null,
    artist_ids: artistIds,
    artist_labels: artistLabels,
    artist_relation_roles: artistRelationRoles,
  };
}

function buildTagFields(links = []) {
  const tagIds = [];
  const tagLabels = [];
  const tagTypes = [];

  links.forEach((link) => {
    uniquePush(tagIds, cleanText(link?.tag_id));
    uniquePush(tagLabels, cleanText(link?.tag_label));
    uniquePush(tagTypes, cleanText(link?.tag_type));
  });

  return {
    tag_ids: tagIds,
    tag_labels: tagLabels,
    tag_types: tagTypes,
  };
}

export function buildDerivedArtworkRecords({ artworks = [], artistLinks = [], tagLinks = [] } = {}) {
  const artistLinksByArtwork = groupByArtworkId(artistLinks);
  const tagLinksByArtwork = groupByArtworkId(tagLinks);

  return artworks.map((artwork, index) => {
    const artworkId = getArtworkId(artwork, index);

    return {
      _id: artworkId,
      ...buildArtistFields(artistLinksByArtwork.get(artworkId) || []),
      ...buildTagFields(tagLinksByArtwork.get(artworkId) || []),
    };
  });
}

export function buildRollbackRecords(artworks = []) {
  return artworks.map((artwork, index) => ({
    _id: getArtworkId(artwork, index),
    previous_primary_artist_id: artwork?.primary_artist_id ?? null,
    previous_artist_ids: Array.isArray(artwork?.artist_ids) ? artwork.artist_ids : null,
    previous_artist_labels: Array.isArray(artwork?.artist_labels) ? artwork.artist_labels : null,
    previous_artist_relation_roles: Array.isArray(artwork?.artist_relation_roles)
      ? artwork.artist_relation_roles
      : null,
    previous_tag_ids: Array.isArray(artwork?.tag_ids) ? artwork.tag_ids : null,
    previous_tag_labels: Array.isArray(artwork?.tag_labels) ? artwork.tag_labels : null,
    previous_tag_types: Array.isArray(artwork?.tag_types) ? artwork.tag_types : null,
  }));
}

export function summarizeDerivedArtworkPatch(records = []) {
  const artworksWithArtistIds = records.filter((record) => asArray(record.artist_ids).length > 0).length;
  const artworksWithTagIds = records.filter((record) => asArray(record.tag_ids).length > 0).length;

  return {
    artworks_total: records.length,
    patched_artworks_total: records.length,
    artworks_with_artist_ids: artworksWithArtistIds,
    artworks_with_tag_ids: artworksWithTagIds,
    artworks_without_artist_ids: records.length - artworksWithArtistIds,
    artworks_without_tag_ids: records.length - artworksWithTagIds,
  };
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const artworksPath = path.resolve(args.artworks || args.input || args.in || DEFAULT_ARTWORKS_PATH);
  const artistLinksPath = path.resolve(args['artist-links'] || DEFAULT_ARTIST_LINKS_PATH);
  const tagLinksPath = path.resolve(args['tag-links'] || DEFAULT_TAG_LINKS_PATH);
  const patchOutputPath = path.resolve(args.out || DEFAULT_PATCH_OUT);
  const rollbackOutputPath = path.resolve(args['rollback-out'] || DEFAULT_ROLLBACK_OUT);

  const artworks = readJsonRecords(artworksPath);
  const artistLinks = readJsonRecords(artistLinksPath);
  const tagLinks = readJsonRecords(tagLinksPath);
  const patch = buildDerivedArtworkRecords({ artworks, artistLinks, tagLinks });
  const rollback = buildRollbackRecords(artworks);
  const summary = {
    dry_run: true,
    inputs: {
      artworks: artworksPath,
      artist_links: artistLinksPath,
      tag_links: tagLinksPath,
    },
    outputs: {
      patch: patchOutputPath,
      rollback: rollbackOutputPath,
    },
    ...summarizeDerivedArtworkPatch(patch),
  };

  writeJsonLines(patchOutputPath, patch);
  writeJsonLines(rollbackOutputPath, rollback);

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  process.exitCode = runCli();
}
