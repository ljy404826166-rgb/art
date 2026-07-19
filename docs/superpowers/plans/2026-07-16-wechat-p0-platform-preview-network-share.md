# WeChat P0 Platform, Preview, Network, and Share Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the P0 WeChat-native capability baseline: centralized platform checks, artwork preview, artwork/artist sharing, and network-aware original-image downloads.

**Architecture:** Keep page files responsible for lifecycle and user feedback while focused CommonJS services own WeChat API detection, error normalization, share payloads, preview invocation, and network state. All new services accept an optional `wxApi` dependency so Node tests can run without the WeChat runtime. Existing artwork data, cloud queries, local library behavior, and image-tier rules remain unchanged.

**Tech Stack:** WeChat native Mini Program JavaScript/WXML/WXSS, CommonJS services, `node:test`, `node:assert`, `vm`-based page tests, WeChat Developer Tools, Android/iOS WeChat clients.

## Global Constraints

- Only modify and extend `miniapp/` plus the directly related miniapp regression documentation.
- Continue using `thumbnail_url` for lists, `display_url` for detail/preview, and `download_url` only for explicit user downloads.
- Prefer official WeChat APIs and native components; add no third-party runtime dependency.
- Every new service must accept an injectable `wxApi` or otherwise remain testable with a `wx` mock.
- Unsupported APIs, offline state, permission denial, and remote failure must have explicit Chinese user feedback.
- Do not start P1 `wx.env.USER_DATA_PATH` or persistent offline-file work in this plan.
- Preserve unrelated working-tree changes and stage only files belonging to the current task.

---

## File Structure

| File | Responsibility |
|---|---|
| `miniapp/services/platform-capabilities.js` | WeChat API availability and stable platform error codes |
| `miniapp/services/platform-capabilities.test.mjs` | Compatibility and error-normalization unit tests |
| `miniapp/services/share-routes.js` | Stable artwork/artist share payload construction |
| `miniapp/services/share-routes.test.mjs` | Share title, path, image, and fallback tests |
| `miniapp/services/artwork-preview.js` | Safe preview URL resolution and `wx.previewImage` Promise wrapper |
| `miniapp/services/artwork-preview.test.mjs` | Image-tier, unsupported API, success, and failure tests |
| `miniapp/services/network-status.js` | Network snapshot, change subscription, and cellular classification |
| `miniapp/services/network-status.test.mjs` | Wi-Fi, cellular, offline, listener, and cleanup tests |
| `miniapp/pages/detail/detail.js` | Preview/share handlers, network lifecycle, and download guard UI |
| `miniapp/pages/detail/detail.wxml` | Clickable hero image and offline banner |
| `miniapp/pages/detail/detail.wxss` | Offline banner presentation |
| `miniapp/pages/detail/detail.test.mjs` | Detail-page integration tests for preview, share, and download guards |
| `miniapp/pages/artist-detail/artist-detail.js` | Artist share lifecycle handler |
| `miniapp/pages/artist-detail/artist-detail.test.mjs` | Artist share integration test plus existing regression tests |
| `docs/miniapp-core-regression-checklist.zh-CN.md` | Developer Tools and real-device P0 acceptance checklist |

## Task 1: Centralize WeChat Capability Checks and Platform Errors

**Files:**
- Create: `miniapp/services/platform-capabilities.js`
- Create: `miniapp/services/platform-capabilities.test.mjs`

**Interfaces:**
- Produces: `getWxApi(wxApi?) -> object|null`
- Produces: `hasWxApi(name, wxApi?) -> boolean`
- Produces: `canUseWxCapability(capability, wxApi?) -> boolean`
- Produces: `normalizePlatformError(error, fallbackCode?) -> Error & { code, originalError }`
- Error codes: `unsupported`, `offline`, `permission-denied`, `quota-exceeded`, `file-missing`, `remote-failed`, `invalid-data`, `unknown`

- [ ] **Step 1: Write the failing platform capability tests**

Create `miniapp/services/platform-capabilities.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  canUseWxCapability,
  hasWxApi,
  normalizePlatformError,
} = require("./platform-capabilities.js");

test("hasWxApi detects callable WeChat APIs", () => {
  assert.equal(hasWxApi("previewImage", { previewImage() {} }), true);
  assert.equal(hasWxApi("previewImage", {}), false);
});

test("canUseWxCapability honors wx.canIUse", () => {
  const calls = [];
  const wxApi = {
    canIUse(capability) {
      calls.push(capability);
      return capability === "previewImage";
    },
    previewImage() {},
  };

  assert.equal(canUseWxCapability("previewImage", wxApi), true);
  assert.equal(canUseWxCapability("onShareTimeline", wxApi), false);
  assert.deepEqual(calls, ["previewImage", "onShareTimeline"]);
});

test("canUseWxCapability falls back to API presence when canIUse throws", () => {
  const wxApi = {
    canIUse() {
      throw new Error("developer-tools-unavailable");
    },
    previewImage() {},
  };

  assert.equal(canUseWxCapability("previewImage", wxApi), true);
});

test("normalizePlatformError maps stable project error codes", () => {
  assert.equal(normalizePlatformError({ errMsg: "request:fail network disconnected" }).code, "offline");
  assert.equal(normalizePlatformError({ errMsg: "saveImageToPhotosAlbum:fail auth deny" }).code, "permission-denied");
  assert.equal(normalizePlatformError({ errMsg: "file system quota exceeded" }).code, "quota-exceeded");
  assert.equal(normalizePlatformError({ errMsg: "open:fail no such file" }).code, "file-missing");
  assert.equal(normalizePlatformError({ errMsg: "downloadFile:fail statusCode 500" }).code, "remote-failed");
});
```

