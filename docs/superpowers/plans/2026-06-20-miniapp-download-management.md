# Miniapp Download Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the miniapp download workflow by recording successful artwork downloads locally and exposing a usable download management entry from the Profile page.

**Architecture:** Keep download behavior front-end only and local-first. `download_url` remains isolated to the explicit download action; artwork display continues to use `thumbnail_url` for lists and `display_url` for detail. Download records are stored in the existing local library service and surfaced through a new lightweight `pages/downloads/downloads` page that reuses the same artwork-card grid pattern as favorites/history.

**Tech Stack:** WeChat Mini Program native pages, `wx.downloadFile`, `wx.saveImageToPhotosAlbum`, `wx.getStorageSync` / `wx.setStorageSync`, local CommonJS services, Node test runner.

---

## Current Context

Already committed:

- `miniapp/services/downloads.js` resolves and saves downloads using only `download_url`.
- `miniapp/pages/detail/detail.js` has a download button beside favorite.
- `miniapp/pages/detail/detail.wxml` renders the download button.
- `miniapp/pages/detail/detail.wxss` styles the download button.
- `miniapp/services/downloads.test.mjs` verifies `download_url` isolation.

Current uncommitted WIP:

- `miniapp/services/local-library.js` already contains a partial download-history service:
  - `DOWNLOAD_IDS_KEY`
  - `DOWNLOAD_ITEMS_KEY`
  - `DOWNLOAD_LIMIT`
  - `getDownloadArtworks`
  - `recordDownloadArtwork`
  - `clearDownloadArtworks`
  - `downloads` count in `getLibraryStats`
- This is not yet wired into the detail page or Profile page.

Missing:

- Detail page does not call `recordDownloadArtwork` after successful save.
- There is no `pages/downloads/downloads` route.
- Profile page still has “下载管理” as disabled.
- There are no local-library unit tests for download records.

Non-goals:

- Do not upload files to cloud storage.
- Do not write to WeChat Cloud Database.
- Do not add auth/login/RBAC.
- Do not change image derivative scripts.
- Do not use `download_url` for default display.
- Do not change home card geometry, shadows, or horizontal scrolling.

---

## File Structure

Create:

- `miniapp/pages/downloads/downloads.js`: reads local download records, clears records, opens artwork detail.
- `miniapp/pages/downloads/downloads.json`: page metadata and component registration if needed.
- `miniapp/pages/downloads/downloads.wxml`: page layout, empty state, clear button, artwork grid.
- `miniapp/pages/downloads/downloads.wxss`: page styling, aligned with favorites/history.
- `miniapp/services/local-library.test.mjs`: local storage unit tests for favorites/history/download bookkeeping.

Modify:

- `miniapp/services/local-library.js`: finalize download record helpers and make behavior testable.
- `miniapp/pages/detail/detail.js`: record a download only after `saveImageToPhotosAlbum` succeeds.
- `miniapp/pages/profile/profile.js`: add download count support and enable `/pages/downloads/downloads`.
- `miniapp/app.json`: register `pages/downloads/downloads`.

Do not modify:

- `miniapp/services/downloads.js`, unless tests expose a defect.
- `miniapp/components/artwork-image/*`.
- `miniapp/pages/home/*`.
- `miniapp/pages/category/*`.
- Cloud database scripts.

---

## Task 1: Finalize Local Download Record Service

**Files:**

- Modify: `miniapp/services/local-library.js`
- Create: `miniapp/services/local-library.test.mjs`

- [ ] **Step 1: Write local-library tests**

Create `miniapp/services/local-library.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function createStorageWx() {
  const store = new Map();
  return {
    getStorageSync(key) {
      return store.get(key);
    },
    setStorageSync(key, value) {
      store.set(key, value);
    },
    dump() {
      return Object.fromEntries(store.entries());
    },
  };
}

function loadLocalLibrary(wxMock) {
  const module = { exports: {} };
  const source = readFileSync("miniapp/services/local-library.js", "utf8");
  vm.runInNewContext(source, { module, exports: module.exports, wx: wxMock }, {
    filename: "miniapp/services/local-library.js",
  });
  return module.exports;
}

test("recordDownloadArtwork stores successful downloads newest first", () => {
  const wxMock = createStorageWx();
  const library = loadLocalLibrary(wxMock);

  assert.equal(library.recordDownloadArtwork({
    _id: "a1",
    titleCn: "作品一",
    artist: "Claude Monet",
    thumbnail_url: "thumb.webp",
    display_url: "display.webp",
    download_url: "original.jpg",
  }), true);

  assert.deepEqual(library.getDownloadArtworks().map((item) => item.id), ["a1"]);
  assert.equal(library.getDownloadArtworks()[0].download_url, "original.jpg");
  assert.equal(library.getDownloadArtworks()[0].status, "completed");
  assert.equal(library.getLibraryStats().downloads, 1);
});

test("recordDownloadArtwork deduplicates by artwork id", () => {
  const wxMock = createStorageWx();
  const library = loadLocalLibrary(wxMock);

  library.recordDownloadArtwork({ _id: "a1", titleCn: "旧标题", download_url: "old.jpg" });
  library.recordDownloadArtwork({ _id: "a1", titleCn: "新标题", download_url: "new.jpg" });

  const downloads = library.getDownloadArtworks();
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].titleCn, "新标题");
  assert.equal(downloads[0].download_url, "new.jpg");
});

test("clearDownloadArtworks clears download records and stats", () => {
  const wxMock = createStorageWx();
  const library = loadLocalLibrary(wxMock);

  library.recordDownloadArtwork({ _id: "a1", titleCn: "作品一", download_url: "original.jpg" });
  library.clearDownloadArtworks();

  assert.deepEqual(library.getDownloadArtworks(), []);
  assert.equal(library.getLibraryStats().downloads, 0);
});
```

