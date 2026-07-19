# Miniapp Artwork Classification MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first reliable miniapp classification page using reviewed style, subject, and decade data, while preserving source artwork fields and retaining a basic dry-run/rollback path.

**Architecture:** Extend the existing governance scripts instead of building a general classification platform. A fresh CloudBase artwork export feeds a reviewed vocabulary, deterministic decade parsing, reviewed artwork-tag links, bounded derived fields, and one versioned category catalog; the miniapp reads that catalog and filters `classification_ids` with `db.command.all(selectedIds)`.

**Tech Stack:** Node.js ESM governance scripts, `node:test`, JSONL review files, `@cloudbase/manager-node`, WeChat Cloud Database, WeChat native miniapp CommonJS services/pages.

## Global Constraints

- Target only `miniapp/`.
- Never overwrite `id,title_cn,title_en,artist,location,year_and_place,medium,dimensions,description,tags`.
- Visible groups are exactly style/流派, subject/题材, and decade/年代.
- One selection per group; repeated selection clears; different groups use AND.
- Only reviewed terms and reviewed relationships enter production-derived fields.
- Per artwork limits are style 2, subject 4, decade 2, and `classification_ids` 8.
- `classification_ids` order is style → subject → decade, with no duplicates and at most 900 UTF-8 bytes.
- Century, era, unknown, wide, invalid, and BCE dates do not receive invented decade values.
- The category page never uses hardcoded `fallbackGroups` or label fallback.
- CloudBase writes default to dry-run and require explicit `--apply`; a rollback JSONL is generated first.
- Use a fresh CloudBase artwork snapshot; do not publish the stale 2,039-row local candidate outputs.
- Defer generic schema infrastructure, index configuration-as-code, SHA/preimage concurrency protection, automated AI labeling, and the materialized-index fallback to the long-term plan.

---

### Task 1: Minimal Classification Rules and Decade Parser

**Files:**
- Create: `scripts/data-governance/classification-core.mjs`
- Create: `scripts/data-governance/classification-core.test.mjs`
- Modify: `scripts/data-governance/validate-reviewed-data.mjs`
- Modify: `scripts/data-governance/validate-reviewed-data.test.mjs`

**Interfaces:**
- Produces: `VOCAB_TYPES`, `CLASSIFICATION_LIMITS`, `normalizeClassificationText(value)`, `getVisibleGroup(term)`, `parseArtworkDecades(value, options)`, `validateArtworkTagLinks(records, context)`.

- [ ] **Step 1: Write failing date and reviewed-link tests**

```javascript
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLASSIFICATION_LIMITS,
  getVisibleGroup,
  parseArtworkDecades,
} from './classification-core.mjs';

describe('classification core', () => {
  const parse = (value) => parseArtworkDecades(value, { currentYear: 2026 });

  it('resolves only deterministic decades', () => {
    assert.deepEqual(parse('1903，巴黎').decadeIds, ['period-1900s']);
    assert.deepEqual(parse('约1903年').decadeIds, ['period-1900s']);
    assert.deepEqual(parse('1896—1902').decadeIds, ['period-1890s', 'period-1900s']);
    assert.equal(parse('19世纪').status, 'needs_review');
    assert.equal(parse('江户时代').status, 'needs_review');
    assert.equal(parse('1890—1908').status, 'needs_review');
    assert.equal(parse('2030').status, 'invalid');
  });

  it('maps only the three visible groups', () => {
    assert.equal(getVisibleGroup({ type: 'style' }), 'style');
    assert.equal(getVisibleGroup({ type: 'subject' }), 'subject');
    assert.equal(getVisibleGroup({ type: 'period', period_kind: 'decade' }), 'decade');
    assert.equal(getVisibleGroup({ type: 'medium' }), '');
    assert.deepEqual(CLASSIFICATION_LIMITS, { style: 2, subject: 4, decade: 2, total: 8, indexedBytes: 900 });
  });
});
```

Extend `validate-reviewed-data.test.mjs` with exact fixtures for duplicate aliases, missing artwork/term references, duplicate `artwork_id + tag_id`, invalid status, and type mismatch.

- [ ] **Step 2: Run tests and confirm RED**

