# Home Horizontal Card Pagination Design

## Goal

The miniapp home page should let users browse every artwork row horizontally. Each row starts with 8 artwork cards. When the user scrolls that row to the right edge, the row appends another 8 cards, and this can repeat until no more items are available.

This applies to all home rows:

- Recommendation rows append more random published artworks.
- Tag rows append more published artworks that belong to the same tag.

## Existing Context

The home page already renders each section as a horizontal `scroll-view` in `miniapp/pages/home/home.wxml`. `miniapp/pages/home/home.js` builds sections with `ROW_LIMIT = 8`. Tag and category pages already use `fetchArtworksByTag(tag, { pageSize, skip })`, so home rows can reuse the same service to keep appended tag rows scoped to the original tag.

The working tree already contains local changes that improve horizontal card rendering and tap suppression during manual row dragging. The pagination change should build on that behavior without reverting it.

## Data Model

Each home section will track independent row pagination state:

- `items`: rendered cards in the row.
- `skip`: number of source items already loaded for tag rows.
- `hasMore`: whether another horizontal batch can be requested.
- `loadingMore`: whether this row is already requesting a batch.
- `isRecommendation`: whether to use random recommendation loading.
- `tag` / `targetTag`: tag value for tag-scoped loading.
- `scrollLeft`: current horizontal offset.

Initial page load keeps using 8 items per row. Tag sections set `skip` to the number of cards initially shown. Recommendation rows do not need a strict skip because random loading is sampled and deduplicated locally.

## Loading Behavior

The home row `scroll-view` will listen for horizontal lower-edge events. When a row reaches the edge:

1. Ignore the event if the row is already loading, has no more content, or the page is in search mode.
2. For recommendation rows, fetch a small random artwork sample and append up to 8 artworks not already present in the row.
3. For tag rows, call `fetchArtworksByTag(tag, { pageSize: 8, skip })`, append unique results, and advance `skip`.
4. Mark `hasMore` false when a tag fetch returns fewer than 8 results or no unique recommendation results can be found after the request.
5. Preserve the current row offset so the new cards extend the row instead of resetting the user to the beginning.

The existing vertical `onReachBottom` behavior remains responsible for appending more home sections. Horizontal row loading and vertical section loading remain separate.

## UI States

Rows should remain visually close to the current preview. A small inline loading indicator can appear after the cards while a row is fetching more. If a row has no more cards, the page should avoid noisy end labels unless an existing pattern requires one.

## Error Handling

If a row-level load fails, clear that row's `loadingMore` flag and keep the existing cards visible. Store the normalized error in the page-level `error` field so the current error-state pattern can display it.

Fallback data remains finite. If cloud loading fails and fallback rows are shown, tag rows can append from the fallback collection only if enough local fallback items exist; otherwise `hasMore` becomes false.

## Testing

Add focused unit coverage for pure home-section pagination helpers where practical. Verify manually or through project checks that:

- Every row starts at 8 cards.
- Recommendation row appends another batch on horizontal lower edge.
- Tag row appends only artworks containing that tag.
- Duplicate artwork IDs are not appended.
- A row cannot start overlapping duplicate requests.

