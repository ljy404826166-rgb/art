# Image Derivatives Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate real thumbnail and display image derivatives for a safe 20-record pilot, upload them without overwriting originals, and backfill `public.artwork_images.thumbnail_url` and `display_url` while preserving `download_url`.

**Architecture:** Add a small Node-based derivative pipeline under `scripts/` with strict dry-run defaults and manifest-first execution. The first script creates a manifest from 20 eligible `artwork_images` records; the second script processes that manifest, uploads derivative objects to new Storage paths, and optionally writes a rollback manifest; the third script applies database updates only when explicitly run without `--dry-run`. No schema migration is required.

**Tech Stack:** Node.js ESM scripts, `@supabase/supabase-js`, built-in `fetch`, a lightweight image encoder/resizer dependency such as `sharp`, Supabase Storage, Supabase PostgREST.

---

## Safety Rules

- Do not run full-table processing in this phase.
- Default every script to `--dry-run`.
- Require explicit `--limit 20` for the pilot.
- Do not print `SUPABASE_SERVICE_ROLE_KEY`, anon keys, or signed URLs.
- Do not overwrite original image objects.
- Do not delete original image objects.
- Keep `download_url` unchanged.
- Write all generated objects under new derivative paths:
  - `derivatives/thumb/{image_id}.webp`
  - `derivatives/display/{image_id}.webp`
- Use `upsert: false` for Storage uploads during pilot.
- If an object already exists, skip it and report it instead of replacing it.
- Never execute SQL migrations for this phase.

## Files

- Create: `D:/art/scripts/image-derivatives-shared.mjs`
  - Shared CLI parsing, env loading, Supabase client creation, URL/path helpers, manifest read/write, and safe logging.
- Create: `D:/art/scripts/generate-image-derivatives-manifest.mjs`
  - Read 20 eligible rows from `published_artworks` / `artwork_images` and write a JSON manifest. Does not download images, upload files, or update DB.
- Create: `D:/art/scripts/process-image-derivatives-manifest.mjs`
  - Read manifest, download source images for only manifest rows, generate 320-480px thumbnail and 1200-1600px display WebP derivatives, upload to Storage derivative paths, and write an upload result manifest. Defaults to dry-run.
- Create: `D:/art/scripts/apply-image-url-manifest.mjs`
  - Read upload result manifest and update `artwork_images.thumbnail_url` / `display_url` only. Defaults to dry-run and writes rollback manifest before updating.
- Create: `D:/art/scripts/image-derivatives.test.mjs`
  - Unit tests for helper logic, manifest shape, path generation, and update payloads.
- Modify: `D:/art/package.json`
  - Add npm scripts for manifest generation, derivative processing, DB apply dry-run, and tests.
- Modify: `D:/art/package-lock.json`
  - Updated only if a dependency such as `sharp` is added.
- Do not modify: `D:/art/src/app.js`
- Do not modify: `D:/art/supabase/schema.sql`
- Do not modify: existing ingestion scripts in `D:/art/scripts/*` during this pilot.

## Environment

Use local env files or shell env:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Rules:

- `generate-image-derivatives-manifest.mjs` can use anon key for read-only queries if RLS/policies allow it.
- `process-image-derivatives-manifest.mjs` needs service role only for Storage upload if anon cannot upload.
- `apply-image-url-manifest.mjs` likely needs service role for `artwork_images` update.
- Scripts must never log key values.
- Scripts should print only project host, object paths, row counts, and sanitized URLs.

## Data Model

Input row shape:

```js
{
  artwork_image_id: "uuid-from-artwork_images.id",
  artwork_id: "uuid-from-artworks.id",
  image_id: "1504_standard",
  title_cn: "特鲁维尔海滩上的卡米耶",
  thumbnail_url: "https://.../storage/v1/object/public/artwork/1504_standard.jpg",
  display_url: "https://.../storage/v1/object/public/artwork/1504_standard.jpg",
  download_url: "https://.../storage/v1/object/public/artwork/1504_standard.jpg"
}
```

