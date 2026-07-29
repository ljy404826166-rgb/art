# WeChat Cloud Artists Data Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move artist profile information from local mock data into a reviewed WeChat Cloud Database `artists` collection, with reliable source tracking, manual review gates, and frontend fallback.

**Architecture:** Artist metadata becomes its own governed dataset in WeChat Cloud Database. The miniapp reads `artists` for artist list/detail pages, while related artworks continue to come from the existing `artworks` collection by matching reviewed aliases. Local mock data remains a fallback only, not the source of truth.

**Tech Stack:** WeChat Mini Program, WeChat Cloud Database, Node.js migration/validation scripts, JSON Lines import files, existing miniapp services/pages.

---

## Current State

The current artist information is local mock data:

- `miniapp/data/mock-artists.js` contains artist names, aliases, biography text, country, styles, periods, representative works, tags, and avatar text.
- `miniapp/services/artists.js` imports `mockArtists` and exposes `listArtists`, `filterArtists`, and `getArtistById`.
- `miniapp/pages/artists/artists` and `miniapp/pages/artist-detail/artist-detail` consume the local artist service.
- Related artworks are separate: `miniapp/services/artworks.js` queries WeChat Cloud Database `artworks` by artist aliases.

There is no confirmed frontend usage of a cloud `artists` collection in the current code path.

## Data Accuracy Principle

Do not import the current mock data as reviewed production data. The local data is useful as a candidate list, but each artist record must be checked against authority sources before being marked visible in the app.

Recommended authority sources:

- Getty ULAN: artist names, roles, nationality, dates, authority identifiers. The Getty ULAN page identifies ULAN as the Union List of Artist Names and notes Getty vocabulary data releases and API/linked-data availability.
- Wikidata Query Service: structured multilingual entity data, useful for cross-checking names, dates, country, and identifiers.
- VIAF: international name authority aggregation; useful for aliases and name variants. VIAF describes itself as combining multiple name authority files into a single OCLC-hosted authority service.
- Museum or institution pages: short biography context and representative works, using summaries rather than copied long passages.

Sources:

- Getty ULAN: https://www.getty.edu/research/tools/vocabularies/ulan/
- Wikidata Query Service: https://query.wikidata.org/
- VIAF: https://viaf.org/

## Target Cloud Collection

Collection name: `artists`

Minimum reviewed document:

```json
{
  "_id": "claude-monet",
  "name_zh": "克洛德·莫奈",
  "name_en": "Claude Monet",
  "birth_year": 1840,
  "death_year": 1926,
  "lifespan_text": "1840–1926",
  "country": "法国",
  "region": "欧洲",
  "styles": ["印象派"],
  "periods": ["19世纪"],
  "active_period": "19世纪后半叶",
  "representative_works": ["睡莲", "日出·印象", "干草堆"],
  "aliases": ["Claude Monet", "Monet", "克洛德·莫奈", "莫奈"],
  "bio_zh": "法国印象派代表画家，长期关注自然光线、空气和时间变化。他的系列作品以细腻的色彩观察和开放笔触建立了现代绘画的重要观看方式。",
  "tags": ["印象派", "法国艺术", "光色研究"],
  "avatar_text": "莫",
  "authority_ids": {
    "ulan": "",
    "wikidata": "",
    "viaf": ""
  },
  "sources": [
    {
      "title": "Getty ULAN",
      "url": "https://www.getty.edu/research/tools/vocabularies/ulan/",
      "fields": ["name_en", "birth_year", "death_year"]
    }
  ],
  "review_status": "reviewed",
  "reviewed_by": "local-review",
  "reviewed_at": "2026-06-27",
  "updated_at": "2026-06-27"
}
```

Visibility rule:

- `review_status: "reviewed"` records are visible in production UI.
- `review_status: "candidate"` records can be imported for review, but should not be shown by default.
- `review_status: "rejected"` records stay hidden.

## Collection Permissions

Recommended initial rule:

- Miniapp client may read `artists` where `review_status == "reviewed"`.
- Miniapp client must not write to `artists`.
- Imports and updates should be done manually through WeChat Cloud Console or an audited script with explicit `--apply`.

This keeps the collection public-read for approved data while avoiding accidental client-side edits.

## File Structure

Create or modify these files during implementation:

- Create: `docs/artist-data-governance.md`
  - Human-facing data rules, source rules, review process, and import checklist.
