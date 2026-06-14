# Supabase Egress P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Supabase Storage image egress immediately by ensuring list-like surfaces use thumbnails, detail surfaces use display images, and originals are only requested on explicit download.

**Architecture:** Keep the existing single-page app structure and UI unchanged. Add small image URL selection helpers in `src/app.js`, wire existing card renderers to the correct helper, and keep current Supabase pagination/cache behavior. Treat database migration SQL as an optional fallback plan only; do not run it in this P0 unless the fields are missing in a target environment.

**Tech Stack:** Vite, vanilla JavaScript, TypeScript Supabase data layer, Supabase Storage public URLs, IndexedDB via Dexie.

---

## Scope

This is a P0 traffic stopgap for Supabase cached egress. It does not migrate images to OSS/COS/CDN, does not redesign UI, does not rewrite data fetching, and does not alter Auth/RBAC/RLS behavior.

## Files

- Modify: `D:/art/src/app.js`
  - Add image URL selection helpers.
  - Keep list/search/category/home cards on thumbnails.
  - Keep detail drawer on display image.
  - Keep download flow on `download_url` only after user action.
  - Reduce homepage eager image loading and image ratio preloading.
- Modify only if needed: `D:/art/src/lib/paintings.ts`
  - Preserve `thumbnail_url`, `display_url`, and `download_url` separately when mapping `ArtworkRecord` to `Painting`.
- Modify only if needed: `D:/art/src/lib/artworks.ts`
  - Verify summary queries keep `thumbnail_url` and `display_url`, while detail queries keep `download_url`.
- Test/verify: `D:/art/src/lib/artwork-schema.test.ts`
  - Only update if schema tests fail after field handling changes.
- Do not modify: `D:/art/supabase/schema.sql`
  - Include SQL below only as a manual fallback if an environment lacks fields.
- Do not modify: ingestion scripts in `D:/art/scripts/*.mjs` during this P0 unless the implementation phase explicitly extends scope.

## Current Risk Locations To Confirm Before Editing

- `D:/art/src/app.js:424`
  - Current mapping prefers `painting.display_url || painting.thumbnail_url`, causing list cards to inherit `display_url`.
- `D:/art/src/app.js:519`
  - Download candidates are `downloadUrl`, then `displayUrl`; fallback to display should be reviewed because it can request a large display/original URL.
- `D:/art/src/app.js:2167`
  - `imageUrl(item)` returns `item.displayUrl`, and all cards use it.
- `D:/art/src/app.js:2178`
  - `preloadImageRatio()` uses `new Image()` and sets eager/high priority.
- `D:/art/src/app.js:2218`
  - `preloadInitialHomeImageRatios()` preloads recommendation and secondary section images.
- `D:/art/src/app.js:2234`
  - `recommendationCard()` renders every home recommendation image as eager/high priority.
- `D:/art/src/app.js:2271`
  - `artworkCard()` is lazy, but still uses `imageUrl(item)`.
- `D:/art/src/app.js:2616`
  - `categoryArtworkCard()` is lazy, but still uses `imageUrl(item)`.
- `D:/art/src/app.js:3182`
  - Detail drawer sets `drawerImage.src = imageUrl(item)`.
- `D:/art/src/lib/artworks.ts:19`
  - Summary columns already include `thumbnail_url` and `display_url`.
- `D:/art/src/lib/artworks.ts:35`
  - Detail columns include `download_url` and `iiif_url`.
- `D:/art/src/lib/paintings.ts:103`
  - Mapping should not collapse thumbnail/display/download semantics.

## Task 1: Baseline URL Audit

**Files:**
- Read: `D:/art/src/app.js`
- Read: `D:/art/src/lib/paintings.ts`
- Read: `D:/art/src/lib/artworks.ts`
- Read: `D:/art/supabase/schema.sql`
- Read: `D:/art/scripts/*.mjs`

- [ ] **Step 1: Search for direct Supabase Storage URL construction**

Run:

```powershell
rg -n "storage/v1/object/public|supabase\\.co|thumbnail_url|display_url|download_url|original_url|iiif_url" D:/art/src D:/art/scripts D:/art/supabase -S
```

Expected:

```text
D:/art/src/app.js contains image field mapping and render usage.
D:/art/src/lib/artworks.ts contains selected Supabase fields.
D:/art/src/lib/paintings.ts contains record mapping.
D:/art/scripts/*.mjs contains ingestion/storage URL generation.
D:/art/supabase/schema.sql contains thumbnail_url/display_url/download_url/iiif_url.
```

- [ ] **Step 2: Confirm no `original_url` dependency exists**

Run:

```powershell
rg -n "original_url|originalUrl" D:/art/src D:/art/scripts D:/art/supabase -S
```

Expected:

```text
No frontend dependency on original_url. If matches appear only in source_payload or comments, keep download behavior based on download_url.
```

- [ ] **Step 3: Record findings before code changes**

Create a short implementation note in the execution summary, not in code:

```text
Direct Storage URL construction remains in ingestion/audit scripts.
Runtime frontend receives URLs from Supabase fields.
P0 runtime fix is to stop list surfaces from requesting display/download URLs.
```

## Task 2: Preserve Separate Image URL Semantics

**Files:**
- Modify: `D:/art/src/app.js`
- Modify only if needed: `D:/art/src/lib/paintings.ts`

- [ ] **Step 1: Add explicit fields in `paintingToArtwork()`**

In `D:/art/src/app.js`, change the returned artwork object so it preserves separate URLs:

```js
thumbnailUrl: painting.thumbnail_url || painting.display_url || "",
displayUrl: painting.display_url || painting.thumbnail_url || "",
downloadUrl: painting.download_url || "",
```

Keep existing fields and ordering around it unchanged.

- [ ] **Step 2: Verify `artworkToPainting()` keeps fields separate**

In `D:/art/src/lib/paintings.ts`, confirm this mapping stays equivalent to:

```ts
display_url: artwork.display_url || artwork.thumbnail_url,
thumbnail_url: artwork.thumbnail_url,
download_url: artwork.download_url,
iiif_url: artwork.iiif_url,
```

If the file has already collapsed `thumbnail_url` into `display_url` elsewhere, restore the separate `thumbnail_url` and `download_url` fields exactly as above.

- [ ] **Step 3: Run syntax/type check**

Run:

```powershell
node --check D:/art/src/app.js
npx tsc --noEmit
```

Expected:

```text
node --check exits 0.
tsc exits 0.
```

## Task 3: Route List Surfaces To `thumbnail_url`

**Files:**
- Modify: `D:/art/src/app.js`

- [ ] **Step 1: Replace the generic image helper with purpose-specific helpers**

Near the current `imageUrl(item)` helper, implement this shape:

```js
function thumbnailImageUrl(item) {
  return item.thumbnailUrl || item.displayUrl || "/assets/icon.svg";
}

function displayImageUrl(item) {
  return item.displayUrl || item.thumbnailUrl || "/assets/icon.svg";
}

function imageUrl(item) {
  return thumbnailImageUrl(item);
}
```

Keep `imageUrl()` temporarily as a compatibility wrapper so the change is small and reversible.

- [ ] **Step 2: Update list/card renderers to use thumbnails**

Use `thumbnailImageUrl(item)` in these render paths:

```js
recommendationCard(item)
artworkCard(item)
categoryArtworkCard(item)
upsertDownloadRecord(item) thumbnailUrl field only
```

The relevant replacements are:

```js
src="${escapeHtml(thumbnailImageUrl(item))}"
```

and:

```js
thumbnailUrl: thumbnailImageUrl(item) || existing?.thumbnailUrl || "",
```

- [ ] **Step 3: Keep fallback behavior unchanged**

Confirm each changed card still calls:

```js
attachImageFallback(card);
```

Expected:

```text
Broken thumbnail URLs still fall back to the existing icon/fallback path.
```

- [ ] **Step 4: Run syntax check**

Run:

```powershell
node --check D:/art/src/app.js
```

Expected:

```text
No syntax errors.
```

## Task 4: Make Detail Use `display_url`, Not Original/Download

**Files:**
- Modify: `D:/art/src/app.js`

- [ ] **Step 1: Update detail image assignment**

In `openDrawer(item)`, change:

```js
nodes.drawerImage.src = imageUrl(item);
```

to:

```js
nodes.drawerImage.src = displayImageUrl(item);
```

- [ ] **Step 2: Update IIIF fallback path**

In `mountDetailViewer(item)`, change open-failed fallback:

```js
nodes.drawerImage.src = imageUrl(item);
```

to:

```js
nodes.drawerImage.src = displayImageUrl(item);
```

- [ ] **Step 3: Confirm no detail path uses `downloadUrl` for rendering**

Run:

```powershell
rg -n "drawerImage\\.src|downloadUrl|download_url|displayImageUrl|thumbnailImageUrl" D:/art/src/app.js -S
```

Expected:

```text
drawerImage.src uses displayImageUrl.
downloadUrl appears only in download flow and data mapping.
```

## Task 5: Keep Originals For Explicit User Download Only

**Files:**
- Modify: `D:/art/src/app.js`

