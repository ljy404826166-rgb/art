# Home Horizontal Card Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-row horizontal pagination to the miniapp home page so every row starts with 8 artwork cards and appends another 8 cards when scrolled to the right edge.

**Architecture:** Keep the current home page and card component structure. Add a focused CommonJS pagination helper next to `home.js` for row-state and de-duplication behavior, then wire `scroll-view` lower-edge events to row-specific loaders in `home.js`.

**Tech Stack:** WeChat Mini Program WXML/WXSS/CommonJS, existing artwork service methods, Node `node:test` for the helper test.

---

### Task 1: Test Row Pagination Helpers

**Files:**
- Create: `miniapp/pages/home/home-pagination.js`
- Create: `miniapp/pages/home/home-pagination.test.mjs`

- [ ] **Step 1: Write the failing helper test**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadCommonJsModule(filePath) {
  const source = readFileSync(filePath, "utf8");
  const module = { exports: {} };
  vm.runInNewContext(source, { module, exports: module.exports }, { filename: filePath });
  return module.exports;
}

const {
  createPaginatedSection,
  getFreshArtworkBatch,
  getArtworkKey,
} = loadCommonJsModule(new URL("./home-pagination.js", import.meta.url));

test("createPaginatedSection keeps only the first row batch and initializes pagination state", () => {
  const section = createPaginatedSection({
    key: "tag:portrait",
    tag: "portrait",
    items: Array.from({ length: 10 }, (_, index) => ({ id: `art-${index}` })),
  }, { rowLimit: 8 });

  assert.equal(section.items.length, 8);
  assert.equal(section.skip, 8);
  assert.equal(section.hasMore, true);
  assert.equal(section.loadingMore, false);
});

test("getFreshArtworkBatch appends only unseen artworks up to the row limit", () => {
  const existing = [{ id: "a" }, { _id: "b" }];
  const incoming = [
    { id: "a" },
    { id: "c" },
    { _id: "d" },
    { source_id: "e" },
  ];

  assert.deepEqual(getFreshArtworkBatch(existing, incoming, 2).map(getArtworkKey), ["c", "d"]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test miniapp/pages/home/home-pagination.test.mjs`

Expected: failure because `miniapp/pages/home/home-pagination.js` does not exist yet.

- [ ] **Step 3: Implement the helper**

```js
const DEFAULT_ROW_LIMIT = 8;

function getArtworkKey(item) {
  return item && (item._id || item.id || item.supabase_id || item.source_id || item.title);
}

function getFreshArtworkBatch(existingItems, incomingItems, limit) {
  const rowLimit = Number(limit || DEFAULT_ROW_LIMIT);
  const seen = {};
  (existingItems || []).forEach((item) => {
    const key = getArtworkKey(item);
    if (key) seen[key] = true;
  });

  const fresh = [];
  (incomingItems || []).forEach((item) => {
    const key = getArtworkKey(item);
    if (!key || seen[key] || fresh.length >= rowLimit) return;
    seen[key] = true;
    fresh.push(item);
  });
  return fresh;
}

function createPaginatedSection(section, options) {
  const rowLimit = Number((options && options.rowLimit) || DEFAULT_ROW_LIMIT);
  const sourceItems = (section && section.items) || [];
  const items = sourceItems.slice(0, rowLimit);
  const explicitSkip = section && Number(section.skip);
  const skip = Number.isFinite(explicitSkip) ? explicitSkip : items.length;
  const explicitHasMore = section && typeof section.hasMore === "boolean";

  return {
    ...section,
    items,
    skip,
    hasMore: explicitHasMore ? section.hasMore : sourceItems.length >= rowLimit,
    loadingMore: false,
  };
}

module.exports = {
  DEFAULT_ROW_LIMIT,
  createPaginatedSection,
  getArtworkKey,
  getFreshArtworkBatch,
};
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `node --test miniapp/pages/home/home-pagination.test.mjs`

Expected: both helper tests pass.

### Task 2: Wire Home Rows To Horizontal Loading

**Files:**
- Modify: `miniapp/pages/home/home.js`
- Modify: `miniapp/pages/home/home.wxml`
- Modify: `miniapp/pages/home/home.wxss`

- [ ] **Step 1: Import helper and tag loader**

In `home.js`, import `fetchArtworksByTag` from `../../services/artworks` and helper functions from `./home-pagination`.

- [ ] **Step 2: Initialize each section with pagination state**

Wrap every section returned by `buildSections` and `buildAppendSections` with `createPaginatedSection(section, { rowLimit: ROW_LIMIT })`.

- [ ] **Step 3: Add row loading methods**

Add `handleSectionScrollToLower`, `loadRecommendationRowMore`, `loadTagRowMore`, `getFallbackRowItems`, and `applySectionAppend`. These methods should set `sections[index].loadingMore`, fetch the correct source, append `getFreshArtworkBatch(...)`, update `skip` and `hasMore`, and preserve `scrollLeft`.

- [ ] **Step 4: Bind lower-edge events in WXML**

Add `lower-threshold="120"` and `bindscrolltolower="handleSectionScrollToLower"` to the home row `scroll-view`. Render a compact inline loading status after cards when `item.loadingMore` is true.

- [ ] **Step 5: Add row loading styles**

Add `.recommendation-row-status` styles so the inline loading status has stable width and does not resize cards.

### Task 3: Verify

**Files:**
- Verify: `miniapp/pages/home/home-pagination.test.mjs`
- Verify: existing project checks where practical

- [ ] **Step 1: Run helper test**

Run: `node --test miniapp/pages/home/home-pagination.test.mjs`

Expected: all tests pass.

- [ ] **Step 2: Run project check**

Run: `npm.cmd run check`

Expected: validation completes without errors.

- [ ] **Step 3: Inspect diff**

Run: `git diff -- miniapp/pages/home miniapp/components/artwork-card docs/superpowers/plans/2026-06-17-home-horizontal-card-pagination.md`

Expected: diff contains only the intended pagination helper, home row event wiring, and row loading styles.