- Create: `miniapp/data/artists.schema.json`
  - Machine-readable schema used by validation scripts.
- Create: `miniapp/data/artists.candidates.jsonl`
  - Candidate artist records generated from local mock data or manually curated input.
- Create: `miniapp/data/artists.reviewed.jsonl`
  - Reviewed records ready for WeChat Cloud Database import.
- Create: `scripts/validate-artists-data.mjs`
  - Validates schema, required fields, source coverage, review status, and duplicate aliases.
- Create: `scripts/export-artist-candidates.mjs`
  - Converts `mock-artists.js` into candidate JSON Lines for review.
- Modify: `miniapp/services/artists.js`
  - Read from WeChat Cloud Database first, fallback to local mock data if cloud fails.
- Create: `miniapp/services/artists.test.mjs`
  - Tests normalization, filtering, fallback, and reviewed-only visibility.
- Modify: `miniapp/pages/artists/artists.js`
  - Handle cloud loading, error, empty state, and reviewed artist data.
- Modify: `miniapp/pages/artist-detail/artist-detail.js`
  - Load artist by cloud `_id`, then load related artworks through existing alias query.
- Modify: `miniapp/pages/artist-detail/artist-detail.wxml`
  - Keep existing visual layout; bind to cloud field names after normalization.

## Task 1: Data Governance Document

**Files:**

- Create: `docs/artist-data-governance.md`

- [ ] **Step 1: Document accepted data sources**

Write the source hierarchy:

```markdown
# Artist Data Governance

## Accepted Sources

1. Getty ULAN for authority names, dates, nationality, and identifiers.
2. Wikidata for structured cross-checking and multilingual names.
3. VIAF for aliases and authority reconciliation.
4. Museum or institution pages for biography context and representative works.

## Source Rules

- Every reviewed record must include at least one authority source.
- Biography text must be a short original summary, not a copied long passage.
- Aliases must include the English name, common Chinese name, and common surname/name variants used in artwork records.
- A record is production-visible only when `review_status` is `reviewed`.
```

- [ ] **Step 2: Add field review checklist**

Add this checklist:

```markdown
## Review Checklist

- Name fields match authority records.
- Birth and death years match at least one authority source.
- Country and region are normalized to project vocabulary.
- Styles and periods are consistent with current filter tags.
- Aliases match known artwork `artist` values.
- Biography is short, neutral, and source-informed.
- Representative works are historically relevant.
- `review_status` is set to `reviewed` only after manual review.
```

- [ ] **Step 3: Commit governance doc**

Run:

```powershell
git add docs/artist-data-governance.md
git commit -m "docs: add artist data governance"
```

Expected: one documentation commit. Do not include miniapp code changes in this commit.

## Task 2: Artist Schema

**Files:**

- Create: `miniapp/data/artists.schema.json`

- [ ] **Step 1: Add JSON schema**

