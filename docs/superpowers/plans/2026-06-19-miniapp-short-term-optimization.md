# Miniapp Short-Term Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the WeChat miniapp by separating the current large diff into reviewable slices, then fixing the highest-impact user experience issues without adding new broad features.

**Architecture:** Treat search, home artwork rows, tag detail navigation, detail display, and download behavior as separate units. Each unit must have focused tests and a separate verification pass before the next unit starts.

**Tech Stack:** WeChat Mini Program native pages/components, `wx.cloud.database`, local CommonJS services, Node test runner, Vite web build checks.

---

## File Structure

Current short-term work should be grouped by responsibility:

- `miniapp/services/search-engine.js`: local keyword normalization, alias expansion, scoring and ranking.
- `miniapp/services/artworks.js`: cloud database access for search, tags, detail, and fallback data.
- `miniapp/pages/home/home.js`: home page state, search scheduling, section paging, navigation.
- `miniapp/pages/home/home.wxml`: home page search and section rendering.
- `miniapp/pages/home/home.wxss`: home search and section visual layout only.
- `miniapp/pages/home/home-search.js`: pure home search state helper.
- `miniapp/pages/home/home-search.test.mjs`: unit tests for home search state.
- `miniapp/services/artworks-search.test.mjs`: unit tests for full-database search behavior and ranking.
- `miniapp/components/horizontal-artwork-row/`: horizontal row behavior and geometry. Do not mix this with search fixes.
- `miniapp/pages/tag/tag.js`, `miniapp/pages/tag/tag.wxml`, `miniapp/pages/tag/tag.wxss`: full tag artwork list used by "查看更多".
- `miniapp/pages/detail/detail.js`, `miniapp/pages/detail/detail.wxml`, `miniapp/pages/detail/detail.wxss`: detail display, metadata cleanup, download button.
- `miniapp/services/downloads.js`: download URL resolution and WeChat save flow.

Do not modify cloud database data, Supabase scripts, image derivative scripts, or account/RBAC/auth logic during this short-term stabilization pass.

---

### Task 1: Current Diff Ownership and Baseline Check

**Files:**
- Inspect: all files from `git status --short`
- Create if useful: `docs/superpowers/plans/2026-06-19-miniapp-diff-ownership.md`

- [ ] **Step 1: Capture current worktree state**

Run:

```powershell
git status --short
git diff --stat
git ls-files --others --exclude-standard
```

Expected: output shows tracked miniapp modifications and untracked miniapp tests/components.

- [ ] **Step 2: Classify files into submit groups**

Use these groups:

```text
A. Search refactor
B. Home horizontal row/card geometry
C. Detail page display/download
D. Tag detail / 查看更多
E. Icons/state/profile/category historical UI
F. Docs/tests/support
G. Unknown, needs manual confirmation
```

Expected: every changed file belongs to exactly one group, or is marked unknown.

- [ ] **Step 3: Run baseline verification before any new edits**

Run:

```powershell
npm.cmd run check
npx.cmd tsc --noEmit
npm.cmd run build
git diff --check
```

Expected: all pass. If a command fails, stop and fix the baseline before feature work.

- [ ] **Step 4: Commit only if the staged scope is clean**

Do not commit broad mixed changes. If committing, use one group at a time:

```powershell
git diff --cached --stat
git diff --cached --check
git commit -m "chore: stabilize miniapp baseline"
```

Expected: commit contains only the reviewed group.

---

### Task 2: Search Refactor Stabilization

**Files:**
- Modify: `miniapp/services/search-engine.js`
- Modify: `miniapp/services/artworks.js`
- Modify: `miniapp/pages/home/home.js`
- Modify: `miniapp/pages/home/home.wxml`
- Modify: `miniapp/pages/home/home-search.js`
- Test: `miniapp/services/artworks-search.test.mjs`
- Test: `miniapp/pages/home/home-search.test.mjs`

- [ ] **Step 1: Confirm home search does not use random home samples**

Run:

```powershell
Select-String -Path miniapp/pages/home/home.js -Pattern "searchArtworks\\(this.data.artworks|warmSearchCorpus|fetchSearchCorpus"
```

Expected: no result for home sample search or warm corpus usage.

- [ ] **Step 2: Confirm all non-empty searches go through cloud candidate search**

