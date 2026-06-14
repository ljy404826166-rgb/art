# Page-Level Data Error State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace raw paintings fetch failure text with a unified, friendly page-level ErrorState that supports retry and keeps technical details out of the UI.

**Architecture:** Keep the fix local to the existing frontend. Add lightweight state-rendering helpers in `src/app.js`, reuse existing app chrome and bottom navigation, and add small CSS rules in `src/styles.css` that fit the current mobile art gallery visual language. Do not change Supabase/Auth/RBAC/RLS/database logic, image fallback behavior, seed scripts, validation scripts, or bottom navigation styling.

**Tech Stack:** Vite, vanilla JavaScript, CSS, existing Supabase client reads, existing DOM render functions.

---

## Current State

### Paintings Fetch Location

Paintings data is read in `src/app.js`:

- `loadPaintings()` starts at `src/app.js:2031`.
- It calls `fetchPaintings()` from `src/lib/paintings.ts`.
- `fetchPaintings()` calls `fetchArtworks()` from `src/lib/artworks.ts`.
- `fetchArtworks()` queries Supabase `published_artworks` through the existing Supabase client.

Relevant current flow:

```js
async function loadPaintings() {
  state.loading = true;
  state.error = "";
  state.visibleTagCount = TAG_BATCH_SIZE;
  state.rowLimits.clear();
  setStatus("");
  render();

  try {
    state.paintings = await fetchPaintings();
    await refreshRecommendations({ renderAfter: false });
  } catch (error) {
    state.error = error instanceof Error ? error.message : "未知错误";
  } finally {
    state.loading = false;
    render();
  }
}
```

### Current Error Storage And Rendering

Current error state is stored globally as `state.error`.

The homepage renders the raw error in `renderRecommendationFeed()`:

```js
if (state.error) {
  nodes.grid.innerHTML = `<div class="empty-state">读取 paintings 失败：${escapeHtml(state.error)}</div>`;
  return;
}
```

This is why offline mode displays `TypeError: Failed to fetch`: the UI renders `error.message` directly.

The category/favorite list renderer also exposes raw error text:

```js
if (state.error) {
  container.innerHTML = `<div class="empty-state">读取失败：${escapeHtml(state.error)}</div>`;
  return;
}
```

### Existing ErrorState Component Status

There is no implemented reusable `ErrorState`, `EmptyState`, or `LoadingState` component/helper in source code.

There is an implementation plan at `docs/superpowers/plans/2026-05-18-image-empty-error-states.md`, but the current app code still uses:

- inline `.empty-state` strings,
- `renderLoading()` only for the homepage spinner,
- `attachImageFallback()` for image URL failures.

Therefore this plan must add a lightweight ErrorState helper rather than trying to reuse a missing component.

## File Structure

Modify only:

- `src/app.js`
  - Add small page state helper functions near existing render helpers.
  - Normalize user-facing error messages.
  - Replace raw `state.error` UI branches in homepage and list renderers.
  - Add retry button event handling after injected ErrorState markup.
  - Add optional console logging in `loadPaintings()` without exposing technical text in UI.

- `src/styles.css`
  - Add `.state-panel`, `.state-panel[data-state="error"]`, `.state-action`, and compact variants.
  - Keep visual style restrained: white panel, subtle dashed/solid border, small icon/label, muted copy, clear button.
  - Do not alter bottom navigation selectors or existing card/image layout selectors.

Do not modify:

- `src/lib/supabase.ts`
- `src/lib/artworks.ts`
- `src/lib/paintings.ts`
- `src/lib/user-library.ts`
- `supabase/`
- `scripts/`
- SQL files
- validation scripts
- bottom navigation CSS
- `attachImageFallback()` behavior

---

### Task 1: Add Lightweight Page State Helpers

**Files:**
- Modify: `src/app.js`, near `renderLoading()` and other render helpers.
- Modify: `src/styles.css`, near existing `.empty-state` and loading state rules.

- [ ] **Step 1: Add a user-facing error classifier in `src/app.js`**

Add these helpers near `renderLoading()`:

```js
function isOfflineError() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function pageDataErrorCopy(error, context = "gallery") {
  if (isOfflineError()) {
    return {
      title: "暂时无法连接画廊",
      description: "请检查网络后重试。",
    };
  }

  if (context === "detail") {
    return {
      title: "暂时无法打开作品详情",
      description: "请稍后重试，或返回画廊继续浏览。",
    };
  }

  if (context === "downloads") {
    return {
      title: "暂时无法读取下载记录",
      description: "请稍后重试，或清理本机记录后再查看。",
    };
  }

  return {
    title: "暂时无法连接画廊",
    description: "请检查网络后重试。",
  };
}
```

Rationale:

- `navigator.onLine` is only a hint, but enough to tailor offline copy.
- `error` is accepted for future extension, but not displayed.
- UI copy avoids `TypeError: Failed to fetch` and Supabase internal messages.

- [ ] **Step 2: Add ErrorState markup helper in `src/app.js`**

Add below `pageDataErrorCopy()`:

```js
function errorStateMarkup(options = {}) {
  const {
    title = "暂时无法连接画廊",
    description = "请检查网络后重试。",
    retryLabel = "重新加载",
    compact = false,
    action = "reloadPaintings",
  } = options;

  return `
    <section class="state-panel" data-state="error" data-compact="${String(compact)}" role="status" aria-live="polite">
      <div class="state-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
          <path d="M10.3 4.3 2.8 17.2A2 2 0 0 0 4.5 20h15a2 2 0 0 0 1.7-2.8L13.7 4.3a2 2 0 0 0-3.4 0Z" />
        </svg>
      </div>
      <div class="state-copy">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
      <button class="state-action" type="button" data-state-action="${escapeHtml(action)}">${escapeHtml(retryLabel)}</button>
    </section>
  `;
}
```

Rationale:

- Uses semantic section and `role="status"`.
- Keeps bottom navigation untouched because it renders inside existing content area.
- Provides a button hook without global inline JS.

- [ ] **Step 3: Add a binder for ErrorState actions**

Add below `errorStateMarkup()`:

```js
function bindStateActions(scope = document) {
  scope.querySelectorAll("[data-state-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.stateAction === "reloadPaintings") {
        loadPaintings();
      }
    });
  });
}
```

Rationale:

- Keeps retry behavior local and explicit.
- Reuses existing `loadPaintings()` path.
- Does not change Supabase query behavior.

- [ ] **Step 4: Add CSS for the page state panel**

Add near existing `.empty-state` or loading rules in `src/styles.css`:

```css
.state-panel {
  display: grid;
  grid-column: 1 / -1;
  min-height: 132px;
  place-items: center;
  gap: 12px;
  padding: 24px 22px;
  border: 1px solid rgba(31, 35, 40, 0.08);
  border-radius: 12px;
  color: var(--ink);
  background: #ffffff;
  text-align: center;
}

.state-panel[data-state="error"] {
  border-style: dashed;
  border-color: rgba(104, 65, 59, 0.18);
}

.state-panel[data-compact="true"] {
  min-height: 112px;
  padding: 20px 18px;
}

.state-mark {
  display: grid;
  width: 36px;
  height: 36px;
  place-items: center;
  border-radius: 999px;
  color: #68413b;
  background: rgba(104, 65, 59, 0.08);
}

.state-mark svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.state-copy h2 {
  margin: 0;
  color: #3f3f3f;
  font-size: 1rem;
  font-weight: 700;
  letter-spacing: 0;
}

.state-copy p {
  margin: 6px 0 0;
  color: #77716b;
  font-size: 0.88rem;
  line-height: 1.45;
}

.state-action {
  min-height: 36px;
  border: 0;
  border-radius: 999px;
  padding: 0 18px;
  color: #ffffff;
  background: #1f2328;
  cursor: pointer;
  font-size: 0.88rem;
  font-weight: 700;
}
```

Expected visual behavior:

- Error area is clear but not oversized.
- It uses the app’s existing neutral gallery palette.
- Bottom navigation remains visible and usable because no fixed overlay is introduced.

---

### Task 2: Connect Homepage Paintings Fetch Failure

