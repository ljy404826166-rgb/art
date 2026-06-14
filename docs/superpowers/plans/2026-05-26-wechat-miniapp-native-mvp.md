# WeChat Native Miniapp MVP Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent native WeChat Mini Program MVP for the art gallery without changing the existing Vite Web application or Supabase/RBAC/RLS logic.

**Architecture:** Create a separate `miniapp/` project that uses native WeChat pages, components, `wx.request`, `wx.storage`, `wx.navigateTo`, and native image rendering. Reuse the current Web project's data contracts and behavior as references, but do not import browser-only code from `src/`.

**Tech Stack:** WeChat Mini Program native WXML/WXSS/JS, Supabase REST API via `wx.request`, WeChat local storage, WeChat Developer Tools.

---

## Scope

This plan covers the first migration phase only:

- Home page
- Categories page
- Detail page
- Basic Me page entry
- Read-only public artwork browsing
- Local cache and image fallback foundation
- Extension points for account, favorites, history, and download management

This phase must not:

- Modify `src/`, `index.html`, `vite.config.js`, or existing Web runtime code.
- Modify Supabase SQL, RBAC, Auth, RLS, or database schema.
- Add service role keys to the Mini Program.
- Implement full login, remote user sync, or full download management.

## Reference From Current Web Project

Use these files as behavior and data-shape references only:

- `src/lib/artworks.ts`: summary/detail field lists, pagination shape, tag/artist query behavior.
- `src/lib/paintings.ts`: page result shape, fallback behavior, request de-duplication idea.
- `src/lib/local-library-store.ts`: cache key shape and local cache concepts.
- `src/app.js`: current page states, home/category/detail/me behavior.
- `src/styles.css`: visual direction only; do not copy browser CSS wholesale.

## Target Directory Structure

Create a new independent project directory:

```text
miniapp/
├─ app.json
├─ app.js
├─ app.wxss
├─ project.config.json
├─ sitemap.json
├─ pages/
│  ├─ home/
│  │  ├─ home.wxml
│  │  ├─ home.js
│  │  └─ home.wxss
│  ├─ categories/
│  │  ├─ categories.wxml
│  │  ├─ categories.js
│  │  └─ categories.wxss
│  ├─ detail/
│  │  ├─ detail.wxml
│  │  ├─ detail.js
│  │  └─ detail.wxss
│  └─ me/
│     ├─ me.wxml
│     ├─ me.js
│     └─ me.wxss
├─ components/
│  ├─ artwork-card/
│  │  ├─ artwork-card.wxml
│  │  ├─ artwork-card.js
│  │  └─ artwork-card.wxss
│  ├─ empty-state/
│  ├─ error-state/
│  ├─ loading-state/
│  └─ tag-chip/
├─ services/
│  ├─ config.js
│  ├─ request.js
│  ├─ artworks.js
│  └─ images.js
├─ stores/
│  ├─ artwork-cache.js
│  ├─ favorites.js
│  └─ history.js
├─ utils/
│  ├─ format.js
│  └─ cache-key.js
└─ assets/
   └─ image-fallback.svg
```

## Page Routes

Configure `miniapp/app.json` with four pages:

```text
pages/home/home
pages/categories/categories
pages/detail/detail
pages/me/me
```

Use native tabBar for:

- 首页: `pages/home/home`
- 分类: `pages/categories/categories`
- 我的: `pages/me/me`

Use normal navigation for detail:

- `wx.navigateTo({ url: "/pages/detail/detail?id=<artwork-id>" })`

## Component Split

`components/artwork-card/`

- Displays one artwork in list/grid contexts.
- Receives `id`, `title_cn`, `title_en`, `artist`, `thumbnail_url`.
- Emits tap event with artwork id.
- Uses `image-fallback.svg` or a local placeholder when `binderror` fires.

`components/loading-state/`

- Displays a compact native loading state.
- Used by home, categories, and detail.

`components/error-state/`

- Displays network or data errors.
- Exposes a retry button event.

`components/empty-state/`

- Displays empty result states.
- Used when category/search returns no items.

`components/tag-chip/`

- Displays selectable category tags.
- Used by categories page.

## API Request Adaptation

Do not use browser `fetch` or direct `@supabase/supabase-js` in the MVP. Implement a minimal request adapter around `wx.request`.