- [ ] **Step 2: Run the test and verify it fails because the service is absent**

Run:

```powershell
node --test miniapp/services/platform-capabilities.test.mjs
```

Expected: FAIL with `Cannot find module './platform-capabilities.js'`.

- [ ] **Step 3: Implement the platform service**

Create `miniapp/services/platform-capabilities.js`:

```js
const ERROR_PATTERNS = [
  ["permission-denied", /auth deny|authorize no response|permission|auth denied/i],
  ["quota-exceeded", /quota|maximum size|storage limit|space is not enough/i],
  ["file-missing", /no such file|not found|file does not exist/i],
  ["offline", /network|offline|disconnected|internet/i],
  ["remote-failed", /downloadFile:fail|request:fail|statusCode\s*[45]\d\d/i],
  ["invalid-data", /invalid data|invalid parameter|parameter error/i],
];
const VALID_ERROR_CODES = [
  "unsupported",
  "offline",
  "permission-denied",
  "quota-exceeded",
  "file-missing",
  "remote-failed",
  "invalid-data",
  "unknown",
];

function getWxApi(wxApi) {
  if (wxApi) return wxApi;
  if (typeof wx !== "undefined") return wx;
  return null;
}

function hasWxApi(name, wxApi) {
  const api = getWxApi(wxApi);
  return Boolean(api && typeof api[name] === "function");
}

function canUseWxCapability(capability, wxApi) {
  const api = getWxApi(wxApi);
  if (!api) return false;

  if (typeof api.canIUse === "function") {
    try {
      return Boolean(api.canIUse(capability));
    } catch (error) {
      // Developer Tools and older clients may throw for capability probes.
    }
  }

  const apiName = String(capability || "").split(".")[0];
  return hasWxApi(apiName, api);
}

function normalizePlatformError(error, fallbackCode = "unknown") {
  if (error && VALID_ERROR_CODES.includes(error.code)) {
    return error;
  }

  const message = String((error && (error.errMsg || error.message)) || error || "");
  const match = ERROR_PATTERNS.find(([, pattern]) => pattern.test(message));
  const normalized = new Error(message || "微信平台能力调用失败");
  normalized.code = match ? match[0] : fallbackCode;
  normalized.originalError = error;
  return normalized;
}

module.exports = {
  canUseWxCapability,
  getWxApi,
  hasWxApi,
  normalizePlatformError,
};
```

- [ ] **Step 4: Run the focused test**

Run:

```powershell
node --test miniapp/services/platform-capabilities.test.mjs
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- miniapp/services/platform-capabilities.js miniapp/services/platform-capabilities.test.mjs
git commit -m "feat: add miniapp platform capability service"
```

## Task 2: Add Stable Artwork and Artist Share Payloads

**Files:**
- Create: `miniapp/services/share-routes.js`
- Create: `miniapp/services/share-routes.test.mjs`
- Modify: `miniapp/pages/detail/detail.js`
- Create: `miniapp/pages/detail/detail.test.mjs`
- Modify: `miniapp/pages/artist-detail/artist-detail.js`
- Modify: `miniapp/pages/artist-detail/artist-detail.test.mjs`

**Interfaces:**
- Consumes: normalized artwork and artist records already used by detail pages
- Produces: `buildArtworkShareMessage(artwork) -> { title, path, imageUrl? }`
- Produces: `buildArtistShareMessage(artist) -> { title, path, imageUrl? }`
- Page lifecycle: `detail.onShareAppMessage()` and `artist-detail.onShareAppMessage()`

- [ ] **Step 1: Write failing share-route unit tests**