**Files:**
- Modify: `src/app.js`, `renderRecommendationFeed()`.

- [ ] **Step 1: Replace raw homepage error rendering**

Replace the current `state.error` branch in `renderRecommendationFeed()`:

```js
if (state.error) {
  const copy = pageDataErrorCopy(state.error, "gallery");
  nodes.grid.innerHTML = errorStateMarkup({
    title: copy.title,
    description: copy.description,
    retryLabel: "重新加载",
    compact: false,
  });
  bindStateActions(nodes.grid);
  return;
}
```

Expected offline UI:

- Title: `暂时无法连接画廊`
- Description: `请检查网络后重试。`
- Button: `重新加载`

- [ ] **Step 2: Preserve loading and empty behavior**

Keep these branches in the same order:

```js
if (state.loading) {
  renderLoading();
  return;
}

if (state.error) {
  // ErrorState branch from Step 1.
  return;
}

const sections = homeSections();
nodes.grid.innerHTML = "";
if (!sections.length) {
  nodes.grid.innerHTML = `<div class="empty-state">paintings 表暂无数据</div>`;
  return;
}
```

Rationale:

- Loading remains separate.
- Empty data remains separate from data loading failure.
- Error no longer leaks raw messages.

---

### Task 3: Connect Category Page Data Failure

**Files:**
- Modify: `src/app.js`, `renderCategories()` and `renderCategoryCards()`.

- [ ] **Step 1: Prevent category filters from rendering misleading empty content during global data failure**

At the start of `renderCategories()`, after determining loading/error state but before generating tag groups, add:

```js
if (state.error) {
  nodes.categoryGrid.innerHTML = "";
  nodes.categoryResultTitle.textContent = "分类结果";
  nodes.categoryResultEyebrow.textContent = "无法读取";
  const copy = pageDataErrorCopy(state.error, "gallery");
  nodes.categoryResults.innerHTML = errorStateMarkup({
    title: copy.title,
    description: copy.description,
    retryLabel: "重新加载",
    compact: true,
  });
  bindStateActions(nodes.categoryResults);
  return;
}
```

Rationale:

- If paintings cannot be read, category filters cannot be trusted because they are derived from paintings data.
- The bottom nav remains available.

- [ ] **Step 2: Replace raw list-renderer error branch**

In `renderCategoryCards()`, replace:

```js
if (state.error) {
  container.innerHTML = `<div class="empty-state">读取失败：${escapeHtml(state.error)}</div>`;
  return;
}
```

with:

```js
if (state.error) {
  const copy = pageDataErrorCopy(state.error, "gallery");
  container.innerHTML = errorStateMarkup({
    title: copy.title,
    description: copy.description,
    retryLabel: "重新加载",
    compact: true,
  });
  bindStateActions(container);
  return;
}
```

Rationale:

- This also covers favorite/history/profile route grids that use `renderCategoryCards()`.
- Raw technical error text stays out of UI.

---

### Task 4: Detail Page Data Failure Behavior

**Files:**
- Modify: `src/app.js`, `openDrawer(item)`.

- [ ] **Step 1: Add a guard for missing detail data**

At the top of `openDrawer(item)`, before using item fields, add:

```js
if (!item || !item.id) {
  window.clearTimeout(detailCloseTimer);
  currentDetailItem = null;
  nodes.drawerImage.removeAttribute("src");
  nodes.drawerImage.alt = "";
  nodes.detailTitleCn.textContent = "作品详情";
  nodes.detailTitleEn.textContent = "";
  nodes.detailCreator.textContent = "";
  nodes.detailLocation.textContent = "";
  nodes.detailCreated.textContent = "";
  nodes.detailMedium.textContent = "";
  nodes.detailDimensions.textContent = "";
  nodes.detailDescription.innerHTML = errorStateMarkup({
    ...pageDataErrorCopy(null, "detail"),
    retryLabel: "返回画廊",
    compact: true,
    action: "closeDetail",
  });
  nodes.detailTags.innerHTML = "";
  nodes.drawer.dataset.mounted = "true";
  requestAnimationFrame(() => {
    nodes.drawer.setAttribute("aria-hidden", "false");
  });
  document.body.classList.add("drawer-open");
  bindStateActions(nodes.detailDescription);
  return;
}
```

