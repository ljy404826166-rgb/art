import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { readJsonRecords } from './validate-reviewed-data.mjs';
import { parseArgs, toCandidateId, uniquePush, writeJsonLines } from './generate-artist-candidates.mjs';

const DEFAULT_ARTWORKS_PATH = path.resolve('miniapp/data/artworks.cloudbase.json');

const STYLE_SUFFIXES = ['派', '主义', '艺术', '绘', '兴'];
const MEDIUM_HINTS = ['油画', '水彩', '素描', '版画', '纸本', '石版', '木版', '海报', '插图', '布面'];
const SUBJECT_HINTS = ['肖像', '风景', '人物', '花园', '静物', '裸体', '宗教', '题材'];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeLabel(value) {
  return String(value ?? '').trim();
}

export function classifyTag(label) {
  const normalized = normalizeLabel(label);
  if (!normalized) return null;

  if (/^\d{1,2}\s*世纪/u.test(normalized) || /^\d{3,4}\s*年代/u.test(normalized) || /时期$/u.test(normalized)) {
    return 'period';
  }

  if (MEDIUM_HINTS.some((hint) => normalized.includes(hint))) {
    return 'medium';
  }

  if (SUBJECT_HINTS.some((hint) => normalized.includes(hint))) {
    return 'subject';
  }

  if (STYLE_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) {
    return 'style';
  }

  return 'subject';
}

function getArtworkId(artwork, index) {
  return artwork?._id || artwork?.id || artwork?.supabase_id || `artwork-${index + 1}`;
}

export function generateVocabCandidates(artworks = []) {
  const byId = new Map();

  artworks.forEach((artwork, index) => {
    const tags = [...asArray(artwork?.tag_keys), ...asArray(artwork?.tags)];
    const uniqueTags = [];
    tags.forEach((tag) => uniquePush(uniqueTags, tag));

    uniqueTags.forEach((tag) => {
      const label = normalizeLabel(tag);
      const type = classifyTag(label);
      if (!label || !type) return;

      const id = toCandidateId(type, label);
      const existing = byId.get(id) || {
        _id: id,
        type,
        label_zh: label,
        aliases: [],
        review_status: 'candidate',
        source_artwork_ids: [],
        artwork_count: 0,
      };

      uniquePush(existing.aliases, label);

      const artworkId = getArtworkId(artwork, index);
      if (!existing.source_artwork_ids.includes(artworkId)) {
        existing.source_artwork_ids.push(artworkId);
        existing.artwork_count += 1;
      }

      byId.set(id, existing);
    });
  });

  return Array.from(byId.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    if (b.artwork_count !== a.artwork_count) return b.artwork_count - a.artwork_count;
    return a._id.localeCompare(b._id);
  });
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const inputPath = path.resolve(args.input || args.in || DEFAULT_ARTWORKS_PATH);
  const outputPath = args.out ? path.resolve(args.out) : null;
  const artworks = readJsonRecords(inputPath);
  const candidates = generateVocabCandidates(artworks);
  const summary = {
    input: inputPath,
    output: outputPath,
    candidateCount: candidates.length,
  };

  if (outputPath) {
    writeJsonLines(outputPath, candidates);
  }

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  process.exitCode = runCli();
}
