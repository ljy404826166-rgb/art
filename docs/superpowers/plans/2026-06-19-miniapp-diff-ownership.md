# Miniapp Diff Ownership Review

Date: 2026-06-19

Scope: current tracked and untracked changes in `D:\art`.

This review is for splitting the current mixed miniapp worktree into safe, reviewable commits. It does not stage or commit anything.

## Command Summary

Commands executed:

```powershell
git status --short
git diff --stat
git ls-files --others --exclude-standard
git diff --name-status
```

Current tracked diff summary:

```text
25 tracked files changed, 806 insertions, 570 deletions.
```

Current untracked miniapp/docs files include:

```text
docs/superpowers/plans/2026-06-17-home-horizontal-artwork-row.md
docs/superpowers/plans/2026-06-17-home-horizontal-card-pagination.md
docs/superpowers/plans/2026-06-19-miniapp-short-term-optimization.md
miniapp/components/horizontal-artwork-row/
miniapp/pages/detail/detail-image-layout.js
miniapp/pages/detail/detail-image-layout.test.mjs
miniapp/pages/home/home-pagination.js
miniapp/pages/home/home-pagination.test.mjs
miniapp/pages/home/home-search.js
miniapp/pages/home/home-search.test.mjs
miniapp/services/artworks-search.test.mjs
miniapp/services/downloads.js
miniapp/services/downloads.test.mjs
miniapp/services/search-engine.js
```

## Group A: Search Refactor

These changes belong to the home full-database search refactor and standalone search-page removal.

```text
miniapp/services/search-engine.js
miniapp/pages/home/home-search.js
miniapp/pages/home/home-search.test.mjs
miniapp/services/artworks-search.test.mjs
miniapp/services/artworks.js
miniapp/pages/search/search.js
miniapp/pages/search/search.json
miniapp/pages/search/search.wxml
miniapp/pages/search/search.wxss
```

Mixed files with search hunks:

```text
miniapp/app.json
miniapp/pages/home/home.js
miniapp/pages/home/home.wxml
miniapp/pages/home/home.wxss
```

Notes:

- `miniapp/services/artworks.js` currently contains cloud candidate search, search normalization exports, and full-corpus helper code.
- `miniapp/pages/home/home.js` contains search scheduling and full-database search state, but also home row pagination and tag navigation. Stage it by hunk, not as a whole file.
- `miniapp/pages/home/home.wxml` contains inline home search UI and standalone search page removal, but also horizontal row rendering. Stage it by hunk.
- `miniapp/app.json` removes `pages/search/search`; include it only with the search-page removal commit.

## Group B: Home Horizontal Row / Card Geometry

These changes belong to fixed-height, ratio-derived-width home artwork rows and horizontal row pagination.

```text
miniapp/components/horizontal-artwork-row/horizontal-artwork-row-geometry.js
miniapp/components/horizontal-artwork-row/horizontal-artwork-row-geometry.test.mjs
miniapp/components/horizontal-artwork-row/horizontal-artwork-row.js
miniapp/components/horizontal-artwork-row/horizontal-artwork-row.json
miniapp/components/horizontal-artwork-row/horizontal-artwork-row.wxml
miniapp/components/horizontal-artwork-row/horizontal-artwork-row.wxss
miniapp/components/artwork-card/artwork-card.js
miniapp/components/artwork-card/artwork-card.wxml
miniapp/pages/home/home-pagination.js
miniapp/pages/home/home-pagination.test.mjs
miniapp/pages/home/home.json
```

Mixed files with row/card hunks:

```text
miniapp/pages/home/home.js
miniapp/pages/home/home.wxml
miniapp/pages/home/home.wxss
```

Notes:

- `miniapp/components/artwork-card/artwork-card.js` measures row artwork ratios and emits `layoutchange`.
- `miniapp/components/artwork-card/artwork-card.wxml` switches row cards to `aspectFit`.
- `miniapp/pages/home/home.json` registers the horizontal row component.
- Do not combine these with search refactor in one commit unless the hunk split is impossible.

