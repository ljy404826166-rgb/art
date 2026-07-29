# Miniapp Core Stability Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the current WeChat miniapp core browsing experience before adding new features.

**Architecture:** Keep the existing native WeChat miniapp structure and cloud database access layer. Each task is scoped to one user-facing flow, with service-layer tests first, page-level implementation second, and WeChat Developer Tools/manual verification last.

**Tech Stack:** WeChat Mini Program, CloudBase database, local CommonJS services, Node built-in test runner, Vite web build checks.

---

## Current Baseline

The project currently has a mature miniapp surface:

- Home: searchable gallery, horizontal artwork sections, tag/category entry points.
- Category: tag filters, artwork grids, tag result pages.
- Artwork detail: image display, favorite, download, artist jump, tag jump.
- Artists: cloud-backed artist list, filter/search, pagination.
- Artist detail: cloud artist profile, related artworks, pagination.
- Profile: user-facing static/account entry surface.
- Shared components: `artwork-card`, `artwork-image`, `horizontal-artwork-row`, `empty-state`, `error-state`, `loading-more`.

The next work should prioritize stability because several core flows have been modified repeatedly:

- Search behavior and ranking.
- Home horizontal scrolling and artwork card ratio logic.
- Cloud artist source and artist detail loading.
- Artwork detail actions: download, favorite, artist jump, tag jump.
- Loading skeletons and empty/error states.

## Non-Goals

- Do not introduce new product modules before this sprint is complete.
- Do not change CloudBase database schema during UI stability tasks.
- Do not rework the full visual system.
- Do not replace the current miniapp with a web-view shell.
- Do not introduce Vant/TDesign/recycle-view during this sprint.
- Do not modify Supabase, RBAC, RLS, or legacy Web project code.
- Do not change `thumbnail_url / display_url / download_url` semantics.

## File Ownership Map

Core files likely to be touched:

- `miniapp/pages/home/home.js`: home state, search mode, section loading.
- `miniapp/pages/home/home.wxml`: search area, section title rows, result rendering.
- `miniapp/pages/home/home.wxss`: home spacing, horizontal section containment.
- `miniapp/pages/home/home-search.js`: full-library search orchestration.
- `miniapp/pages/home/home-search.test.mjs`: search mode tests.
- `miniapp/components/horizontal-artwork-row/horizontal-artwork-row.*`: horizontal card layout and gestures.
- `miniapp/components/horizontal-artwork-row/horizontal-artwork-row-geometry.js`: card width/ratio geometry.
- `miniapp/components/horizontal-artwork-row/horizontal-artwork-row-geometry.test.mjs`: ratio regression tests.
- `miniapp/components/artwork-card/artwork-card.*`: shared card text truncation and image composition.
- `miniapp/components/artwork-image/artwork-image.*`: display image source and fallback behavior.
- `miniapp/pages/category/category.*`: filter state, result grid, pagination.
- `miniapp/pages/tag/tag.*`: tag result page and card grid.
- `miniapp/pages/detail/detail.*`: artwork detail actions and loading skeleton.
- `miniapp/pages/artist-detail/artist-detail.*`: artist profile loading, related artwork pagination.
- `miniapp/pages/artists/artists.*`: cloud artist list pagination and filters.
- `miniapp/services/artworks.js`: cloud artwork queries.
- `miniapp/services/search-engine.js`: search normalization and ranking.
- `miniapp/services/artists.js`: cloud artist queries and alias matching.
- `miniapp/services/downloads.js`: download URL and save workflow.
- `miniapp/services/local-library.js`: favorite/history/download local storage.

Documentation and validation files:

- `docs/superpowers/plans/2026-06-28-miniapp-core-stability-sprint.md`
- `scripts/check.mjs`
- Existing `*.test.mjs` files under `miniapp/`

---

## Task 1: Freeze And Commit Current Verified Artist Navigation Work

**Purpose:** Preserve the current known-good changes before starting the next set of fixes.