Check that `miniapp/pages/home/home.js` calls:

```js
const results = await searchCloudArtworks(normalizedQuery, { pageSize: SEARCH_PAGE_SIZE });
```

Expected: home input schedules `runCloudSearch`, and `runCloudSearch` uses `searchCloudArtworks`.

- [ ] **Step 3: Ensure empty input returns to the original home feed**

Check `miniapp/pages/home/home-search.js`:

```js
function createHomeSearchState(_artworks, query, options) {
  const normalizedQuery = normalizeSearchQuery(query);
  const searchMode = Boolean(normalizedQuery);
  const results = options && Array.isArray(options.results) ? options.results : [];
  return {
    searchQuery: String(query || ""),
    searchMode,
    searchResults: searchMode ? results : [],
  };
}
```

Expected: empty query sets `searchMode: false` and clears `searchResults`.

- [ ] **Step 4: Verify ranking and normalization**

Run:

```powershell
node --test miniapp/services/artworks-search.test.mjs miniapp/pages/home/home-search.test.mjs
```

Expected: tests pass for `达芬奇`, `达·芬奇`, `列奥纳多`, title-first ranking, and no full-corpus load.

- [ ] **Step 5: Manual WeChat DevTools verification**

In WeChat DevTools:

```text
1. Search "梵高": results appear without long "搜索中".
2. Search "达芬奇": results include Leonardo da Vinci works and other title/description matches.
3. Search "列奥纳多": results appear from the full database candidate search.
4. Delete all input: page returns to the normal home feed.
5. Tap "搜索": keyboard closes and current results remain visible.
```

Expected: no one-second result replacement from local random sample to a different cloud result set.

- [ ] **Step 6: Commit search refactor**

Stage only search files:

```powershell
git add miniapp/services/search-engine.js miniapp/services/artworks.js miniapp/pages/home/home.js miniapp/pages/home/home.wxml miniapp/pages/home/home-search.js miniapp/services/artworks-search.test.mjs miniapp/pages/home/home-search.test.mjs
git diff --cached --stat
git diff --cached --check
git commit -m "fix: stabilize miniapp full database search"
```

Expected: commit contains no horizontal row, card geometry, icon, profile, or database-data changes.

---

### Task 3: Home Horizontal Row and Card Geometry Stabilization

**Files:**
- Modify: `miniapp/components/horizontal-artwork-row/`
- Modify: `miniapp/pages/home/home.wxml`
- Modify: `miniapp/pages/home/home.wxss`
- Modify: `miniapp/pages/home/home.js`
- Test: `miniapp/components/horizontal-artwork-row/horizontal-artwork-row-geometry.test.mjs`
- Test: `miniapp/pages/home/home-pagination.test.mjs`

- [ ] **Step 1: Lock the card geometry rule**

Document this invariant in the component test:

```text
Home row artwork image height is fixed.
Card width is derived from measured artwork aspect ratio.
No max-width should force wide artworks into a padded box.
No min-width should force narrow artworks into a padded box.
The image should use aspectFit-style full artwork display, not aspectFill cropping.
```

Expected: this rule is reflected in test names and assertions.

- [ ] **Step 2: Verify current geometry tests**

Run:

```powershell
node --test miniapp/components/horizontal-artwork-row/horizontal-artwork-row-geometry.test.mjs miniapp/pages/home/home-pagination.test.mjs
```

Expected: tests pass before visual changes. If not, fix tests or implementation before proceeding.

- [ ] **Step 3: Remove width caps from the home row only**

Search:

```powershell
Select-String -Path miniapp\\**\\*.wxss -Pattern "max-width|min-width|aspectFill|mode=\"aspectFill\""
```

Expected: identify only home row/card rules that cap artwork display. Do not change category grid rules in the same edit.

- [ ] **Step 4: Manual WeChat DevTools verification**

Verify these cases:

```text
1. Landscape artwork displays wider, without hard padding.
2. Portrait artwork displays narrower, without hard padding.
3. Extremely narrow artwork is not forced into a wide card.
4. Horizontal drag works past the eighth artwork.
5. Card shadow remains visible and does not reintroduce heavy shadows.
```

Expected: row behavior is stable before adding "查看更多" work.

- [ ] **Step 5: Commit horizontal row stabilization**