Manifest row shape:

```js
{
  artworkImageId: "uuid-from-artwork_images.id",
  artworkId: "uuid-from-artworks.id",
  imageId: "1504_standard",
  title: "特鲁维尔海滩上的卡米耶",
  sourceUrl: "https://.../storage/v1/object/public/artwork/1504_standard.jpg",
  currentThumbnailUrl: "https://.../storage/v1/object/public/artwork/1504_standard.jpg",
  currentDisplayUrl: "https://.../storage/v1/object/public/artwork/1504_standard.jpg",
  currentDownloadUrl: "https://.../storage/v1/object/public/artwork/1504_standard.jpg",
  thumbnailObjectPath: "derivatives/thumb/1504_standard.webp",
  displayObjectPath: "derivatives/display/1504_standard.webp",
  thumbnailPublicUrl: "https://.../storage/v1/object/public/artwork/derivatives/thumb/1504_standard.webp",
  displayPublicUrl: "https://.../storage/v1/object/public/artwork/derivatives/display/1504_standard.webp"
}
```

Rollback row shape:

```js
{
  artworkImageId: "uuid-from-artwork_images.id",
  previousThumbnailUrl: "https://.../storage/v1/object/public/artwork/1504_standard.jpg",
  previousDisplayUrl: "https://.../storage/v1/object/public/artwork/1504_standard.jpg",
  previousDownloadUrl: "https://.../storage/v1/object/public/artwork/1504_standard.jpg",
  appliedThumbnailUrl: "https://.../storage/v1/object/public/artwork/derivatives/thumb/1504_standard.webp",
  appliedDisplayUrl: "https://.../storage/v1/object/public/artwork/derivatives/display/1504_standard.webp",
  appliedAt: "2026-05-26T00:00:00.000Z"
}
```

## Task 1: Add Shared Script Utilities

**Files:**
- Create: `D:/art/scripts/image-derivatives-shared.mjs`
- Test: `D:/art/scripts/image-derivatives.test.mjs`

- [ ] **Step 1: Write helper tests first**

Create `D:/art/scripts/image-derivatives.test.mjs` with these tests:

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  derivativeObjectPaths,
  isEligibleImageRow,
  parseArgs,
  sanitizedUrlPath,
  updatePayloadForManifestRow,
} from "./image-derivatives-shared.mjs";

test("parseArgs defaults to dry-run and limit 20", () => {
  const args = parseArgs([]);
  assert.equal(args.dryRun, true);
  assert.equal(args.limit, 20);
});

test("parseArgs requires explicit execute to disable dry-run", () => {
  const args = parseArgs(["--execute", "--limit", "20"]);
  assert.equal(args.dryRun, false);
  assert.equal(args.limit, 20);
});

test("derivativeObjectPaths uses new derivative paths", () => {
  assert.deepEqual(derivativeObjectPaths("1504_standard"), {
    thumbnailObjectPath: "derivatives/thumb/1504_standard.webp",
    displayObjectPath: "derivatives/display/1504_standard.webp",
  });
});

test("sanitizedUrlPath strips query and origin details to safe path", () => {
  assert.equal(
    sanitizedUrlPath("https://example.supabase.co/storage/v1/object/public/artwork/1504_standard.jpg?token=secret"),
    "/storage/v1/object/public/artwork/1504_standard.jpg",
  );
});

test("isEligibleImageRow requires equal current urls and storage source", () => {
  const row = {
    thumbnail_url: "https://x.supabase.co/storage/v1/object/public/artwork/a.jpg",
    display_url: "https://x.supabase.co/storage/v1/object/public/artwork/a.jpg",
    download_url: "https://x.supabase.co/storage/v1/object/public/artwork/a.jpg",
  };
  assert.equal(isEligibleImageRow(row), true);
});