Expected: the first run may fail if `local-library.js` has missing exports or inconsistent behavior.

- [ ] **Step 2: Run the new tests**

Run:

```powershell
node --test miniapp/services/local-library.test.mjs
```

Expected before implementation polish: failures identify missing or incorrect download helpers.

- [ ] **Step 3: Finalize `local-library.js`**

Ensure `miniapp/services/local-library.js` contains:

```js
const DOWNLOAD_IDS_KEY = "artArchive:downloadArtworkIds";
const DOWNLOAD_ITEMS_KEY = "artArchive:downloadArtworkItems";
const DOWNLOAD_LIMIT = 80;
```

Ensure `compactDownloadArtwork` is strict and does not use display URLs as download source:

```js
function compactDownloadArtwork(artwork, status = "completed") {
  const item = compactArtwork(artwork);
  if (!item) return null;

  return {
    ...item,
    download_url: artwork.download_url || "",
    status,
    downloadedAt: new Date().toISOString(),
  };
}
```

Ensure exports include:

```js
getDownloadArtworks,
recordDownloadArtwork,
clearDownloadArtworks,
```

Expected: download records preserve `download_url` for explicit re-download/history use, but normal `compactArtwork` remains display-safe.

- [ ] **Step 4: Re-run local-library tests**

Run:

```powershell
node --test miniapp/services/local-library.test.mjs
```

Expected: all local-library tests pass.

- [ ] **Step 5: Commit local download storage**

Stage only:

```powershell
git add miniapp/services/local-library.js miniapp/services/local-library.test.mjs
git diff --cached --stat
git diff --cached --check
git commit -m "feat: track local artwork download records"
```

Expected: commit contains only the local download record service and tests.

---

## Task 2: Record Successful Downloads From Detail Page

**Files:**

- Modify: `miniapp/pages/detail/detail.js`
- Test: `miniapp/services/downloads.test.mjs`
- Test: `miniapp/services/local-library.test.mjs`

- [ ] **Step 1: Import `recordDownloadArtwork`**

In `miniapp/pages/detail/detail.js`, update the local-library import:

```js
const {
  isFavoriteArtwork,
  recordDownloadArtwork,
  recordHistoryArtwork,
  toggleFavoriteArtwork,
} = require("../../services/local-library");
```

- [ ] **Step 2: Record only after save succeeds**

Inside `downloadArtwork`, after `await saveImageToAlbum(tempFilePath);`, add:

```js
recordDownloadArtwork(artwork, "completed");
```

The success path should become:

```js
const tempFilePath = await downloadFile(downloadUrl);
await saveImageToAlbum(tempFilePath);
recordDownloadArtwork(artwork, "completed");
wx.hideLoading();
wx.showToast({
  title: "已保存到相册",
  icon: "success",
});
```

Expected: failed downloads and permission-denied saves do not enter download history.

- [ ] **Step 3: Verify download URL isolation**

Run:

```powershell
node --test miniapp/services/downloads.test.mjs miniapp/services/local-library.test.mjs
```

Expected:

- `resolveArtworkDownloadUrl` still uses only `download_url`.
- local download records store `download_url`.
- no list/detail display test requires `download_url`.

- [ ] **Step 4: Commit detail download recording**

Stage only:

```powershell
git add miniapp/pages/detail/detail.js
git diff --cached --stat
git diff --cached --check
git commit -m "feat: record successful artwork downloads"
```

Expected: commit only wires detail success path to the local download record service.

---

## Task 3: Add Download Management Page

**Files:**