Create `miniapp/services/share-routes.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildArtworkShareMessage,
  buildArtistShareMessage,
} = require("./share-routes.js");

test("buildArtworkShareMessage uses a stable encoded artwork id and thumbnail", () => {
  assert.deepEqual(buildArtworkShareMessage({
    _id: "artwork/梵高",
    titleCn: "星月夜",
    artist: "文森特·梵高",
    thumbnail_url: "https://img.example/thumb.webp",
    display_url: "https://img.example/display.webp",
  }), {
    title: "星月夜 · 文森特·梵高",
    path: "/pages/detail/detail?id=artwork%2F%E6%A2%B5%E9%AB%98",
    imageUrl: "https://img.example/thumb.webp",
  });
});

test("buildArtistShareMessage uses a stable artist id", () => {
  assert.deepEqual(buildArtistShareMessage({
    id: "claude-monet",
    nameZh: "克洛德·莫奈",
    nameEn: "Claude Monet",
  }), {
    title: "克洛德·莫奈（Claude Monet）· Art Archive",
    path: "/pages/artist-detail/artist-detail?id=claude-monet",
  });
});

test("share payloads fall back to the home page without a stable id", () => {
  assert.deepEqual(buildArtworkShareMessage(null), {
    title: "Art Archive · 在线画廊",
    path: "/pages/home/home",
  });
  assert.deepEqual(buildArtistShareMessage({ nameZh: "未知画家" }), {
    title: "Art Archive · 在线画廊",
    path: "/pages/home/home",
  });
});
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run:

```powershell
node --test miniapp/services/share-routes.test.mjs
```

Expected: FAIL with `Cannot find module './share-routes.js'`.

- [ ] **Step 3: Implement share payload construction**

Create `miniapp/services/share-routes.js`:

```js
const HOME_SHARE = {
  title: "Art Archive · 在线画廊",
  path: "/pages/home/home",
};

function compactText(value) {
  return String(value || "").trim();
}

function withOptionalImage(message, imageUrl) {
  const safeImageUrl = compactText(imageUrl);
  return safeImageUrl ? { ...message, imageUrl: safeImageUrl } : message;
}

function buildArtworkShareMessage(artwork) {
  const id = compactText(artwork && (artwork._id || artwork.id || artwork.source_id || artwork.supabase_id));
  if (!id) return { ...HOME_SHARE };

  const title = compactText(artwork.titleCn || artwork.title_cn || artwork.title || artwork.titleEn) || "未命名作品";
  const artist = compactText(artwork.artist);
  return withOptionalImage({
    title: artist ? `${title} · ${artist}` : `${title} · Art Archive`,
    path: `/pages/detail/detail?id=${encodeURIComponent(id)}`,
  }, artwork.thumbnail_url || artwork.display_url);
}

function buildArtistShareMessage(artist) {
  const id = compactText(artist && (artist.id || artist._id));
  if (!id) return { ...HOME_SHARE };

  const nameZh = compactText(artist.nameZh || artist.name_zh || artist.name);
  const nameEn = compactText(artist.nameEn || artist.name_en);
  const name = nameZh && nameEn ? `${nameZh}（${nameEn}）` : (nameZh || nameEn || "画家");
  return withOptionalImage({
    title: `${name} · Art Archive`,
    path: `/pages/artist-detail/artist-detail?id=${encodeURIComponent(id)}`,
  }, artist.avatarUrl || artist.avatar_url);
}

module.exports = {
  buildArtworkShareMessage,
  buildArtistShareMessage,
};
```

- [ ] **Step 4: Run share-route unit tests**

Run:

```powershell
node --test miniapp/services/share-routes.test.mjs
```

Expected: 3 tests PASS.

- [ ] **Step 5: Write failing page lifecycle tests**

Create `miniapp/pages/detail/detail.test.mjs` with this initial page loader and artwork-share test:

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const serviceDefaults = {
    artworks: {
      fetchArtworkById: async () => null,
      fallbackArtworkById: () => null,
      normalizeError: (error) => String((error && error.message) || error || ""),
    },
    artists: { loadArtistByArtworkText: async () => ({ artist: null }) },
    imageLayout: {
      computeDetailHeroFrameStyle: () => "",
      resolveDetailMeasureSrc: () => "",
    },
    downloads: {
      downloadFile: async () => "temp-file",
      getDownloadFailureMessage: () => "下载失败，请重试",
      isAlbumPermissionError: () => false,
      resolveArtworkDownloadUrl: (artwork) => artwork && artwork.download_url,
      saveImageToAlbum: async () => {},
    },
    localLibrary: {
      isFavoriteArtwork: () => false,
      recordDownloadArtwork: () => {},
      recordHistoryArtwork: () => {},
      toggleFavoriteArtwork: () => true,
    },
    shareRoutes: {
      buildArtworkShareMessage: (artwork) => ({
        title: artwork ? artwork.titleCn : "fallback",
        path: artwork ? `/pages/detail/detail?id=${artwork.id}` : "/pages/home/home",
      }),
    },
};

function loadDetailPage(overrides = {}, wxOverrides = {}) {
  const filename = fileURLToPath(new URL("./detail.js", import.meta.url));
  const source = readFileSync(filename, "utf8");
  let page;
  const services = { ...serviceDefaults, ...overrides };
  const localRequire = (id) => {
    if (id === "../../services/artworks") return services.artworks;
    if (id === "../../services/artists") return services.artists;
    if (id === "./detail-image-layout") return services.imageLayout;
    if (id === "../../services/downloads") return services.downloads;
    if (id === "../../services/local-library") return services.localLibrary;
    if (id === "../../services/share-routes") return services.shareRoutes;
    return require(id);
  };
  const Page = (definition) => {
    page = {
      ...definition,
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(patch) {
        Object.assign(this.data, patch);
      },
    };
  };
  const wx = {
    setNavigationBarTitle() {},
    showToast() {},
    showLoading() {},
    hideLoading() {},
    showModal() {},
    openSetting() {},
    navigateTo() {},
    ...wxOverrides,
  };

  vm.runInNewContext(source, {
    module: { exports: {} },
    exports: {},
    require: localRequire,
    Page,
    wx,
    console,
  }, { filename });
  return page;
}

test("detail exposes a stable artwork share payload", () => {
  const page = loadDetailPage();
  page.data.artwork = { id: "starry-night", titleCn: "星月夜" };

  assert.deepEqual(page.onShareAppMessage(), {
    title: "星月夜",
    path: "/pages/detail/detail?id=starry-night",
  });
});
```