Stage only row/card files:

```powershell
git add miniapp/components/horizontal-artwork-row miniapp/pages/home/home.js miniapp/pages/home/home.wxml miniapp/pages/home/home.wxss miniapp/pages/home/home-pagination.js miniapp/pages/home/home-pagination.test.mjs
git diff --cached --stat
git diff --cached --check
git commit -m "fix: stabilize home artwork row geometry"
```

Expected: commit contains no search engine, detail metadata, download, profile, or icon changes unless already committed as dependencies.

---

### Task 4: Home "查看更多" Entry and Tag Detail Reuse

**Files:**
- Modify: `miniapp/pages/home/home.js`
- Modify: `miniapp/pages/home/home.wxml`
- Modify: `miniapp/pages/home/home.wxss`
- Modify: `miniapp/pages/tag/tag.js`
- Modify: `miniapp/pages/tag/tag.wxml`
- Modify: `miniapp/pages/tag/tag.wxss`

- [ ] **Step 1: Confirm tag detail route**

Run:

```powershell
Select-String -Path miniapp/app.json -Pattern "pages/tag/tag"
Select-String -Path miniapp/pages/tag/tag.js -Pattern "onLoad|fetchArtworksByTag|countArtworksByTag"
```

Expected: `/pages/tag/tag?tag=<encoded>` is available and can load full tag results.

- [ ] **Step 2: Render title row outside the horizontal scroll container**

In `miniapp/pages/home/home.wxml`, the section title row must be structurally separate from the horizontally scrollable artwork row:

```xml
<view class="recommendation-group-head">
  <text class="group-title">{{item.title}}</text>
  <view wx:if="{{item.showMore}}" class="group-more" data-tag="{{item.targetTag || item.tag || item.title}}" bindtap="openTagDetail">
    <text>查看更多</text>
    <image class="group-more-icon" src="/assets/icons/lucide/svg/chevron-right.svg" mode="aspectFit" />
  </view>
</view>
```

Expected: "查看更多" is visible at the right side of the default viewport, not hidden at the far end of horizontal scrolling.

- [ ] **Step 3: Verify route parameter encoding**

Check `miniapp/pages/home/home.js`:

```js
openTagDetail(event) {
  const dataset = event.currentTarget.dataset || {};
  const tag = dataset.tag || dataset.title;
  if (!tag) return;
  wx.navigateTo({
    url: `/pages/tag/tag?tag=${encodeURIComponent(tag)}`,
  });
}
```

Expected: Chinese tags navigate correctly.

- [ ] **Step 4: Manual verification**

In WeChat DevTools:

```text
1. Home title row shows "查看更多" at the right edge with matching right padding.
2. Tap "查看更多" under "印象派"; tag page title shows "印象派".
3. Tag page count is correct.
4. Tag page grid uses thumbnail images.
5. Tap a result card; detail page uses display image.
```

Expected: no horizontal scroll is required to see the button.

- [ ] **Step 5: Commit "查看更多"**

```powershell
git add miniapp/pages/home/home.js miniapp/pages/home/home.wxml miniapp/pages/home/home.wxss miniapp/pages/tag/tag.js miniapp/pages/tag/tag.wxml miniapp/pages/tag/tag.wxss
git diff --cached --stat
git diff --cached --check
git commit -m "feat: add home tag see more entry"
```

Expected: commit does not alter home card geometry.

---

### Task 5: Detail Page Display Cleanup and Download UX

**Files:**
- Modify: `miniapp/pages/detail/detail.js`
- Modify: `miniapp/pages/detail/detail.wxml`
- Modify: `miniapp/pages/detail/detail.wxss`
- Modify: `miniapp/services/downloads.js`
- Test: `miniapp/services/downloads.test.mjs`
- Test: `miniapp/pages/detail/detail-image-layout.test.mjs`

- [ ] **Step 1: Confirm front-end-only display cleanup**

Apply only UI-level transformations:

```text
1. Hide "来源" metadata card.
2. Remove the "ARTWORK DETAIL" label.
3. Show year-only text in "创作年代" when possible.
4. Strip Artvee wording from medium display, e.g. "油画或其 Artvee 图像记录（推测）" -> "油画".
5. Do not mutate cloud database records in this task.
```