- [ ] **Step 2: Extend `bindStateActions()` for closing detail**

Update `bindStateActions()`:

```js
function bindStateActions(scope = document) {
  scope.querySelectorAll("[data-state-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.stateAction === "reloadPaintings") {
        loadPaintings();
      }

      if (button.dataset.stateAction === "closeDetail") {
        closeDrawer();
      }
    });
  });
}
```

Rationale:

- Current detail pages are opened from already-loaded items, so this is defensive.
- It does not interfere with image fallback for failed detail artwork image URLs.

---

### Task 5: Download Management Failure Behavior

**Files:**
- Modify: `src/app.js`, `readLocalDownloadRecords()`, `state`, `renderDownloadRecords()`, and settings clear paths if needed.

- [ ] **Step 1: Add local download error state field**

Add to `state` initialization:

```js
downloadError: "",
```

- [ ] **Step 2: Preserve localStorage read errors instead of silently returning empty**

Change `readLocalDownloadRecords()` catch behavior from returning only `[]` to recording error after state exists. Because `state` is initialized using this function, keep initial read safe:

```js
function readLocalDownloadRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(downloadStorageKey) || "[]");
    if (!Array.isArray(records)) return [];
    return records.map(normalizeDownloadRecord).filter(Boolean);
  } catch (error) {
    console.error("Download records read failed", error);
    return [];
  }
}
```

Then add a reload helper after `saveLocalDownloadRecords()`:

```js
function reloadLocalDownloadRecords() {
  try {
    state.downloadError = "";
    state.downloads = readLocalDownloadRecords();
  } catch (error) {
    console.error("Download records reload failed", error);
    state.downloadError = error instanceof Error ? error.message : "unknown";
  }
}
```

Note:

- The current `readLocalDownloadRecords()` already catches errors, so a true ErrorState for downloads requires either a reload helper that can record errors or an explicit validation path.
- Keep this minimal; do not redesign download storage.

- [ ] **Step 3: Render download ErrorState when `state.downloadError` exists**

At the top of `renderDownloadRecords(container, records)`, add:

```js
if (state.downloadError) {
  const copy = pageDataErrorCopy(state.downloadError, "downloads");
  container.innerHTML = errorStateMarkup({
    title: copy.title,
    description: copy.description,
    retryLabel: "重新读取",
    compact: true,
    action: "reloadDownloads",
  });
  bindStateActions(container);
  return;
}
```

- [ ] **Step 4: Extend `bindStateActions()` for download retry**

Add:

```js
if (button.dataset.stateAction === "reloadDownloads") {
  reloadLocalDownloadRecords();
  renderProfile();
  if (nodes.profileRoute?.getAttribute("aria-hidden") === "false") {
    openProfileRoute("downloads");
  }
}
```

Rationale:

- Download management is local-first.
- No Supabase/Auth/RLS/database changes.
- Empty downloads remain an EmptyState, not an ErrorState.

---

### Task 6: Preserve Developer Debug Information Without Exposing It In UI

**Files:**
- Modify: `src/app.js`, `loadPaintings()`.

- [ ] **Step 1: Add console logging in the catch block**

Change the `loadPaintings()` catch block:

```js
} catch (error) {
  console.error("Paintings fetch failed", error);
  state.error = error instanceof Error ? error.message : "未知错误";
}
```

Rationale:

- Technical detail remains available in DevTools.
- UI uses `pageDataErrorCopy()` and never directly renders `state.error`.
- This preserves debugging value without showing `TypeError: Failed to fetch` to users.

- [ ] **Step 2: Confirm no raw error string is rendered**

Search:

```powershell
rg -n "state\\.error|读取 paintings 失败|读取失败" src\\app.js
```

Expected:

- `state.error` remains as internal state and in console-oriented logic.
- No UI string directly includes `${escapeHtml(state.error)}`.

---

### Task 7: Verification

**Files:**
- No source changes beyond previous tasks.