Update the `localRequire` function in `miniapp/pages/artist-detail/artist-detail.test.mjs`:

```js
if (id === "../../services/share-routes") {
  return services.shareRoutes || {
    buildArtistShareMessage: (artist) => ({
      title: artist ? artist.nameZh : "fallback",
      path: artist ? `/artist/${artist.id}` : "/",
    }),
  };
}
```

Append this test:

```js
test("artist detail exposes a stable share payload", () => {
  const page = loadArtistDetailPage({
    artists: {},
    artworks: {},
    localLibrary: {},
    shareRoutes: {
      buildArtistShareMessage: (artist) => ({
        title: artist.nameZh,
        path: `/pages/artist-detail/artist-detail?id=${artist.id}`,
      }),
    },
  });
  page.data.artist = { id: "monet", nameZh: "莫奈" };

  assert.deepEqual(page.onShareAppMessage(), {
    title: "莫奈",
    path: "/pages/artist-detail/artist-detail?id=monet",
  });
});
```

Run:

```powershell
node --test miniapp/pages/detail/detail.test.mjs miniapp/pages/artist-detail/artist-detail.test.mjs
```

Expected: FAIL because both page definitions lack `onShareAppMessage`.

- [ ] **Step 6: Add page lifecycle integration**

In `miniapp/pages/detail/detail.js`, import the builder and add the lifecycle method inside `Page({ ... })`:

```js
const { buildArtworkShareMessage } = require("../../services/share-routes");

onShareAppMessage() {
  return buildArtworkShareMessage(this.data.artwork);
},
```

In `miniapp/pages/artist-detail/artist-detail.js`:

```js
const { buildArtistShareMessage } = require("../../services/share-routes");

onShareAppMessage() {
  return buildArtistShareMessage(this.data.artist);
},
```

- [ ] **Step 7: Run share and page tests**

Run:

```powershell
node --test miniapp/services/share-routes.test.mjs miniapp/pages/detail/detail.test.mjs miniapp/pages/artist-detail/artist-detail.test.mjs
```

Expected: all tests PASS, including the existing artist pagination tests.

- [ ] **Step 8: Commit Task 2**

```powershell
git add -- miniapp/services/share-routes.js miniapp/services/share-routes.test.mjs miniapp/pages/detail/detail.js miniapp/pages/detail/detail.test.mjs miniapp/pages/artist-detail/artist-detail.js miniapp/pages/artist-detail/artist-detail.test.mjs
git commit -m "feat: add miniapp artwork and artist sharing"
```

## Task 3: Add Safe Artwork Full-Screen Preview

**Files:**
- Create: `miniapp/services/artwork-preview.js`
- Create: `miniapp/services/artwork-preview.test.mjs`
- Modify: `miniapp/pages/detail/detail.test.mjs`
- Modify: `miniapp/pages/detail/detail.js`
- Modify: `miniapp/pages/detail/detail.wxml`

**Interfaces:**
- Consumes: `canUseWxCapability`, `getWxApi`, and `normalizePlatformError` from Task 1
- Produces: `resolveArtworkPreviewUrl(artwork) -> string`
- Produces: `previewArtwork(artwork, wxApi?) -> Promise<{ url, result }>`
- Page handler: `detail.previewHeroImage()`

- [ ] **Step 1: Write failing preview service tests**

Create `miniapp/services/artwork-preview.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  previewArtwork,
  resolveArtworkPreviewUrl,
} = require("./artwork-preview.js");

test("resolveArtworkPreviewUrl prefers display images and never selects download_url", () => {
  assert.equal(resolveArtworkPreviewUrl({
    display_url: "https://img.example/display.webp",
    thumbnail_url: "https://img.example/thumb.webp",
    download_url: "https://img.example/original.jpg",
  }), "https://img.example/display.webp");

  assert.equal(resolveArtworkPreviewUrl({
    thumbnail_url: "https://img.example/thumb.webp",
    download_url: "https://img.example/original.jpg",
  }), "https://img.example/thumb.webp");
});

test("previewArtwork calls wx.previewImage with exactly one display URL", async () => {
  const calls = [];
  const result = await previewArtwork({ display_url: "https://img.example/display.webp" }, {
    canIUse: () => true,
    previewImage(options) {
      calls.push(options);
      options.success({ errMsg: "previewImage:ok" });
    },
  });

  assert.equal(result.url, "https://img.example/display.webp");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].current, "https://img.example/display.webp");
  assert.deepEqual(calls[0].urls, ["https://img.example/display.webp"]);
});

test("previewArtwork rejects unsupported and missing-image cases with stable codes", async () => {
  await assert.rejects(
    previewArtwork({ display_url: "https://img.example/display.webp" }, { canIUse: () => false }),
    (error) => error.code === "unsupported",
  );
  await assert.rejects(
    previewArtwork({}, { canIUse: () => true, previewImage() {} }),
    (error) => error.code === "invalid-data",
  );
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node --test miniapp/services/artwork-preview.test.mjs
```