Expected: no cloud database write code is added.

- [ ] **Step 2: Keep download_url isolated to download behavior**

Check `miniapp/services/downloads.js`:

```js
function resolveArtworkDownloadUrl(artwork) {
  return artwork && artwork.download_url ? artwork.download_url : "";
}
```

Expected: display components never fall back to `download_url`.

- [ ] **Step 3: Add download button beside favorite button**

In `miniapp/pages/detail/detail.wxml`, render actions as a horizontal row:

```xml
<view class="detail-actions">
  <button class="detail-action-button favorite-button" bindtap="toggleFavorite">收藏</button>
  <button class="detail-action-button download-button" bindtap="downloadArtwork">下载</button>
</view>
```

Expected: layout places download beside favorite without moving title/artist content.

- [ ] **Step 4: Verify download tests**

Run:

```powershell
node --test miniapp/services/downloads.test.mjs miniapp/pages/detail/detail-image-layout.test.mjs
```

Expected: download only uses `download_url`; detail image layout still uses display-safe source.

- [ ] **Step 5: Commit detail/download cleanup**

```powershell
git add miniapp/pages/detail/detail.js miniapp/pages/detail/detail.wxml miniapp/pages/detail/detail.wxss miniapp/services/downloads.js miniapp/services/downloads.test.mjs miniapp/pages/detail/detail-image-layout.js miniapp/pages/detail/detail-image-layout.test.mjs
git diff --cached --stat
git diff --cached --check
git commit -m "feat: refine artwork detail actions and metadata"
```

Expected: commit contains no cloud database migration or data mutation.

---

### Task 6: Cloud Database Cleanup Planning Only

**Files:**
- Create: `docs/wechat-cloud-artworks-cleanup-plan.md`

- [ ] **Step 1: Export a local backup before any future data mutation**

Plan command shape:

```powershell
node scripts/export-wechat-cloud-artworks.mjs --collection artworks --output backups/wechat-cloud-artworks-YYYYMMDD.jsonl
```

Expected: this is only a plan unless the export script exists and user explicitly approves execution.

- [ ] **Step 2: Define field cleanup rules**

Document proposed data changes:

```text
1. Remove source display value "Artvee" from user-facing metadata if it is not a collection location.
2. Normalize medium values by removing Artvee-specific phrases.
3. Split "收藏地" from inferred context text if possible.
4. Preserve original raw fields in backup or a raw_* field if cloud schema allows.
```

Expected: no online data is changed in this short-term plan.

- [ ] **Step 3: Prepare a review checklist**

Checklist:

```text
1. Backup file exists and opens.
2. Sample 20 records before/after cleanup.
3. Rollback file is generated.
4. Miniapp still renders detail metadata.
5. No user data, RBAC, auth, or private collections are touched.
```

Expected: future cloud cleanup has a safe review path.

---

## Final Verification Before Each Commit

Run this before every commit:

```powershell
npm.cmd run check
npx.cmd tsc --noEmit
npm.cmd run build
git diff --check
```

Expected: all pass. If WeChat DevTools is needed for visual validation, manually verify on iPhone 15 Pro preview size before committing.

---

## Short-Term Priority Order

1. Search refactor stabilization.
2. Home horizontal row/card geometry stabilization.
3. Home "查看更多" and tag detail reuse.
4. Detail page display cleanup and download UX.
5. Cloud database cleanup plan only.

Do not start a lower-priority task while a higher-priority task has failing tests or unresolved visual regressions.

---

## Risks

- The current worktree contains many unrelated changes; careless staging can create a mixed commit.
- Home row drag and card geometry are tightly coupled; adding "查看更多" before stabilizing the row can hide buttons or break scroll behavior again.
- Cloud database search is limited by Mini Program database query behavior; candidate search is safer than full corpus loading, but large-scale search may later need cloud functions or a dedicated search index.
- Any future cloud database cleanup must be backed up first because it changes source data, not just UI display.

---

## Self-Review

- Spec coverage: includes search stabilization, diff splitting, home row/card fix, "查看更多", detail cleanup/download, and cloud data cleanup planning.
- Placeholder scan: no task uses unspecified placeholders; each task lists files, commands, and expected results.
- Type consistency: search helpers, tag route, and download behavior names match current miniapp structure.
