# Miniapp Artwork Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the miniapp category page's hardcoded demo tags with a reviewed, versioned CloudBase classification system for style, subject, and decade, with exact cross-group AND filtering.

**Architecture:** Keep the ten source artwork fields immutable. Generate reviewed vocabulary and artwork-tag relationships offline, project bounded `style_ids`, `subject_ids`, `decade_ids`, and `classification_ids` fields into `artworks`, and publish a versioned `category_catalog` behind a singleton active-version pointer. The miniapp reads only reviewed catalog data and queries `classification_ids` with `db.command.all(selectedIds)`; all CloudBase writes remain explicit, hashed, staged, audited, and reversible.

**Tech Stack:** Node.js ESM governance scripts, `node:test`, JSON/JSONL review artifacts, `@cloudbase/manager-node`, WeChat Cloud Database, WeChat native miniapp CommonJS pages/services, existing page/component test harnesses.

## Global Constraints

- Target only `miniapp/`; do not implement Web or other platform equivalents.
- Preserve the original artwork fields `id,title_cn,title_en,artist,location,year_and_place,medium,dimensions,description,tags` without rewriting their values.
- The visible groups are exactly `style`, `subject`, and `decade`, displayed as “流派”“题材”“年代”.
- Each visible group permits at most one selected tag; different groups use AND; selecting the same tag again clears that group.
- Only `review_status=reviewed` relationships may enter derived fields, catalog counts, or miniapp results.
- Per artwork limits are style 0–2, subject 0–4, decade 0–2, and `classification_ids` 0–8.
- `classification_ids` order is style → subject → decade, contains no duplicates, and must remain at or below the project gate of 900 UTF-8 bytes.
- Decades come only from supported `year_and_place` date evidence. Century/era/unknown dates enter the date-completion queue instead of receiving an invented decade.
- No image or multimodal model integration in this implementation. Title/description matches remain candidates unless manually reviewed.
- Generated batch artifacts for the first release live under ignored `csv/cloudbase/classification/classification-20260719-v1/`; reviewed sources live under versioned `governance/classification/` and must not increase the miniapp package.
- All write tools default to dry-run. CloudBase apply and rollback require an explicit environment ID, `--confirm-env` with the same value, and an expected manifest SHA-256.
- Do not use the stale 2,039-row local review outputs for release. Export a fresh read-only source snapshot from the current CloudBase dataset before reviewing or publishing.
- Result page size is 20. Result ordering is `created_at desc` followed by `_id desc`; count and page queries must use identical filters.
- Catalog load failure must never restore hardcoded demo groups. A same-version valid cache may be used; otherwise show an error and retry.
- Production data mutation, index creation, active catalog pointer switching, and rollback apply are explicit human gates.

---

## File and Responsibility Map

### Versioned governance sources

- Create `governance/classification/README.md`: review states, allowed types, batch workflow, and artifact locations.
- Create `governance/classification/reviewed-vocab-terms.jsonl`: authoritative reviewed controlled vocabulary.
- Create `governance/classification/reviewed-artwork-tag-links.jsonl`: manually reviewed relationships not produced by deterministic rules.
- Modify `miniapp/data/schemas/vocab-terms.schema.json`: add the complete backend type set and period/display fields.
- Create `miniapp/data/schemas/artwork-tag-links.schema.json`: relationship contract.
- Create `miniapp/data/schemas/category-catalog.schema.json`: catalog row contract.

### Governance libraries and pipeline

- Create `scripts/data-governance/lib/classification-contract.mjs`: shared types, limits, stable IDs, group resolution, byte measurement, and invariant validation.
- Create `scripts/data-governance/lib/classification-contract.test.mjs`.
- Create `scripts/data-governance/lib/decade-parser.mjs`: deterministic date evidence parser.
- Create `scripts/data-governance/lib/decade-parser.test.mjs`.
- Modify `scripts/data-governance/generate-vocab-candidates.mjs` and `generate-candidates.test.mjs`: conservative suggestions with no default-to-subject behavior.
- Modify `scripts/data-governance/generate-artwork-links.mjs` and `.test.mjs`: exact reviewed alias links, candidate text links, deterministic decade links, and conflict reports.
- Modify `scripts/data-governance/validate-reviewed-data.mjs` and `.test.mjs`: validate vocabulary, aliases, tag links, and references.
- Modify `scripts/data-governance/build-derived-artworks.mjs` and `.test.mjs`: reviewed-only classification projection and rollback.
- Create `scripts/data-governance/build-category-catalog.mjs` and `.test.mjs`: versioned catalog and pointer candidate.
- Create `scripts/data-governance/build-classification-release.mjs` and `.test.mjs`: deterministic dry-run batch bundle and manifest hash.
- Create `scripts/data-governance/export-classification-source.mjs` and `.test.mjs`: read-only current CloudBase export.
- Create `scripts/data-governance/audit-artwork-classification.mjs` and `.test.mjs`: offline/cloud release gates.

### CloudBase controlled mutation

- Create `config/cloudbase-classification-indexes.json`: expected index definitions.
- Create `scripts/data-governance/cloudbase-classification-indexes.mjs` and `.test.mjs`: audit by default, create missing indexes only after explicit confirmation.
- Create `scripts/data-governance/cloudbase-publish-classification.mjs` and `.test.mjs`: staged, preimage-checked apply.
- Create `scripts/data-governance/cloudbase-rollback-classification.mjs` and `.test.mjs`: manifest-scoped rollback.

### Miniapp runtime

- Create `miniapp/services/categories.js` and `.test.mjs`: active pointer, reviewed catalog normalization, and same-version cache.
- Modify `miniapp/services/artworks.js` and `artworks-normalized.test.mjs`: strict `classification_ids` fetch/count APIs with no label fallback.
- Modify `miniapp/pages/category/category.js`, `.wxml`, `.wxss`, and `.test.mjs`: three-group selection, AND results, retries, request invalidation, stable pagination, and clear filters.
- Keep `miniapp/data/fallback-artworks.js` for unrelated fallback artwork consumers, but remove `fallbackGroups` from the category page execution path.

### Commands and documentation

- Modify `package.json`: add governance and miniapp test scripts without any default apply alias.
- Create `scripts/run-node-tests.mjs` and `.test.mjs`: recursively discover sorted `*.test.mjs` files without shell glob dependence.
- Modify `docs/art-data-import-checklist.md`: correct the invalid audit `--dry-run` example and document classification gates.
- Modify `docs/art-data-normalization-acceptance.md`: replace references to the missing legacy apply script with the new publish/rollback flow.
- Create `docs/wechat-classification-cloud-operations.md`: exact snapshot, dry-run, index, pilot, publish, audit, pointer switch, and rollback commands.

---

### Task 1: Classification Contracts and Reviewed Data Validation

**Files:**
- Create: `scripts/data-governance/lib/classification-contract.mjs`
- Create: `scripts/data-governance/lib/classification-contract.test.mjs`
- Modify: `scripts/data-governance/validate-reviewed-data.mjs`
- Modify: `scripts/data-governance/validate-reviewed-data.test.mjs`
- Modify: `miniapp/data/schemas/vocab-terms.schema.json`
- Create: `miniapp/data/schemas/artwork-tag-links.schema.json`
- Create: `miniapp/data/schemas/category-catalog.schema.json`
- Create: `governance/classification/README.md`

**Interfaces:**
- Produces: `VOCAB_TYPES`, `CLASSIFICATION_LIMITS`, `normalizeClassificationText(value)`, `getStableArtworkId(artwork)`, `getVisibleGroup(term)`, `orderedUnique(values)`, `measureIndexedArrayBytes(values)`, `validateClassificationProjection(record, vocabById)`.
- Extends: `validateVocabTerms(records)`, `validateArtworkTagLinks(records, context)`, `validateReviewedData(payload)`.

- [ ] **Step 1: Write failing contract and validator tests**

