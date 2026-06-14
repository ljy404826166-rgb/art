# Image Derivatives Pilot

This pilot reduces Supabase Storage traffic by backfilling lightweight image URLs into `public.artwork_images.thumbnail_url` and `display_url` while preserving `download_url` as the original file.

The pilot is capped at 20 records. Do not expand to 100 records until the checks in this document pass.

## Safety Model

Eligible records must still satisfy all conditions:

```text
thumbnail_url == display_url
display_url == download_url
download_url is a Supabase Storage public URL
```

Derivative objects are written to new paths only:

```text
derivatives/thumb/{image_id}.webp
derivatives/display/{image_id}.webp
```

Storage uploads use `upsert: false`. Existing derivative objects are skipped as `skipped_object_exists`; they are never overwritten. `download_url` is not changed by the generation script.

## Parameters

```powershell
node scripts/generate-image-derivatives.mjs --dry-run --limit 20 --offset 0 --manifest ./image-derivatives-manifest.json
```

- `--dry-run`: default behavior. Reads candidates and writes a manifest only.
- `--apply`: allows image downloads, derivative uploads, and database updates.
- `--manifest`: output path for the plan and execution result.
- `--rollback-manifest`: output path for rollback data when `--apply` updates rows.
- `--limit`: number of records in this pilot window. Current maximum is 20.
- `--offset`: skips the first N rows in the ordered candidate window.

Without `--apply`, the script must not upload files or update database rows.

## 20-Row Pilot Flow

1. Dry-run the selected window:

```powershell
node scripts/generate-image-derivatives.mjs --dry-run --limit 20 --offset 0 --manifest ./image-derivatives-manifest.json
```

2. Review the manifest:

```powershell
node -e "const m=require('./image-derivatives-manifest.json'); console.log({readRows:m.readRows, eligibleRows:m.eligibleRows, skippedRows:m.skippedRows, first:m.rows[0] && {imageId:m.rows[0].imageId, thumb:m.rows[0].thumbnailObjectPath, display:m.rows[0].displayObjectPath}})"
```

3. Execute only the 20-row pilot when ready:

```powershell
node scripts/generate-image-derivatives.mjs --apply --limit 20 --offset 0 --manifest ./image-derivatives-manifest.apply.json --rollback-manifest ./image-derivatives-rollback.apply.json
```

During `--apply`, each row is checked again before update:

- The script queries `artwork_images` by `image_id`.
- It updates only if the current DB row is still eligible.
- If the DB has changed, the row is skipped as `skipped_db_changed`.

## SQL Verification

After dry-run, no derivative URLs should be present from the dry-run itself.

After apply, verify the manifest IDs:

```sql
select
  count(*) as total,
  count(*) filter (where thumbnail_url like '%/derivatives/thumb/%') as thumb_derivatives,
  count(*) filter (where display_url like '%/derivatives/display/%') as display_derivatives,
  count(*) filter (where download_url like '%/derivatives/%') as download_derivatives
from public.artwork_images
where id in (
  -- artwork_image_id values from image-derivatives-manifest.apply.json
);
```

Expected result for a fully successful 20-row pilot:

```text
total = 20
thumb_derivatives = 20
display_derivatives = 20
download_derivatives = 0
```

Also check for skipped rows in the apply manifest:

```powershell
node -e "const m=require('./image-derivatives-manifest.apply.json'); console.log(m.rows.map(r=>({imageId:r.imageId, updated:r.updated, skipped:r.skipped, reason:r.reason})))"
```

## Browser Network Verification

After the 20-row pilot is applied:

1. Open the app at `http://127.0.0.1:5173/`.
2. Open DevTools Network.
3. Filter requests by `derivatives/`.
4. On the home and category list views, image card requests should include:

```text
/storage/v1/object/public/artwork/derivatives/thumb/
```

5. Open a detail page. The detail image request should include:

```text
/storage/v1/object/public/artwork/derivatives/display/
```

6. Trigger a download flow only if needed. Download should still use the original URL, not `derivatives/`.

## Rollback

The apply command writes a rollback manifest with:

- `image_id`
- `previous_thumbnail_url`
- `previous_display_url`
- `previous_download_url`
- `new_thumbnail_url`
- `new_display_url`
- `updated_at`

Rollback dry-run:

```powershell
node scripts/rollback-image-derivatives.mjs --dry-run --limit 20 --manifest ./image-derivatives-rollback.apply.json
```

Rollback apply:

```powershell
node scripts/rollback-image-derivatives.mjs --apply --limit 20 --manifest ./image-derivatives-rollback.apply.json
```

Rollback restores database URLs only. It does not delete derivative files from Supabase Storage.

Equivalent SQL shape:

```sql
update public.artwork_images
set
  thumbnail_url = rollback.previous_thumbnail_url,
  display_url = rollback.previous_display_url,
  download_url = rollback.previous_download_url
from (
  values
    -- ('artwork_image_id', 'previous_thumbnail_url', 'previous_display_url', 'previous_download_url')
) as rollback(id, previous_thumbnail_url, previous_display_url, previous_download_url)
where public.artwork_images.id = rollback.id::uuid;
```

## Preconditions Before Expanding To 100

Do not run a 100-row batch until all items pass:

- The 20-row pilot has real derivative URLs in `thumbnail_url` and `display_url`.
- `download_url` remains original for every pilot row.
- Browser Network confirms list pages request `derivatives/thumb`.
- Browser Network confirms detail pages request `derivatives/display`.
- Re-running the pilot window reports existing objects as `skipped_object_exists`, not overwritten uploads.
- Rollback dry-run reads the rollback manifest successfully.
- A rollback has been tested on a tiny subset or approved as an emergency-only operation.
- Any `upload_failed`, `source_or_derivative_failed`, or `skipped_db_changed` rows have been reviewed.

Only after those checks should a separate plan raise the maximum batch size and process additional offsets.