Expected: FAIL with `Cannot find module './artwork-preview.js'`.

- [ ] **Step 3: Implement the preview service**

Create `miniapp/services/artwork-preview.js`:

```js
const {
  canUseWxCapability,
  getWxApi,
  normalizePlatformError,
} = require("./platform-capabilities");

function resolveArtworkPreviewUrl(artwork) {
  if (!artwork) return "";
  const safeImageSrc = artwork.imageSrc && artwork.imageSrc !== artwork.download_url
    ? artwork.imageSrc
    : "";
  return artwork.display_url || artwork.cloud_file_id || artwork.thumbnail_url || safeImageSrc || "";
}

function createPreviewError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function previewArtwork(artwork, wxApi) {
  const api = getWxApi(wxApi);
  const url = resolveArtworkPreviewUrl(artwork);
  if (!url) return Promise.reject(createPreviewError("invalid-data", "暂无可预览图片"));
  if (!api || !canUseWxCapability("previewImage", api)) {
    return Promise.reject(createPreviewError("unsupported", "当前微信版本不支持图片预览"));
  }

  return new Promise((resolve, reject) => {
    api.previewImage({
      current: url,
      urls: [url],
      success(result) {
        resolve({ url, result });
      },
      fail(error) {
        reject(normalizePlatformError(error, "remote-failed"));
      },
    });
  });
}

module.exports = {
  previewArtwork,
  resolveArtworkPreviewUrl,
};
```

- [ ] **Step 4: Run preview service tests**

Run:

```powershell
node --test miniapp/services/platform-capabilities.test.mjs miniapp/services/artwork-preview.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Write the failing detail-page preview integration test**

Extend the existing `serviceDefaults` in `miniapp/pages/detail/detail.test.mjs`:

```js
artworkPreview: {
  previewArtwork: async () => ({ url: "display" }),
},
```

Add this exact branch to `localRequire`:

```js
if (id === "../../services/artwork-preview") return services.artworkPreview;
```

Then add this test:

```js
test("detail preview handler previews the loaded artwork", async () => {
  const calls = [];
  const page = loadDetailPage({
    artworkPreview: {
      previewArtwork: async (artwork) => {
        calls.push(artwork);
        return { url: artwork.display_url };
      },
    },
  });
  page.data.artwork = { id: "starry-night", display_url: "https://img.example/display.webp" };

  await page.previewHeroImage();

  assert.deepEqual(calls, [page.data.artwork]);
});
```

Run:

```powershell
node --test miniapp/pages/detail/detail.test.mjs
```

Expected: FAIL because `previewHeroImage` is not defined.

- [ ] **Step 6: Wire the detail page and hero tap target**

Add to `miniapp/pages/detail/detail.js`:

```js
const { previewArtwork } = require("../../services/artwork-preview");

async previewHeroImage() {
  if (!this.data.artwork) return;
  try {
    await previewArtwork(this.data.artwork);
  } catch (error) {
    wx.showToast({
      title: error && error.code === "unsupported"
        ? "当前微信版本不支持预览"
        : (error && error.message) || "图片预览失败",
      icon: "none",
    });
  }
},
```

Change the hero wrapper in `miniapp/pages/detail/detail.wxml`:

```xml
<view class="hero-image-wrap" bindtap="previewHeroImage" aria-label="全屏预览作品">
```

- [ ] **Step 7: Run preview and detail tests**

Run:

```powershell
node --test miniapp/services/artwork-preview.test.mjs miniapp/pages/detail/detail.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 8: Commit Task 3**

```powershell
git add -- miniapp/services/artwork-preview.js miniapp/services/artwork-preview.test.mjs miniapp/pages/detail/detail.js miniapp/pages/detail/detail.wxml miniapp/pages/detail/detail.test.mjs
git commit -m "feat: add miniapp artwork full-screen preview"
```

## Task 4: Add Network Monitoring and Guard Original Downloads

**Files:**
- Create: `miniapp/services/network-status.js`
- Create: `miniapp/services/network-status.test.mjs`
- Modify: `miniapp/pages/detail/detail.js`
- Modify: `miniapp/pages/detail/detail.wxml`
- Modify: `miniapp/pages/detail/detail.wxss`
- Modify: `miniapp/pages/detail/detail.test.mjs`