```javascript
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLASSIFICATION_LIMITS,
  getVisibleGroup,
  measureIndexedArrayBytes,
  validateClassificationProjection,
} from './classification-contract.mjs';

describe('classification contract', () => {
  it('maps only visible reviewed term types to groups', () => {
    assert.equal(getVisibleGroup({ type: 'style' }), 'style');
    assert.equal(getVisibleGroup({ type: 'subject' }), 'subject');
    assert.equal(getVisibleGroup({ type: 'period', period_kind: 'decade' }), 'decade');
    assert.equal(getVisibleGroup({ type: 'medium' }), '');
    assert.equal(getVisibleGroup({ type: 'period', period_kind: 'era' }), '');
  });

  it('rejects over-limit or unreviewed projections', () => {
    const vocabById = new Map([
      ['style-a', { _id: 'style-a', type: 'style', review_status: 'reviewed' }],
      ['subject-a', { _id: 'subject-a', type: 'subject', review_status: 'candidate' }],
    ]);
    const result = validateClassificationProjection({
      style_ids: ['style-a'],
      subject_ids: ['subject-a'],
      decade_ids: [],
      classification_ids: ['style-a', 'subject-a'],
    }, vocabById);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === 'unreviewed-term'));
    assert.equal(CLASSIFICATION_LIMITS.total, 8);
    assert.ok(measureIndexedArrayBytes(['style-a']) > 0);
  });
});
```

Add validator coverage with these fixtures:

```javascript
it('rejects aliases owned by multiple reviewed terms', () => {
  const result = validateVocabTerms([
    { _id: 'subject-landscape', type: 'subject', label_zh: '风景', aliases: ['景观'], review_status: 'reviewed' },
    { _id: 'style-landscape', type: 'style', label_zh: '风景式', aliases: ['景观'], review_status: 'reviewed' },
  ]);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'alias-owner-conflict'));
});

it('rejects duplicate or broken artwork-tag relationships', () => {
  const rows = [
    { _id: 'l1', artwork_id: 'a1', tag_id: 'subject-landscape', tag_type: 'subject', review_status: 'reviewed', source: 'manual', evidence: 'review' },
    { _id: 'l2', artwork_id: 'a1', tag_id: 'subject-landscape', tag_type: 'subject', review_status: 'reviewed', source: 'manual', evidence: 'review' },
    { _id: 'l3', artwork_id: 'missing', tag_id: 'missing-term', tag_type: 'subject', review_status: 'reviewed', source: 'manual', evidence: 'review' },
  ];
  const result = validateArtworkTagLinks(rows, {
    artworkIds: new Set(['a1']),
    vocabById: new Map([['subject-landscape', { _id: 'subject-landscape', type: 'subject', review_status: 'reviewed' }]]),
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'duplicate-artwork-tag-link'));
  assert.ok(result.errors.some((error) => error.code === 'missing-artwork-reference'));
  assert.ok(result.errors.some((error) => error.code === 'missing-term-reference'));
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```powershell
node --test scripts/data-governance/lib/classification-contract.test.mjs scripts/data-governance/validate-reviewed-data.test.mjs
```

Expected: FAIL because `classification-contract.mjs` and `validateArtworkTagLinks` do not exist.

- [ ] **Step 3: Implement shared constants and validation**

Use these exact public constants and group rules:

```javascript
export const VOCAB_TYPES = new Set([
  'style', 'subject', 'medium', 'technique', 'period',
  'format', 'series', 'rights', 'region', 'country', 'collection', 'source',
]);

export const CLASSIFICATION_LIMITS = Object.freeze({
  style: 2,
  subject: 4,
  decade: 2,
  total: 8,
  indexedBytes: 900,
});

export function normalizeClassificationText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

export function getStableArtworkId(artwork) {
  const id = String(artwork?._id || artwork?.id || '').trim();
  if (!id) {
    const error = new Error('Artwork requires a stable _id or id.');
    error.code = 'missing-artwork-id';
    throw error;
  }
  return id;
}

export function getVisibleGroup(term) {
  if (term?.type === 'style') return 'style';
  if (term?.type === 'subject') return 'subject';
  if (term?.type === 'period' && term?.period_kind === 'decade') return 'decade';
  return '';
}