```powershell
node --test scripts/data-governance/classification-core.test.mjs scripts/data-governance/validate-reviewed-data.test.mjs
```

Expected: FAIL because the core module and artwork-tag validator do not exist.

- [ ] **Step 3: Implement the minimal shared rules**

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
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

export function getVisibleGroup(term) {
  if (term?.type === 'style') return 'style';
  if (term?.type === 'subject') return 'subject';
  if (term?.type === 'period' && term?.period_kind === 'decade') return 'decade';
  return '';
}
```

`parseArtworkDecades` accepts explicit four-digit years, `约/c./circa`, and two-year ranges joined by `-`, `–`, `—`, or `至`. A range resolves only if it stays in one decade or crosses exactly two adjacent decades with span at most ten years. It returns `{status, decadeIds, evidence, reason}`. Update the validator's type enum and add `validateArtworkTagLinks(records,{artworkIds,vocabById})`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data-governance/classification-core.mjs scripts/data-governance/classification-core.test.mjs scripts/data-governance/validate-reviewed-data.mjs scripts/data-governance/validate-reviewed-data.test.mjs
git commit -m "feat: add minimal classification rules"
```

### Task 2: Reviewed Links and Derived Artwork Fields

**Files:**
- Modify: `scripts/data-governance/generate-vocab-candidates.mjs`
- Modify: `scripts/data-governance/generate-candidates.test.mjs`
- Modify: `scripts/data-governance/generate-artwork-links.mjs`
- Modify: `scripts/data-governance/generate-artwork-links.test.mjs`
- Modify: `scripts/data-governance/build-derived-artworks.mjs`
- Modify: `scripts/data-governance/build-derived-artworks.test.mjs`

**Interfaces:**
- Produces: `suggestTagTypes(label)`, `generateArtworkClassificationLinks(artworks, vocabTerms, options)`, `buildClassificationFields(links, vocabById, options)`.
- Expands: `buildDerivedArtworkRecords` and `buildRollbackRecords`.

- [ ] **Step 1: Write failing conservative-candidate and projection tests**

```javascript
it('does not classify unknown labels as subject by default', () => {
  const rows = generateVocabCandidates([{ _id: 'a1', tags: ['印象派', '风景', '葛饰北斋'] }]);
  const byLabel = new Map(rows.map((row) => [row.label_zh, row]));
  assert.deepEqual(byLabel.get('印象派').suggested_types, ['style']);
  assert.deepEqual(byLabel.get('风景').suggested_types, ['subject']);
  assert.deepEqual(byLabel.get('葛饰北斋').suggested_types, []);
});

it('projects reviewed visible fields in fixed order', () => {
  const rows = buildDerivedArtworkRecords({
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
    sourceBatch: 'classification-20260719-v1',
    classifiedAt: '2026-07-19T00:00:00.000Z',
  });
  assert.deepEqual(rows[0].style_ids, ['style-impressionism']);
  assert.deepEqual(rows[0].subject_ids, ['subject-seascape']);
  assert.deepEqual(rows[0].classification_ids, ['style-impressionism', 'subject-seascape']);
  assert.deepEqual(rows[0].tag_ids, ['subject-seascape', 'style-impressionism', 'medium-oil']);
});
```

Add tests proving exact reviewed aliases and deterministic dates create reviewed links, ambiguous aliases create conflicts, and 2/4/2/8 or 900-byte overflow throws instead of truncating.

- [ ] **Step 2: Run focused tests and confirm RED**

```powershell
node --test scripts/data-governance/generate-candidates.test.mjs scripts/data-governance/generate-artwork-links.test.mjs scripts/data-governance/build-derived-artworks.test.mjs
```

Expected: FAIL because candidates default to subject and derived classification fields are absent.

- [ ] **Step 3: Implement the reviewed-only pipeline**

Remove default-to-subject. Candidate rows use `suggested_types` and remain candidate. Build a reviewed alias lookup that reports multiple owners instead of choosing the first. Exact raw-tag matches and deterministic decade parsing produce reviewed links; title/description matches remain candidate. Project all reviewed backend terms into `tag_ids`, but only visible reviewed terms into `style_ids`, `subject_ids`, `decade_ids`, and their ordered union `classification_ids`.