Create:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Reviewed Artist",
  "type": "object",
  "required": [
    "_id",
    "name_zh",
    "name_en",
    "birth_year",
    "death_year",
    "lifespan_text",
    "country",
    "region",
    "styles",
    "periods",
    "active_period",
    "representative_works",
    "aliases",
    "bio_zh",
    "tags",
    "avatar_text",
    "authority_ids",
    "sources",
    "review_status",
    "reviewed_at",
    "updated_at"
  ],
  "properties": {
    "_id": { "type": "string", "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    "name_zh": { "type": "string", "minLength": 1 },
    "name_en": { "type": "string", "minLength": 1 },
    "birth_year": { "type": "integer" },
    "death_year": { "type": "integer" },
    "lifespan_text": { "type": "string", "minLength": 1 },
    "country": { "type": "string", "minLength": 1 },
    "region": { "type": "string", "minLength": 1 },
    "styles": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "periods": { "type": "array", "items": { "type": "string" }, "minItems": 1 },
    "active_period": { "type": "string", "minLength": 1 },
    "representative_works": { "type": "array", "items": { "type": "string" } },
    "aliases": { "type": "array", "items": { "type": "string" }, "minItems": 2 },
    "bio_zh": { "type": "string", "minLength": 20, "maxLength": 220 },
    "tags": { "type": "array", "items": { "type": "string" } },
    "avatar_text": { "type": "string", "minLength": 1, "maxLength": 2 },
    "authority_ids": {
      "type": "object",
      "properties": {
        "ulan": { "type": "string" },
        "wikidata": { "type": "string" },
        "viaf": { "type": "string" }
      },
      "additionalProperties": false
    },
    "sources": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["title", "url", "fields"],
        "properties": {
          "title": { "type": "string", "minLength": 1 },
          "url": { "type": "string", "minLength": 1 },
          "fields": { "type": "array", "items": { "type": "string" }, "minItems": 1 }
        },
        "additionalProperties": false
      },
      "minItems": 1
    },
    "review_status": { "type": "string", "enum": ["candidate", "reviewed", "rejected"] },
    "reviewed_by": { "type": "string" },
    "reviewed_at": { "type": "string" },
    "updated_at": { "type": "string" }
  },
  "additionalProperties": false
}
```

- [ ] **Step 2: Verify schema parses**

Run:

```powershell
node -e "JSON.parse(require('fs').readFileSync('miniapp/data/artists.schema.json','utf8')); console.log('schema ok')"
```

Expected output:

```text
schema ok
```

- [ ] **Step 3: Commit schema**

Run:

```powershell
git add miniapp/data/artists.schema.json
git commit -m "chore: define reviewed artist schema"
```

## Task 3: Candidate Export Script

**Files:**

- Create: `scripts/export-artist-candidates.mjs`
- Create: `miniapp/data/artists.candidates.jsonl`

- [ ] **Step 1: Implement candidate export**

Create a script that imports `miniapp/data/mock-artists.js`, maps existing records into the target field shape, and writes JSON Lines with `review_status: "candidate"`.

Required output behavior:

```text
Wrote miniapp/data/artists.candidates.jsonl
Candidate artists: 8
Reviewed artists: 0
```

- [ ] **Step 2: Normalize generated candidate fields**

The script must map:

```js
{
  _id: artist.id,
  name_zh: artist.nameZh,
  name_en: artist.nameEn,
  lifespan_text: artist.lifespan,
  country: artist.country,
  region: artist.region,
  styles: artist.styles,
  periods: artist.periods,
  active_period: artist.activePeriod,
  representative_works: artist.representativeWorks,
  aliases: artist.aliases,
  bio_zh: artist.bio,
  tags: artist.tags,
  avatar_text: artist.avatarText,
  authority_ids: { ulan: "", wikidata: "", viaf: "" },
  sources: [
    {
      title: "Local candidate seed",
      url: "miniapp/data/mock-artists.js",
      fields: ["candidate"]
    }
  ],
  review_status: "candidate",
  reviewed_by: "",
  reviewed_at: "",
  updated_at: new Date().toISOString().slice(0, 10)
}
```

- [ ] **Step 3: Run candidate export**

Run:

```powershell
node scripts/export-artist-candidates.mjs
```

Expected: `miniapp/data/artists.candidates.jsonl` is created. No cloud database writes occur.

- [ ] **Step 4: Commit candidate export**

Run:

```powershell
git add scripts/export-artist-candidates.mjs miniapp/data/artists.candidates.jsonl
git commit -m "chore: export artist candidate data"
```

## Task 4: Validation Script

**Files:**

- Create: `scripts/validate-artists-data.mjs`

- [ ] **Step 1: Validate JSON Lines**

The script must accept:

```powershell
node scripts/validate-artists-data.mjs miniapp/data/artists.reviewed.jsonl
```

It must reject:

- Invalid JSON lines.
- Missing required fields.
- Duplicate `_id`.
- Duplicate aliases across different artists unless manually listed in an allowed collision list inside the script.
- `review_status: "reviewed"` records without at least one non-local source URL.
- Empty `name_zh`, `name_en`, `bio_zh`, `aliases`, `styles`, or `periods`.
- `birth_year >= death_year` for deceased artists.

- [ ] **Step 2: Add clear validation output**

Expected success output:

```text
artists reviewed data ok
Records: 8
Reviewed: 8
Candidates: 0
Rejected: 0
```

Expected failure format:

```text
artists reviewed data invalid
line 3: reviewed record must include at least one authority source URL
line 5: duplicate alias "Monet" also appears in claude-monet
```

- [ ] **Step 3: Test validator with candidate file**

Run:

```powershell
node scripts/validate-artists-data.mjs miniapp/data/artists.candidates.jsonl
```

Expected: candidate records may pass structural validation, but the summary must show `Reviewed: 0`.

- [ ] **Step 4: Commit validator**

Run:

```powershell
git add scripts/validate-artists-data.mjs
git commit -m "chore: validate artist data files"
```

## Task 5: First Reviewed Batch

**Files:**

- Create: `miniapp/data/artists.reviewed.jsonl`

- [ ] **Step 1: Review core artist records**

Start with these eight records:

```text
claude-monet
vincent-van-gogh
leonardo-da-vinci
edvard-munch
johannes-vermeer
katsushika-hokusai
rembrandt
henri-matisse
```

For each record, manually verify names, years, aliases, country, style, and biography summary against at least one authority source.

- [ ] **Step 2: Validate reviewed data**

Run:

```powershell
node scripts/validate-artists-data.mjs miniapp/data/artists.reviewed.jsonl
```

Expected: validator reports all records as reviewed and valid.

- [ ] **Step 3: Import manually into WeChat Cloud Database**

In WeChat Developer Tools:

1. Open Cloud Development.
2. Create collection `artists`.
3. Import `miniapp/data/artists.reviewed.jsonl` as JSON Lines.
4. Confirm imported record count equals validator count.
5. Configure read permission so normal users can read reviewed public artist records.

No script should write to cloud database in this task.

- [ ] **Step 4: Commit reviewed batch**

Run:

```powershell
git add miniapp/data/artists.reviewed.jsonl
git commit -m "data: add first reviewed artist batch"
```

## Task 6: Cloud Artist Service

**Files:**

- Modify: `miniapp/services/artists.js`
- Create: `miniapp/services/artists.test.mjs`

- [ ] **Step 1: Add normalization layer**

Normalize cloud field names into the existing page-facing shape:

```js
{
  id: record._id,
  nameZh: record.name_zh,
  nameEn: record.name_en,
  lifespan: record.lifespan_text,
  region: record.region,
  country: record.country,
  styles: record.styles,
  periods: record.periods,
  activePeriod: record.active_period,
  representativeWorks: record.representative_works,
  aliases: record.aliases,
  bio: record.bio_zh,
  tags: record.tags,
  avatarText: record.avatar_text,
  reviewStatus: record.review_status
}
```

- [ ] **Step 2: Read reviewed artists from cloud**

Add cloud read behavior:

```js
wx.cloud
  .database()
  .collection("artists")
  .where({ review_status: "reviewed" })
  .limit(100)
  .get()