`services/config.js`

- Stores public Supabase project URL.
- Stores anon/publishable key only.
- Does not contain service role key.
- Defines `published_artworks` endpoint constants.

`services/request.js`

- Wraps `wx.request` in a Promise.
- Adds `apikey` and `Authorization: Bearer <anon-key>` headers.
- Adds timeout handling using `timeout`.
- Normalizes errors into `{ message, statusCode, offline }`.

`services/artworks.js`

- Implements `fetchArtworkPage({ limit, from, tag, artist })`.
- Implements `fetchArtworkById(id)`.
- Uses field-cropped select strings matching Web summary/detail columns.
- Uses `Range` or PostgREST query parameters compatible with Supabase REST.
- Returns `{ items, nextFrom, hasMore, totalCount }`.

Suggested summary fields:

```text
id,slug,title_cn,title_en,artist,year_and_place,dimensions,tags,tags_text,thumbnail_url,display_url,created_at,updated_at
```

Suggested detail fields:

```text
id,slug,title_cn,title_en,artist,year_and_place,location,medium,dimensions,description,tags,tags_text,source_name,source_url,thumbnail_url,display_url,download_url,iiif_url,created_at,updated_at
```

## Local Cache Adaptation

Use WeChat storage instead of Dexie/IndexedDB.

`stores/artwork-cache.js`

- `saveArtworkPageCache(key, page)`
- `readArtworkPageCache(key)`
- `saveArtworkDetailCache(id, item)`
- `readArtworkDetailCache(id)`
- Store `updatedAt` with each cache entry.

Use cache keys aligned with Web behavior:

```text
JSON.stringify({ limit, from, tag, artist })
```

Failure behavior:

- On successful network response, save latest data.
- On network failure, try cached page/detail.
- If cache exists, render cached data with a small "缓存数据" state.
- If no cache exists, render `error-state`.

`stores/favorites.js`

- Reserve local methods for later:
  - `readFavoriteIds`
  - `saveFavoriteIds`
  - `toggleFavorite`
- MVP can expose the functions without connecting remote sync.

`stores/history.js`

- Reserve local browsing history functions:
  - `recordHistory(id)`
  - `readHistoryIds`
- Detail page should record local history in MVP if low risk.

## Image Loading Strategy

List pages:

- Use `thumbnail_url`.
- Set image mode to `aspectFill`.
- Use lazy loading where supported.
- On `binderror`, replace with local fallback.

Detail page:

- Use `display_url`.
- Do not request `download_url` until download functionality is implemented.
- Do not implement IIIF viewer in MVP; show a single native image.

Download extension:

- Later use `download_url` with `wx.downloadFile`.
- Saving to album requires user permission and should be separate from MVP.

## Style Migration Strategy

Do not copy `src/styles.css` as-is.

Use WXSS to recreate the mobile app structure:

- White background.
- Compact top spacing.
- Bottom tabBar handled by WeChat native config.
- Artwork cards with fixed image area, title, artist.
- Detail page with image hero, title, metadata, description.
- Error/loading/empty states consistent across pages.

Keep the MVP visually close but simpler than the Web app:

- No PWA styles.
- No browser drawer.
- No OpenSeadragon/IIIF interaction.
- No complex CSS variables or browser-only media queries.

## app.json Plan

`miniapp/app.json` should include:

- `pages` with home, categories, detail, me.
- `window` title and theme colors.
- `tabBar` with home/categories/me.
- `usingComponents` globally only for components used across multiple pages, or page-local registration when clearer.
- `sitemapLocation`.

The detail page should not be in tabBar.

## project.config.json Plan

`miniapp/project.config.json` should:

- Set `compileType` to `miniprogram`.
- Set `miniprogramRoot` to `./`.
- Use the existing appid if this is the intended production Mini Program appid.
- Set `urlCheck` to `false` only for local early development if needed.
- Document that release/test builds must use valid HTTPS domains and configured request/download domains.

## WeChat Developer Tools Opening Method

Open this directory in WeChat Developer Tools:

```text
D:\art\miniapp
```

Do not open `D:\art` for the native migration MVP unless root project configuration is intentionally changed later.

## Domain Configuration Requirements

