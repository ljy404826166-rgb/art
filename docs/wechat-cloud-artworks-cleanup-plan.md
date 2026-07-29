# WeChat Cloud Artworks Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely clean user-facing artwork metadata in the WeChat Cloud Database `artworks` collection without touching user data, auth, RBAC, or image routing.

**Architecture:** Treat cloud data cleanup as a reversible migration: export a full local JSON Lines backup first, generate a reviewed patch file, apply only approved updates in small batches, and keep a rollback manifest that can restore previous field values. Existing front-end display cleanup remains in place as a safety net until cloud data is verified.

**Tech Stack:** WeChat Cloud Database / CloudBase Manager Node SDK, JSON Lines backups, native miniapp pages, Node scripts, Git-reviewed reports.

---

## Scope

This plan only covers public artwork records in the WeChat Cloud Database collection:

```text
collection: artworks
status: published
```

In scope:

- Public artwork metadata shown on miniapp artwork detail pages.
- Fields used by title, artist, year, location, medium, dimensions, source, description, tags, and image URLs.
- Read-only audit and backup scripts.
- Dry-run cleanup reports and rollback manifests.

Out of scope:

- User accounts, favorites, browsing history, downloads, follows, login state, RBAC, RLS, Supabase Auth, or private data.
- Supabase database mutations.
- WeChat Cloud Database permission changes.
- Image derivative generation or deletion.
- Changing `thumbnail_url`, `display_url`, or `download_url` unless a separate image-routing task explicitly approves it.

---

## Current Repository Context

Existing CloudBase-related scripts:

- `scripts/cloudbase-audit-artworks.mjs`: reads all `artworks` documents and writes an audit report.
- `scripts/cloudbase-upsert-artworks.mjs`: upserts JSON/JSONL records into `artworks`; this is a write script and must not be used for cleanup until backup and patch review are complete.
- `scripts/cloudbase-optimize-image-urls.mjs`: updates image URL routing; this is unrelated to metadata cleanup and must not be used in this task.

Missing capability:

- There is no dedicated read-only exporter that writes every current `artworks` document to a local backup JSON Lines file. Add this before any cloud mutation.

Required credentials for future script execution:

```text
TENCENT_SECRET_ID
TENCENT_SECRET_KEY
CLOUDBASE_ENV_ID or TCB_ENV_ID
```

Do not print or commit these values.

---

## Target Field Cleanup Rules

### 1. Source

Current issue:

```text
source_name: Artvee
```

`Artvee` is a data source, not a collection location. It should not appear in the user-facing metadata card as "收藏地".

Cleanup rule:

- Keep `source_name` if needed for internal provenance.
- Do not copy `source_name` into `location`.
- If `location` is empty or equals a source-only value such as `Artvee`, set the cleaned display field to:

```text
收藏地暂未收录
```

Recommended data approach:

- Preserve original fields.
- Add normalized display fields only after review, for example:

```json
{
  "display_year": "1485",
  "display_location": "意大利佛罗伦萨乌菲齐美术馆",
  "display_medium": "油画"
}
```

If adding new fields is not approved, update existing `year_and_place`, `location`, and `medium` only after a backup and rollback file exist.

### 2. Medium

Current issue examples:

```text
油画或其 Artvee 图像记录（推测）
纸本素描或习作（推测）
```

Cleanup rule:

- Remove source-specific phrases:

```text
或其 Artvee 图像记录
Artvee 图像记录
```

- Remove uncertainty suffixes from display text when the remaining medium is useful:

```text
（推测）
（推断）
（估计）
```

Examples:

```text
油画或其 Artvee 图像记录（推测） -> 油画
纸本素描或习作（推测） -> 纸本素描或习作
```

### 3. Year

Current issue:

`year_and_place` may contain year plus place/context text.

Cleanup rule:

- Display year-only in the miniapp detail field "创作年代".
- Preserve the original full context in a raw field or backup.

Examples:

```text
1485, 意大利佛罗伦萨（推测） -> 1485
1890-91年 -> 1890-91年
约1887年，巴黎 -> 约1887年
```

### 4. Location

Current issue examples:

```text
意大利佛罗伦萨乌菲齐美术馆相关语境...（推测）
Artvee
```

Cleanup rule:

- Remove trailing source/context phrases:

```text
相关语境...
（推测）
（推断）
（估计）
```

- If the result is empty or source-only, use:

```text
收藏地暂未收录
```

### 5. Tags and Search

Do not delete tags during this cleanup. Tags are used by:

- Home sections.
- Category filtering.
- Tag detail pages.
- Search ranking and normalization.

If a tag value is noisy, list it in a separate review report instead of changing it automatically.

---

## Backup Format

Create a local full backup before any update:

```powershell
node scripts/export-wechat-cloud-artworks.mjs --collection artworks --output backups/wechat-cloud-artworks-YYYYMMDD-HHmmss.jsonl
```

