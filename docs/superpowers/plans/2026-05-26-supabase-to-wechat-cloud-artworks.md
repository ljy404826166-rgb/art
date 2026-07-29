# Supabase To WeChat Cloud Artworks Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export public artwork records from Supabase `published_artworks`, transform them into WeChat Cloud Database `artworks` JSON documents, and document safe import and verification steps.

**Architecture:** Treat Supabase as the source of truth and WeChat Cloud Database as a read-only public mirror for the native Mini Program. Migration runs as local tooling: read-only export, deterministic JSON transform, staged import, and verification without modifying Supabase or user/RBAC/Auth data.

**Tech Stack:** Node.js migration scripts, Supabase read-only REST/client access, JSON export files, WeChat Cloud Database `artworks` collection, WeChat Mini Program cloud database SDK.

---

## Scope

Migrate only:

- `public.published_artworks` public artwork records.

Do not migrate:

- `user_profiles`
- `user_settings`
- `user_roles`
- `user_favorites`
- `user_browsing_history`
- `user_downloads`
- `auth.users`
- RBAC / RLS / Supabase policy definitions
- Service role keys into Mini Program code
- Any private user data

Do not modify:

- Supabase database rows or schema.
- Supabase RBAC/RLS/Auth logic.
- Existing Vite Web app runtime.

## Field Mapping Table

| Supabase `published_artworks` | WeChat `artworks` | Type | Required | Notes |
|---|---|---:|---:|---|
| `id` | `_id` | string | yes | Use deterministic `_id`, recommended `artwork_${id}`. |
| `id` | `supabase_id` | string | yes | Preserve original Supabase id for audit and re-sync. |
| `slug` | `slug` | string | yes | Keep for future routing/search. |
| `title_cn` | `title_cn` | string | yes | Primary title in Mini Program UI. |
| `title_en` | `title_en` | string/null | no | Secondary title. |
| `artist` | `artist` | string | yes | Used by list, detail, filter/search. |
| `year_and_place` | `year_and_place` | string/null | no | Detail metadata. |
| `location` | `location` | string/null | no | Detail metadata. |
| `medium` | `medium` | string/null | no | Detail metadata. |
| `dimensions` | `dimensions` | string/null | no | Detail metadata. |
| `description` | `description` | string/null | no | Detail text; keep out of list projections. |
| `tags` | `tags` | string[] | yes | Normalize to array. |
| `tags_text` | `tags_text` | string/null | no | Keep for display/debug compatibility. |
| `tags` / `tags_text` | `tag_keys` | string[] | yes | Duplicate normalized tags for category queries. |
| `source_name` | `source_name` | string/null | no | Source metadata. |
| `source_url` | `source_url` | string/null | no | External source reference; do not expose as navigation in MVP. |
| `image_id` | `image_id` | string/null | no | Useful for image audit. |
| `thumbnail_url` | `thumbnail_url` | string/null | no | List/card image. |
| `display_url` | `display_url` | string/null | no | Detail image. |
| `download_url` | `download_url` | string/null | no | Preserve for later download feature; do not request before user action. |
| `iiif_url` | `iiif_url` | string/null | no | Preserve but do not use in MVP. |
| `created_at` | `created_at` | string | yes | Sorting and audit. |
| `updated_at` | `updated_at` | string | yes | Incremental sync anchor. |
| none | `status` | string | yes | Always `"published"` for migrated records. |
| none | `migrated_at` | string | yes | ISO timestamp of migration run. |
| none | `migration_batch` | string | yes | Batch id for rollback and audit. |

## JSON Document Structure

Each exported WeChat Cloud Database document should follow this shape:

```json
{
  "_id": "artwork_123",
  "supabase_id": "123",
  "slug": "legacy-paintings-123",
  "title_cn": "星月夜",
  "title_en": "The Starry Night",
  "artist": "Vincent van Gogh",
  "year_and_place": "1889",
  "location": "Museum of Modern Art, New York",
  "medium": "Oil on canvas",
  "dimensions": "73.7 x 92.1 cm",
  "description": "Artwork description.",
  "tags": ["后印象派", "夜景", "油画"],
  "tags_text": "后印象派,夜景,油画",
  "tag_keys": ["后印象派", "夜景", "油画"],
  "source_name": "Artvee",
  "source_url": "https://example.com/source",
  "image_id": "123",
  "thumbnail_url": "https://example.com/thumb.webp",
  "display_url": "https://example.com/display.webp",
  "download_url": "https://example.com/original.jpg",
  "iiif_url": null,
  "created_at": "2026-05-26T00:00:00.000Z",
  "updated_at": "2026-05-26T00:00:00.000Z",
  "status": "published",
  "migrated_at": "2026-05-26T12:00:00.000Z",
  "migration_batch": "published-artworks-2026-05-26"
}
```

Normalization rules:

- Convert every id to string.
- `_id = "artwork_" + id`.
- `supabase_id = id`.
- Empty strings become `null`, except required display fields where fallback is needed.
- `tags` must always be an array.
- `tag_keys` must be the normalized tag array with duplicates removed.
- `thumbnail_url = thumbnail_url || display_url || null`.
- `display_url = display_url || thumbnail_url || null`.
- `download_url = download_url || null`.
- Do not collapse `download_url` into `thumbnail_url` or `display_url`.

## Export Method

Preferred export method: local Node script using Supabase read-only access.

Create:

```text
scripts/export-published-artworks-for-wechat.mjs
```

Script responsibilities:

- Read environment variables from `.env.local` or current shell.
- Use only `VITE_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` and anon/publishable key for public view export, unless a local operator explicitly chooses service role for export.
- Never print keys.
- Query `published_artworks` with the mapped fields.
- Paginate in batches of 500 or 1000.
- Write raw export file.
- Write transformed WeChat JSON file.
- Write manifest with counts, field list, batch id, and timestamp.

Export query fields:

```text
id,slug,title_cn,title_en,artist,year_and_place,location,medium,dimensions,description,tags,tags_text,source_name,source_url,image_id,thumbnail_url,display_url,download_url,iiif_url,created_at,updated_at
```

Output paths:

```text
exports/wechat-cloud/published-artworks.raw.json
exports/wechat-cloud/artworks.wechat.json
exports/wechat-cloud/artworks.sample-20.json
exports/wechat-cloud/artworks.manifest.json
```

Staged export sequence:

- Export first 20 records for sample validation.
- Export first 100 records for pilot validation.
- Export all records only after sample and pilot pass.

## Transform Script Plan

Create:

```text
scripts/transform-published-artworks-to-wechat.mjs
```

The transform may be implemented separately from export, or export script may call shared transform helpers.

Suggested shared helper file:

```text
scripts/wechat-artwork-transform.mjs
```

Transform responsibilities:

- Validate input is an array.
- Map fields according to the table above.
- Normalize tags.
- Normalize empty values.
- Preserve image URL separation.
- Add `status`, `migrated_at`, `migration_batch`.
- Detect duplicate `_id`.
- Detect records missing `title_cn`, `artist`, or both image URLs.
- Produce a warning report without mutating source data.

Validation report fields:

```json
{
  "total": 1958,
  "valid": 1958,
  "missingTitle": 0,
  "missingArtist": 0,
  "missingImages": 0,
  "duplicateIds": [],
  "taglessRecords": 12
}
```

## WeChat Cloud Import Method

Recommended import sequence:

1. Create WeChat Cloud environment.
2. Create collection:

```text
artworks
```

3. Configure permissions:

```text
client read: allowed
client write: denied
admin/cloud function write: allowed
```

4. Import `artworks.sample-20.json` through WeChat Cloud Console.
5. Verify Mini Program reads sample records.
6. Import 100-record pilot.
7. Verify pagination, category query, and detail lookup.
8. Import full `artworks.wechat.json`.

If the cloud console import format requires line-delimited JSON, add an export mode:

```text
exports/wechat-cloud/artworks.wechat.ndjson
```

Do not delete existing collection before full import unless a backup export exists.

## Mini Program Read Plan

Add cloud initialization in `miniapp/app.js` in the implementation phase:

```text
wx.cloud.init({ env: "<cloud-env-id>" })
```

Home page:

- Read `artworks`.
- Filter `status == "published"`.
- Order by `created_at desc`.
- Use `limit(20)`.
- Use `skip(page * 20)` for MVP pagination.
- Render `thumbnail_url`.

Category page:

- Read `artworks`.
- Filter `status == "published"`.
- Filter `tag_keys` by selected tag.
- Use pagination.

Detail page:

- Use document `_id`.
- Read one record from `artworks`.
- Render `display_url`.
- Do not request `download_url` until download feature exists.

Profile page:

- Remains local placeholder in this migration.
- Does not read user collections.

## Permission Setting Recommendation

For `artworks`:

- Public client read is acceptable because data is already public.
- Client write must be denied.
- Admin write should happen only through cloud console, cloud function, or trusted import tool.

Recommended rule concept:

```text
read: true
write: false
```

If using cloud functions for import/update:

```text
client: read only
cloud function with admin privileges: write
```

Never store these in Mini Program code:

- Supabase service role key.
- WeChat cloud admin secret.
- Private user data.

## Verification Checklist

Supabase export:

- [ ] Export query reads only `published_artworks`.
- [ ] Export does not query user/RBAC/Auth tables.
- [ ] Export does not write to Supabase.
- [ ] Raw export count matches expected Supabase count.
- [ ] Raw export contains required fields.

Transform:

- [ ] Every document has `_id`.
- [ ] Every document has `supabase_id`.
- [ ] `tags` is always an array.
- [ ] `tag_keys` is always an array.
- [ ] `_id` values are unique.
- [ ] `thumbnail_url` and `display_url` remain separate.
- [ ] `download_url` remains original/download URL.
- [ ] No service role key appears in output.
- [ ] No user private data appears in output.

WeChat Cloud import:

- [ ] `artworks` collection exists.
- [ ] Sample 20 import succeeds.
- [ ] Pilot 100 import succeeds.
- [ ] Full import succeeds only after pilot verification.
- [ ] Imported document count matches manifest count.
- [ ] Cloud database indexes exist for `status`, `created_at`, `updated_at`, `artist`, and `tag_keys` if supported.

Mini Program:

- [ ] Home page reads `artworks`.
- [ ] Home page renders `thumbnail_url`.
- [ ] Category page filters by tag.
- [ ] Detail page reads by `_id`.
- [ ] Detail page renders `display_url`.
- [ ] `download_url` is not requested before user download action.
- [ ] Network/image failure shows fallback state.
- [ ] Profile page remains local-only.

Permissions:

- [ ] Client can read `artworks`.
- [ ] Client cannot create/update/delete `artworks`.
- [ ] Import credentials are not committed.
- [ ] Supabase RBAC/RLS/Auth files are unchanged.

## Rollback Plan

Supabase rollback:

- No Supabase rollback is needed because this migration is read-only against Supabase.

WeChat Cloud rollback:

Option A: Delete imported batch by `migration_batch`.

- Query documents where `migration_batch == "<batch-id>"`.
- Delete only those documents.
- Use this if import created bad transformed documents.

Option B: Restore from backup export.

- Before replacing full collection, export existing `artworks` collection from WeChat Cloud Console.
- Save backup as:

```text
exports/wechat-cloud/backups/artworks-before-<batch-id>.json
```

- Re-import backup if a full import needs to be reverted.

Option C: Versioned import without deletion.

- Add `migration_batch` and `status`.
- Mark old batch inactive through admin tooling.
- Switch Mini Program query to `status == "published"` and latest accepted batch only if version filtering is introduced later.

Recommended MVP rollback:

- For sample and pilot, delete by `migration_batch`.
- For full import, export backup first, then import full dataset.

## Implementation Tasks

### Task 1: Migration Documentation And Output Directories

**Files:**

- Create: `exports/wechat-cloud/.gitkeep`
- Create: `exports/wechat-cloud/backups/.gitkeep`
- Create: `docs/wechat-cloud-artworks-import.md`

- [ ] Create output directories.
- [ ] Document required environment variables.
- [ ] Document that `.env.local` and credentials must not be committed.
- [ ] Document WeChat Cloud collection name: `artworks`.

### Task 2: Export Script

**Files:**

- Create: `scripts/export-published-artworks-for-wechat.mjs`

- [ ] Add read-only Supabase connection.
- [ ] Add paginated `published_artworks` export.
- [ ] Add `--limit` and `--offset` for sample/pilot.
- [ ] Add `--out-dir exports/wechat-cloud`.
- [ ] Add manifest output.
- [ ] Verify sample export reads 20 records.

### Task 3: Transform Script

**Files:**

- Create: `scripts/wechat-artwork-transform.mjs`
- Create: `scripts/transform-published-artworks-to-wechat.mjs`

- [ ] Implement field mapping.
- [ ] Implement tag normalization.
- [ ] Implement image URL preservation.
- [ ] Implement duplicate id detection.
- [ ] Write transformed JSON and validation report.

### Task 4: Import Guide

**Files:**

- Modify: `docs/wechat-cloud-artworks-import.md`

- [ ] Add cloud console import steps.
- [ ] Add sample-20 import procedure.
- [ ] Add pilot-100 import procedure.
- [ ] Add full import procedure.
- [ ] Add permission configuration.
- [ ] Add rollback steps.

### Task 5: Mini Program Read Adapter Plan

**Files:**

- Modify: `docs/wechat-cloud-artworks-import.md`

- [ ] Add Mini Program home query example.
- [ ] Add category query example.
- [ ] Add detail query example.
- [ ] Add image URL usage rules.
- [ ] Add fallback behavior expectations.

## Execution Order

1. Write docs and output directory placeholders.
2. Implement export script.
3. Run sample 20 export.
4. Implement transform script.
5. Transform sample 20.
6. Manually import sample 20 into WeChat Cloud.
7. Verify Mini Program can read sample data.
8. Run pilot 100.
9. Import and verify pilot 100.
10. Export and import full dataset only after pilot passes.

## Self-Review

- Includes required field mapping table.
- Defines JSON document structure.
- Covers export, transform, import, Mini Program reads, permissions, verification, and rollback.
- Keeps migration limited to `published_artworks`.
- Explicitly excludes user/RBAC/Auth/private data.
- Does not include code implementation.