```

Normalize records before returning them.

- [ ] **Step 3: Add fallback to local mock**

If cloud read fails, return normalized `mockArtists` and attach a lightweight status:

```js
{
  artists,
  source: "fallback"
}
```

If cloud succeeds:

```js
{
  artists,
  source: "cloud"
}
```

- [ ] **Step 4: Test service behavior**

Tests must cover:

- Cloud records normalize into existing page-facing field names.
- Non-reviewed cloud records are not returned.
- Cloud failure falls back to local mock data.
- `getArtistById` can resolve a cloud artist by `_id`.
- Filtering still works by region, style, period, and query.

Run:

```powershell
node --test miniapp/services/artists.test.mjs
```

Expected: all artist service tests pass.

- [ ] **Step 5: Commit artist service**

Run:

```powershell
git add miniapp/services/artists.js miniapp/services/artists.test.mjs
git commit -m "feat: read reviewed artists from cloud"
```

## Task 7: Artist Pages Integration

**Files:**

- Modify: `miniapp/pages/artists/artists.js`
- Modify: `miniapp/pages/artist-detail/artist-detail.js`
- Modify: `miniapp/pages/artists/artists.wxml`
- Modify: `miniapp/pages/artist-detail/artist-detail.wxml`

- [ ] **Step 1: Update artists list page**

The artists page should:

- Show loading state while reading artists.
- Show cloud artists when available.
- Show fallback artists if cloud fails.
- Keep current visual layout.
- Keep search and filters working with normalized fields.

- [ ] **Step 2: Update artist detail page**

The detail page should:

- Load artist by `_id`.
- Render cloud artist fields through normalized names.
- Continue loading related artworks from `artworks` using `artist.aliases`.
- Keep related artworks paginated 8 at a time.
- Preserve current related artwork card behavior.

- [ ] **Step 3: Verify fallback messaging**

If fallback data is used, the page can remain visually unchanged. Log source state in development only:

```js
if (artistResult.source === "fallback") {
  console.warn("Using local artist fallback data");
}
```

- [ ] **Step 4: Run miniapp tests and checks**

Run:

```powershell
$tests = Get-ChildItem -Path 'miniapp' -Recurse -Filter '*.test.mjs' | ForEach-Object { $_.FullName }; node --test @tests
npm run check
npx tsc --noEmit
npm run build
git diff --check
```

Expected:

- All Node tests pass.
- Project check passes.
- TypeScript check passes.
- Build passes.
- Diff check passes.

- [ ] **Step 5: Commit page integration**

Run:

```powershell
git add miniapp/pages/artists miniapp/pages/artist-detail miniapp/services/artists.js
git commit -m "feat: connect artist pages to reviewed cloud data"
```

## Task 8: Cloud Verification

**Files:**

- Create: `docs/artist-cloud-verification.md`

- [ ] **Step 1: Record WeChat Cloud verification steps**

Document:

```markdown
# Artist Cloud Verification