Expected output:

```text
backups/wechat-cloud-artworks-YYYYMMDD-HHmmss.jsonl
```

Each line must be one complete document:

```json
{"_id":"...","title_cn":"...","artist":"...","year_and_place":"...","location":"...","medium":"..."}
```

Backup requirements:

- JSON Lines, not an array.
- Preserve every field returned from cloud database.
- Do not mask public artwork data.
- Do not include Tencent credentials.
- Do not include user data collections.
- Do not overwrite previous backups.

---

## Patch and Rollback Format

The cleanup generator should produce two files:

```text
csv/cloudbase/artworks-cleanup-patch-YYYYMMDD-HHmmss.jsonl
csv/cloudbase/artworks-cleanup-rollback-YYYYMMDD-HHmmss.jsonl
```

Patch row example:

```json
{"_id":"artwork-id","patch":{"medium":"油画","location":"收藏地暂未收录","year_and_place":"1485"}}
```

Rollback row example:

```json
{"_id":"artwork-id","restore":{"medium":"油画或其 Artvee 图像记录（推测）","location":"Artvee","year_and_place":"1485, 意大利佛罗伦萨（推测）"}}
```

Patch rules:

- Include only fields that actually change.
- Never patch `_id`.
- Never patch `thumbnail_url`, `display_url`, or `download_url` in this cleanup.
- Never patch user-related fields.
- Include a `sample` report with at least 20 before/after records.

---

## Implementation Tasks

### Task 1: Add Read-Only Cloud Backup Exporter

**Files:**

- Create: `scripts/export-wechat-cloud-artworks.mjs`
- Create output directory at runtime: `backups/`

- [ ] **Step 1: Read credentials from local environment**

Use the same environment variable convention as existing CloudBase scripts:

```js
const secretId = config.TENCENT_SECRET_ID || config.TENCENTCLOUD_SECRETID || config.TENCENT_CLOUD_SECRET_ID;
const secretKey = config.TENCENT_SECRET_KEY || config.TENCENTCLOUD_SECRETKEY || config.TENCENT_CLOUD_SECRET_KEY;
```

Expected: missing credentials fail with a clear message and do not print secrets.

- [ ] **Step 2: Query `artworks` in pages**

Use CloudBase `runCommands` with `QUERY`, `skip`, and `limit`.

Expected: no `UPDATE`, `DELETE`, `INSERT`, or `CREATE` command exists in the exporter.

- [ ] **Step 3: Write JSON Lines backup**

Command shape:

```powershell
node scripts/export-wechat-cloud-artworks.mjs --collection artworks --output backups/wechat-cloud-artworks-YYYYMMDD-HHmmss.jsonl
```

Expected: one document per line, no outer array.

- [ ] **Step 4: Verify backup**

Run:

```powershell
Get-Content backups\wechat-cloud-artworks-YYYYMMDD-HHmmss.jsonl -TotalCount 3
```

Expected: three valid JSON documents, no credentials.

### Task 2: Add Dry-Run Cleanup Candidate Generator

**Files:**

- Create: `scripts/prepare-wechat-cloud-artworks-cleanup.mjs`
- Input: `backups/wechat-cloud-artworks-YYYYMMDD-HHmmss.jsonl`
- Output: `csv/cloudbase/artworks-cleanup-patch-YYYYMMDD-HHmmss.jsonl`
- Output: `csv/cloudbase/artworks-cleanup-rollback-YYYYMMDD-HHmmss.jsonl`

- [ ] **Step 1: Implement pure cleanup helpers**

Functions:

```js
cleanYear(value)
cleanMedium(value)
cleanLocation(value)
buildPatch(row)
```

Expected: helpers are pure and do not connect to cloud database.

- [ ] **Step 2: Generate patch and rollback JSONL**

Run:

```powershell
node scripts/prepare-wechat-cloud-artworks-cleanup.mjs --in backups/wechat-cloud-artworks-YYYYMMDD-HHmmss.jsonl --out-dir csv/cloudbase
```

Expected: writes patch, rollback, and sample report. No cloud writes.

- [ ] **Step 3: Add unit tests**

Create:

```text
scripts/prepare-wechat-cloud-artworks-cleanup.test.mjs
```

Test cases:

```text
油画或其 Artvee 图像记录（推测） -> 油画
Artvee -> 收藏地暂未收录
1485, 意大利佛罗伦萨（推测） -> 1485
意大利佛罗伦萨乌菲齐美术馆相关语境...（推测） -> 意大利佛罗伦萨乌菲齐美术馆
```

Expected:

```powershell
node --test scripts/prepare-wechat-cloud-artworks-cleanup.test.mjs
```

passes.

### Task 3: Review Patch Before Any Cloud Write

**Files:**

