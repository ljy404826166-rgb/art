import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  buildSearchDocuments,
  runCli,
} from './build-search-documents.mjs';

describe('build-search-documents', () => {
  it('creates flat searchable documents with normalized relationship fields', () => {
    const docs = buildSearchDocuments({
      artworks: [
        {
          _id: 'artwork-1',
          title_cn: '蒙娜丽莎',
          title_en: 'Mona Lisa',
          artist: '列奥纳多·达·芬奇',
          description: '文艺复兴肖像画。',
          tag_keys: ['文艺复兴'],
          medium: '油画',
        },
      ],
      derivedArtworks: [
        {
          _id: 'artwork-1',
          primary_artist_id: 'leonardo-da-vinci',
          artist_ids: ['leonardo-da-vinci'],
          artist_labels: ['列奥纳多·达·芬奇', 'Leonardo da Vinci'],
          tag_ids: ['style-renaissance'],
          tag_labels: ['文艺复兴'],
        },
      ],
    });

    assert.equal(docs.length, 1);
    assert.deepEqual(docs[0], {
      id: 'artwork-1',
      artwork_id: 'artwork-1',
      title: '蒙娜丽莎',
      title_en: 'Mona Lisa',
      artist: '列奥纳多·达·芬奇',
      artist_ids: 'leonardo-da-vinci',
      artist_labels: '列奥纳多·达·芬奇 Leonardo da Vinci',
      primary_artist_id: 'leonardo-da-vinci',
      description: '文艺复兴肖像画。',
      tag_ids: 'style-renaissance',
      tag_labels: '文艺复兴',
      tags_text: '文艺复兴',
      medium: '油画',
      year: '',
      location: '',
      source_name: '',
      search_text: '蒙娜丽莎 Mona Lisa 列奥纳多·达·芬奇 leonardo-da-vinci 列奥纳多·达·芬奇 Leonardo da Vinci 文艺复兴肖像画。 style-renaissance 文艺复兴 油画',
    });
  });

  it('writes JSON Lines output from the CLI', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'art-search-docs-'));
    const artworksPath = path.join(dir, 'artworks.jsonl');
    const derivedPath = path.join(dir, 'derived.jsonl');
    const outPath = path.join(dir, 'search-documents.jsonl');

    fs.writeFileSync(
      artworksPath,
      `${JSON.stringify({ _id: 'artwork-1', title: '达芬奇研究', artist: '其他画家' })}\n`,
      'utf8',
    );
    fs.writeFileSync(
      derivedPath,
      `${JSON.stringify({ _id: 'artwork-1', tag_ids: ['topic-da-vinci'], tag_labels: ['达芬奇研究'] })}\n`,
      'utf8',
    );

    const exitCode = runCli(['--artworks', artworksPath, '--derived', derivedPath, '--out', outPath]);
    const output = fs.readFileSync(outPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

    assert.equal(exitCode, 0);
    assert.equal(output.length, 1);
    assert.equal(output[0].id, 'artwork-1');
    assert.equal(output[0].tag_ids, 'topic-da-vinci');
  });
});