- Create: `miniapp/pages/downloads/downloads.js`
- Create: `miniapp/pages/downloads/downloads.json`
- Create: `miniapp/pages/downloads/downloads.wxml`
- Create: `miniapp/pages/downloads/downloads.wxss`

- [ ] **Step 1: Create page script**

Create `miniapp/pages/downloads/downloads.js`:

```js
const {
  clearDownloadArtworks,
  getDownloadArtworks,
} = require("../../services/local-library");

Page({
  data: {
    artworks: [],
  },

  onShow() {
    this.refreshDownloads();
  },

  refreshDownloads() {
    this.setData({
      artworks: getDownloadArtworks(),
    });
  },

  clearDownloads() {
    if (this.data.artworks.length === 0) return;
    wx.showModal({
      title: "清空下载记录",
      content: "清空后，本机下载记录将无法恢复，但不会删除系统相册中的图片。",
      confirmText: "清空",
      confirmColor: "#111111",
      success: (result) => {
        if (!result.confirm) return;
        clearDownloadArtworks();
        this.refreshDownloads();
      },
    });
  },

  openArtwork(event) {
    const { id, ratio } = event.detail || {};
    if (!id) return;
    const ratioValue = Number(ratio || 0);
    const ratioParam = ratioValue > 0 ? `&ratio=${encodeURIComponent(ratioValue)}` : "";
    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}${ratioParam}`,
    });
  },
});
```

Expected: page reads only local storage and navigates back to detail using existing detail route.

- [ ] **Step 2: Create page config**

Create `miniapp/pages/downloads/downloads.json`:

```json
{
  "navigationBarTitleText": "下载管理",
  "usingComponents": {
    "artwork-card": "/components/artwork-card/artwork-card",
    "empty-state": "/components/empty-state/empty-state"
  }
}
```

- [ ] **Step 3: Create page markup**

Create `miniapp/pages/downloads/downloads.wxml`:

```xml
<view class="library-page">
  <view class="library-head">
    <view class="library-title-wrap">
      <text class="library-title">下载管理</text>
      <text class="library-count">{{artworks.length}}件作品</text>
    </view>
    <button wx:if="{{artworks.length}}" class="clear-button" bindtap="clearDownloads">清空</button>
  </view>

  <empty-state
    wx:if="{{artworks.length === 0}}"
    title="还没有下载记录"
    description="在作品详情页点击下载并保存到相册后，会记录在这里。"
    show-action="{{false}}"
  />

  <view wx:else class="library-grid">
    <block wx:for="{{artworks}}" wx:key="id">
      <artwork-card artwork="{{item}}" bindtapcard="openArtwork" />
    </block>
  </view>
</view>
```

Expected: page mirrors History/Favorites visual structure and does not show `download_url` as visible metadata.

- [ ] **Step 4: Create page styles**

Create `miniapp/pages/downloads/downloads.wxss`:

```css
.library-page {
  min-height: 100vh;
  padding: 44rpx 34rpx 140rpx;
  background: #faf9f7;
}

.library-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24rpx;
  margin-bottom: 30rpx;
}

.library-title-wrap {
  display: grid;
  gap: 6rpx;
}

.library-title {
  color: #111111;
  font-size: 46rpx;
  font-weight: 950;
  line-height: 58rpx;
}

.library-count {
  color: #7a736d;
  font-size: 25rpx;
  line-height: 36rpx;
}

.clear-button {
  display: flex;
  min-width: 108rpx;
  height: 58rpx;
  align-items: center;
  justify-content: center;
  border-radius: 999rpx;
  padding: 0 24rpx;
  color: #5f5a55;
  background: #efede9;
  font-size: 24rpx;
  font-weight: 850;
  line-height: 58rpx;
}

.clear-button::after {
  border: 0;
}