**Files:**
- Stage: `miniapp/pages/detail/detail.js`
- Stage: `miniapp/pages/artist-detail/artist-detail.js`
- Stage: `miniapp/pages/artist-detail/artist-detail.wxml`
- Stage: `miniapp/pages/artist-detail/artist-detail.wxss`
- Stage: `miniapp/pages/artist-detail/artist-detail.json`
- Stage: `miniapp/services/artists.js`
- Stage: `miniapp/services/artists.test.mjs`
- Do not stage unrelated untracked plan files unless explicitly approved.

- [ ] **Step 1: Verify working tree scope**

Run:

```powershell
git status --short
git diff --stat
```

Expected:

- Modified files are limited to the artist navigation/detail optimization files listed above.
- Untracked docs are reviewed separately and not accidentally staged.

- [ ] **Step 2: Run verification**

Run:

```powershell
node --test miniapp/services/*.test.mjs
npm run check
npx tsc --noEmit
npm run build
git diff --check
```

Expected:

- Node tests: all pass.
- `npm run check`: exits 0.
- `npx tsc --noEmit`: exits 0.
- `npm run build`: exits 0.
- `git diff --check`: exits 0; CRLF warnings are acceptable.

- [ ] **Step 3: Stage only current verified optimization files**

Run:

```powershell
git add miniapp/pages/detail/detail.js `
  miniapp/pages/artist-detail/artist-detail.js `
  miniapp/pages/artist-detail/artist-detail.wxml `
  miniapp/pages/artist-detail/artist-detail.wxss `
  miniapp/pages/artist-detail/artist-detail.json `
  miniapp/services/artists.js `
  miniapp/services/artists.test.mjs
git diff --cached --stat
git diff --cached --check
```

Expected:

- Cached diff contains only those seven files.
- Cached diff check exits 0.

- [ ] **Step 4: Commit after approval**

Run only after confirming the staged scope:

```powershell
git commit -m "fix: speed up artwork artist navigation"
```

Expected:

- Commit succeeds.
- `git status --short` shows only unrelated untracked docs or future work.

---

## Task 2: Core Flow Regression Checklist

**Purpose:** Build a repeatable manual and command-line checklist before more UI changes.

**Files:**
- Create or modify: `docs/miniapp-core-regression-checklist.md`

- [ ] **Step 1: Create regression checklist document**

Add the following checklist to `docs/miniapp-core-regression-checklist.md`:

```markdown
# Miniapp Core Regression Checklist

## Command Checks

- [ ] `node --test miniapp/services/*.test.mjs`
- [ ] `npm run check`
- [ ] `npx tsc --noEmit`
- [ ] `npm run build`
- [ ] `git diff --check`

## WeChat Developer Tools Checks

### Home
- [ ] Home opens without duplicate title.
- [ ] Search input stays on home page.
- [ ] Search results update while typing.
- [ ] Clearing search restores the original home sections.
- [ ] Horizontal artwork rows can be dragged left and right.
- [ ] Artwork cards keep fixed media height and width based on image ratio.
- [ ] Section "查看更多" enters the correct tag result page.

### Category
- [ ] Filters select and deselect correctly.
- [ ] Result count matches selected filter.
- [ ] Artwork cards are two-column, shadowed, and text truncates to one line.
- [ ] Reaching bottom loads more when available.

### Artwork Detail
- [ ] Detail image uses display image, not download image.
- [ ] Favorite toggles without layout shift.
- [ ] Download saves image and records history.
- [ ] Artist pill navigates to artist detail without blocking modal.
- [ ] Tag pills navigate to tag result page.

### Artists
- [ ] Artist list reads cloud data, not local eight-card fallback.
- [ ] Filters work across currently loaded cloud artists.
- [ ] Reaching bottom appends 8 artists without losing scroll position.

### Artist Detail
- [ ] Header skeleton matches artist detail page.
- [ ] Artist profile renders before related artwork load finishes.
- [ ] Related artworks load 8 at a time.
- [ ] Reaching bottom appends related artworks without resetting scroll.
```

- [ ] **Step 2: Verify document diff**

Run:

```powershell
git diff -- docs/miniapp-core-regression-checklist.md
```

Expected:

- Document contains only the regression checklist.

- [ ] **Step 3: Commit checklist separately**

Run:

```powershell
git add docs/miniapp-core-regression-checklist.md
git commit -m "docs: add miniapp core regression checklist"
```

Expected:

- Documentation-only commit.

---

## Task 3: Home Search Stabilization

**Purpose:** Make home search consistently full-library, responsive, and reversible.

**Files:**
- Modify: `miniapp/pages/home/home-search.js`
- Modify: `miniapp/pages/home/home-search.test.mjs`
- Modify if needed: `miniapp/pages/home/home.js`
- Modify if needed: `miniapp/pages/home/home.wxml`
- Modify if needed: `miniapp/pages/home/home.wxss`
- Review: `miniapp/services/search-engine.js`
- Review: `miniapp/services/artworks.js`

**Required behavior:**

- Search always queries the full cloud dataset path, not the currently loaded home random sections.
- Search updates while typing.
- Pressing the visible "搜索" button hides the keyboard but does not change search semantics.
- Clearing input restores original home sections.
- Stale async search responses cannot override newer input.
- Ranking priority is title > artist > description.
- Normalization handles punctuation and variants such as `达芬奇`, `达·芬奇`, `列奥纳多`, and `Leonardo da Vinci`.

- [ ] **Step 1: Write stale-response regression test**

Add a test to `miniapp/pages/home/home-search.test.mjs` that models two searches where the older response returns last:

```js
test("home search ignores stale full-library responses", async () => {
  const calls = [];
  const searcher = createHomeSearchController({
    searchArtworks(query) {
      calls.push(query);
      if (query === "梵") {
        return new Promise((resolve) => {
          setTimeout(() => resolve([{ id: "old", title: "旧结果" }]), 20);
        });
      }
      return Promise.resolve([{ id: "new", title: "新结果" }]);
    },
  });

  const first = searcher.search("梵");
  const second = searcher.search("梵高");
  await second;
  await first;

  assert.deepEqual(calls, ["梵", "梵高"]);
  assert.deepEqual(searcher.getState().results.map((item) => item.id), ["new"]);
});
```

If the existing test helper name differs, adapt the test to the current exported API while preserving the same assertion: older results must not replace newer results.

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
node --test miniapp/pages/home/home-search.test.mjs
```

Expected:

- The new test fails before implementation if stale responses are not guarded.

- [ ] **Step 3: Implement request token guard**

In `miniapp/pages/home/home-search.js`, store a monotonically increasing search sequence:

```js
let activeSearchSeq = 0;

async function runFullLibrarySearch(query, searchFn) {
  const seq = activeSearchSeq + 1;
  activeSearchSeq = seq;
  const results = await searchFn(query);
  if (seq !== activeSearchSeq) {
    return { stale: true, results: [] };
  }
  return { stale: false, results };
}
```

Apply the guard to the actual page search flow so only the latest query can update `searchResults`, `searching`, and `searchCount`.

- [ ] **Step 4: Ensure clear restores home**

In `miniapp/pages/home/home.js`, confirm the input handler uses this state transition when `query.trim()` becomes empty:

```js
this.setData({
  searchQuery: "",
  searchMode: false,
  searchResults: [],
  searchTotal: 0,
  searching: false,
  searchError: "",
});
```

Do not reload random sections just because the user cleared search; preserve current home sections unless the page is intentionally refreshed.

- [ ] **Step 5: Verify**

Run:

```powershell
node --test miniapp/pages/home/home-search.test.mjs
node --test miniapp/services/artworks-search.test.mjs
npm run check
npx tsc --noEmit
npm run build
git diff --check
```

Expected:

- Search tests pass.
- Project checks pass.
- Manual check: typing shows results; clearing input restores home.

- [ ] **Step 6: Commit**

```powershell
git add miniapp/pages/home/home-search.js miniapp/pages/home/home-search.test.mjs miniapp/pages/home/home.js miniapp/pages/home/home.wxml miniapp/pages/home/home.wxss miniapp/services/search-engine.js miniapp/services/artworks.js
git diff --cached --stat
git commit -m "fix: stabilize home full-library search"
```

Stage only files that actually changed.

---

## Task 4: Home Horizontal Rows And Card Ratio Stability

**Purpose:** Fix horizontal dragging and ratio stability without redesigning the home cards.

**Files:**
- Modify: `miniapp/components/horizontal-artwork-row/horizontal-artwork-row.js`
- Modify: `miniapp/components/horizontal-artwork-row/horizontal-artwork-row.wxml`
- Modify: `miniapp/components/horizontal-artwork-row/horizontal-artwork-row.wxss`
- Modify: `miniapp/components/horizontal-artwork-row/horizontal-artwork-row-geometry.js`
- Modify: `miniapp/components/horizontal-artwork-row/horizontal-artwork-row-geometry.test.mjs`
- Modify only if necessary: `miniapp/pages/home/home.wxml`
- Modify only if necessary: `miniapp/pages/home/home.wxss`

**Required behavior:**

- Horizontal rows drag smoothly in WeChat Developer Tools and on device.
- Card media height remains fixed.
- Card width is computed from image ratio and fixed media height.
- No max-width should cause wide artworks to be "hard padded" or visually forced into a fixed shape.
- The section should not lose scroll ability after the 8th item.
- Shadow must remain visible and not be clipped.

- [ ] **Step 1: Write geometry regression tests**

Add or extend tests in `miniapp/components/horizontal-artwork-row/horizontal-artwork-row-geometry.test.mjs`:

```js
test("wide artwork width is not capped by card max width", () => {
  const frame = computeArtworkCardFrame({
    ratio: 2.4,
    mediaHeight: 260,
    minWidth: 120,
  });

  assert.equal(frame.height, 260);
  assert.equal(frame.width, 624);
});

test("narrow artwork respects minimum readable width only", () => {
  const frame = computeArtworkCardFrame({
    ratio: 0.35,
    mediaHeight: 260,
    minWidth: 120,
  });

  assert.equal(frame.height, 260);
  assert.equal(frame.width, 120);
});
```

- [ ] **Step 2: Run geometry test and verify failure if max cap still exists**

Run:

```powershell
node --test miniapp/components/horizontal-artwork-row/horizontal-artwork-row-geometry.test.mjs
```

Expected:

- If max width is still applied, the first test fails.

- [ ] **Step 3: Remove max-width from geometry**

In `horizontal-artwork-row-geometry.js`, compute width with:

```js
function computeArtworkCardFrame({ ratio, mediaHeight, minWidth }) {
  const safeHeight = Number(mediaHeight) > 0 ? Number(mediaHeight) : 260;
  const safeRatio = Number(ratio) > 0 ? Number(ratio) : 0.8;
  const safeMinWidth = Number(minWidth) > 0 ? Number(minWidth) : 120;
  return {
    width: Math.max(Math.round(safeHeight * safeRatio), safeMinWidth),
    height: safeHeight,
  };
}
```

Do not introduce a `maxWidth` argument in this sprint.

- [ ] **Step 4: Use native scroll-view first**

Prefer native WeChat horizontal scrolling:

```xml
<scroll-view
  class="artwork-row-scroll"
  scroll-x="true"
  enhanced="true"
  show-scrollbar="false"
>
  <view class="artwork-row-track">
    ...
  </view>
</scroll-view>
```

Avoid manual drag simulations unless native scroll-view is proven insufficient.

- [ ] **Step 5: Ensure the track can exceed viewport width**

In WXSS:

```css
.artwork-row-scroll {
  width: 100%;
  overflow: visible;
}

.artwork-row-track {
  display: flex;
  width: max-content;
  min-width: 100%;
  gap: 28rpx;
  padding: 0 34rpx 24rpx;
  box-sizing: border-box;
}
```

If `max-content` is unreliable in the miniapp runtime, use `white-space: nowrap` on the track and `display: inline-flex` on card wrappers.

- [ ] **Step 6: Verify**

Run:

```powershell
node --test miniapp/components/horizontal-artwork-row/horizontal-artwork-row-geometry.test.mjs
npm run check
npx tsc --noEmit
npm run build
git diff --check
```

Manual check:

- Drag row left and right.
- Drag past the 8th card.
- Confirm wide images are not padded.
- Confirm narrow images only use the minimum readable width.

- [ ] **Step 7: Commit**

```powershell
git add miniapp/components/horizontal-artwork-row
git diff --cached --stat
git commit -m "fix: stabilize home horizontal artwork rows"
```

Include `miniapp/pages/home/*` only if they changed.

---

## Task 5: Artwork Detail Action Polish

**Purpose:** Verify detail actions are fast, consistent, and not visually disruptive.

**Files:**
- Modify if needed: `miniapp/pages/detail/detail.js`
- Modify if needed: `miniapp/pages/detail/detail.wxml`
- Modify if needed: `miniapp/pages/detail/detail.wxss`
- Modify if needed: `miniapp/pages/detail/detail-image-layout.js`
- Modify if needed: `miniapp/pages/detail/detail-image-layout.test.mjs`
- Review: `miniapp/services/downloads.js`
- Review: `miniapp/services/local-library.js`

**Required behavior:**

- Detail image skeleton dimensions should match the final image frame when route ratio exists.
- Download button sits next to favorite and uses only `download_url`.
- Artist pill navigation should not show blocking modal.
- Tag pill navigation should open the tag result page.
- Detail page should not request original/download image unless download is triggered.

- [ ] **Step 1: Add or verify detail image skeleton ratio tests**

In `miniapp/pages/detail/detail-image-layout.test.mjs`, ensure tests cover:

```js
test("detail hero frame respects routed artwork ratio", () => {
  const style = computeDetailHeroFrameStyle(0.72);
  assert.match(style, /aspect-ratio:\s*0\.72/);
});
```

If the project uses a different style output, assert the actual stable style string.

- [ ] **Step 2: Verify download URL tests**

Run:

```powershell
node --test miniapp/services/downloads.test.mjs
node --test miniapp/services/local-library.test.mjs
node --test miniapp/pages/detail/detail-image-layout.test.mjs
```

Expected:

- Download tests confirm no fallback to thumbnail/display image.
- Detail layout tests pass.

- [ ] **Step 3: Fix only failing detail action behavior**

Allowed changes:

- Button spacing in `detail.wxss`.
- Skeleton ratio in `detail.wxml/detail.wxss`.
- Event handler correctness in `detail.js`.

Disallowed changes:

- No new download source fallback.
- No original image display.
- No visual redesign.

- [ ] **Step 4: Verify**

Run:

```powershell
node --test miniapp/services/downloads.test.mjs
node --test miniapp/services/local-library.test.mjs
node --test miniapp/pages/detail/detail-image-layout.test.mjs
npm run check
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add miniapp/pages/detail miniapp/services/downloads.js miniapp/services/local-library.js
git diff --cached --stat
git commit -m "fix: polish artwork detail actions"
```

Stage only changed files.

---

## Task 6: Artist Cloud Source And Pagination Hardening

**Purpose:** Ensure artist list/detail always prefer cloud data and paginate without replacing existing content.

**Files:**
- Modify if needed: `miniapp/pages/artists/artists.js`
- Modify if needed: `miniapp/pages/artists/artists.wxml`
- Modify if needed: `miniapp/pages/artists/artists.wxss`
- Modify if needed: `miniapp/pages/artist-detail/artist-detail.js`
- Modify if needed: `miniapp/services/artists.js`
- Modify if needed: `miniapp/services/artists.test.mjs`
- Review: `miniapp/data/mock-artists.js`

**Required behavior:**

- Artists page shows all cloud artists through incremental pagination.
- Local mock artists are fallback only when cloud is unavailable and fallback is explicitly allowed.
- Reaching bottom appends 8 artists.
- Existing scroll/content remains stable after append.
- Artist detail related artworks load 8 at a time.
- Artist detail does not display a right-side total if it causes confusing "读取中" states.

- [ ] **Step 1: Confirm service tests for pagination**

Run:

```powershell
node --test miniapp/services/artists.test.mjs
```

Expected:

- Tests cover `loadArtists` multi-page cloud reads.
- Tests cover `appendArtistPage`.
- Tests cover direct `doc(id)` lookup.

- [ ] **Step 2: Add page-level append regression if missing**

In `miniapp/pages/artist-detail/artist-detail.test.mjs`, add behavior equivalent to:

```js
test("artist detail appends related artworks without replacing existing items", async () => {
  const page = createArtistDetailPageHarness({
    firstPage: [{ id: "a1" }, { id: "a2" }],
    secondPage: [{ id: "a3" }, { id: "a4" }],
  });

  await page.loadInitialArtworks({ aliases: ["Vincent van Gogh"] });
  await page.loadMore();

  assert.deepEqual(page.data.artworks.map((item) => item.id), ["a1", "a2", "a3", "a4"]);
});
```

If no harness exists, add a small pure helper in the test file rather than exporting page internals.

- [ ] **Step 3: Verify**

Run:

```powershell
node --test miniapp/pages/artist-detail/artist-detail.test.mjs
node --test miniapp/services/artists.test.mjs
npm run check
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] **Step 4: Commit**

```powershell
git add miniapp/pages/artists miniapp/pages/artist-detail miniapp/services/artists.js miniapp/services/artists.test.mjs
git diff --cached --stat
git commit -m "fix: harden cloud artist pagination"
```

Stage only changed files.

---

## Task 7: Category And Tag Result Consistency

**Purpose:** Align category/tag result card behavior with home and ensure pagination hooks are reliable.

**Files:**
- Modify if needed: `miniapp/pages/category/category.js`
- Modify if needed: `miniapp/pages/category/category.wxml`
- Modify if needed: `miniapp/pages/category/category.wxss`
- Modify if needed: `miniapp/pages/tag/tag.js`
- Modify if needed: `miniapp/pages/tag/tag.wxml`
- Modify if needed: `miniapp/pages/tag/tag.wxss`
- Modify if needed: `miniapp/components/artwork-card/artwork-card.*`

**Required behavior:**

- Category and tag pages use two-column result grids.
- Card shadows are visible.
- Title and artist text are one line with ellipsis.
- Pagination appends new cards and does not replace existing cards.
- Cards use `thumbnail_url` through `ArtworkImage`.

- [ ] **Step 1: Add/verify artwork-card text truncation rules**

In `miniapp/components/artwork-card/artwork-card.wxss`, confirm the title and meta use:

```css
.artwork-title,
.artwork-meta {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
```

- [ ] **Step 2: Verify image source restrictions**

Run:

```powershell
npm run check
```

Expected:

- Existing static rules do not report display-layer `download_url` usage.

- [ ] **Step 3: Manual WeChat checks**

Use Developer Tools:

- Select a category filter.
- Scroll to bottom.
- Confirm next page appends.
- Open a card.
- Return to category page.
- Confirm previous scroll content remains stable.

- [ ] **Step 4: Verify**

Run:

```powershell
npm run check
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add miniapp/pages/category miniapp/pages/tag miniapp/components/artwork-card
git diff --cached --stat
git commit -m "fix: align category and tag artwork cards"
```

Stage only changed files.

---

## Task 8: Final Miniapp UX Polish Pass

**Purpose:** Make small UI corrections after functional stability is verified.

**Files:**
- Modify only files required by concrete visual defects found in the regression checklist.

**Allowed polish:**

- Minor spacing adjustments.
- Minor shadow opacity adjustments.
- Text truncation consistency.
- Loading skeleton alignment.
- Empty/error copy clarity.

**Disallowed polish:**

- No new pages.
- No new major components.
- No layout redesign.
- No new third-party UI libraries.

- [ ] **Step 1: Run manual checklist**

Use `docs/miniapp-core-regression-checklist.md` and mark every item.

- [ ] **Step 2: Create a punch list**

If visual defects remain, add a dated note to:

```text
docs/miniapp-ui-polish-notes.md
```

Use this format:

```markdown
# Miniapp UI Polish Notes

## 2026-06-28

- Home: [specific issue, screenshot reference if available]
- Category: [specific issue, screenshot reference if available]
- Artist Detail: [specific issue, screenshot reference if available]
```

- [ ] **Step 3: Fix only P0 visual defects**

P0 means:

- User cannot complete a core action.
- Content is visually clipped.
- Wrong image source is requested.
- Loading/empty/error state is misleading.

- [ ] **Step 4: Verify**

Run:

```powershell
node --test miniapp/services/*.test.mjs
npm run check
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] **Step 5: Commit**

```powershell
git add docs/miniapp-ui-polish-notes.md miniapp
git diff --cached --stat
git commit -m "fix: polish miniapp core experience"
```

Before committing, inspect `git diff --cached --stat` and unstage unrelated files.

---

## Execution Order

1. Task 1: Freeze current verified work.
2. Task 2: Add regression checklist.
3. Task 3: Stabilize home search.
4. Task 4: Stabilize home horizontal rows and card ratios.
5. Task 5: Polish artwork detail actions.
6. Task 6: Harden artist cloud source and pagination.
7. Task 7: Align category/tag cards.
8. Task 8: Final UI polish pass.

## Commit Strategy

- One task, one commit.
- Do not combine data migration, UI fixes, and service refactors in one commit.
- Before every commit:

```powershell
git diff --cached --stat
git diff --cached --check
```

- After every commit:

```powershell
git status --short
```

## Global Verification Commands

Run before declaring any task complete:

```powershell
node --test miniapp/services/*.test.mjs
npm run check
npx tsc --noEmit
npm run build
git diff --check
```

When a task only affects page layout and has no service tests, still run:

```powershell
npm run check
npx tsc --noEmit
npm run build
git diff --check
```

## Risk Register

- **Home horizontal scrolling:** WeChat `scroll-view` gesture behavior differs between Developer Tools and real devices. Verify both.
- **Card ratio logic:** Removing width caps improves accurate ratios but can create very wide cards. Minimum width is acceptable; maximum width should not be reintroduced without explicit design approval.
- **Full-library search:** Cloud query latency can produce stale responses. Request sequencing must prevent old results from overwriting new results.
- **Artist source:** Local mock data should remain fallback only. Do not let fallback mask cloud permission or collection issues in normal operation.
- **Download flow:** Download must be the only path that uses `download_url`.
- **Untracked docs:** Several historical plan docs are currently untracked. Stage them only when intentionally submitting documentation.

## Definition Of Done

This sprint is done when:

- All Tasks 1-8 are either completed or explicitly deferred.
- Command checks pass.
- WeChat Developer Tools manual checklist passes for home, category, artwork detail, artists, and artist detail.
- No current core page depends on local mock data when cloud data is available.
- Home search is full-library and reversible.
- Horizontal card rows preserve fixed media height and ratio-based width.
- Artwork display paths still use `thumbnail_url` for lists and `display_url` for details.
- `download_url` is used only by download behavior.