## Checks

1. `artists` collection exists.
2. Imported records count matches `miniapp/data/artists.reviewed.jsonl`.
3. Each imported record has `review_status` set to `reviewed`.
4. Artist list page shows reviewed cloud artists.
5. Artist detail page shows cloud biography and metadata.
6. Related artworks still load from `artworks`.
7. Disabling network or cloud read failure falls back to local data.
```

- [ ] **Step 2: Manual verification in WeChat Developer Tools**

Verify:

- Search `莫奈` displays Claude Monet.
- Search `梵高` displays Vincent van Gogh.
- Artist detail shows reviewed `bio_zh`.
- Related artworks load in batches of 8.
- No artist detail page depends on `artworkCount` from local mock data.

- [ ] **Step 3: Commit verification doc**

Run:

```powershell
git add docs/artist-cloud-verification.md
git commit -m "docs: add artist cloud verification checklist"
```

## Rollout Plan

### Phase 0: Data Design

Deliver:

- Schema
- Governance doc
- Candidate export
- Validator

Success criteria:

- No cloud writes.
- Candidate data exists as JSON Lines.
- Validator catches missing sources and duplicate aliases.

### Phase 1: First Reviewed Batch

Deliver:

- 8 reviewed artists imported into WeChat Cloud Database.
- Frontend still reads local mock data.

Success criteria:

- Imported `artists` count matches reviewed JSON Lines count.
- Every visible cloud artist has `review_status: "reviewed"`.

### Phase 2: Frontend Cloud Read

Deliver:

- Artist list/detail read cloud `artists`.
- Local mock remains fallback.
- Related artworks still query `artworks`.

Success criteria:

- Artist pages work with cloud data.
- Cloud failure does not break pages.
- Related artworks continue to load in paginated batches.

### Phase 3: Expand Artist Coverage

Deliver:

- More reviewed artists added in batches.
- Alias coverage improves artwork matching.

Success criteria:

- Search and artist detail pages become more complete.
- No unreviewed artist appears in production UI.

## Risks

- Authority data can disagree across sources; the governance document must define the accepted source priority.
- Chinese biographies require manual editorial review; automated translation should not be imported as reviewed content.
- Alias collisions can cause unrelated artworks to appear in artist detail pages.
- WeChat Cloud Database permissions must prevent client writes.
- Importing malformed JSON Lines can pollute production data; validation must run before import.
- Frontend fallback can hide cloud data issues if not logged during development.

## Rollback Plan

- If cloud `artists` data is wrong, switch `miniapp/services/artists.js` back to local mock fallback by feature flag or direct service fallback.
- If a bad import occurs, delete or hide affected records by setting `review_status: "rejected"` in WeChat Cloud Console.
- If aliases cause incorrect related works, correct `aliases` in the `artists` collection first; do not change `artworks` data unless the artwork artist field is demonstrably wrong.
- Keep `miniapp/data/artists.reviewed.jsonl` as the recoverable reviewed source file.

## Execution Gate

Before implementation starts, confirm:

1. The first reviewed artist batch size.
2. Whether `artists.reviewed.jsonl` should be committed to Git or kept as local data.
3. Whether WeChat Cloud import is manual-only or whether a guarded import script with explicit `--apply` is allowed later.
4. Which source priority is final when Getty ULAN, Wikidata, VIAF, and museum pages disagree.