Before real device testing or release, configure these domains in WeChat Mini Program admin:

- Request domain: Supabase REST/Auth project domain.
- Download domain: Supabase Storage public object domain.
- Upload domain: not needed in MVP.
- Socket domain: not needed in MVP.

All production URLs must be HTTPS.

## Implementation Tasks

### Task 1: Create Isolated Mini Program Shell

**Files:**

- Create: `miniapp/app.json`
- Create: `miniapp/app.js`
- Create: `miniapp/app.wxss`
- Create: `miniapp/project.config.json`
- Create: `miniapp/sitemap.json`

- [ ] Create the `miniapp/` directory.
- [ ] Add a valid `app.json` with four routes and tabBar.
- [ ] Add empty app lifecycle in `app.js`.
- [ ] Add global page background and box sizing in `app.wxss`.
- [ ] Add `project.config.json` with `compileType: miniprogram`.
- [ ] Add `sitemap.json`.
- [ ] Open `D:\art\miniapp` in WeChat Developer Tools and confirm it compiles.

### Task 2: Add Shared Request and Config Layer

**Files:**

- Create: `miniapp/services/config.js`
- Create: `miniapp/services/request.js`

- [ ] Define public Supabase URL and anon key placeholders in `config.js`.
- [ ] Add comments stating service role keys are forbidden in Mini Program code.
- [ ] Implement `request({ url, method, data, header })` using `wx.request`.
- [ ] Normalize failed HTTP status codes into rejected errors.
- [ ] Add timeout behavior.
- [ ] Verify a simple request failure displays a readable error in developer tools console.

### Task 3: Add Artwork API Adapter

**Files:**

- Create: `miniapp/services/artworks.js`
- Create: `miniapp/utils/cache-key.js`
- Create: `miniapp/utils/format.js`

- [ ] Implement field-cropped summary query.
- [ ] Implement field-cropped detail query by id.
- [ ] Implement tag filtering.
- [ ] Implement artist filtering as an extension point.
- [ ] Normalize records to the same item shape used by pages.
- [ ] Confirm no query uses `select=*`.
- [ ] Confirm list responses include count when available.

### Task 4: Add Cache Stores

**Files:**

- Create: `miniapp/stores/artwork-cache.js`
- Create: `miniapp/stores/favorites.js`
- Create: `miniapp/stores/history.js`

- [ ] Add page cache read/write using `wx.getStorageSync` and `wx.setStorageSync`.
- [ ] Add detail cache read/write.
- [ ] Add local favorite id read/write stubs.
- [ ] Add local browsing history read/write.
- [ ] Verify storage keys are namespaced with `artArchive:`.

### Task 5: Add Shared Components

**Files:**

- Create: `miniapp/components/artwork-card/*`
- Create: `miniapp/components/loading-state/*`
- Create: `miniapp/components/error-state/*`
- Create: `miniapp/components/empty-state/*`
- Create: `miniapp/components/tag-chip/*`
- Add: `miniapp/assets/image-fallback.svg`

- [ ] Create artwork card component.
- [ ] Create loading component.
- [ ] Create error component with retry event.
- [ ] Create empty component.
- [ ] Create tag chip component.
- [ ] Add image fallback behavior with `binderror`.

### Task 6: Implement Home Page MVP

**Files:**

- Create: `miniapp/pages/home/home.wxml`
- Create: `miniapp/pages/home/home.js`
- Create: `miniapp/pages/home/home.wxss`

- [ ] Fetch first page with `limit: 20` or `limit: 40`.
- [ ] Render artwork cards with thumbnail images.
- [ ] Add pull-down refresh if low risk.
- [ ] Add "load more" via `onReachBottom`.
- [ ] Use cache on network failure.
- [ ] Show loading, error, and empty states.
- [ ] Navigate to detail on artwork tap.

### Task 7: Implement Categories Page MVP

**Files:**

- Create: `miniapp/pages/categories/categories.wxml`
- Create: `miniapp/pages/categories/categories.js`
- Create: `miniapp/pages/categories/categories.wxss`

- [ ] Define initial tag groups from known tags already used by the Web project.
- [ ] Render chips for movement, era, region, and subject groups.
- [ ] On chip tap, request paged results by tag.
- [ ] Render total count when Supabase returns count.
- [ ] Add pagination with `onReachBottom`.
- [ ] Show error and empty states.

