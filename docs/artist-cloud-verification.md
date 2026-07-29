# Artist Cloud Verification

This checklist verifies that reviewed artist metadata is served from the WeChat Cloud Database `artists` collection while related artworks continue to come from the existing `artworks` collection.

## Data Checks

1. The `artists` collection exists in the target WeChat Cloud environment.
2. The imported record count matches `miniapp/data/artists.reviewed.jsonl`.
3. Each imported artist document has `review_status` set to `reviewed`.
4. No `candidate` or `rejected` artist records are visible in the miniapp UI.
5. Imported artist documents use the reviewed field shape:
   - `_id`
   - `name_zh`
   - `name_en`
   - `lifespan_text`
   - `country`
   - `region`
   - `styles`
   - `periods`
   - `active_period`
   - `representative_works`
   - `aliases`
   - `bio_zh`
   - `tags`
   - `avatar_text`
   - `review_status`

## Miniapp Checks

1. Artist list page shows reviewed cloud artists.
2. Artist list search and filters work with cloud artist fields.
3. Artist detail page shows reviewed cloud biography and metadata.
4. Related artworks still load from the `artworks` collection by `artist.aliases`.
5. Related artworks load in batches of 8 on the artist detail page.
6. Artist detail no longer depends on local mock `artworkCount` as the source of truth.
7. Cloud read failure falls back to local artist data without blocking page rendering.

## Manual Verification In WeChat Developer Tools

1. Open the `miniapp/` project in WeChat Developer Tools.
2. Confirm Cloud Development is using the expected environment.
3. Open the `artists` collection and confirm the reviewed record count.
4. Search `莫奈` on the artist page and confirm Claude Monet appears.
5. Search `梵高` on the artist page and confirm Vincent van Gogh appears.
6. Open an artist detail page and confirm biography text comes from reviewed `bio_zh`.
7. Scroll the artist detail page and confirm related artworks append in batches of 8.
8. Disable or break cloud access in development and confirm the page falls back to local data.

## Expected Fallback Behavior

Fallback is a resilience path only. If fallback data is used in development, the page logs:

```text
Using local artist fallback data
```

The fallback should not be treated as the production source of truth. Incorrect cloud data should be fixed in the `artists` collection or in the reviewed JSON Lines source file, not by editing local mock data.

## Regression Guard

Run these checks after changing artist data loading:

```powershell
$tests = Get-ChildItem -Path 'miniapp' -Recurse -Filter '*.test.mjs' | ForEach-Object { $_.FullName }; node --test @tests
npm run check
npx tsc --noEmit
npm run build
git diff --check
```

All checks should pass before merging artist cloud integration changes.