## Group C: Detail Page Display / Download / Detail Image Ratio

These changes belong to artwork detail metadata cleanup, download behavior, and detail hero image ratio preservation.

```text
miniapp/pages/detail/detail.js
miniapp/pages/detail/detail.wxml
miniapp/pages/detail/detail.wxss
miniapp/pages/detail/detail-image-layout.js
miniapp/pages/detail/detail-image-layout.test.mjs
miniapp/services/downloads.js
miniapp/services/downloads.test.mjs
miniapp/services/local-library.js
miniapp/components/artwork-image/artwork-image.wxss
miniapp/data/fallback-artworks.js
miniapp/pages/category/category.js
miniapp/pages/favorites/favorites.js
miniapp/pages/history/history.js
miniapp/pages/tag/tag.js
miniapp/pages/artist-detail/artist-detail.js
```

Notes:

- `miniapp/pages/detail/detail.js` adds hero image measurement and download flow.
- `miniapp/services/local-library.js` adds local download history bookkeeping.
- `miniapp/components/artwork-image/artwork-image.wxss` removes the detail image minimum height.
- `miniapp/data/fallback-artworks.js` normalizes year, location, and medium display values.
- `miniapp/pages/category/category.js`, `favorites.js`, `history.js`, `tag.js`, and `artist-detail.js` only pass image ratio into detail navigation. These are detail-image-layout support changes.

## Group D: Tag Detail / "查看更多"

These changes belong to the home section "查看更多" entry and tag detail reuse.

```text
miniapp/pages/home/home.js
miniapp/pages/home/home.wxml
miniapp/pages/home/home.wxss
```

Notes:

- The actual tag page currently has only detail-ratio navigation changes in `miniapp/pages/tag/tag.js`; those are Group C.
- The "查看更多" UI and `openTagDetail` behavior appear in mixed home files and must be staged by hunk after the row/card geometry is stable.

## Group E: Icons / State / Profile / Category / Artist UI Historical Changes

These changes are UI cleanup outside the immediate search/row/detail/download path.

```text
miniapp/pages/artist-detail/artist-detail.wxml
miniapp/pages/artist-detail/artist-detail.wxss
```

Notes:

- These change the artist detail info panel from rows with icons to two-column cards.
- Keep them separate from the detail image/download commit because they affect a different page and user workflow.

## Group F: Docs / Tests / Support

Docs and support artifacts.

```text
docs/superpowers/plans/2026-06-17-home-horizontal-artwork-row.md
docs/superpowers/plans/2026-06-17-home-horizontal-card-pagination.md
docs/superpowers/plans/2026-06-19-miniapp-short-term-optimization.md
docs/superpowers/plans/2026-06-19-miniapp-diff-ownership.md
```

Notes:

- Functional tests should generally be committed with the feature they verify, not as a standalone docs/support commit.
- This ownership document can be committed separately as planning documentation, or kept local if the user wants a minimal code history.

## Group G: Unknown / Needs Manual Confirmation

No current file is fully unknown. The main risk is mixed hunks in these files:

```text
miniapp/pages/home/home.js
miniapp/pages/home/home.wxml
miniapp/pages/home/home.wxss
```

These must be split carefully by hunk during staging.

## Recommended Submit Order

1. Group A: search refactor and standalone search page removal.
2. Group B: home horizontal row/card geometry.
3. Group D: home "查看更多" entry, after Group B is visually stable.
4. Group C: detail display/download/detail image ratio.
5. Group E: artist detail UI cards.
6. Group F: docs planning files, if desired.

## Do Not Stage Whole File Without Review

These files currently contain mixed responsibilities:

```text
miniapp/pages/home/home.js
miniapp/pages/home/home.wxml
miniapp/pages/home/home.wxss
```

Use hunk staging for these files.

## Current Task 1 Decision

No files were staged or committed during this review.