**Interfaces:**
- Consumes: `getWxApi`, `hasWxApi`, and `normalizePlatformError` from Task 1
- Produces: `normalizeNetworkState(result) -> { isConnected, networkType }`
- Produces: `getNetworkSnapshot(wxApi?) -> Promise<NetworkState>`
- Produces: `subscribeNetworkStatus(listener, wxApi?) -> () => void`
- Produces: `isCellularNetwork(networkType) -> boolean`
- Page lifecycle: subscribe in `onShow`, unsubscribe in `onHide` and `onUnload`

- [ ] **Step 1: Write failing network service tests**

Create `miniapp/services/network-status.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  getNetworkSnapshot,
  isCellularNetwork,
  normalizeNetworkState,
  subscribeNetworkStatus,
} = require("./network-status.js");

test("normalizeNetworkState recognizes offline and connected networks", () => {
  assert.deepEqual(normalizeNetworkState({ networkType: "none" }), {
    isConnected: false,
    networkType: "none",
  });
  assert.deepEqual(normalizeNetworkState({ isConnected: true, networkType: "wifi" }), {
    isConnected: true,
    networkType: "wifi",
  });
});

test("isCellularNetwork recognizes mobile network types", () => {
  for (const type of ["2g", "3g", "4g", "5g"]) assert.equal(isCellularNetwork(type), true);
  assert.equal(isCellularNetwork("wifi"), false);
  assert.equal(isCellularNetwork("none"), false);
});

test("getNetworkSnapshot wraps wx.getNetworkType", async () => {
  const state = await getNetworkSnapshot({
    getNetworkType(options) {
      options.success({ networkType: "wifi" });
    },
  });
  assert.deepEqual(state, { isConnected: true, networkType: "wifi" });
});

test("subscribeNetworkStatus forwards changes and unregisters its exact handler", async () => {
  let registered;
  let removed;
  const states = [];
  const wxApi = {
    getNetworkType(options) {
      options.success({ networkType: "wifi" });
    },
    onNetworkStatusChange(handler) {
      registered = handler;
    },
    offNetworkStatusChange(handler) {
      removed = handler;
    },
  };

  const unsubscribe = subscribeNetworkStatus((state) => states.push(state), wxApi);
  await Promise.resolve();
  registered({ isConnected: false, networkType: "none" });
  unsubscribe();

  assert.deepEqual(states[states.length - 1], { isConnected: false, networkType: "none" });
  assert.equal(removed, registered);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node --test miniapp/services/network-status.test.mjs
```

Expected: FAIL with `Cannot find module './network-status.js'`.

- [ ] **Step 3: Implement the network status service**

Create `miniapp/services/network-status.js`:

```js
const {
  getWxApi,
  hasWxApi,
  normalizePlatformError,
} = require("./platform-capabilities");

const CELLULAR_TYPES = ["2g", "3g", "4g", "5g"];

function normalizeNetworkState(result) {
  const networkType = String((result && result.networkType) || "unknown").toLowerCase();
  const isConnected = typeof (result && result.isConnected) === "boolean"
    ? result.isConnected
    : networkType !== "none";
  return { isConnected, networkType };
}

function isCellularNetwork(networkType) {
  return CELLULAR_TYPES.includes(String(networkType || "").toLowerCase());
}

function getNetworkSnapshot(wxApi) {
  const api = getWxApi(wxApi);
  if (!api || !hasWxApi("getNetworkType", api)) {
    return Promise.resolve({ isConnected: true, networkType: "unknown" });
  }

  return new Promise((resolve, reject) => {
    api.getNetworkType({
      success(result) {
        resolve(normalizeNetworkState(result));
      },
      fail(error) {
        reject(normalizePlatformError(error, "remote-failed"));
      },
    });
  });
}

function subscribeNetworkStatus(listener, wxApi) {
  const api = getWxApi(wxApi);
  const handler = (result) => listener(normalizeNetworkState(result));
  if (api && hasWxApi("onNetworkStatusChange", api)) {
    api.onNetworkStatusChange(handler);
  }
  getNetworkSnapshot(api).then(listener).catch(() => {});

  return function unsubscribe() {
    if (api && hasWxApi("offNetworkStatusChange", api)) {
      api.offNetworkStatusChange(handler);
    }
  };
}

module.exports = {
  getNetworkSnapshot,
  isCellularNetwork,
  normalizeNetworkState,
  subscribeNetworkStatus,
};
```

- [ ] **Step 4: Run network service tests**

Run:

```powershell
node --test miniapp/services/platform-capabilities.test.mjs miniapp/services/network-status.test.mjs
```

Expected: all tests PASS.

- [ ] **Step 5: Add failing detail-page tests for offline and cellular downloads**

Extend the detail-page loader defaults in `miniapp/pages/detail/detail.test.mjs` with:

```js
networkStatus: {
  getNetworkSnapshot: async () => ({ isConnected: true, networkType: "wifi" }),
  isCellularNetwork: (type) => ["2g", "3g", "4g", "5g"].includes(type),
  subscribeNetworkStatus: () => () => {},
},
```

Route `../../services/network-status` to that mock and add:

```js
test("detail blocks original download while offline", async () => {
  let downloadCalls = 0;
  const toasts = [];
  const page = loadDetailPage({
    networkStatus: {
      getNetworkSnapshot: async () => ({ isConnected: false, networkType: "none" }),
      isCellularNetwork: () => false,
      subscribeNetworkStatus: () => () => {},
    },
    downloads: {
      ...serviceDefaults.downloads,
      downloadFile: async () => {
        downloadCalls += 1;
        return "temp-file";
      },
    },
  }, {
    showToast: (options) => toasts.push(options),
  });
  page.data.artwork = { id: "artwork", download_url: "https://img.example/original.jpg" };

  await page.downloadArtwork();

  assert.equal(downloadCalls, 0);
  assert.equal(toasts[0].title, "当前无网络，无法下载原图");
});

test("detail asks before an original download on cellular data", async () => {
  let downloadCalls = 0;
  const modals = [];
  const page = loadDetailPage({
    networkStatus: {
      getNetworkSnapshot: async () => ({ isConnected: true, networkType: "4g" }),
      isCellularNetwork: () => true,
      subscribeNetworkStatus: () => () => {},
    },
    downloads: {
      ...serviceDefaults.downloads,
      downloadFile: async () => {
        downloadCalls += 1;
        return "temp-file";
      },
    },
  }, {
    showModal(options) {
      modals.push(options);
      options.success({ confirm: false, cancel: true });
    },
  });
  page.data.artwork = { id: "artwork", download_url: "https://img.example/original.jpg" };

  await page.downloadArtwork();

  assert.equal(modals[0].title, "使用移动网络下载");
  assert.equal(downloadCalls, 0);
});
```

Run:

```powershell
node --test miniapp/pages/detail/detail.test.mjs
```

Expected: FAIL because the page does not query network state or request cellular confirmation.

- [ ] **Step 6: Integrate network lifecycle and download guards**

Import the service in `miniapp/pages/detail/detail.js`:

```js
const {
  getNetworkSnapshot,
  isCellularNetwork,
  subscribeNetworkStatus,
} = require("../../services/network-status");
```

Add to page data:

```js
networkState: {
  isConnected: true,
  networkType: "unknown",
},
```

Add lifecycle and helper methods:

```js
onShow() {
  this.stopNetworkSubscription = subscribeNetworkStatus((networkState) => {
    this.setData({ networkState });
  });
},

onHide() {
  this.stopNetworkMonitor();
},

onUnload() {
  this.stopNetworkMonitor();
},

stopNetworkMonitor() {
  if (typeof this.stopNetworkSubscription === "function") {
    this.stopNetworkSubscription();
    this.stopNetworkSubscription = null;
  }
},

confirmCellularDownload() {
  return new Promise((resolve) => {
    wx.showModal({
      title: "使用移动网络下载",
      content: "原图文件可能较大并消耗较多流量，是否继续？",
      confirmText: "继续下载",
      success: (result) => resolve(Boolean(result && result.confirm)),
      fail: () => resolve(false),
    });
  });
},
```

Immediately after resolving `downloadUrl` and before setting `downloading: true`, add:

```js
let networkState;
try {
  networkState = await getNetworkSnapshot();
} catch (error) {
  networkState = this.data.networkState;
}
this.setData({ networkState });

if (!networkState.isConnected) {
  wx.showToast({ title: "当前无网络，无法下载原图", icon: "none" });
  return;
}

if (isCellularNetwork(networkState.networkType)) {
  const confirmed = await this.confirmCellularDownload();
  if (!confirmed) return;
}
```

Add near the top of `miniapp/pages/detail/detail.wxml`:

```xml
<view wx:if="{{!networkState.isConnected}}" class="network-banner" role="status">
  当前无网络，已加载内容仍可浏览
</view>
```

Add to `miniapp/pages/detail/detail.wxss`:

```css
.network-banner {
  margin: 16rpx 28rpx 0;
  padding: 16rpx 20rpx;
  border: 1rpx solid #eadfce;
  border-radius: 12rpx;
  color: #6f5438;
  background: #fff8ee;
  font-size: 24rpx;
  line-height: 1.45;
}
```

- [ ] **Step 7: Run network and detail tests**

Run:

```powershell
node --test miniapp/services/network-status.test.mjs miniapp/pages/detail/detail.test.mjs
```

Expected: all tests PASS, including offline cancellation and cellular cancellation.

- [ ] **Step 8: Commit Task 4**

```powershell
git add -- miniapp/services/network-status.js miniapp/services/network-status.test.mjs miniapp/pages/detail/detail.js miniapp/pages/detail/detail.wxml miniapp/pages/detail/detail.wxss miniapp/pages/detail/detail.test.mjs
git commit -m "feat: guard miniapp downloads by network state"
```