- [ ] **Step 1: Tighten `downloadUrlForItem()`**

Change the helper from fallback-to-display behavior to explicit download-first behavior:

```js
function downloadUrlForItem(item) {
  const url = String(item?.downloadUrl || "").trim();
  return url && url !== "#" ? url : "";
}
```

This prevents display images from becoming implicit download/original requests.

- [ ] **Step 2: Preserve user-triggered download behavior**

Confirm `handleDetailDownload()` still calls:

```js
const record = upsertDownloadRecord(currentDetailItem, { status: "queued" });
```

and `downloadRecordFile()` still only runs after a user download action.

- [ ] **Step 3: Confirm missing download URL fails gracefully**

Manually test one item with empty `downloadUrl` by temporarily inspecting runtime state in the browser console during QA:

```js
currentDetailItem.downloadUrl
```

Expected:

```text
If downloadUrl is empty, the app shows the existing missing-url/download failure path instead of fetching displayUrl.
```

Do not add a new UI style in this P0.

## Task 6: Lazy Load Homepage Images

**Files:**
- Modify: `D:/art/src/app.js`

- [ ] **Step 1: Remove all-card eager/high behavior**

In `recommendationCard(item)`, replace:

```html
<img loading="eager" decoding="async" fetchpriority="high" src="..." alt="..." />
```

with:

```html
<img loading="lazy" decoding="async" src="..." alt="..." />
```

Use `thumbnailImageUrl(item)` for `src`.

- [ ] **Step 2: Optional first-visible-card priority**

If execution needs one high-priority image for perceived performance, add an optional parameter:

```js
function recommendationCard(item, options = {}) {
  const priorityAttrs = options.priority ? `loading="eager" fetchpriority="high"` : `loading="lazy"`;
  ...
}
```

Then only pass `{ priority: true }` for the first card in the first section. If this makes the code broader, skip it for P0 and use lazy everywhere.

- [ ] **Step 3: Run markup search**

Run:

```powershell
rg -n "fetchpriority=|loading=\"eager\"|new Image\\(" D:/art/src/app.js -S
```

Expected:

```text
No eager/high img tags remain in card rendering.
new Image() remains only in image ratio preload logic and is limited by Task 7.
```

## Task 7: Limit `preloadInitialHomeImageRatios()`

**Files:**
- Modify: `D:/art/src/app.js`

- [ ] **Step 1: Reduce preload scope**

Replace the current behavior that preloads first 3 recommendation items plus first 3 items from sections 1-4 with a cap of 2 total images:

```js
async function preloadInitialHomeImageRatios() {
  const sections = dedupedHomeSections();
  const items = [];

  for (const section of sections) {
    for (const item of section.artworks) {
      if (!items.some((existing) => thumbnailImageUrl(existing) === thumbnailImageUrl(item))) {
        items.push(item);
      }
      if (items.length >= 2) break;
    }
    if (items.length >= 2) break;
  }

  await Promise.all(items.map((item) => preloadImageRatio(item, { timeoutMs: 1500 })));
}
```

- [ ] **Step 2: Make ratio preload use thumbnail URLs**

Inside `preloadImageRatio(item)`, ensure:

```js
const url = thumbnailImageUrl(item);
```

not display/download URL.

- [ ] **Step 3: Remove high fetch priority from preload image**

Inside `preloadImageRatio(item)`, remove or avoid:

```js
image.fetchPriority = "high";
```

Keep:

```js
image.decoding = "async";
```

Do not set `image.loading = "eager"` in this helper.

- [ ] **Step 4: Verify only capped preloads happen**

In browser devtools Network tab:

```text
Filter by "Img".
Hard refresh home page.
Confirm only visible lazy-loaded thumbnails and at most 2 ratio-preload thumbnail requests appear before scrolling.
```

## Task 8: Validate Database Field Availability

**Files:**
- Read: `D:/art/supabase/schema.sql`
- Read: `D:/art/src/lib/artwork-schema.ts`
- Do not run migration in P0.

- [ ] **Step 1: Confirm fields in local schema**

Run:

```powershell
rg -n "thumbnail_url|display_url|download_url|iiif_url|original_url" D:/art/supabase/schema.sql D:/art/src/lib/artwork-schema.ts -S
```

Expected:

```text
thumbnail_url, display_url, download_url, iiif_url exist.
original_url does not exist and is not required for P0.
```

- [ ] **Step 2: Use this SQL only if target DB lacks fields**

Manual fallback SQL, not to be executed during this plan unless a target environment is missing columns:

```sql
alter table public.artwork_images
  add column if not exists thumbnail_url text,
  add column if not exists display_url text,
  add column if not exists download_url text,
  add column if not exists iiif_url text;
```