- [ ] **Step 1: Static search for raw error leakage**

Run:

```powershell
rg -n "TypeError: Failed to fetch|读取 paintings 失败|读取失败：\\$\\{escapeHtml\\(state\\.error\\)\\}|Supabase paintings 读取失败" src
```

Expected:

- No homepage/category UI branch renders raw `state.error`.
- Profile metadata may still reference failure in non-user-facing internal state only if it does not include raw technical message. If it does, replace with friendly text in the same implementation pass.

- [ ] **Step 2: Run syntax check**

Run:

```powershell
node --check src\\app.js
```

Expected:

- Exit code `0`.

- [ ] **Step 3: Run requested project checks**

Run:

```powershell
npm.cmd run check
npx.cmd tsc --noEmit
git diff --check
```

Expected based on current repo state:

- `git diff --check` exits `0`, allowing existing CRLF warnings.
- `npm.cmd run check` may fail if `src/data/seed-artworks.js` remains absent. Do not modify `scripts/` or seed files for this task.
- `npx.cmd tsc --noEmit` may print help and exit non-zero if no `tsconfig.json` exists. Do not add TypeScript config for this task.

Record exact outputs in the final implementation summary.

- [ ] **Step 4: Manual offline verification in browser**

Use browser DevTools Network tab:

1. Set network to Offline.
2. Reload `http://127.0.0.1:5173/`.
3. Confirm homepage shows:
   - `暂时无法连接画廊`
   - `请检查网络后重试。`
   - `重新加载` button
4. Confirm UI does not show:
   - `TypeError: Failed to fetch`
   - raw Supabase error messages
   - stack traces
5. Confirm bottom navigation remains visible and tappable.
6. Click 分类.
7. Confirm category page shows the same friendly ErrorState or equivalent compact state.
8. Restore network.
9. Click `重新加载`.
10. Confirm paintings render again.

- [ ] **Step 5: Image fallback regression check**

Temporarily inspect an item with an invalid image URL or block image requests in DevTools:

1. Keep data fetch online.
2. Trigger an image URL failure.
3. Confirm card image uses `.image-missing` placeholder.
4. Confirm image failure does not show page-level ErrorState.

Rationale:

- Separates image fallback failures from page-level data fetch failures.

---

## Risk Points

- `navigator.onLine` is not perfectly reliable. Treat it only as a copy hint, not as business logic.
- `state.error` is global. Changing all render branches must avoid accidentally hiding valid empty states.
- `renderCategoryCards()` is reused by profile routes. Its ErrorState must be compact so it does not overwhelm route drawers.
- `bindStateActions()` injects event listeners after `innerHTML`; each render replaces nodes, so duplicate listeners are unlikely, but implementation should only bind inside the freshly rendered scope.
- `loadPaintings()` calls `render()` before and after fetch. Retry button must tolerate repeated clicks during loading; the existing `state.loading` branch handles most of this.
- Download record errors are currently swallowed. Showing a true download ErrorState requires careful minimal changes so empty download records do not become false errors.
- CSS must not touch `.main-nav`, `.main-nav-item`, recommendation card layout, or image fallback selectors.
- Do not add offline caching in this task. It changes persistence behavior and should be a separate design.

## Out Of Scope

- Offline cache or “recently viewed data” mode.
- Supabase retry/backoff changes.
- Auth/RBAC/RLS/database changes.
- SQL or seed script changes.
- Bottom navigation redesign.
- Homepage card layout changes.
- Image fallback redesign.
- Automatic commit, merge, or push.

## Self-Review

- Spec coverage: The plan covers fetch location, error storage/rendering, lack of existing ErrorState, new lightweight helper, homepage/category/detail/download handling, retry, offline copy, debug logging, verification, and risks.
- Placeholder scan: No implementation step uses placeholders such as TBD or generic “handle errors”; each step names exact functions and behavior.
- Type consistency: Helper names are consistent across tasks: `pageDataErrorCopy`, `errorStateMarkup`, `bindStateActions`, `reloadLocalDownloadRecords`, `loadPaintings`, and `closeDrawer`.
