import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  classifyArtworkArtistRelation,
  generateArtworkArtistLinks,
  generateArtworkLinks,
  generateArtworkTagLinks,
} from './generate-artwork-links.mjs';

const artists = [
  {
    _id: 'claude-monet',
    name_zh: '克洛德·莫奈',
    name_en: 'Claude Monet',
    aliases: ['Claude Monet', '克洛德·莫奈'],
    review_status: 'reviewed',
  },
  {
    _id: 'jacques-louis-david',
    name_zh: '雅克-路易·大卫',
    name_en: 'Jacques Louis David',
    aliases: ['Jacques Louis David', 'Jacques-Louis David'],
    review_status: 'reviewed',
  },
  {
    _id: 'rembrandt-van-rijn',
    name_zh: '伦勃朗',
    name_en: 'Rembrandt van Rijn',
    aliases: ['Rembrandt', 'Rembrandt van Rijn'],
    review_status: 'reviewed',
  },
];

const vocabTerms = [
  {
    _id: 'style-impressionism',
    type: 'style',
    label_zh: '印象派',
    aliases: ['印象派'],
    review_status: 'reviewed',
  },
  {
    _id: 'medium-oil-painting',
    type: 'medium',
    label_zh: '油画',
    aliases: ['油画'],
    review_status: 'reviewed',
  },
];

const artworks = [
  {
    _id: 'artwork_creator',
    artist: '克洛德·莫奈（Claude Monet, 1840-1926）',
    tag_keys: ['印象派', '油画'],
  },
  {
    _id: 'artwork_after',
    artist: 'after Jacques Louis David',
    tag_keys: [],
  },
  {
    _id: 'artwork_workshop',
    artist: 'Studio of Rembrandt',
    tag_keys: [],
  },
  {
    _id: 'artwork_unknown',
    artist: 'Unmapped Artist',
    tag_keys: ['未知标签'],
  },
];

describe('classifyArtworkArtistRelation', () => {
  it('classifies creator, after, workshop, and unknown relations', () => {
    assert.deepEqual(classifyArtworkArtistRelation('Claude Monet'), {
      role: 'creator',
      targetText: 'Claude Monet',
    });
    assert.deepEqual(classifyArtworkArtistRelation('after Jacques Louis David'), {
      role: 'after',
      targetText: 'Jacques Louis David',
    });
    assert.deepEqual(classifyArtworkArtistRelation('Studio of Rembrandt'), {
      role: 'workshop',
      targetText: 'Rembrandt',
    });
    assert.deepEqual(classifyArtworkArtistRelation(''), {
      role: 'unknown',
      targetText: '',
    });
  });
});

describe('generateArtworkArtistLinks', () => {
  it('creates artwork artist relationship candidates with explicit roles', () => {
    const links = generateArtworkArtistLinks(artworks, artists);
    const byArtwork = new Map(links.map((link) => [link.artwork_id, link]));

    assert.equal(byArtwork.get('artwork_creator').artist_id, 'claude-monet');
    assert.equal(byArtwork.get('artwork_creator').role, 'creator');
    assert.equal(byArtwork.get('artwork_creator').matched, true);

    assert.equal(byArtwork.get('artwork_after').artist_id, 'jacques-louis-david');
    assert.equal(byArtwork.get('artwork_after').role, 'after');
    assert.equal(byArtwork.get('artwork_after').matched, true);

    assert.equal(byArtwork.get('artwork_workshop').artist_id, 'rembrandt-van-rijn');
    assert.equal(byArtwork.get('artwork_workshop').role, 'workshop');
    assert.equal(byArtwork.get('artwork_workshop').matched, true);

    assert.equal(byArtwork.get('artwork_unknown').artist_id, 'unknown');
    assert.equal(byArtwork.get('artwork_unknown').role, 'unknown');
    assert.equal(byArtwork.get('artwork_unknown').matched, false);
  });
});

describe('generateArtworkTagLinks', () => {
  it('creates artwork tag relationship candidates from known vocab terms', () => {
    const links = generateArtworkTagLinks(artworks, vocabTerms);
    const ids = links.map((link) => link._id);

    assert.deepEqual(ids, [
      'artwork_creator--style-impressionism',
      'artwork_creator--medium-oil-painting',
    ]);
    assert.equal(links[0].tag_type, 'style');
    assert.equal(links[1].tag_type, 'medium');
  });
});

describe('generateArtworkLinks', () => {
  it('returns links with an audit summary', () => {
    const result = generateArtworkLinks({ artworks, artists, vocabTerms });

    assert.equal(result.summary.artworks_total, 4);
    assert.equal(result.summary.artist_links_total, 4);
    assert.equal(result.summary.tag_links_total, 2);
    assert.equal(result.summary.unmatched_artist_count, 1);
    assert.equal(result.summary.unknown_relation_count, 1);
  });
});
