# Artist Data Governance

## Purpose

Artist profile data must be accurate enough for a public art browsing product. The miniapp should not treat local mock artist records as production truth. Reviewed artist records should live in the WeChat Cloud Database `artists` collection, while local mock data remains only a development or offline fallback.

## Accepted Sources

Use authority and institution sources in this order:

1. Getty ULAN for authority names, artist roles, nationality, dates, aliases, and stable identifiers.
2. Wikidata for structured cross-checking, multilingual names, dates, countries, and external identifiers.
3. VIAF for alias reconciliation and international authority-name variants.
4. Museum or institution pages for biography context and representative works.

## Source Rules

- Every reviewed record must include at least one authority source.
- Biography text must be a short original summary, not a copied long passage.
- Aliases must include the English name, common Chinese name, and common surname/name variants used in artwork records.
- A record is production-visible only when `review_status` is `reviewed`.
- Candidate records can be imported for internal review, but production queries must filter them out.
- Rejected records should be retained only when useful for audit history or duplicate prevention.

## Review Checklist

- Name fields match authority records.
- Birth and death years match at least one authority source.
- Country and region are normalized to project vocabulary.
- Styles and periods are consistent with current filter tags.
- Aliases match known artwork `artist` values.
- Biography is short, neutral, and source-informed.
- Representative works are historically relevant.
- `review_status` is set to `reviewed` only after manual review.

## Required Fields

Each reviewed `artists` document should include:

- `_id`: stable slug, such as `claude-monet`.
- `name_zh`: reviewed Chinese display name.
- `name_en`: reviewed English display name.
- `birth_year` and `death_year`: numeric years for filtering and verification.
- `lifespan_text`: display string, such as `1840-1926`.
- `country` and `region`: normalized Chinese values for UI filters.
- `styles` and `periods`: arrays aligned with miniapp filter options.
- `active_period`: short display text for artist detail pages.
- `representative_works`: reviewed representative work names.
- `aliases`: all known values used for search and artwork matching.
- `bio_zh`: short Chinese biography summary.
- `tags`: compact display/search tags.
- `avatar_text`: one or two Chinese characters for placeholder avatar display.
- `authority_ids`: source identifiers, such as `ulan`, `wikidata`, and `viaf`.
- `sources`: source records with title, URL, and fields verified from that source.
- `review_status`: `candidate`, `reviewed`, or `rejected`.
- `reviewed_by`, `reviewed_at`, and `updated_at`: review metadata.

## WeChat Cloud Collection

Recommended collection name:

```text
artists
```

Recommended public query rule:

```js
where({
  review_status: "reviewed"
})
```

Client-side miniapp code should read reviewed records only. The client must not write artist records.

## Import Rules

- Import reviewed data as JSON Lines, one artist document per line.
- Validate data before import.
- Do not import unreviewed local mock data as production data.
- Keep the reviewed JSON Lines file as the recoverable source artifact.
- Do not overwrite cloud records without a rollback path.

## Frontend Fallback Rule

The miniapp should try cloud `artists` first. If cloud read fails, it may fall back to local mock data so the UI remains usable during development or weak-network conditions. The fallback state should be visible in development logs, but should not be shown as reviewed production data.

## Related Artworks Rule

Artist profile data and artwork data stay separate:

- Artist metadata comes from the cloud `artists` collection.
- Related artworks continue to come from the cloud `artworks` collection.
- Related artworks are matched through reviewed `aliases`.
- Alias changes should be made in `artists` first; do not rewrite artwork records unless the artwork data itself is wrong.

## Rollback

If bad artist data is imported:

1. Set affected records to `review_status: "rejected"` or restore previous reviewed JSON Lines.
2. Re-import the corrected reviewed records manually through WeChat Cloud Console.
3. Keep the frontend fallback intact until the cloud data is confirmed.
4. Re-run artist list and detail page checks in WeChat Developer Tools.
