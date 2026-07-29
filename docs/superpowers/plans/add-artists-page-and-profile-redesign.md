# Add Artists Page And Profile Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-stage native WeChat Mini Program artists section, artist detail page, mock artist data, tabBar entry, and a static profile redesign without changing database schema or auth logic.

**Architecture:** Keep the work inside `miniapp/`. Artists use local mock data in `miniapp/data/mock-artists.js` and a focused service in `miniapp/services/artists.js`; artwork matching on artist detail reuses the existing WeChat Cloud `artworks` collection through a small read-only helper. UI follows the existing native miniapp page/component patterns and reuses `artwork-card`.

**Tech Stack:** Native WeChat Mini Program, WXML/WXSS/JS, WeChat Cloud Database for existing artworks, local mock data for artists, existing `artwork-card` component.

---

### Task 1: Add Artist Data And Service

**Files:**
- Create: `miniapp/data/mock-artists.js`
- Create: `miniapp/services/artists.js`
- Modify: `miniapp/services/artworks.js`

- [ ] Create mock artist records with `id`, Chinese/English names, lifespan, region, country, styles, periods, aliases, bio, representative works, tags, and placeholder avatar text.
- [ ] Implement `listArtists`, `filterArtists`, `getArtistById`, and fallback helpers in `services/artists.js`.
- [ ] Add `fetchArtworksByArtistAliases(aliases, options)` to `services/artworks.js`; it must read only from the existing `artworks` collection and must not modify database data.
- [ ] Verify with `node --check miniapp/data/mock-artists.js miniapp/services/artists.js miniapp/services/artworks.js`.

### Task 2: Add Artists List Page

**Files:**
- Create: `miniapp/pages/artists/artists.js`
- Create: `miniapp/pages/artists/artists.wxml`
- Create: `miniapp/pages/artists/artists.wxss`

- [ ] Build header, search bar, Region/Style/Period filter tags, and artist grid.
- [ ] Search should match Chinese name, English name, lifespan, region, country, style, period, and aliases.
- [ ] Filter tags should behave like category filters but operate on mock artists.
- [ ] Artist cards should show placeholder circular avatar, Chinese name, English name, country/style/period, and artwork count.
- [ ] Card tap should navigate to `/pages/artist-detail/artist-detail?id=<artist-id>`.

### Task 3: Add Artist Detail Page

**Files:**
- Create: `miniapp/pages/artist-detail/artist-detail.js`
- Create: `miniapp/pages/artist-detail/artist-detail.wxml`
- Create: `miniapp/pages/artist-detail/artist-detail.wxss`

- [ ] Load artist by `id`.
- [ ] Show back button, placeholder portrait, Chinese/English names, lifespan, bio, country, styles, active period, representative works, and tags.
- [ ] Query artworks by `aliases` using `fetchArtworksByArtistAliases`.
- [ ] Display matched artworks with existing `artwork-card`; do not load original image URLs by default.
- [ ] Show an empty state if no artworks match.

### Task 4: Update Routing And TabBar

**Files:**
- Modify: `miniapp/app.json`
- Create: `miniapp/assets/tab/artists.png`
- Create: `miniapp/assets/tab/artists-active.png`

- [ ] Add `pages/artists/artists` and `pages/artist-detail/artist-detail` to `pages`.
- [ ] Change tabBar to four entries: 首页, 分类, 画家, 我的.
- [ ] Generate simple local PNG tab icons for the artists tab.
- [ ] Keep existing home/category/profile icon paths intact.

### Task 5: Redesign Profile Page As Static Placeholder

**Files:**
- Modify: `miniapp/pages/profile/profile.js`
- Modify: `miniapp/pages/profile/profile.wxml`
- Modify: `miniapp/pages/profile/profile.wxss`

- [ ] Add mock user data in page state.
- [ ] Build profile hero with placeholder avatar, nickname, and identity text.
- [ ] Add stats cards for 我的收藏, 关注画家, 浏览历史.
- [ ] Add grouped menu sections for 账户与安全, 收藏与管理, 系统设置.
- [ ] Add static logout button. Do not add auth, RBAC, or real user data.

### Task 6: Verification

**Files:**
- No new files.

- [ ] Run `Get-ChildItem miniapp -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }`.
- [ ] Run `node -e "JSON.parse(require('fs').readFileSync('miniapp/app.json','utf8')); console.log('app.json ok')"`.
- [ ] Run `npm run check`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm run build`.
- [ ] Summarize changed files, routes, mock data, artist search/filter behavior, artwork matching behavior, profile redesign, tabBar status, verification results, risks, and next steps.