If the legacy `public.paintings` table is still directly queried in a deployment, use:

```sql
alter table public.paintings
  add column if not exists thumbnail_url text,
  add column if not exists display_url text,
  add column if not exists download_url text,
  add column if not exists iiif_url text;
```

Do not add `original_url` for P0. Use existing `download_url` as the original/download source.

## Task 9: Verify No Large One-Time Reads Were Introduced

**Files:**
- Read: `D:/art/src/lib/artworks.ts`
- Read: `D:/art/src/app.js`

- [ ] **Step 1: Confirm paginated Supabase reads remain capped**

Run:

```powershell
rg -n "HOME_PAGE_SIZE|CATEGORY_PAGE_SIZE|SEARCH_PAGE_SIZE|fetchPaintingsPage|fetchArtworksPage|\\.range\\(" D:/art/src/app.js D:/art/src/lib/artworks.ts -S
```

Expected:

```text
HOME_PAGE_SIZE remains 80.
CATEGORY_PAGE_SIZE remains 40.
fetchArtworksPage uses .range(from, to).
No new select-all frontend query is introduced.
```

- [ ] **Step 2: Do not change pagination in P0**

Leave these values unchanged unless production data shows DB response size is also a quota issue:

```js
const HOME_PAGE_SIZE = 80;
const CATEGORY_PAGE_SIZE = 40;
const SEARCH_PAGE_SIZE = 40;
```

## Task 10: Test And Inspect Network Behavior

**Files:**
- Test app runtime at `http://127.0.0.1:5173/`

- [ ] **Step 1: Run static checks**

Run:

```powershell
npm.cmd run check
npx tsc --noEmit
git diff --check
```

Expected:

```text
All commands exit 0.
If git diff --check prints CRLF warnings for pre-existing dirty files, confirm there are no whitespace errors in files changed by this P0.
```

- [ ] **Step 2: Start or reuse dev server**

Run:

```powershell
npm.cmd run dev -- --host 127.0.0.1
```

Expected:

```text
Vite serves the app, usually at http://127.0.0.1:5173/.
```

- [ ] **Step 3: Browser network validation**

In the browser Network tab:

```text
1. Disable cache for a clean test.
2. Filter by Img.
3. Load home page.
4. Confirm card image URLs use thumbnail_url where data provides it.
5. Confirm no download_url request occurs before clicking download.
6. Open detail drawer.
7. Confirm detail main image uses display_url.
8. Click download.
9. Confirm download_url is requested only after this click.
```

- [ ] **Step 4: Page coverage**

Manually check these app surfaces:

```text
Home recommendation sections
Home search results
Category results
Home section "查看全部" route
Favorites/history grids
Detail drawer
Download action
```

Expected:

```text
UI style remains visually unchanged.
Cards still show images or existing fallback.
Only the requested image URL size/source behavior changes.
```

## Rollback Plan

- [ ] **Step 1: Revert only P0 code changes**

If the implementation is uncommitted:

```powershell
git diff -- D:/art/src/app.js D:/art/src/lib/paintings.ts D:/art/src/lib/artworks.ts
```

Manually revert only the P0 hunks. Do not use `git reset --hard`.

- [ ] **Step 2: Restore old generic image behavior if needed**

Rollback target:

```js
function imageUrl(item) {
  return item.displayUrl || "/assets/icon.svg";
}
```

and restore card renderers to:

```js
src="${escapeHtml(imageUrl(item))}"
```

- [ ] **Step 3: Restore old download fallback if needed**

Rollback target:

```js
function downloadUrlForItem(item) {
  const candidates = [item?.downloadUrl, item?.displayUrl].map((url) => String(url || "").trim());
  return candidates.find((url) => url && url !== "#") || "";
}
```

- [ ] **Step 4: Restore old preload behavior only if visual sizing breaks badly**

If card sizing becomes unacceptable, restore the previous `preloadInitialHomeImageRatios()` implementation, but keep it on `thumbnailImageUrl(item)` if possible.

## Self-Review

- Covers direct Supabase Storage URL location by audit commands and known risky files.
- Covers list/search/card thumbnail priority.
- Covers homepage lazy image loading.
- Covers limiting `preloadInitialHomeImageRatios()`.
- Covers detail defaulting to `display_url`.
- Covers original/download URL only on explicit download.
- Includes minimal SQL only as fallback, not as an execution step.
- Includes exact file paths, verification commands, browser test steps, and rollback.
- Excludes OSS/COS/CDN, large refactor, large dependencies, UI style changes, RBAC/Auth/RLS changes, and automatic database migration.