export function orderedUnique(values = []) {
  const seen = new Set();
  return values.filter((value) => {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((value) => String(value).trim());
}

export function measureIndexedArrayBytes(values = []) {
  return Buffer.byteLength(JSON.stringify(values), 'utf8');
}
```

`validateClassificationProjection` must compare `classification_ids` to `orderedUnique([...style_ids, ...subject_ids, ...decade_ids])`, enforce 2/4/2/8 and 900-byte limits, require reviewed terms, and confirm every term belongs to the expected group. `validateArtworkTagLinks` must validate IDs, statuses, type consistency, reference existence, relation uniqueness, and evidence/source fields. Update all three JSON schemas to encode the same field names and enums.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data-governance/lib/classification-contract.mjs scripts/data-governance/lib/classification-contract.test.mjs scripts/data-governance/validate-reviewed-data.mjs scripts/data-governance/validate-reviewed-data.test.mjs miniapp/data/schemas governance/classification/README.md
git commit -m "feat: define artwork classification contracts"
```

### Task 2: Deterministic Decade Parser

**Files:**
- Create: `scripts/data-governance/lib/decade-parser.mjs`
- Create: `scripts/data-governance/lib/decade-parser.test.mjs`

**Interfaces:**
- Produces: `toDecadeId(year)`, `parseArtworkDecades(yearAndPlace, options)`.
- Return shape: `{ status: 'resolved'|'needs_review'|'invalid', decadeIds: string[], evidence: string[], reason: string }`.

- [ ] **Step 1: Write the complete date-rule tests**

```javascript
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseArtworkDecades } from './decade-parser.mjs';

describe('parseArtworkDecades', () => {
  const parse = (value) => parseArtworkDecades(value, { currentYear: 2026 });

  it('resolves exact, circa, same-decade, and narrow adjacent-decade dates', () => {
    assert.deepEqual(parse('1903，巴黎').decadeIds, ['period-1900s']);
    assert.deepEqual(parse('约1903年').decadeIds, ['period-1900s']);
    assert.deepEqual(parse('1901-1908').decadeIds, ['period-1900s']);
    assert.deepEqual(parse('1896—1902').decadeIds, ['period-1890s', 'period-1900s']);
  });

  it('queues broad or wide dates without inventing a decade', () => {
    assert.equal(parse('19世纪，法国').status, 'needs_review');
    assert.equal(parse('江户时代').status, 'needs_review');
    assert.equal(parse('年份不详').status, 'needs_review');
    assert.equal(parse('1890-1908').status, 'needs_review');
    assert.deepEqual(parse('1890-1908').decadeIds, []);
  });

  it('rejects impossible ranges and ignores unrelated place numbers', () => {
    assert.equal(parse('2030').status, 'invalid');
    assert.equal(parse('1908-1901').status, 'invalid');
    assert.equal(parse('巴黎第8区').status, 'needs_review');
  });
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test scripts/data-governance/lib/decade-parser.test.mjs`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement only supported patterns**

Implement `toDecadeId(year)` as `period-${Math.floor(year / 10) * 10}s`. Parse explicit four-digit Gregorian years, optional `约/c./circa`, and two-year ranges joined by `-`, `–`, `—`, or `至`. A single valid year resolves one decade. A same-decade range resolves one. A range spanning exactly two adjacent decades and at most ten years resolves two. Wider ranges, century/era/unknown/BCE text, and text without a recognized date become `needs_review`. Values below 1, above `currentYear`, or reversed ranges become `invalid`. Preserve the matched source substring in `evidence`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data-governance/lib/decade-parser.mjs scripts/data-governance/lib/decade-parser.test.mjs
git commit -m "feat: add deterministic artwork decade parser"
```

### Task 3: Conservative Vocabulary Candidate Generation

**Files:**
- Modify: `scripts/data-governance/generate-vocab-candidates.mjs`
- Modify: `scripts/data-governance/generate-candidates.test.mjs`

**Interfaces:**
- Produces: `suggestTagTypes(label) -> { suggestedTypes: string[], reasons: string[] }`.
- Changes: `generateVocabCandidates(artworks)` returns candidate IDs independent of an unreviewed authoritative type.

- [ ] **Step 1: Replace the permissive candidate test with conservative cases**

```javascript
it('does not default unknown labels or artist names to subject', () => {
  const candidates = generateVocabCandidates([{
    _id: 'a1',
    tags: ['印象派', '风景', '油画', '江户时代', '富岳三十六景', '葛饰北斋'],
  }]);
  const byLabel = new Map(candidates.map((row) => [row.label_zh, row]));
  assert.deepEqual(byLabel.get('印象派').suggested_types, ['style']);
  assert.deepEqual(byLabel.get('风景').suggested_types, ['subject']);
  assert.deepEqual(byLabel.get('油画').suggested_types, ['medium']);
  assert.deepEqual(byLabel.get('江户时代').suggested_types, ['period']);
  assert.deepEqual(byLabel.get('富岳三十六景').suggested_types, []);
  assert.deepEqual(byLabel.get('葛饰北斋').suggested_types, []);
  assert.equal(byLabel.get('葛饰北斋').review_status, 'candidate');
});
```

- [ ] **Step 2: Run the candidate tests and confirm RED**

Run: `node --test scripts/data-governance/generate-candidates.test.mjs`

Expected: FAIL because unknown labels currently default to `subject` and `suggested_types` is absent.

- [ ] **Step 3: Implement conservative suggestions and conflict evidence**

Keep candidates non-authoritative:

```javascript
export function suggestTagTypes(label) {
  const text = normalizeLabel(label);
  const suggestedTypes = [];
  const reasons = [];
  const add = (type, reason) => {
    if (!suggestedTypes.includes(type)) suggestedTypes.push(type);
    reasons.push(reason);
  };
  if (/世纪|时代|时期$/u.test(text)) add('period', 'period-pattern');
  if (MEDIUM_HINTS.some((hint) => text.includes(hint))) add('medium', 'medium-hint');
  if (SUBJECT_HINTS.some((hint) => text.includes(hint))) add('subject', 'subject-hint');
  if (STYLE_SUFFIXES.some((suffix) => text.endsWith(suffix))) add('style', 'style-suffix');
  return { suggestedTypes, reasons };
}
```

Candidate `_id` values must be constructed as `candidate-${stableSlug}`. Each row also contains `label_zh`, `aliases`, `suggested_types`, `classification_reasons`, `review_status:'candidate'`, `source_artwork_ids`, and `artwork_count`. Never write an authoritative `type` until review.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all candidate tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data-governance/generate-vocab-candidates.mjs scripts/data-governance/generate-candidates.test.mjs
git commit -m "fix: make tag candidate typing conservative"
```

### Task 4: Reviewed Artwork Classification Links

**Files:**
- Modify: `scripts/data-governance/generate-artwork-links.mjs`
- Modify: `scripts/data-governance/generate-artwork-links.test.mjs`
- Modify: `scripts/data-governance/validate-reviewed-data.mjs`
- Modify: `scripts/data-governance/validate-reviewed-data.test.mjs`

**Interfaces:**
- Produces: `buildReviewedVocabLookup(vocabTerms)`, `generateArtworkClassificationLinks(artworks, vocabTerms, options)`.
- Return shape: `{ links, candidates, conflicts, dateQueue, unmatchedTags, summary }`.

- [ ] **Step 1: Write failing exact-alias, ambiguity, and decade tests**

```javascript
it('publishes only exact reviewed aliases and deterministic decades', () => {
  const result = generateArtworkClassificationLinks([
    { _id: 'a1', tags: ['印象主义'], title_cn: '海边', year_and_place: '1896—1902，法国' },
  ], [
    { _id: 'style-impressionism', type: 'style', label_zh: '印象派', aliases: ['印象主义'], review_status: 'reviewed' },
  ], { classificationVersion: 'classification-v1', sourceBatch: 'batch-v1', currentYear: 2026 });

  assert.deepEqual(result.links.map((row) => row.tag_id), [
    'style-impressionism', 'period-1890s', 'period-1900s',
  ]);
  assert.ok(result.links.every((row) => row.review_status === 'reviewed'));
  assert.equal(result.candidates.length, 0);
});

it('reports duplicate aliases and does not select the first term', () => {
  const result = generateArtworkClassificationLinks(
    [{ _id: 'a1', tags: ['风景'] }],
    [
      { _id: 'subject-landscape', type: 'subject', aliases: ['风景'], review_status: 'reviewed' },
      { _id: 'style-landscape', type: 'style', aliases: ['风景'], review_status: 'reviewed' },
    ],
    { classificationVersion: 'classification-v1', sourceBatch: 'batch-v1', currentYear: 2026 },
  );
  assert.equal(result.links.length, 0);
  assert.equal(result.conflicts[0].code, 'ambiguous-alias');
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test scripts/data-governance/generate-artwork-links.test.mjs scripts/data-governance/validate-reviewed-data.test.mjs`

Expected: FAIL because current lookup silently selects the first alias and emits only candidate tag links.

- [ ] **Step 3: Implement reviewed-only lookup and evidence-rich link creation**

Exact raw `tags`, `tag_keys`, or `tag_labels` matches against one reviewed term produce reviewed links with `source:'raw-tag-exact-alias'`, `confidence:1`, `source_field`, `source_text`, `evidence`, `classification_version`, and `source_batch`. Exact title/description matches produce candidate links only. The decade parser creates deterministic reviewed period terms with `period_kind:'decade'`, stable IDs, `source:'deterministic-date-parser'`, and preserved date evidence in the release bundle. Duplicate normalized aliases produce conflicts and no link. Preserve existing artist-link exports unchanged.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data-governance/generate-artwork-links.mjs scripts/data-governance/generate-artwork-links.test.mjs scripts/data-governance/validate-reviewed-data.mjs scripts/data-governance/validate-reviewed-data.test.mjs
git commit -m "feat: generate reviewed artwork classification links"
```

### Task 5: Reviewed Derived Fields and `classification_ids`

**Files:**
- Modify: `scripts/data-governance/build-derived-artworks.mjs`
- Modify: `scripts/data-governance/build-derived-artworks.test.mjs`

**Interfaces:**
- Produces: `buildClassificationFields(links, vocabById, options)`, expanded `buildDerivedArtworkRecords`, expanded `buildRollbackRecords`.

- [ ] **Step 1: Write failing projection and rollback tests**

```javascript
it('projects only reviewed links in fixed visible-group order', () => {
  const records = buildDerivedArtworkRecords({
    artworks: [{ _id: 'a1' }],
    artistLinks: [],
    tagLinks: [
      { artwork_id: 'a1', tag_id: 'subject-seascape', review_status: 'reviewed' },
      { artwork_id: 'a1', tag_id: 'style-impressionism', review_status: 'reviewed' },
      { artwork_id: 'a1', tag_id: 'medium-oil', review_status: 'reviewed' },
      { artwork_id: 'a1', tag_id: 'subject-night', review_status: 'candidate' },
    ],
    vocabTerms: [
      { _id: 'style-impressionism', type: 'style', review_status: 'reviewed' },
      { _id: 'subject-seascape', type: 'subject', review_status: 'reviewed' },
      { _id: 'subject-night', type: 'subject', review_status: 'reviewed' },
      { _id: 'medium-oil', type: 'medium', review_status: 'reviewed' },
    ],
    classificationVersion: 'classification-v1',
    sourceBatch: 'batch-v1',
    classifiedAt: '2026-07-19T00:00:00.000Z',
  });
  assert.deepEqual(records[0].style_ids, ['style-impressionism']);
  assert.deepEqual(records[0].subject_ids, ['subject-seascape']);
  assert.deepEqual(records[0].decade_ids, []);
  assert.deepEqual(records[0].classification_ids, ['style-impressionism', 'subject-seascape']);
  assert.deepEqual(records[0].tag_ids, ['subject-seascape', 'style-impressionism', 'medium-oil']);
  assert.equal(records[0].classification_schema_version, 1);
});
```

Add explicit limit and rollback tests:

```javascript
it('rejects classification limits instead of truncating', () => {
  assert.throws(() => buildDerivedArtworkRecords({
    artworks: [{ _id: 'a1' }],
    artistLinks: [],
    tagLinks: ['a', 'b', 'c'].map((id) => ({ artwork_id: 'a1', tag_id: `style-${id}`, review_status: 'reviewed' })),
    vocabTerms: ['a', 'b', 'c'].map((id) => ({ _id: `style-${id}`, type: 'style', review_status: 'reviewed' })),
    classificationVersion: 'classification-v1',
    sourceBatch: 'batch-v1',
    classifiedAt: '2026-07-19T00:00:00.000Z',
  }), (error) => error.code === 'classification-limit-exceeded');
});

it('records whether every derived field previously existed', () => {
  const rollback = buildRollbackRecords([{ _id: 'a1', style_ids: ['style-old'] }]);
  assert.deepEqual(rollback[0].previous.style_ids, { exists: true, value: ['style-old'] });
  assert.deepEqual(rollback[0].previous.classification_ids, { exists: false, value: null });
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test scripts/data-governance/build-derived-artworks.test.mjs`

Expected: FAIL because classification fields and reviewed-only filtering are absent.

- [ ] **Step 3: Implement the bounded projection**

Filter links with `review_status==='reviewed'`, resolve every `tag_id` through reviewed vocabulary, group with `getVisibleGroup`, and produce:

```javascript
{
  style_ids,
  subject_ids,
  decade_ids,
  classification_ids: orderedUnique([...style_ids, ...subject_ids, ...decade_ids]),
  tag_ids,
  tag_labels,
  tag_types,
  classification_version: classificationVersion,
  classification_schema_version: 1,
  source_batch: sourceBatch,
  classified_at: classifiedAt,
}
```

Call `validateClassificationProjection` before returning each patch. Rollback records must preserve previous existence as well as previous value so absent fields are restored with `$unset`, not `null`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all derived tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data-governance/build-derived-artworks.mjs scripts/data-governance/build-derived-artworks.test.mjs
git commit -m "feat: project reviewed artwork classification fields"
```

### Task 6: Versioned Category Catalog and Release Bundle

**Files:**
- Create: `scripts/data-governance/build-category-catalog.mjs`
- Create: `scripts/data-governance/build-category-catalog.test.mjs`
- Create: `scripts/data-governance/build-classification-release.mjs`
- Create: `scripts/data-governance/build-classification-release.test.mjs`

**Interfaces:**
- Produces: `buildCategoryCatalog({ artworks, patches, vocabTerms, catalogVersion, generatedAt })`.
- Produces: `buildClassificationRelease(input, options) -> { files, manifest, manifestSha256 }`.

- [ ] **Step 1: Write catalog and deterministic manifest tests**

```javascript
it('counts only published works and sorts decades newest first', () => {
  const result = buildCategoryCatalog({
    artworks: [
      { _id: 'a1', status: 'published' },
      { _id: 'a2', status: 'draft' },
    ],
    patches: [
      { _id: 'a1', style_ids: ['style-a'], subject_ids: [], decade_ids: ['period-1900s'] },
      { _id: 'a2', style_ids: ['style-a'], subject_ids: [], decade_ids: ['period-1930s'] },
    ],
    vocabTerms: [
      { _id: 'style-a', type: 'style', label_zh: '测试流派', review_status: 'reviewed', display_enabled: true, sort_order: 10 },
      { _id: 'period-1900s', type: 'period', period_kind: 'decade', label_zh: '1900s', review_status: 'reviewed', display_enabled: true },
      { _id: 'period-1930s', type: 'period', period_kind: 'decade', label_zh: '1930s', review_status: 'reviewed', display_enabled: true },
    ],
    catalogVersion: 'classification-v1',
    generatedAt: '2026-07-19T00:00:00.000Z',
  });
  assert.deepEqual(result.rows.map((row) => [row.term_id, row.artwork_count]), [
    ['style-a', 1], ['period-1900s', 1],
  ]);
  assert.equal(result.pointer._id, 'active');
  assert.equal(result.pointer.active_catalog_version, 'classification-v1');
});
```

Add a deterministic release test:

```javascript
it('hashes normalized release inputs deterministically', () => {
  const input = {
    artworks: [{ _id: 'a1', status: 'published' }],
    vocabTerms: [{ _id: 'style-a', type: 'style', review_status: 'reviewed' }],
    reviewedLinks: [{ _id: 'l1', artwork_id: 'a1', tag_id: 'style-a', review_status: 'reviewed' }],
  };
  const options = { classificationVersion: 'classification-v1', sourceBatch: 'batch-v1', generatedAt: '2026-07-19T00:00:00.000Z' };
  const first = buildClassificationRelease(input, options);
  const second = buildClassificationRelease(input, options);
  assert.equal(first.manifestSha256, second.manifestSha256);
  const changed = buildClassificationRelease({
    ...input,
    reviewedLinks: [{ ...input.reviewedLinks[0], evidence: 'changed' }],
  }, options);
  assert.notEqual(first.manifestSha256, changed.manifestSha256);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```powershell
node --test scripts/data-governance/build-category-catalog.test.mjs scripts/data-governance/build-classification-release.test.mjs
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement catalog and batch outputs**

Catalog `_id` values must be constructed as `${catalogVersion}--${termId}`. Each row also contains `catalog_version`, `group`, `term_id`, `label`, `artwork_count`, `sort_order`, `display_enabled:true`, `publish_status:'ready'`, and `generated_at`. Omit zero-count rows. Sort style/subject by `sort_order` then `_id`; sort decade numerically descending.

The release builder must write these exact logical files under the requested batch directory: `vocab-terms.jsonl`, `artwork-tag-links.jsonl`, `artworks-patch.jsonl`, `artworks-rollback.jsonl`, `category-catalog.jsonl`, `category-catalog-state.json`, `date-completion-queue.jsonl`, `conflicts.jsonl`, `unmatched-tags.jsonl`, `summary.json`, and `manifest.json`. Hash canonical JSON with keys sorted and line endings normalized to `\n`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data-governance/build-category-catalog.mjs scripts/data-governance/build-category-catalog.test.mjs scripts/data-governance/build-classification-release.mjs scripts/data-governance/build-classification-release.test.mjs
git commit -m "feat: build versioned classification release bundles"
```

### Task 7: Fresh Read-Only CloudBase Snapshot and Strict Audit

**Files:**
- Create: `scripts/data-governance/export-classification-source.mjs`
- Create: `scripts/data-governance/export-classification-source.test.mjs`
- Create: `scripts/data-governance/audit-artwork-classification.mjs`
- Create: `scripts/data-governance/audit-artwork-classification.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_COLLECTIONS`, `parseExportArgs(argv)`, `exportClassificationSource(database, options)`.
- Produces: `buildClassificationAudit(data, options) -> { ok, checks, summary, samples }`.

- [ ] **Step 1: Write tests proving export is read-only and audit is strict**

```javascript
it('exports with QUERY commands only', async () => {
  const commands = [];
  const database = {
    async runCommands(payload) {
      commands.push(...payload.MgoCommands);
      return { Data: ['[]'] };
    },
  };
  const result = await exportClassificationSource(database, { collections: DEFAULT_COLLECTIONS, pageSize: 1000 });
  assert.ok(commands.length >= 5);
  assert.ok(commands.every((command) => command.CommandType === 'QUERY'));
  assert.deepEqual(result.artworks, []);
});

it('fails hard classification invariants without imposing a coverage minimum', () => {
  const report = buildClassificationAudit({
    artworks: [{ _id: 'a1', status: 'published', style_ids: ['style-a'], subject_ids: [], decade_ids: [], classification_ids: [] }],
    vocabTerms: [{ _id: 'style-a', type: 'style', review_status: 'candidate', display_enabled: true }],
    artworkTagLinks: [],
    categoryCatalog: [{ _id: 'c1', catalog_version: 'v1', term_id: 'style-a', artwork_count: 2, publish_status: 'ready' }],
    categoryCatalogState: [{ _id: 'active', active_catalog_version: 'v2' }],
  }, { catalogVersion: 'v1' });
  assert.equal(report.ok, false);
  assert.ok(report.checks.some((check) => check.id === 'reviewed_visible_terms' && !check.ok));
  assert.ok(report.checks.some((check) => check.id === 'classification_projection' && !check.ok));
  assert.ok(report.checks.some((check) => check.id === 'catalog_counts' && !check.ok));
  assert.ok(report.checks.some((check) => check.id === 'active_catalog_pointer' && !check.ok));
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```powershell
node --test scripts/data-governance/export-classification-source.test.mjs scripts/data-governance/audit-artwork-classification.test.mjs
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement explicit-environment read-only export and audit**

`parseExportArgs` must reject a missing environment ID and unknown flags. Export `artworks`, `vocab_terms`, `artwork_tag_links`, `category_catalog`, and `category_catalog_state` into the batch directory and record collection counts plus SHA-256 in `source-manifest.json`. Never create a collection during dry-run.

The audit must report coverage without treating incomplete coverage as fabrication pressure. Hard failures are reviewed-only violations, reference/type mismatches, 2/4/2/8 or 900-byte violations, decade evidence violations, catalog count mismatch, pointer/version mismatch, and unstable page IDs.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data-governance/export-classification-source.mjs scripts/data-governance/export-classification-source.test.mjs scripts/data-governance/audit-artwork-classification.mjs scripts/data-governance/audit-artwork-classification.test.mjs
git commit -m "feat: add classification snapshot and audit gates"
```

### Task 8: CloudBase Index Audit and Controlled Creation

**Files:**
- Create: `config/cloudbase-classification-indexes.json`
- Create: `scripts/data-governance/cloudbase-classification-indexes.mjs`
- Create: `scripts/data-governance/cloudbase-classification-indexes.test.mjs`

**Interfaces:**
- Produces: `parseIndexArgs(argv)`, `diffIndexes(actual, expected)`, `applyMissingIndexes(database, diff, options)`.

- [ ] **Step 1: Write argument and no-write-by-default tests**

```javascript
it('requires matching confirmation for index mutation', () => {
  assert.throws(() => parseIndexArgs(['--env-id', 'env-a', '--apply']), /--confirm-env/);
  assert.throws(() => parseIndexArgs(['--env-id', 'env-a', '--confirm-env', 'env-b', '--apply']), /must match/);
});

it('creates missing indexes without dropping existing indexes', async () => {
  const calls = [];
  const database = {
    async describeCollection() { return { Indexes: [{ IndexName: 'published_results_v1' }] }; },
    async updateCollection(name, payload) { calls.push({ name, payload }); },
  };
  const expected = {
    artworks: [
      { name: 'classification_results_v1', keys: { status: 1, classification_ids: 1, created_at: -1, _id: -1 } },
      { name: 'published_results_v1', keys: { status: 1, created_at: -1, _id: -1 } },
    ],
  };
  const actual = { artworks: [{ name: 'published_results_v1', keys: { status: 1, created_at: -1, _id: -1 } }] };
  const diff = diffIndexes(actual, expected);
  await applyMissingIndexes(database, diff, { apply: true });
  assert.ok(calls.every((call) => Array.isArray(call.payload.CreateIndexes)));
  assert.ok(calls.every((call) => !('DropIndexes' in call.payload)));
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test scripts/data-governance/cloudbase-classification-indexes.test.mjs`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Add exact index configuration and implementation**

```json
{
  "artworks": [
    { "name": "classification_results_v1", "keys": { "status": 1, "classification_ids": 1, "created_at": -1, "_id": -1 } },
    { "name": "published_results_v1", "keys": { "status": 1, "created_at": -1, "_id": -1 } }
  ],
  "category_catalog": [
    { "name": "catalog_version_group_v1", "keys": { "catalog_version": 1, "publish_status": 1, "group": 1, "sort_order": 1, "_id": 1 } }
  ]
}
```

Before apply, scan source documents and fail if any `classification_ids` value exceeds 900 bytes. Use manager-node collection APIs confirmed by the installed dependency. Never issue drop-index operations.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add config/cloudbase-classification-indexes.json scripts/data-governance/cloudbase-classification-indexes.mjs scripts/data-governance/cloudbase-classification-indexes.test.mjs
git commit -m "feat: manage classification database indexes safely"
```

### Task 9: Manifest-Checked Publish and Rollback

**Files:**
- Create: `scripts/data-governance/cloudbase-publish-classification.mjs`
- Create: `scripts/data-governance/cloudbase-publish-classification.test.mjs`
- Create: `scripts/data-governance/cloudbase-rollback-classification.mjs`
- Create: `scripts/data-governance/cloudbase-rollback-classification.test.mjs`

**Interfaces:**
- Produces: `parsePublishArgs(argv)`, `assertDerivedOnlyArtworkPatch(record)`, `buildPublishOperations(bundle, preimages)`, `publishClassification(database, options)`.
- Produces: `parseRollbackArgs(argv)`, `buildRollbackOperations(manifest, currentRows)`, `rollbackClassification(database, options)`.

- [ ] **Step 1: Write safety, idempotency, preimage, and rollback tests**

```javascript
it('rejects unsafe publish arguments and source-field mutations', () => {
  assert.throws(() => parsePublishArgs(['--release', 'release', '--env-id', 'env-a', '--apply']), /--confirm-env/);
  assert.throws(() => parsePublishArgs([
    '--release', 'release', '--env-id', 'env-a', '--confirm-env', 'env-a',
    '--expected-manifest-sha256', 'wrong', '--apply',
  ], { manifestSha256: 'expected' }), /manifest SHA-256 mismatch/);
  assert.throws(() => assertDerivedOnlyArtworkPatch({ _id: 'a1', title_cn: 'changed' }), /source field/);
});

it('restores absent fields with unset and existing fields with set', () => {
  const operations = buildRollbackOperations({
    source_batch: 'batch-v1',
    artwork_preimages: [{
      _id: 'a1',
      previous: {
        style_ids: { exists: true, value: ['style-old'] },
        classification_ids: { exists: false, value: null },
      },
    }],
  }, [{ _id: 'a1', source_batch: 'batch-v1' }]);
  assert.deepEqual(operations.artworkUpdates[0].set, { style_ids: ['style-old'] });
  assert.deepEqual(operations.artworkUpdates[0].unset, ['classification_ids']);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```powershell
node --test scripts/data-governance/cloudbase-publish-classification.test.mjs scripts/data-governance/cloudbase-rollback-classification.test.mjs
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement staged order and explicit pointer operation**

Publish order is: reviewed `vocab_terms`, reviewed `artwork_tag_links`, existing `artworks` derived-field updates, ready `category_catalog`, then audit. Use batches of at most 20 by default. Reject missing artwork rows instead of upserting them. Write a publish report containing environment ID, manifest hash, per-collection counts, conflicts, and before/after hashes. Expose a separate `--switch-catalog-pointer` operation that updates only `category_catalog_state/active` after audit and explicit confirmation.

Rollback order is: switch pointer back first when instructed, restore artwork derived-field preimages, restore or remove link/vocabulary/catalog rows scoped to the release, then audit. Default rollback is dry-run.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data-governance/cloudbase-publish-classification.mjs scripts/data-governance/cloudbase-publish-classification.test.mjs scripts/data-governance/cloudbase-rollback-classification.mjs scripts/data-governance/cloudbase-rollback-classification.test.mjs
git commit -m "feat: publish and rollback classification releases safely"
```

### Task 10: Category Catalog Runtime Service

**Files:**
- Create: `miniapp/services/categories.js`
- Create: `miniapp/services/categories.test.mjs`

**Interfaces:**
- Produces: `normalizeCategoryCatalogRows(rows, catalogVersion)`, `fetchActiveCategoryCatalog()`, `readCategoryCatalogCache(wxApi)`, `writeCategoryCatalogCache(wxApi, payload)`, `loadCategoryCatalog(options)`.
- Output: `{ catalogVersion, groups, source: 'cloud'|'cache', stale: boolean }` where each group is `{ key, name, tags }` and each tag is `{ id, label, count, sortOrder }`.

- [ ] **Step 1: Write catalog normalization and cache tests**

```javascript
const validGroups = [
  { key: 'style', name: '流派', tags: [{ id: 'style-a', label: '流派A', count: 1, sortOrder: 10 }] },
  { key: 'subject', name: '题材', tags: [] },
  { key: 'decade', name: '年代', tags: [] },
];

function createStorageWx(payload) {
  return {
    getStorageSync() { return payload; },
    setStorageSync() {},
  };
}

test('normalizes one active catalog into three sorted groups', () => {
  const result = normalizeCategoryCatalogRows([
    { catalog_version: 'v1', publish_status: 'ready', group: 'decade', term_id: 'period-1900s', label: '1900s', artwork_count: 2, display_enabled: true },
    { catalog_version: 'v1', publish_status: 'ready', group: 'decade', term_id: 'period-1930s', label: '1930s', artwork_count: 1, display_enabled: true },
    { catalog_version: 'v1', publish_status: 'ready', group: 'style', term_id: 'style-a', label: '流派A', artwork_count: 3, display_enabled: true, sort_order: 20 },
    { catalog_version: 'v2', publish_status: 'ready', group: 'subject', term_id: 'subject-other', label: '其他版本', artwork_count: 9, display_enabled: true },
  ], 'v1');
  assert.deepEqual(result.find((group) => group.key === 'decade').tags.map((tag) => tag.label), ['1930s', '1900s']);
  assert.equal(result.find((group) => group.key === 'style').tags[0].id, 'style-a');
  assert.equal(result.some((group) => group.tags.some((tag) => tag.id === 'subject-other')), false);
});

test('uses cache after a cloud failure but never imports fallback groups', async () => {
  const wxApi = createStorageWx({ schemaVersion: 1, catalogVersion: 'v1', groups: validGroups, cachedAt: '2026-07-19T00:00:00.000Z' });
  const result = await loadCategoryCatalog({ wxApi, fetchCatalog: async () => { throw new Error('offline'); } });
  assert.equal(result.source, 'cache');
  assert.equal(result.stale, true);
  assert.deepEqual(result.groups, validGroups);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test miniapp/services/categories.test.mjs`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the service with a fixed cache contract**

Use cache key `artArchive:categoryCatalog:v1`. Cache payload fields are `schemaVersion:1`, `catalogVersion`, `groups`, and `cachedAt`. `fetchActiveCategoryCatalog` reads `category_catalog_state/active`, then queries all `category_catalog` rows for that version in pages. `loadCategoryCatalog({ forceRefresh=false, wxApi=wx }={})` tries cloud first unless a non-stale in-memory value exists, writes successful results to cache, and falls back only to a structurally valid cache.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add miniapp/services/categories.js miniapp/services/categories.test.mjs
git commit -m "feat: load reviewed category catalog"
```

### Task 11: Strict Artwork Classification Queries

**Files:**
- Modify: `miniapp/services/artworks.js`
- Modify: `miniapp/services/artworks-normalized.test.mjs`

**Interfaces:**
- Produces: `normalizeCategoryFilters(filters)`, `getSelectedClassificationIds(filters)`, `createCategoryWhereClause(db, filters)`, `fetchArtworksByCategoryFilters(filters, options)`, `countArtworksByCategoryFilters(filters)`.

- [ ] **Step 1: Write no/single/double/triple filter tests**

```javascript
test('category filters use one classification_ids all-query for AND semantics', async () => {
  const { service } = loadArtworksService([
    { _id: 'a', status: 'published', classification_ids: ['style-a', 'subject-a', 'period-1900s'] },
    { _id: 'b', status: 'published', classification_ids: ['style-a', 'subject-a'] },
    { _id: 'c', status: 'published', classification_ids: ['style-a'] },
  ]);
  const filters = { style: 'style-a', subject: 'subject-a', decade: 'period-1900s' };
  const page = await service.fetchArtworksByCategoryFilters(filters, { pageSize: 20, skip: 0 });
  const count = await service.countArtworksByCategoryFilters(filters);
  assert.deepEqual(page.map((row) => row._id), ['a']);
  assert.equal(count, 1);
  assert.deepEqual(service.getSelectedClassificationIds(filters), ['style-a', 'subject-a', 'period-1900s']);
});
```

Add empty-filter and duplicate/blank normalization tests. Record both `orderBy` calls in the fake database and assert `created_at desc`, then `_id desc`.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test miniapp/services/artworks-normalized.test.mjs`

Expected: FAIL because strict category query exports are absent.

- [ ] **Step 3: Implement strict APIs without touching legacy tag APIs**

```javascript
function getSelectedClassificationIds(filters) {
  const normalized = normalizeCategoryFilters(filters);
  return [normalized.style, normalized.subject, normalized.decade]
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function createCategoryWhereClause(db, filters) {
  const selectedIds = getSelectedClassificationIds(filters);
  return selectedIds.length
    ? { status: 'published', classification_ids: db.command.all(selectedIds) }
    : { status: 'published' };
}
```

Fetch and count must share this clause builder. Fetch uses `.orderBy('created_at','desc').orderBy('_id','desc').skip(skip).limit(pageSize)`. Do not call `fetchArtworksByTag`, label fallback, or local fallback from the new APIs.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all normalized artwork tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add miniapp/services/artworks.js miniapp/services/artworks-normalized.test.mjs
git commit -m "feat: query artworks by reviewed classifications"
```

### Task 12: Three-Group Category Page

**Files:**
- Modify: `miniapp/pages/category/category.js`
- Modify: `miniapp/pages/category/category.wxml`
- Modify: `miniapp/pages/category/category.wxss`
- Modify: `miniapp/pages/category/category.test.mjs`

**Interfaces:**
- Consumes: `loadCategoryCatalog`, `fetchArtworksByCategoryFilters`, `countArtworksByCategoryFilters`.
- Page methods: `loadCatalog`, `selectTag`, `clearFilters`, `applyFilters`, `loadResults`, `retryCatalog`, `retryResults`, `toggleGroup`, `loadMore`, `openDetail`.

- [ ] **Step 1: Replace current two tests with the complete interaction suite**

Test: initial catalog then all published results; one selection per group; same tag clears; other same-group tag replaces; cross-group filters are passed together; clear filters; legacy stored home tag resolves only through the loaded reviewed catalog; unknown stored label is discarded; catalog failure never loads `fallbackGroups`; result failure preserves selections and already loaded rows; stale request responses are ignored; load-more deduplicates by stable ID; accurate count and empty state.

Use this interaction test as the core state assertion:

```javascript
test('category page applies one selection per group and clears a repeated tag', async () => {
  const filtersSeen = [];
  const page = loadCategoryPage({
    categoriesService: {
      loadCategoryCatalog: async () => ({
        catalogVersion: 'v1', source: 'cloud', stale: false,
        groups: [
          { key: 'style', name: '流派', tags: [{ id: 'style-a', label: '流派A', count: 2, sortOrder: 10 }] },
          { key: 'subject', name: '题材', tags: [{ id: 'subject-a', label: '题材A', count: 1, sortOrder: 10 }] },
          { key: 'decade', name: '年代', tags: [{ id: 'period-1900s', label: '1900s', count: 1, sortOrder: 1900 }] },
        ],
      }),
    },
    artworksService: {
      countArtworksByCategoryFilters: async (filters) => { filtersSeen.push({ ...filters }); return 1; },
      fetchArtworksByCategoryFilters: async () => [{ id: 'a1' }],
      normalizeError: (error) => error.message,
    },
  });
  await page.onShow();
  await page.selectTag({ currentTarget: { dataset: { group: 'style', tagId: 'style-a' } } });
  await page.selectTag({ currentTarget: { dataset: { group: 'subject', tagId: 'subject-a' } } });
  assert.deepEqual(page.data.selectedFilters, { style: 'style-a', subject: 'subject-a', decade: '' });
  await page.selectTag({ currentTarget: { dataset: { group: 'style', tagId: 'style-a' } } });
  assert.deepEqual(page.data.selectedFilters, { style: '', subject: 'subject-a', decade: '' });
  assert.ok(filtersSeen.some((filters) => filters.style === 'style-a' && filters.subject === 'subject-a'));
});
```

Use deferred promises in a second test:

```javascript
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('ignores a stale result response after filters change', async () => {
  const first = deferred();
  let fetchCount = 0;
  const page = loadCategoryPage({
    categoriesService: {
      loadCategoryCatalog: async () => ({
        catalogVersion: 'v1', source: 'cloud', stale: false,
        groups: [{ key: 'style', name: '流派', tags: [{ id: 'style-a', label: '流派A', count: 1, sortOrder: 10 }] }],
      }),
    },
    artworksService: {
      countArtworksByCategoryFilters: async () => 1,
      fetchArtworksByCategoryFilters: async () => {
        fetchCount += 1;
        return fetchCount === 1 ? first.promise : [{ id: 'new' }];
      },
      normalizeError: (error) => error.message,
    },
  });
  const initial = page.onShow();
  await page.selectTag({ currentTarget: { dataset: { group: 'style', tagId: 'style-a' } } });
  first.resolve([{ id: 'old' }]);
  await initial;
  assert.deepEqual(page.data.artworks.map((row) => row.id), ['new']);
});
```

- [ ] **Step 2: Run page tests and confirm RED**

Run: `node --test miniapp/pages/category/category.test.mjs`

Expected: FAIL because the current page has one global `activeTag`, hardcoded groups, and fallback results.

- [ ] **Step 3: Implement state and request invalidation**

Use this state contract:

```javascript
data: {
  groups: [],
  groupsView: [],
  expandedGroups: {},
  selectedFilters: { style: '', subject: '', decade: '' },
  hasActiveFilters: false,
  catalogLoading: true,
  catalogError: '',
  catalogSource: '',
  catalogStale: false,
  artworks: [],
  totalCount: 0,
  resultCountText: '0件作品',
  skip: 0,
  hasMore: false,
  loading: false,
  loadingMore: false,
  resultError: '',
}
```

Store `this.resultsRequestSerial` outside `data`. Increment it before every non-append result load and check the captured serial before every `setData`. `selectTag` receives `data-group` and `data-tag-id`; it replaces or clears only that group. Deduplicate appended works by `_id || id || supabase_id`.

- [ ] **Step 4: Update WXML/WXSS without redesigning the page**

Use `wx:key="id"`, `tag.label`, and `tag.selected`; preserve collapsible horizontal chips and the two-column artwork grid. Add a visible “清除筛选” control only when `hasActiveFilters`. Separate catalog error from result error. Empty copy remains “暂无符合条件的作品”; do not claim 0 results when a request failed.

- [ ] **Step 5: Run focused and adjacent regression tests**

```powershell
node --test miniapp/services/categories.test.mjs miniapp/services/artworks-normalized.test.mjs miniapp/pages/category/category.test.mjs
node --test miniapp/pages/tag/tag.test.mjs miniapp/pages/home/home-search.test.mjs miniapp/pages/home/home-pagination.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add miniapp/pages/category/category.js miniapp/pages/category/category.wxml miniapp/pages/category/category.wxss miniapp/pages/category/category.test.mjs
git commit -m "feat: drive category page from reviewed classifications"
```

### Task 13: Project Commands, Operations Documentation, and Full Verification

**Files:**
- Modify: `package.json`
- Create: `scripts/run-node-tests.mjs`
- Create: `scripts/run-node-tests.test.mjs`
- Modify: `docs/art-data-import-checklist.md`
- Modify: `docs/art-data-normalization-acceptance.md`
- Create: `docs/wechat-classification-cloud-operations.md`

**Interfaces:**
- Produces safe npm scripts: `test:data-governance`, `test:miniapp`, `classification:build`, `classification:snapshot`, `classification:audit`, `classification:indexes`, `classification:publish`, `classification:rollback`.

- [ ] **Step 1: Add scripts that never imply apply**

```json
{
  "test:data-governance": "node scripts/run-node-tests.mjs scripts/data-governance",
  "test:miniapp": "node scripts/run-node-tests.mjs miniapp",
  "classification:build": "node scripts/data-governance/build-classification-release.mjs",
  "classification:snapshot": "node scripts/data-governance/export-classification-source.mjs",
  "classification:audit": "node scripts/data-governance/audit-artwork-classification.mjs",
  "classification:indexes": "node scripts/data-governance/cloudbase-classification-indexes.mjs",
  "classification:publish": "node scripts/data-governance/cloudbase-publish-classification.mjs",
  "classification:rollback": "node scripts/data-governance/cloudbase-rollback-classification.mjs"
}
```

Create the runner with this interface and behavior:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function findTestFiles(roots = []) {
  const files = [];
  const visit = (entry) => {
    const stat = fs.statSync(entry);
    if (stat.isDirectory()) {
      fs.readdirSync(entry).sort().forEach((name) => visit(path.join(entry, name)));
    } else if (entry.endsWith('.test.mjs')) {
      files.push(path.resolve(entry));
    }
  };
  roots.forEach((root) => visit(path.resolve(root)));
  return files.sort();
}

export function runCli(argv = process.argv.slice(2)) {
  if (!argv.length) throw new Error('At least one test root is required.');
  const files = findTestFiles(argv);
  if (!files.length) throw new Error('No .test.mjs files found.');
  return spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' }).status ?? 1;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) process.exitCode = runCli();
```

Test `findTestFiles` with a temporary nested directory:

```javascript
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findTestFiles } from './run-node-tests.mjs';

test('findTestFiles returns nested tests in lexical order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'art-tests-'));
  const nested = path.join(root, 'nested');
  fs.mkdirSync(nested);
  fs.writeFileSync(path.join(root, 'b.test.mjs'), '', 'utf8');
  fs.writeFileSync(path.join(nested, 'a.test.mjs'), '', 'utf8');
  fs.writeFileSync(path.join(root, 'ignore.mjs'), '', 'utf8');
  assert.deepEqual(findTestFiles([root]), [
    path.resolve(root, 'b.test.mjs'),
    path.resolve(nested, 'a.test.mjs'),
  ].sort());
  fs.rmSync(root, { recursive: true, force: true });
});
```

- [ ] **Step 2: Correct and expand operations documentation**

Remove the invalid `audit-normalized-cloud-data.mjs --dry-run` example; the audit is intrinsically read-only. Document exact flags, artifact names, pointer switching, 20-row pilot, 900-byte gate, index validation, and rollback order. State that reviewed source files are versioned while snapshots/manifests remain under ignored `csv/cloudbase/classification/`.

- [ ] **Step 3: Run every automated gate**

```powershell
npm run test:data-governance
npm run test:miniapp
npm run check
npm run typecheck
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0. Record exact test counts in the implementation handoff.

- [ ] **Step 4: Commit**

```powershell
git add package.json package-lock.json scripts/run-node-tests.mjs scripts/run-node-tests.test.mjs docs/art-data-import-checklist.md docs/art-data-normalization-acceptance.md docs/wechat-classification-cloud-operations.md
git commit -m "docs: add classification operations and verification gates"
```

### Task 14: Governed Vocabulary Review, Experience Pilot, and Production Release

**Files:**
- Create: `governance/classification/reviewed-vocab-terms.jsonl`
- Create: `governance/classification/reviewed-artwork-tag-links.jsonl`
- Generated, ignored: `csv/cloudbase/classification/classification-20260719-v1/*`

**Interfaces:**
- Consumes all previous tasks.
- Produces a reviewed release bundle, experience-environment evidence, production audit, and rollback evidence.

- [ ] **Step 1: Export a fresh production source snapshot without writes**

```powershell
$batch = 'classification-20260719-v1'
$out = "csv/cloudbase/classification/$batch/source"
npm run classification:snapshot -- --env-id cloudbase-d6gvny27ib05e0ede --out $out
```

Expected: QUERY-only report, current collection counts, source manifest SHA-256, and no collection creation/update/delete.

- [ ] **Step 2: Generate candidates and complete the reviewed source files**

Run candidate generation against the fresh snapshot. Review every distinct raw tag. Move only unambiguous terms into `reviewed-vocab-terms.jsonl`; keep ambiguous terms as candidates in the ignored batch report. Ensure every visible reviewed term has a stable prefixed ID, aliases with one unique owner, `display_enabled`, `sort_order`, evidence, reviewer, and review timestamp. Review candidate title/description relationships individually before placing them in `reviewed-artwork-tag-links.jsonl`.

Validate:

```powershell
node scripts/data-governance/validate-reviewed-data.mjs --vocab-terms governance/classification/reviewed-vocab-terms.jsonl --artwork-tag-links governance/classification/reviewed-artwork-tag-links.jsonl
```

Expected: `ok:true`, zero duplicate aliases, zero broken references, and zero unreviewed rows in the reviewed files.

- [ ] **Step 3: Commit the reviewed governance sources before any cloud write**

```powershell
git add governance/classification/reviewed-vocab-terms.jsonl governance/classification/reviewed-artwork-tag-links.jsonl
git commit -m "data: review artwork classification vocabulary"
```

- [ ] **Step 4: Build and audit the release bundle**

```powershell
$batch = 'classification-20260719-v1'
$source = "csv/cloudbase/classification/$batch/source"
$release = "csv/cloudbase/classification/$batch/release"
npm run classification:build -- --artworks "$source/artworks.jsonl" --vocab governance/classification/reviewed-vocab-terms.jsonl --reviewed-links governance/classification/reviewed-artwork-tag-links.jsonl --classification-version classification-v1 --source-batch $batch --out $release
npm run classification:audit -- --release $release --strict
```

Expected: audit passes every hard gate; coverage is reported; unresolved and date-completion queues are preserved; no original field appears in artwork update operations.

- [ ] **Step 5: Pause for the experience-environment mutation gate**

Require `CLOUDBASE_EXPERIENCE_ENV_ID` and explicit user approval. Then audit/create indexes and apply a 20-row pilot:

```powershell
$experienceEnv = $env:CLOUDBASE_EXPERIENCE_ENV_ID
if (-not $experienceEnv) { throw 'CLOUDBASE_EXPERIENCE_ENV_ID is required' }
$release = 'csv/cloudbase/classification/classification-20260719-v1/release'
$manifest = Get-Content -Raw "$release/manifest.json" | ConvertFrom-Json
$sha = $manifest.manifest_sha256
npm run classification:indexes -- --env-id $experienceEnv
npm run classification:indexes -- --env-id $experienceEnv --confirm-env $experienceEnv --apply
npm run classification:publish -- --release $release --env-id $experienceEnv --confirm-env $experienceEnv --expected-manifest-sha256 $sha --limit 20 --apply
npm run classification:audit -- --env-id $experienceEnv --strict
```

Expected: single/double/triple `db.command.all` fetch and count queries pass, both indexes are usable, ordering is stable, and no source fields change.

- [ ] **Step 6: Verify the miniapp in Developer Tools and devices**

In WeChat Developer Tools, verify catalog load, unfiltered results, one/two/three-group AND, selecting again to clear, clear-all, zero results, quick switching, pagination, weak network, offline cache, catalog failure, and retry. Complete one Android and one iOS device pass. If the array compound index fails in the target environment, stop and write a separate implementation plan for `artwork_category_filter_index`; do not silently restore 44 in-document keys.

- [ ] **Step 7: Pause for production apply and pointer-switch gates**

After explicit approval, apply in batches while the old page remains active. Audit after vocab/links, artwork patches, catalog, and indexes. Only then switch `category_catalog_state/active` and deploy the page. Use the exact production environment ID in both confirmation flags and the audited manifest hash.

```powershell
$productionEnv = 'cloudbase-d6gvny27ib05e0ede'
$release = 'csv/cloudbase/classification/classification-20260719-v1/release'
$manifest = Get-Content -Raw "$release/manifest.json" | ConvertFrom-Json
$sha = $manifest.manifest_sha256
npm run classification:indexes -- --env-id $productionEnv
npm run classification:indexes -- --env-id $productionEnv --confirm-env $productionEnv --apply
npm run classification:publish -- --release $release --env-id $productionEnv --confirm-env $productionEnv --expected-manifest-sha256 $sha --apply
npm run classification:audit -- --env-id $productionEnv --release $release --strict
npm run classification:publish -- --release $release --env-id $productionEnv --confirm-env $productionEnv --expected-manifest-sha256 $sha --switch-catalog-pointer --apply
npm run classification:audit -- --env-id $productionEnv --release $release --strict
```

Expected: each command exits 0, the final audit resolves exactly one active catalog version, and the source-field checksum remains unchanged.

- [ ] **Step 8: Exercise rollback dry-run and close the release**

Run rollback without `--apply`, verify the affected IDs and preimages, then retain the rollback report. Do not apply rollback unless the release is rejected or a production issue occurs. Final acceptance requires exact catalog/query count reconciliation, stable pagination, no visible unreviewed terms, and unchanged original ten fields.

```powershell
$productionEnv = 'cloudbase-d6gvny27ib05e0ede'
$release = 'csv/cloudbase/classification/classification-20260719-v1/release'
$manifest = Get-Content -Raw "$release/manifest.json" | ConvertFrom-Json
npm run classification:rollback -- --release $release --env-id $productionEnv --expected-manifest-sha256 $manifest.manifest_sha256
```

Expected: `dry_run:true`, zero writes, affected IDs equal the release manifest, and every derived field has a deterministic `$set` or `$unset` preimage operation.

---

## Execution Order and Parallelism

- Tasks 1 and 2 may run in parallel in separate subagents.
- Task 3 depends on Task 1.
- Task 4 depends on Tasks 1–3.
- Task 5 depends on Tasks 1 and 4.
- Task 6 depends on Task 5.
- Task 7 may begin after Task 1, but its full audit fixtures depend on Tasks 5–6.
- Tasks 8 and 9 depend on Tasks 6–7 and should receive separate security reviews.
- Tasks 10 and 11 may run in parallel after their interfaces are frozen by Tasks 1 and 6.
- Task 12 depends on Tasks 10–11.
- Task 13 depends on Tasks 1–12.
- Task 14 is strictly last and includes all external mutation gates.

Each coding task receives a fresh implementation subagent, then a specification-compliance review and a code-quality review before the next dependent task starts.