### Task 8: Implement Detail Page MVP

**Files:**

- Create: `miniapp/pages/detail/detail.wxml`
- Create: `miniapp/pages/detail/detail.js`
- Create: `miniapp/pages/detail/detail.wxss`

- [ ] Read `id` from route query.
- [ ] Fetch detail fields by id.
- [ ] Use cached detail on failure.
- [ ] Render display image, title, artist, year, location, medium, dimensions, description, tags.
- [ ] Record local browsing history after successful load.
- [ ] Reserve favorite and download button positions without remote behavior.
- [ ] Do not load `download_url` image unless user action is implemented in a later phase.

### Task 9: Implement Basic Me Page Entry

**Files:**

- Create: `miniapp/pages/me/me.wxml`
- Create: `miniapp/pages/me/me.js`
- Create: `miniapp/pages/me/me.wxss`

- [ ] Show local favorite count.
- [ ] Show local browsing history count.
- [ ] Show placeholder entry for downloads.
- [ ] Show placeholder entry for future account login.
- [ ] Do not connect Supabase Auth in MVP.

### Task 10: Verification and Handoff

**Files:**

- No new runtime files.
- Optional: Create `docs/miniapp-migration-notes.md` if implementation needs operational notes.

- [ ] Run WeChat Developer Tools compile.
- [ ] Confirm Home loads list data or shows ErrorState.
- [ ] Confirm Home uses `thumbnail_url`.
- [ ] Confirm Categories filter by tag and paginate.
- [ ] Confirm Detail uses `display_url`.
- [ ] Confirm Detail does not request original `download_url` before download action.
- [ ] Confirm Me page opens from tabBar.
- [ ] Confirm no service role key appears under `miniapp/`.
- [ ] Confirm `src/` diff is unchanged by this migration.
- [ ] Confirm `supabase/` diff is unchanged by this migration.

## MVP Acceptance Checklist

- WeChat Developer Tools opens `D:\art\miniapp` without "missing app.json".
- App compiles as a native Mini Program.
- Home page renders artworks or a clear error state.
- Categories page can select a tag and show paged results.
- Detail page opens from a card and displays one artwork.
- Me page exists as a tab and shows local-only placeholders.
- List images use `thumbnail_url`.
- Detail image uses `display_url`.
- No original image is requested before download behavior exists.
- No service role key is present in Mini Program code.
- No Web project files are changed.
- No Supabase SQL/RBAC/RLS/Auth files are changed.

## Risks and Mitigations

Supabase compatibility:

- Risk: `@supabase/supabase-js` may rely on browser APIs not available in Mini Program.
- Mitigation: Use Supabase REST via `wx.request` in MVP.

Domain restrictions:

- Risk: Developer Tools or real devices block Supabase domains.
- Mitigation: Configure request/download legal domains before real-device testing.

Auth:

- Risk: Supabase Auth session persistence differs from browser.
- Mitigation: Defer Auth to a later phase; evaluate backend token exchange or Edge Function.

Image traffic:

- Risk: Lists may accidentally load original images.
- Mitigation: Enforce thumbnail/display/download URL separation in page code review.

Review policy:

- Risk: Some art content may trigger content review.
- Mitigation: Add content moderation or tag-based exclusions before public submission.

## Future Phases

Phase 2:

- Search.
- Better tag discovery from database.
- Scroll position restoration.
- Stronger offline cache.

Phase 3:

- Local favorites.
- Local browsing history screens.
- Download queue and save-to-album flow.

Phase 4:

- Account login assessment.
- Remote favorites/history/profile sync.
- Supabase Auth or backend token bridge.

Phase 5:

- Review readiness.
- Privacy policy.
- Domain configuration.
- Real-device performance testing.

## Self-Review

- Covers required directory structure, routes, component split, styling strategy, API adaptation, local cache, fallback images, app/project config, WeChat Developer Tools opening method, and verification checklist.
- Keeps implementation isolated under `miniapp/`.
- Preserves current Vite Web project and Supabase/RBAC/RLS constraints.
- Defines MVP boundaries and future extension space.
- Contains no instruction to commit automatically.