## Task 5: Update P0 Regression Coverage and Run the Full Gate

**Files:**
- Modify: `docs/miniapp-core-regression-checklist.zh-CN.md`
- Modify only if test discovery needs a stable command: `package.json`

**Interfaces:**
- Consumes: all P0 services and page behaviors from Tasks 1–4
- Produces: a repeatable command-line gate and a manual Developer Tools/real-device checklist

- [ ] **Step 1: Add P0 acceptance cases to the Chinese regression checklist**

Add a `P0 微信原生能力` section containing these exact checks:

```markdown
## P0 微信原生能力

### 作品预览

- [ ] 点击作品详情主图后进入微信全屏图片预览。
- [ ] 预览请求使用 `display_url`，不提前请求 `download_url` 原图。
- [ ] 没有可预览图片或基础库不支持时显示明确提示。

### 分享

- [ ] 作品详情分享卡片标题、图片和作品 ID 正确。
- [ ] 画家详情分享卡片标题和画家 ID 正确。
- [ ] 从分享卡片冷启动后直达对应详情页。
- [ ] 分享目标不存在时展示可恢复错误状态。

### 网络与原图下载

- [ ] 断网时详情页保留已加载内容并显示网络提示。
- [ ] 断网点击下载不会调用 `wx.downloadFile`。
- [ ] 使用移动网络下载原图前显示流量确认。
- [ ] 用户取消移动网络下载后不产生下载记录。
- [ ] Wi-Fi 下载继续沿用当前相册权限和失败恢复流程。
- [ ] 网络恢复后用户可以主动重试加载或下载。

### 兼容性

- [ ] API 不可用时功能降级，不出现白屏或无限加载。
- [ ] Android 微信真机完成预览、分享、断网和移动网络检查。
- [ ] iOS 微信真机完成预览、分享、断网和移动网络检查。
```

- [ ] **Step 2: Run every P0-focused automated test**

Run:

```powershell
node --test miniapp/services/platform-capabilities.test.mjs miniapp/services/share-routes.test.mjs miniapp/services/artwork-preview.test.mjs miniapp/services/network-status.test.mjs miniapp/pages/detail/detail.test.mjs miniapp/pages/artist-detail/artist-detail.test.mjs
```

Expected: all P0 and existing artist-detail tests PASS.

- [ ] **Step 3: Run all miniapp tests recursively**

Run:

```powershell
$miniappTests = @(Get-ChildItem -Path miniapp -Recurse -Filter *.test.mjs | Select-Object -ExpandProperty FullName)
node --test $miniappTests
```

Expected: all miniapp tests PASS with zero failures.

- [ ] **Step 4: Run repository verification commands**

Run:

```powershell
npm.cmd run check
npm.cmd run typecheck
npm.cmd run build
git diff --check
```

Expected:

- `npm.cmd run check`: prints the existing validation success message.
- `npm.cmd run typecheck`: exits 0 with no TypeScript errors.
- `npm.cmd run build`: exits 0 and produces the Vite `dist` output without changing tracked files.
- `git diff --check`: exits 0 with no whitespace errors.

- [ ] **Step 5: Verify in WeChat Developer Tools**

Open the existing `miniapp/` project using its current project configuration and execute every new P0 checklist item. Confirm the Network panel never requests `download_url` when only opening or previewing a detail page. Test Wi-Fi, simulated offline, API-unavailable mocks where Developer Tools supports them, share launch parameters, and cellular confirmation UI.

- [ ] **Step 6: Verify on real Android and iOS WeChat clients**

On each platform:

1. Open an artwork detail page and preview the hero image.
2. Share the artwork to a test conversation and reopen it from the card.
3. Open a painter detail page, share it, and reopen the card.
4. Disable connectivity and verify the offline banner and blocked download.
5. Enable mobile data and verify the original-download confirmation.
6. Cancel once and confirm no download record appears.
7. Confirm once and verify the existing save-to-album flow still succeeds.

Expected: every P0 checklist item passes or a defect is recorded before closing P0.

- [ ] **Step 7: Commit the regression documentation**

```powershell
git add -- docs/miniapp-core-regression-checklist.zh-CN.md
git commit -m "docs: add miniapp P0 native capability checks"
```

## Plan Self-Review

- Spec coverage: Tasks cover P0-01 compatibility, P0-02 preview, P0-03 artwork/artist sharing, P0-04 network state and large-image download protection, plus command-line and real-device gates.
- Scope control: No P1 permanent file storage, P2 identity/sync, P3 notification, Web, Android-native, or iOS-native implementation is included.
- Image policy: Preview explicitly excludes `download_url`; original images remain restricted to the existing explicit download action.
- Type consistency: `NetworkState` consistently uses `{ isConnected, networkType }`; share builders return `{ title, path, imageUrl? }`; platform errors consistently use the codes defined in Task 1.
- Existing behavior: Cloud reads, local favorites/history, artist pagination, save-to-album permissions, and Vite Web behavior remain in place and are regression-tested.