Rollback rows record `{exists,value}` for every derived field so rollback can choose `$set` or `$unset`. Preserve existing artist behavior.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add scripts/data-governance/generate-vocab-candidates.mjs scripts/data-governance/generate-candidates.test.mjs scripts/data-governance/generate-artwork-links.mjs scripts/data-governance/generate-artwork-links.test.mjs scripts/data-governance/build-derived-artworks.mjs scripts/data-governance/build-derived-artworks.test.mjs
git commit -m "feat: derive reviewed artwork classifications"
```

### Task 3: Fresh Snapshot, Reviewed Vocabulary, and Category Catalog

**Files:**
- Create: `scripts/data-governance/export-classification-source.mjs`
- Create: `scripts/data-governance/export-classification-source.test.mjs`
- Create: `scripts/data-governance/build-category-catalog.mjs`
- Create: `scripts/data-governance/build-category-catalog.test.mjs`
- Create: `governance/classification/reviewed-vocab-terms.jsonl`
- Create: `governance/classification/reviewed-artwork-tag-links.jsonl`
- Generated, ignored: `csv/cloudbase/classification/classification-20260719-v1/*`

**Interfaces:**
- Produces: `exportClassificationSource(database, options)`, `buildCategoryCatalog({artworks,patches,vocabTerms,catalogVersion,generatedAt})`.
- Catalog rows: `{_id,catalog_version,group,term_id,label,artwork_count,sort_order,display_enabled,publish_status,generated_at}`.

- [ ] **Step 1: Write read-only export and catalog-count tests**

```javascript
it('uses QUERY commands only for the source export', async () => {
  const commands = [];
  const database = {
    async runCommands(payload) {
      commands.push(...payload.MgoCommands);
      return { Data: ['[]'] };
    },
  };
  await exportClassificationSource(database, { collection: 'artworks', pageSize: 1000 });
  assert.ok(commands.length > 0);
  assert.ok(commands.every((command) => command.CommandType === 'QUERY'));
});

it('counts only published artworks in the catalog', () => {
  const result = buildCategoryCatalog({
    artworks: [{ _id: 'a1', status: 'published' }, { _id: 'a2', status: 'draft' }],
    patches: [{ _id: 'a1', style_ids: ['style-a'] }, { _id: 'a2', style_ids: ['style-a'] }],
    vocabTerms: [{ _id: 'style-a', type: 'style', label_zh: '流派A', review_status: 'reviewed', display_enabled: true, sort_order: 10 }],
    catalogVersion: 'classification-v1',
    generatedAt: '2026-07-19T00:00:00.000Z',
  });
  assert.equal(result.rows[0].artwork_count, 1);
  assert.equal(result.pointer.active_catalog_version, 'classification-v1');
});
```

- [ ] **Step 2: Run tests and confirm RED**

```powershell
node --test scripts/data-governance/export-classification-source.test.mjs scripts/data-governance/build-category-catalog.test.mjs
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement export and catalog generation**

The exporter requires explicit `--env-id`, reads only the `artworks` collection, sorts by stable ID, and writes `artworks.jsonl` plus a count report. The catalog omits zero-count or non-reviewed terms; style/subject use `sort_order`, and decades sort newest first. It also emits a candidate `category_catalog_state/active` pointer, but does not write CloudBase.

- [ ] **Step 4: Export the current snapshot and review every distinct tag**

```powershell
$batch = 'classification-20260719-v1'
$source = "csv/cloudbase/classification/$batch/source"
node scripts/data-governance/export-classification-source.mjs --env-id cloudbase-d6gvny27ib05e0ede --out $source
node scripts/data-governance/generate-vocab-candidates.mjs --input "$source/artworks.jsonl" --out "csv/cloudbase/classification/$batch/candidate-tags.jsonl"
```

Review all distinct terms. Put only unambiguous terms in `reviewed-vocab-terms.jsonl`; keep unresolved terms in the ignored candidate file. Every visible term needs a stable prefixed ID, unique aliases, `review_status:'reviewed'`, `display_enabled`, and `sort_order`. Put only individually reviewed title/description relationships in `reviewed-artwork-tag-links.jsonl`.

- [ ] **Step 5: Generate and inspect dry-run artifacts**

Run the link and derived scripts against the fresh snapshot and reviewed files. Generate `artworks-patch.jsonl`, `artworks-rollback.jsonl`, `category-catalog.jsonl`, `category-catalog-state.json`, `date-completion-queue.jsonl`, `conflicts.jsonl`, and `summary.json`. Require zero hard conflicts, zero unreviewed visible relations, correct 2/4/2 limits, and exact catalog-count reconciliation.

- [ ] **Step 6: Run tests, commit code and reviewed sources**

```powershell
node --test scripts/data-governance/export-classification-source.test.mjs scripts/data-governance/build-category-catalog.test.mjs
git add scripts/data-governance/export-classification-source.mjs scripts/data-governance/export-classification-source.test.mjs scripts/data-governance/build-category-catalog.mjs scripts/data-governance/build-category-catalog.test.mjs governance/classification/reviewed-vocab-terms.jsonl governance/classification/reviewed-artwork-tag-links.jsonl
git commit -m "data: build reviewed classification catalog"
```

### Task 4: Strict Miniapp Catalog and Artwork Services

**Files:**
- Create: `miniapp/services/categories.js`
- Create: `miniapp/services/categories.test.mjs`
- Modify: `miniapp/services/artworks.js`
- Modify: `miniapp/services/artworks-normalized.test.mjs`

**Interfaces:**
- Produces: `loadCategoryCatalog(options) -> {catalogVersion,groups,source,stale}`.
- Produces: `getSelectedClassificationIds(filters)`, `fetchArtworksByCategoryFilters(filters,options)`, `countArtworksByCategoryFilters(filters)`.

- [ ] **Step 1: Write failing catalog and AND-query tests**

```javascript
test('category filters require all selected classification ids', async () => {
  const { service } = loadArtworksService([
    { _id: 'a', status: 'published', classification_ids: ['style-a', 'subject-a', 'period-1900s'] },
    { _id: 'b', status: 'published', classification_ids: ['style-a', 'subject-a'] },
  ]);
  const filters = { style: 'style-a', subject: 'subject-a', decade: 'period-1900s' };
  const rows = await service.fetchArtworksByCategoryFilters(filters, { pageSize: 20, skip: 0 });
  assert.deepEqual(rows.map((row) => row._id), ['a']);
  assert.equal(await service.countArtworksByCategoryFilters(filters), 1);
});
```

In `categories.test.mjs`, cover active pointer loading, ready/enabled/positive-count filtering, style/subject ordering, decade descending, cloud success cache, cloud failure cache, invalid cache rejection, and no `fallbackGroups` import.

- [ ] **Step 2: Run tests and confirm RED**

```powershell
node --test miniapp/services/categories.test.mjs miniapp/services/artworks-normalized.test.mjs
```

Expected: FAIL because the catalog service and strict filter APIs do not exist.

- [ ] **Step 3: Implement the two focused services**

Catalog cache key is `artArchive:categoryCatalog:v1`. Fetch `category_catalog_state/active`, then that version's ready catalog rows. Cache only normalized data. On cloud failure, return a valid cache with `stale:true`; otherwise reject.

```javascript
function getSelectedClassificationIds(filters) {
  return [filters?.style, filters?.subject, filters?.decade]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
}

function createCategoryWhereClause(db, filters) {
  const ids = getSelectedClassificationIds(filters);
  return ids.length
    ? { status: 'published', classification_ids: db.command.all(ids) }
    : { status: 'published' };
}
```

Fetch uses the same clause as count and orders by `created_at desc`, then `_id desc`. Keep old tag APIs for the separate tag page, but do not call them from the category page.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add miniapp/services/categories.js miniapp/services/categories.test.mjs miniapp/services/artworks.js miniapp/services/artworks-normalized.test.mjs
git commit -m "feat: add strict classification services"
```

### Task 5: Database-Driven Category Page

**Files:**
- Modify: `miniapp/pages/category/category.js`
- Modify: `miniapp/pages/category/category.wxml`
- Modify: `miniapp/pages/category/category.wxss`
- Modify: `miniapp/pages/category/category.test.mjs`

**Interfaces:**
- Consumes: `loadCategoryCatalog`, `fetchArtworksByCategoryFilters`, `countArtworksByCategoryFilters`.
- Page methods: `loadCatalog`, `selectTag`, `clearFilters`, `applyFilters`, `loadResults`, `loadMore`, `retryCatalog`, `retryResults`, `toggleGroup`, `openDetail`.

- [ ] **Step 1: Write failing interaction tests**

```javascript
test('selects, replaces, clears, and combines category filters', async () => {
  const filtersSeen = [];
  const page = loadCategoryPage({
    catalog: {
      catalogVersion: 'v1', source: 'cloud', stale: false,
      groups: [
        { key: 'style', name: '流派', tags: [{ id: 'style-a', label: '流派A', count: 2 }] },
        { key: 'subject', name: '题材', tags: [{ id: 'subject-a', label: '题材A', count: 1 }] },
        { key: 'decade', name: '年代', tags: [{ id: 'period-1900s', label: '1900s', count: 1 }] },
      ],
    },
    onFilter: async (filters) => { filtersSeen.push({ ...filters }); return [{ id: 'a1' }]; },
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

Also test clear-all, zero results, result errors preserving selection, unknown legacy stored tag rejection, stale request response suppression, and duplicate-free load-more.

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test miniapp/pages/category/category.test.mjs`

Expected: FAIL because the page still has one hardcoded `activeTag` and fallback groups.

- [ ] **Step 3: Implement page state and events**

Use `selectedFilters:{style:'',subject:'',decade:''}`, `groups`, `groupsView`, `catalogError`, `resultError`, `artworks`, `totalCount`, `skip`, `hasMore`, `loading`, and `loadingMore`. Keep `resultsRequestSerial` outside `data` and ignore responses whose captured serial is stale. Resolve the home page's stored label only against the loaded reviewed catalog.

- [ ] **Step 4: Update WXML/WXSS minimally**

Render tag objects with `wx:key="id"`, `tag.label`, `tag.selected`, `data-group`, and `data-tag-id`. Preserve the existing collapsible chips and two-column artwork grid. Add “清除筛选” only when a filter is active. Use separate retry states for catalog and results. Remove all category-page fallback-result copy.

- [ ] **Step 5: Run focused and adjacent tests**

```powershell
node --test miniapp/services/categories.test.mjs miniapp/services/artworks-normalized.test.mjs miniapp/pages/category/category.test.mjs
node --test miniapp/pages/tag/tag.test.mjs miniapp/pages/home/home-search.test.mjs miniapp/pages/home/home-pagination.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add miniapp/pages/category/category.js miniapp/pages/category/category.wxml miniapp/pages/category/category.wxss miniapp/pages/category/category.test.mjs
git commit -m "feat: drive category page from cloud classifications"
```

### Task 6: Simple Apply/Rollback, Pilot, and Release Verification

**Files:**
- Create: `scripts/data-governance/cloudbase-apply-classification.mjs`
- Create: `scripts/data-governance/cloudbase-apply-classification.test.mjs`
- Modify: `package.json`
- Create: `docs/wechat-classification-mvp-operations.md`

**Interfaces:**
- Produces: `parseArgs(argv)`, `buildArtworkUpdates(patch, rollback)`, `runClassificationApply(database, options)`.
- CLI modes: default dry-run, `--apply`, and `--rollback`; env ID is mandatory for apply/rollback.

- [ ] **Step 1: Write failing safety and rollback tests**

```javascript
it('defaults to dry-run and rejects source-field updates', () => {
  assert.equal(parseArgs(['--in', 'release']).apply, false);
  assert.throws(() => buildArtworkUpdates([
    { _id: 'a1', title_cn: 'changed', style_ids: ['style-a'] },
  ], []), /source field/);
});

it('restores missing fields with unset and existing fields with set', () => {
  const result = buildRollbackUpdates([{
    _id: 'a1',
    previous: {
      style_ids: { exists: true, value: ['style-old'] },
      classification_ids: { exists: false, value: null },
    },
  }]);
  assert.deepEqual(result[0].set, { style_ids: ['style-old'] });
  assert.deepEqual(result[0].unset, ['classification_ids']);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `node --test scripts/data-governance/cloudbase-apply-classification.test.mjs`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the minimal safe writer**

Allow writes only to `vocab_terms`, `artwork_tag_links`, existing `artworks` derived fields, `category_catalog`, and `category_catalog_state/active`. Reject any artwork patch containing the ten source fields. Default batch size is 20. Apply order is vocabulary → links → artwork patch → catalog → pointer. Rollback restores artwork derived fields and removes only inserted documents listed in the rollback bundle. Print environment, mode, counts, and failures without printing credentials.

- [ ] **Step 4: Add safe npm commands and operations documentation**

Add scripts that do not include `--apply`:

```json
{
  "test:classification-mvp": "node --test scripts/data-governance/classification-core.test.mjs scripts/data-governance/generate-candidates.test.mjs scripts/data-governance/generate-artwork-links.test.mjs scripts/data-governance/build-derived-artworks.test.mjs scripts/data-governance/export-classification-source.test.mjs scripts/data-governance/build-category-catalog.test.mjs scripts/data-governance/cloudbase-apply-classification.test.mjs",
  "classification:mvp:apply": "node scripts/data-governance/cloudbase-apply-classification.mjs"
}
```

Document dry-run, 20-row pilot, full apply, pointer switch, rollback dry-run, and explicit rollback apply. Index creation remains a manual CloudBase console step; verify `status + classification_ids + created_at + _id` and `status + created_at + _id` in the experience environment before production.

- [ ] **Step 5: Run all automated checks**

```powershell
npm run test:classification-mvp
$miniappTests = Get-ChildItem -Path miniapp -Recurse -Filter '*.test.mjs' | ForEach-Object { $_.FullName }
node --test @miniappTests
npm run check
npm run typecheck
npm run build
git diff --check
```

Expected: every command exits 0. Record exact test counts.

- [ ] **Step 6: Run the experience 20-row pilot after explicit approval**

```powershell
$experienceEnv = $env:CLOUDBASE_EXPERIENCE_ENV_ID
if (-not $experienceEnv) { throw 'CLOUDBASE_EXPERIENCE_ENV_ID is required' }
$release = 'csv/cloudbase/classification/classification-20260719-v1/release'
npm run classification:mvp:apply -- --env-id $experienceEnv --in $release --limit 20
npm run classification:mvp:apply -- --env-id $experienceEnv --in $release --limit 20 --apply
```

Expected: dry-run and apply affect the same 20 IDs; original-field checksum is unchanged; no hard conflict exists. Verify unfiltered, single, double, and triple filters with both `get()` and `count()`.

- [ ] **Step 7: Complete Developer Tools and device acceptance**

Verify normal, empty, error, rapid-switch, pagination, weak-network, offline-cache, retry, and clear-filter states in WeChat Developer Tools. Complete one Android and one iOS pass.

- [ ] **Step 8: Pause for production apply**

Only after explicit approval, run dry-run against `cloudbase-d6gvny27ib05e0ede`, compare counts and IDs with the reviewed bundle, then run `--apply`. Immediately rerun count reconciliation and retain the rollback file. If any check fails, do not continue to page deployment.

- [ ] **Step 9: Commit**

```powershell
git add scripts/data-governance/cloudbase-apply-classification.mjs scripts/data-governance/cloudbase-apply-classification.test.mjs package.json package-lock.json docs/wechat-classification-mvp-operations.md
git commit -m "feat: add classification MVP release workflow"
```

---

## Deferred to the Long-Term Plan

- Generic JSON Schema coverage for every collection.
- Separate reusable snapshot, audit, publish, rollback, and index-management frameworks.
- Manifest SHA-256 and preimage concurrency checks.
- Automated index creation and index drift reporting.
- Independent materialized filter-index collection.
- Model-assisted image classification.
- Parent/child recursive subject filtering.
- Additional visible medium, technique, region, series, or rights groups.

The full reference remains `docs/superpowers/plans/2026-07-19-miniapp-artwork-classification.md`.