.library-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 28rpx;
}
```

Expected: visual style is consistent with `favorites` and `history`.

- [ ] **Step 5: Commit download page**

Stage only:

```powershell
git add miniapp/pages/downloads/downloads.js miniapp/pages/downloads/downloads.json miniapp/pages/downloads/downloads.wxml miniapp/pages/downloads/downloads.wxss
git diff --cached --stat
git diff --cached --check
git commit -m "feat: add download management page"
```

Expected: commit adds a local-only page without wiring the route yet.

---

## Task 4: Wire Download Management Entry

**Files:**

- Modify: `miniapp/app.json`
- Modify: `miniapp/pages/profile/profile.js`

- [ ] **Step 1: Register download page route**

Add `pages/downloads/downloads` after `pages/history/history` in `miniapp/app.json`:

```json
"pages/history/history",
"pages/downloads/downloads",
"pages/followed-artists/followed-artists"
```

Expected: WeChat DevTools can open `/pages/downloads/downloads`.

- [ ] **Step 2: Add download stats support**

In `miniapp/pages/profile/profile.js`, update `buildStats` only if the design should expose downloads as a top stat. If keeping three top cards, leave `buildStats` unchanged and rely on the menu entry.

Recommended first implementation: keep the current three top stat cards unchanged to avoid crowding.

- [ ] **Step 3: Enable Profile menu route**

In the “收藏与管理” menu item for download management, change:

```js
{ label: "下载管理", icon: "/assets/icons/lucide/svg/download.svg", disabled: true },
```

to:

```js
{ label: "下载管理", icon: "/assets/icons/lucide/svg/download.svg", route: "/pages/downloads/downloads" },
```

Expected: tapping the menu row navigates to the download management page.

- [ ] **Step 4: Verify app route and menu**

Run:

```powershell
Select-String -Path miniapp/app.json -Pattern "pages/downloads/downloads"
Select-String -Path miniapp/pages/profile/profile.js -Pattern "pages/downloads/downloads|下载管理"
```

Expected: both route and menu entry exist.

- [ ] **Step 5: Commit route wiring**

Stage only:

```powershell
git add miniapp/app.json miniapp/pages/profile/profile.js
git diff --cached --stat
git diff --cached --check
git commit -m "feat: enable download management entry"
```

Expected: commit only wires app route and Profile entry.

---

## Task 5: End-to-End Verification

**Files:**

- No code changes unless verification finds defects.

- [ ] **Step 1: Run targeted tests**

Run:

```powershell
node --test miniapp/services/downloads.test.mjs miniapp/services/local-library.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Run project checks**

Run:

```powershell
npm.cmd run check
npx.cmd tsc --noEmit
npm.cmd run build
git diff --check
```

Expected: all pass.

- [ ] **Step 3: Manual WeChat DevTools verification**

Use iPhone 15 Pro preview:

```text
1. Open an artwork detail page with a valid download_url.
2. Tap 下载.
3. Allow album permission if prompted.
4. Confirm toast says image saved.
5. Go to 我的 -> 下载管理.
6. Confirm the downloaded artwork appears.
7. Tap the artwork card; detail page opens.
8. Return to 下载管理 and tap 清空.
9. Confirm records clear.
10. Confirm system Photos album image is not deleted by clearing records.
```

Expected: download record only appears after successful save.

- [ ] **Step 4: Verify image source separation**

Inspect display chain:

```powershell
Select-String -Path miniapp/components/artwork-image/artwork-image.js -Pattern "download_url"
Select-String -Path miniapp/pages/downloads/downloads.wxml -Pattern "download_url"
```

Expected:

- `artwork-image` does not use `download_url` as a display candidate.
- downloads page does not render `download_url` text directly.

- [ ] **Step 5: Final status report**

Run:

```powershell
git status --short
git log --oneline -5
```

Expected: working tree is clean except for unrelated pre-existing plan docs or WIP explicitly preserved by the user.

---

## Acceptance Criteria

- Detail page download button still uses only `download_url`.
- A successful save to system album records the artwork in local storage.
- Failed download or denied album permission does not create a completed record.
- Profile page has a working “下载管理” entry.
- Download management page shows downloaded artworks in a two-column grid.
- Download management page supports clearing local records.
- Clearing local records does not delete the system album image.
- List thumbnails still use `thumbnail_url`.
- Detail image still uses `display_url`.
- No WeChat Cloud Database writes are added.
- No Supabase, Auth, RBAC, or account-system logic is changed.

---

## Risk Points

- WeChat album permission behavior differs between DevTools and real devices; manual real-device testing is recommended before release.
- `wx.saveImageToPhotosAlbum` may fail for non-image content types or expired remote URLs.
- Local storage can be cleared by the user or OS; download management is a local convenience history, not a durable cloud record.
- Existing text encoding in some miniapp files appears garbled in terminal output; avoid broad text rewrites while implementing this feature.
- If download management later needs actual file existence checks, a separate task should add local file persistence metadata. This plan only records successful album-save events.

---

## Recommended Commit Order

1. `feat: track local artwork download records`
2. `feat: record successful artwork downloads`
3. `feat: add download management page`
4. `feat: enable download management entry`

Do not combine all tasks into one broad commit.

---

## Self-Review

- Spec coverage: plan covers local download records, detail-page recording, Profile entry, download management page, clear behavior, tests, and manual verification.
- Placeholder scan: no placeholder task remains; each task has exact files and commands.
- Type consistency: function names match current services: `recordDownloadArtwork`, `getDownloadArtworks`, `clearDownloadArtworks`, `resolveArtworkDownloadUrl`.