test("updatePayloadForManifestRow preserves download_url", () => {
  const payload = updatePayloadForManifestRow({
    artworkImageId: "image-row-id",
    thumbnailPublicUrl: "https://cdn/thumb.webp",
    displayPublicUrl: "https://cdn/display.webp",
    currentDownloadUrl: "https://origin/original.jpg",
  });
  assert.deepEqual(payload, {
    id: "image-row-id",
    thumbnail_url: "https://cdn/thumb.webp",
    display_url: "https://cdn/display.webp",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail before helpers exist**

Run:

```powershell
node --test D:/art/scripts/image-derivatives.test.mjs
```

Expected:

```text
FAIL because image-derivatives-shared.mjs does not exist.
```

- [ ] **Step 3: Implement shared helpers**

Create `D:/art/scripts/image-derivatives-shared.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export const DEFAULT_BUCKET = "artwork";
export const DEFAULT_LIMIT = 20;

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    dryRun: true,
    limit: DEFAULT_LIMIT,
    bucket: DEFAULT_BUCKET,
    output: "",
    input: "",
    rollbackOutput: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--execute") {
      args.dryRun = false;
    } else if (value === "--dry-run") {
      args.dryRun = true;
    } else if (value === "--limit") {
      args.limit = Number(argv[++index]);
    } else if (value === "--bucket") {
      args.bucket = String(argv[++index] || "").trim();
    } else if (value === "--output") {
      args.output = String(argv[++index] || "").trim();
    } else if (value === "--input") {
      args.input = String(argv[++index] || "").trim();
    } else if (value === "--rollback-output") {
      args.rollbackOutput = String(argv[++index] || "").trim();
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 20) {
    throw new Error("--limit must be an integer between 1 and 20 for the pilot.");
  }
  return args;
}

export function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const output = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let envValue = match[2].trim();
    if ((envValue.startsWith('"') && envValue.endsWith('"')) || (envValue.startsWith("'") && envValue.endsWith("'"))) {
      envValue = envValue.slice(1, -1);
    }
    output[match[1]] = envValue;
  }
  return output;
}

export function loadEnv() {
  return {
    ...loadEnvFile(".env"),
    ...loadEnvFile(".env.local"),
    ...process.env,
  };
}

export function createSupabaseClient({ requireServiceRole = false } = {}) {
  const env = loadEnv();
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const key = requireServiceRole
    ? env.SUPABASE_SERVICE_ROLE_KEY
    : env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing VITE_SUPABASE_URL or SUPABASE_URL.");
  if (!key) throw new Error(requireServiceRole ? "Missing SUPABASE_SERVICE_ROLE_KEY." : "Missing Supabase anon key.");

  return {
    supabase: createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }),
    supabaseUrl: url,
  };
}

export function derivativeObjectPaths(imageId) {
  const safeId = String(imageId || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-");
  if (!safeId) throw new Error("Missing imageId for derivative path.");
  return {
    thumbnailObjectPath: `derivatives/thumb/${safeId}.webp`,
    displayObjectPath: `derivatives/display/${safeId}.webp`,
  };
}

export function publicUrlForObject(supabaseUrl, bucket, objectPath) {
  return `${String(supabaseUrl).replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${objectPath}`;
}

export function sanitizedUrlPath(value) {
  const text = String(value || "");
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.pathname;
  } catch {
    return text.slice(0, 160);
  }
}

export function isStoragePublicUrl(value) {
  return /https?:\/\/[^/]*supabase\.co\/storage\/v1\/object\/public\//i.test(String(value || ""));
}

export function isEligibleImageRow(row) {
  const thumbnail = row?.thumbnail_url || "";
  const display = row?.display_url || "";
  const download = row?.download_url || "";
  return Boolean(
    thumbnail &&
      display &&
      download &&
      thumbnail === display &&
      display === download &&
      isStoragePublicUrl(download),
  );
}

export function updatePayloadForManifestRow(row) {
  if (!row?.artworkImageId) throw new Error("Manifest row missing artworkImageId.");
  if (!row?.thumbnailPublicUrl) throw new Error("Manifest row missing thumbnailPublicUrl.");
  if (!row?.displayPublicUrl) throw new Error("Manifest row missing displayPublicUrl.");
  return {
    id: row.artworkImageId,
    thumbnail_url: row.thumbnailPublicUrl,
    display_url: row.displayPublicUrl,
  };
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
```

- [ ] **Step 4: Run helper tests**

Run:

```powershell
node --test D:/art/scripts/image-derivatives.test.mjs
```

Expected:

```text
PASS 6 tests.
```

## Task 2: Generate 20-Record Manifest

**Files:**
- Create: `D:/art/scripts/generate-image-derivatives-manifest.mjs`
- Modify: `D:/art/package.json`

- [ ] **Step 1: Create manifest generator**

Create `D:/art/scripts/generate-image-derivatives-manifest.mjs`:

```js
import {
  createSupabaseClient,
  derivativeObjectPaths,
  isEligibleImageRow,
  parseArgs,
  publicUrlForObject,
  sanitizedUrlPath,
  writeJson,
} from "./image-derivatives-shared.mjs";

const args = parseArgs();
const outputPath = args.output || `docs/image-derivatives-manifest-${new Date().toISOString().slice(0, 10)}.json`;
const { supabase, supabaseUrl } = createSupabaseClient();

const { data, error } = await supabase
  .from("published_artworks")
  .select("id,title_cn,title_en,image_id,thumbnail_url,display_url,download_url,created_at")
  .order("created_at", { ascending: false })
  .limit(args.limit);

if (error) throw new Error(`Failed to read published_artworks: ${error.message}`);

const rows = data || [];
const eligible = rows.filter(isEligibleImageRow);
const manifestRows = eligible.map((row) => {
  const imageId = row.image_id || row.id;
  const paths = derivativeObjectPaths(imageId);
  return {
    artworkImageId: row.image_id ? null : null,
    artworkId: row.id,
    imageId,
    title: row.title_cn || row.title_en || "",
    sourceUrl: row.download_url || row.display_url,
    currentThumbnailUrl: row.thumbnail_url,
    currentDisplayUrl: row.display_url,
    currentDownloadUrl: row.download_url,
    thumbnailObjectPath: paths.thumbnailObjectPath,
    displayObjectPath: paths.displayObjectPath,
    thumbnailPublicUrl: publicUrlForObject(supabaseUrl, args.bucket, paths.thumbnailObjectPath),
    displayPublicUrl: publicUrlForObject(supabaseUrl, args.bucket, paths.displayObjectPath),
    sourcePath: sanitizedUrlPath(row.download_url || row.display_url),
  };
});

writeJson(outputPath, {
  version: 1,
  generatedAt: new Date().toISOString(),
  dryRun: args.dryRun,
  bucket: args.bucket,
  limit: args.limit,
  sourceView: "published_artworks",
  note: "Pilot manifest only. Does not download, upload, or update database.",
  selectedCount: manifestRows.length,
  rows: manifestRows,
});

console.log(JSON.stringify({
  outputPath,
  readRows: rows.length,
  selectedCount: manifestRows.length,
  dryRun: args.dryRun,
}, null, 2));
```

Important correction before implementation: `published_artworks` does not expose `artwork_images.id`, so the generator must either:

```js
// Option A: query public.artwork_images directly with joined artwork title if REST relationship is available.
```

or:

```js
// Option B: add a read-only select against artwork_images after reading published_artworks.image_id.
```

Use Option A if Supabase REST exposes the relationship:

```js
const { data, error } = await supabase
  .from("artwork_images")
  .select("id,artwork_id,image_id,thumbnail_url,display_url,download_url,created_at")
  .order("created_at", { ascending: false })
  .limit(args.limit);
```

This is the safer implementation because `artwork_images.id` is required for rollback and update.

- [ ] **Step 2: Add package script**

Modify `D:/art/package.json` scripts:

```json
{
  "images:manifest": "node scripts/generate-image-derivatives-manifest.mjs",
  "test:images": "node --test scripts/image-derivatives.test.mjs"
}
```

Keep existing scripts unchanged.

- [ ] **Step 3: Run manifest generator dry-run**

Run:

```powershell
npm.cmd run images:manifest -- --dry-run --limit 20 --output docs/image-derivatives-manifest-pilot.json
```

Expected:

```json
{
  "outputPath": "docs/image-derivatives-manifest-pilot.json",
  "readRows": 20,
  "selectedCount": 20,
  "dryRun": true
}
```

- [ ] **Step 4: Inspect manifest without printing secrets**

Run:

```powershell
node -e "const m=require('./docs/image-derivatives-manifest-pilot.json'); console.log({version:m.version, selectedCount:m.selectedCount, first:m.rows[0] && {imageId:m.rows[0].imageId, thumbnailObjectPath:m.rows[0].thumbnailObjectPath, displayObjectPath:m.rows[0].displayObjectPath}})"
```

Expected:

```text
selectedCount is <= 20.
paths are under derivatives/thumb and derivatives/display.
download/source URL is present but no key is printed.
```

## Task 3: Process Manifest And Upload Derivatives

**Files:**
- Create: `D:/art/scripts/process-image-derivatives-manifest.mjs`
- Modify: `D:/art/package.json`
- Modify: `D:/art/package-lock.json` if adding `sharp`

- [ ] **Step 1: Add image dependency**

Use `sharp` unless the environment already has another proven image processing dependency.

Run:

```powershell
npm.cmd install --save-dev sharp
```

Expected:

```text
package.json and package-lock.json update.
```

- [ ] **Step 2: Create processor script**

Create `D:/art/scripts/process-image-derivatives-manifest.mjs`:

```js
import sharp from "sharp";
import {
  createSupabaseClient,
  parseArgs,
  readJson,
  sanitizedUrlPath,
  writeJson,
} from "./image-derivatives-shared.mjs";

const args = parseArgs();
if (!args.input) throw new Error("Missing --input manifest path.");
const outputPath = args.output || args.input.replace(/\.json$/, ".processed.json");
const manifest = readJson(args.input);
const rows = manifest.rows.slice(0, args.limit);
const { supabase } = createSupabaseClient({ requireServiceRole: !args.dryRun });

async function fetchSource(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch source ${sanitizedUrlPath(url)}: HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.startsWith("image/")) throw new Error(`Source is not an image: ${contentType}`);
  return Buffer.from(await response.arrayBuffer());
}

async function makeWebp(buffer, width) {
  return sharp(buffer)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
}

async function uploadObject(bucket, objectPath, buffer) {
  if (args.dryRun) {
    return { skipped: true, reason: "dry-run" };
  }
  const { error } = await supabase.storage.from(bucket).upload(objectPath, buffer, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) {
    return { skipped: true, reason: error.message };
  }
  return { skipped: false, reason: "" };
}

const results = [];
for (const row of rows) {
  const source = await fetchSource(row.sourceUrl);
  const thumbnail = await makeWebp(source, 480);
  const display = await makeWebp(source, 1600);
  const thumbnailUpload = await uploadObject(manifest.bucket, row.thumbnailObjectPath, thumbnail);
  const displayUpload = await uploadObject(manifest.bucket, row.displayObjectPath, display);

  results.push({
    ...row,
    thumbnailBytes: thumbnail.length,
    displayBytes: display.length,
    thumbnailUpload,
    displayUpload,
    readyForDbUpdate: args.dryRun ? false : !thumbnailUpload.skipped && !displayUpload.skipped,
  });

  console.log(JSON.stringify({
    imageId: row.imageId,
    sourcePath: row.sourcePath,
    thumbnailObjectPath: row.thumbnailObjectPath,
    displayObjectPath: row.displayObjectPath,
    thumbnailBytes: thumbnail.length,
    displayBytes: display.length,
    dryRun: args.dryRun,
  }));
}

writeJson(outputPath, {
  ...manifest,
  processedAt: new Date().toISOString(),
  dryRun: args.dryRun,
  rows: results,
});

console.log(JSON.stringify({
  outputPath,
  processedCount: results.length,
  readyForDbUpdate: results.filter((row) => row.readyForDbUpdate).length,
  dryRun: args.dryRun,
}, null, 2));
```

- [ ] **Step 3: Add package script**

Modify `D:/art/package.json` scripts:

```json
{
  "images:process": "node scripts/process-image-derivatives-manifest.mjs"
}
```

- [ ] **Step 4: Run dry-run processor**

Run:

```powershell
npm.cmd run images:process -- --dry-run --limit 20 --input docs/image-derivatives-manifest-pilot.json --output docs/image-derivatives-processed-pilot.dry-run.json
```

Expected:

```text
20 source images fetched.
20 thumbnail buffers generated.
20 display buffers generated.
0 objects uploaded because dryRun is true.
0 rows readyForDbUpdate because dryRun is true.
```

- [ ] **Step 5: Run execute upload for 20 only**

Run only after dry-run sizes look sane:

```powershell
npm.cmd run images:process -- --execute --limit 20 --input docs/image-derivatives-manifest-pilot.json --output docs/image-derivatives-processed-pilot.json
```

Expected:

```text
At most 40 new Storage objects uploaded.
No original object overwritten.
No original object deleted.
readyForDbUpdate equals the number of rows where both uploads succeeded.
```

## Task 4: Apply URL Backfill For 20 Rows

**Files:**
- Create: `D:/art/scripts/apply-image-url-manifest.mjs`
- Modify: `D:/art/package.json`

- [ ] **Step 1: Create apply script**

Create `D:/art/scripts/apply-image-url-manifest.mjs`:

```js
import {
  createSupabaseClient,
  parseArgs,
  readJson,
  updatePayloadForManifestRow,
  writeJson,
} from "./image-derivatives-shared.mjs";

const args = parseArgs();
if (!args.input) throw new Error("Missing --input processed manifest path.");
const rollbackOutput = args.rollbackOutput || args.input.replace(/\.json$/, ".rollback.json");
const manifest = readJson(args.input);
const rows = manifest.rows.filter((row) => row.readyForDbUpdate).slice(0, args.limit);
const { supabase } = createSupabaseClient({ requireServiceRole: !args.dryRun });

const rollbackRows = rows.map((row) => ({
  artworkImageId: row.artworkImageId,
  previousThumbnailUrl: row.currentThumbnailUrl,
  previousDisplayUrl: row.currentDisplayUrl,
  previousDownloadUrl: row.currentDownloadUrl,
  appliedThumbnailUrl: row.thumbnailPublicUrl,
  appliedDisplayUrl: row.displayPublicUrl,
  appliedAt: new Date().toISOString(),
}));

writeJson(rollbackOutput, {
  version: 1,
  generatedAt: new Date().toISOString(),
  dryRun: args.dryRun,
  rows: rollbackRows,
});

if (args.dryRun) {
  console.log(JSON.stringify({
    dryRun: true,
    candidateUpdates: rows.length,
    rollbackOutput,
  }, null, 2));
  process.exit(0);
}

for (const row of rows) {
  const payload = updatePayloadForManifestRow(row);
  const { error } = await supabase
    .from("artwork_images")
    .update({
      thumbnail_url: payload.thumbnail_url,
      display_url: payload.display_url,
    })
    .eq("id", payload.id);
  if (error) throw new Error(`Failed to update artwork_images ${payload.id}: ${error.message}`);
}

console.log(JSON.stringify({
  dryRun: false,
  updatedRows: rows.length,
  rollbackOutput,
}, null, 2));
```

- [ ] **Step 2: Add package script**

Modify `D:/art/package.json` scripts:

```json
{
  "images:apply": "node scripts/apply-image-url-manifest.mjs"
}
```

- [ ] **Step 3: Run DB apply dry-run**

Run:

```powershell
npm.cmd run images:apply -- --dry-run --limit 20 --input docs/image-derivatives-processed-pilot.json --rollback-output docs/image-derivatives-rollback-pilot.json
```

Expected:

```text
No database writes.
Rollback manifest is written.
candidateUpdates equals readyForDbUpdate count.
```

- [ ] **Step 4: Execute DB apply for 20 only**

Run only after reviewing rollback manifest:

```powershell
npm.cmd run images:apply -- --execute --limit 20 --input docs/image-derivatives-processed-pilot.json --rollback-output docs/image-derivatives-rollback-pilot.json
```

Expected:

```text
updatedRows <= 20.
download_url remains unchanged.
thumbnail_url changes to derivatives/thumb/*.webp.
display_url changes to derivatives/display/*.webp.
```

## Task 5: Verification Queries

**Files:**
- No code changes.

- [ ] **Step 1: Verify 20-row pilot outcome**

Run read-only query:

```sql
select
  count(*) as total,
  count(*) filter (where thumbnail_url like '%/derivatives/thumb/%') as thumbnail_derivative,
  count(*) filter (where display_url like '%/derivatives/display/%') as display_derivative,
  count(*) filter (where download_url like '%/derivatives/%') as download_derivative,
  count(*) filter (where thumbnail_url = download_url) as thumbnail_still_original,
  count(*) filter (where display_url = download_url) as display_still_original
from public.artwork_images
where id in (
  -- paste the 20 artworkImageId values from rollback manifest here
);
```

Expected:

```text
thumbnail_derivative = updatedRows
display_derivative = updatedRows
download_derivative = 0
thumbnail_still_original = 0 for updated rows
display_still_original = 0 for updated rows
```

- [ ] **Step 2: Verify app runtime requests**

Open `http://127.0.0.1:5173/` and use browser Network tab:

```text
1. Hard refresh.
2. Filter by Img.
3. Confirm list card requests include /derivatives/thumb/.
4. Open one updated artwork detail.
5. Confirm detail image includes /derivatives/display/.
6. Do not click download during this verification unless intentionally testing original download.
```

Expected:

```text
Card images use thumbnail derivatives.
Detail image uses display derivative.
No download_url/original request occurs before clicking download.
```

- [ ] **Step 3: Verify object count in Storage**

Use a read-only Storage list script or Supabase dashboard:

```text
artwork/derivatives/thumb/ has <= 20 new webp objects.
artwork/derivatives/display/ has <= 20 new webp objects.
Original artwork/*.jpg objects still exist.
```

## Task 6: Rollback Plan

**Files:**
- Use: `D:/art/docs/image-derivatives-rollback-pilot.json`
- Optional Create Later: `D:/art/scripts/rollback-image-url-manifest.mjs`

- [ ] **Step 1: Roll back database URLs only**

Rollback SQL shape:

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

Important:

```text
Do not delete derivative Storage objects during emergency rollback.
Do not delete original Storage objects.
Do not overwrite original Storage objects.
```

- [ ] **Step 2: Verify rollback**

Run:

```sql
select
  id,
  thumbnail_url = download_url as thumbnail_restored,
  display_url = download_url as display_restored
from public.artwork_images
where id in (
  -- rollback ids
);
```

Expected:

```text
thumbnail_restored and display_restored are true for rolled-back rows.
```

## Task 7: Final Static Checks

**Files:**
- All changed files.

- [ ] **Step 1: Run tests**

Run:

```powershell
npm.cmd run test:images
npm.cmd run check
npx.cmd tsc --noEmit
git diff --check
```

Expected:

```text
All commands exit 0.
git diff --check may print existing CRLF warnings, but no whitespace errors.
```

- [ ] **Step 2: Summarize pilot**

Report:

```text
Rows selected:
Rows processed:
Storage objects uploaded:
DB rows updated:
Rollback file:
Known failures/skips:
Next recommended batch size:
```

## Self-Review

- Covers 20-row-only pilot.
- Defaults to dry-run.
- Requires manifest output before processing.
- Does not expose service role key.
- Does not overwrite or delete originals.
- Keeps `download_url` unchanged.
- Uses 480px thumbnail target and 1600px display target.
- Uses derivative object paths under existing `artwork` bucket.
- Includes new scripts, commands, rollback, verification, and tests.
- Does not require schema migration.