- Review: `csv/cloudbase/artworks-cleanup-patch-*.jsonl`
- Review: `csv/cloudbase/artworks-cleanup-rollback-*.jsonl`
- Review: `csv/cloudbase/artworks-cleanup-sample-*.json`

- [ ] **Step 1: Count candidate rows**

Run:

```powershell
(Get-Content csv\cloudbase\artworks-cleanup-patch-YYYYMMDD-HHmmss.jsonl).Count
```

Expected: candidate count is understood before execution.

- [ ] **Step 2: Manually review samples**

Open the sample report and check at least:

```text
20 changed medium values
20 changed location values
20 changed year values
20 unchanged records
```

Expected: no title, artist, image URL, tag, or description is changed accidentally.

- [ ] **Step 3: Confirm rollback completeness**

For every patch row `_id`, rollback must contain the same `_id`.

Expected: patch count equals rollback count.

### Task 4: Apply Approved Cleanup in Small Batches

**Files:**

- Create only after approval: `scripts/apply-wechat-cloud-artworks-cleanup.mjs`

- [ ] **Step 1: Require explicit `--run`**

Default behavior must be dry-run:

```powershell
node scripts/apply-wechat-cloud-artworks-cleanup.mjs --patch csv/cloudbase/artworks-cleanup-patch-YYYYMMDD-HHmmss.jsonl --batch-size 20
```

Expected: no writes without `--run`.

- [ ] **Step 2: Apply a 20-row pilot**

Only after user approval:

```powershell
node scripts/apply-wechat-cloud-artworks-cleanup.mjs --patch csv/cloudbase/artworks-cleanup-patch-YYYYMMDD-HHmmss.jsonl --limit 20 --batch-size 20 --run
```

Expected: writes only those 20 `_id` records and logs a report.

- [ ] **Step 3: Verify in WeChat DevTools**

Check detail pages for pilot records:

```text
1. No "来源" card in detail page.
2. "创作年代" is concise.
3. "媒介" does not show Artvee text.
4. "收藏地" does not show source-only Artvee.
5. Images still use display/thumbnail chain.
6. Download still uses download_url.
```

Expected: visual output matches current front-end cleanup, but now source data is cleaner.

### Task 5: Rollback Path

**Files:**

- Create only after approval: `scripts/rollback-wechat-cloud-artworks-cleanup.mjs`
- Input: `csv/cloudbase/artworks-cleanup-rollback-YYYYMMDD-HHmmss.jsonl`

- [ ] **Step 1: Default rollback to dry-run**

Command shape:

```powershell
node scripts/rollback-wechat-cloud-artworks-cleanup.mjs --rollback csv/cloudbase/artworks-cleanup-rollback-YYYYMMDD-HHmmss.jsonl --limit 20
```

Expected: logs what would be restored, no writes.

- [ ] **Step 2: Apply rollback only with `--run`**

Command shape:

```powershell
node scripts/rollback-wechat-cloud-artworks-cleanup.mjs --rollback csv/cloudbase/artworks-cleanup-rollback-YYYYMMDD-HHmmss.jsonl --limit 20 --run
```

Expected: restores only fields recorded in `restore`.

---

## Verification Checklist

Before any cloud write:

```powershell
npm.cmd run check
npx.cmd tsc --noEmit
npm.cmd run build
git diff --check
node --test scripts/prepare-wechat-cloud-artworks-cleanup.test.mjs
```

Cloud cleanup preflight:

```text
1. Full JSONL backup exists.
2. Backup line count matches cloud `artworks` count.
3. Patch JSONL exists.
4. Rollback JSONL exists.
5. Patch count equals rollback count.
6. Sample report has before/after values.
7. No patch row touches image URLs.
8. No patch row touches user data.
9. No command has `--run` until user explicitly approves.
```

Post-pilot verification:

```text
1. WeChat DevTools detail page displays cleaned metadata.
2. Search still returns expected records.
3. Category/tag pages still load.
4. Home page still loads thumbnails.
5. Detail page still loads display image.
6. Download button still saves `download_url`.
7. Rollback dry-run can locate the same pilot records.
```

---

## Risk Points

- CloudBase writes are destructive unless rollback data is complete.
- Existing records may contain mixed-language punctuation and inconsistent year formats.
- Some `location` values may contain meaningful context that should not be blindly removed.
- Adding new display fields is safer than overwriting existing raw fields, but the miniapp would need a later read-path update.
- Updating existing fields is simpler but increases rollback importance.
- A dry-run patch can still be wrong; visual sample review is mandatory.

---

## Recommended Decision Gate

Before implementing cleanup scripts, confirm one of these data strategies:

```text
A. Safer: add display_year / display_location / display_medium and keep raw fields unchanged.
B. Simpler: update existing year_and_place / location / medium, relying on full backup and rollback.
```

Recommendation: choose **A** for the first production cleanup unless the Cloud Database field set must stay minimal.
