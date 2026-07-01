import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildDerivedArtworkRecords,
  buildRollbackRecords,
  summarizeDerivedArtworkPatch,
} from './build-derived-artworks.mjs';

const artworks = [
  {
    _id: 'artwork_a',
    title_cn: '睡莲',
    primary_artist_id: 'legacy-artist',
    artist_ids: ['legacy-artist'],
    artist_labels: ['旧画家'],
    artist_relation_roles: ['creator'],
    tag_ids: ['legacy-tag'],
    tag_labels: ['旧标签'],
  },
  {
    _id: 'artwork_b',
    title_cn: '未匹配作品',
  },
];

const artistLinks = [
  {
    artwork_id: 'artwork_a',
    artist_id: 'claude-monet',
    artist_label: '克洛德·莫奈',
    role: 'creator',
    matched: true,
  },
  {
    artwork_id: 'artwork_a',
    artist_id: 'jacques-louis-david',
    artist_label: '雅克-路易·大卫',
    role: 'after',
    matched: true,
  },
  {
    artwork_id: 'artwork_b',
    artist_id: 'unknown',
    artist_label: '未知画家',
    role: 'unknown',
    matched: false,
  },
];

const tagLinks = [
  {
    artwork_id: 'artwork_a',
    tag_id: 'style-impressionism',
    tag_label: '印象派',
    tag_type: 'style',
  },
  {
    artwork_id: 'artwork_a',
    tag_id: 'medium-oil-painting',
    tag_label: '油画',
    tag_type: 'medium',
  },
  {
    artwork_id: 'artwork_b',
    tag_id: 'subject-landscape',
    tag_label: '风景',
    tag_type: 'subject',
  },
];

describe('buildDerivedArtworkRecords', () => {
  it('builds app-facing artist and tag fields from relationship links', () => {
    const records = buildDerivedArtworkRecords({ artworks, artistLinks, tagLinks });
    const byId = new Map(records.map((record) => [record._id, record]));

    assert.deepEqual(byId.get('artwork_a'), {
      _id: 'artwork_a',
      primary_artist_id: 'claude-monet',
      artist_ids: ['claude-monet', 'jacques-louis-david'],
      artist_labels: ['克洛德·莫奈', '雅克-路易·大卫'],
      artist_relation_roles: ['creator', 'after'],
      tag_ids: ['style-impressionism', 'medium-oil-painting'],
      tag_labels: ['印象派', '油画'],
      tag_types: ['style', 'medium'],
    });

    assert.deepEqual(byId.get('artwork_b'), {
      _id: 'artwork_b',
      primary_artist_id: null,
      artist_ids: [],
      artist_labels: [],
      artist_relation_roles: [],
      tag_ids: ['subject-landscape'],
      tag_labels: ['风景'],
      tag_types: ['subject'],
    });
  });
});

describe('buildRollbackRecords', () => {
  it('captures previous derived values for reversible apply steps', () => {
    const rollback = buildRollbackRecords(artworks);

    assert.deepEqual(rollback[0], {
      _id: 'artwork_a',
      previous_primary_artist_id: 'legacy-artist',
      previous_artist_ids: ['legacy-artist'],
      previous_artist_labels: ['旧画家'],
      previous_artist_relation_roles: ['creator'],
      previous_tag_ids: ['legacy-tag'],
      previous_tag_labels: ['旧标签'],
      previous_tag_types: null,
    });

    assert.equal(rollback[1].previous_primary_artist_id, null);
    assert.equal(rollback[1].previous_artist_ids, null);
    assert.equal(rollback[1].previous_tag_ids, null);
  });
});

describe('summarizeDerivedArtworkPatch', () => {
  it('reports patch scope and unresolved artwork counts', () => {
    const records = buildDerivedArtworkRecords({ artworks, artistLinks, tagLinks });
    const summary = summarizeDerivedArtworkPatch(records);

    assert.deepEqual(summary, {
      artworks_total: 2,
      patched_artworks_total: 2,
      artworks_with_artist_ids: 1,
      artworks_with_tag_ids: 2,
      artworks_without_artist_ids: 1,
      artworks_without_tag_ids: 0,
    });
  });
});
