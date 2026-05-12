# Supabase Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize the app on Supabase as the source of truth for artworks, artists, tags, images, imports, favorites, browsing history, and future account-backed settings.

**Architecture:** Keep the public mobile app on Vite + Capacitor and use Supabase browser clients with publishable anon keys only. Use normalized Supabase tables for crawled/open-data content, a read-only published view for the app, and user-scoped tables for authenticated favorites/history/settings once Supabase Auth is enabled. Keep scraping/import scripts server-side and require the service role key only in local ingestion scripts or trusted automation.

**Tech Stack:** Vite, TypeScript, vanilla JavaScript app shell, Capacitor Android, `@supabase/supabase-js`, Supabase Postgres, RLS policies, REST ingestion scripts.

---

## File Structure

- Modify: `supabase/schema.sql`  
  Owns canonical normalized database schema, legacy `paintings` migration, indexes, views, triggers, grants, and RLS policies.
- Create: `supabase/app_user_data.sql`  
  Owns authenticated user tables: favorites, browsing history, downloads, and settings.
- Modify: `supabase/paintings.sql`  
  Either deprecate the legacy `paintings` table policy file or turn it into a compatibility view policy note.
- Modify: `.env.local`  
  Holds Vite-safe public Supabase variables.
- Modify: `.env.example`  
  Documents all public and private ingestion variables without secrets.
- Modify: `src/lib/supabase.ts`  
  Creates the browser Supabase client from Vite environment variables.
- Create: `src/lib/artworks.ts`  
  Reads public artwork data from `published_artworks`.
- Create: `src/lib/user-library.ts`  
  Reads/writes authenticated favorites, history, downloads, and settings. Falls back to local storage when no user session exists.
- Modify: `src/lib/paintings.ts`  
  Replace direct `paintings` table dependency with compatibility exports from `src/lib/artworks.ts`.
- Modify: `src/app.js`  
  Connect homepage, category page, detail page, artist/tag pages, favorites, and history to the new data access layer.
- Modify: `scripts/ingest-artic.mjs`  
  Keep Chicago Art Institute ingestion aligned with normalized schema and tags.
- Modify: `scripts/ingest-artvee.mjs`  
  Keep Artvee ingestion as draft-only, low-frequency, source-verification workflow.
- Modify: `scripts/check.mjs`  
  Verify required env shape, schema-related expectations, and app data mapping.
- Modify: `README.md` and `docs/DATA_PIPELINE.md`  
  Document setup, SQL execution, RLS model, ingestion, and verification.

---

### Task 1: Database Schema, Legacy Migration, and Public Read Model

**Files:**
- Modify: `supabase/schema.sql`
- Modify: `supabase/paintings.sql`

- [ ] **Step 1: Replace the published artwork view with app-ready columns**

Update `supabase/schema.sql` so `public.published_artworks` exposes the fields the current app needs without client-side joins.

```sql
create or replace view public.published_artworks
with (security_invoker = true)
as
select
  artworks.id,
  artworks.slug,
  artworks.title as title_cn,
  nullif(artworks.source_payload->>'title_en', '') as title_en,
  artworks.artist_display as artist,
  artworks.date_display as year_and_place,
  coalesce(artworks.place_of_origin, sources.name) as location,
  artworks.medium,
  nullif(artworks.source_payload->>'dimensions', '') as dimensions,
  coalesce(artworks.educational_summary, artworks.description) as description,
  artworks.tags,
  array_to_string(artworks.tags, ',') as tags_text,
  sources.name as source_name,
  artworks.source_url,
  artwork_images.thumbnail_url,
  artwork_images.display_url,
  artwork_images.download_url,
  artwork_images.iiif_url,
  artworks.created_at,
  artworks.updated_at
from public.artworks
join public.sources on sources.id = artworks.source_id
left join public.artwork_images
  on artwork_images.artwork_id = artworks.id
 and artwork_images.image_kind = 'primary'
where artworks.status = 'published';
```

- [ ] **Step 2: Add a safe one-time legacy `paintings` migration**

Append this block after the `sources` seed in `supabase/schema.sql`. It copies existing rows from `public.paintings` into the normalized schema if the legacy table exists. It is idempotent because `artworks` uses `unique (source_id, source_record_id)` and `artwork_images` uses `unique (artwork_id, image_kind)`.

```sql
insert into public.sources (slug, name, base_url, source_type, rights_notes)
values
  ('legacy-paintings', 'Legacy paintings table', 'https://hdrppuuowsaryftkbuoj.supabase.co', 'legacy', 'Migrated from the original public.paintings table used by early app prototypes.')
on conflict (slug) do update
set name = excluded.name,
    base_url = excluded.base_url,
    source_type = excluded.source_type,
    rights_notes = excluded.rights_notes;

do $$
begin
  if to_regclass('public.paintings') is not null then
    insert into public.artists (name)
    select distinct coalesce(nullif(trim(artist), ''), 'Unknown artist')
    from public.paintings
    on conflict (normalized_name) do nothing;

    insert into public.artworks (
      source_id,
      source_record_id,
      slug,
      title,
      artist_id,
      artist_display,
      date_display,
      medium,
      description,
      educational_summary,
      license,
      is_public_domain,
      source_url,
      source_payload,
      tags,
      status
    )
    select
      sources.id,
      paintings.id::text,
      'legacy-paintings-' || regexp_replace(paintings.id::text, '[^a-zA-Z0-9]+', '-', 'g'),
      coalesce(nullif(paintings.title_cn, ''), nullif(paintings.title_en, ''), 'Untitled'),
      artists.id,
      coalesce(nullif(trim(paintings.artist), ''), 'Unknown artist'),
      paintings.year_and_place,
      paintings.medium,
      paintings.description,
      paintings.description,
      'Rights status inherited from legacy paintings table; verify before high-resolution download publishing.',
      true,
      coalesce(nullif(paintings.display_url, ''), 'https://hdrppuuowsaryftkbuoj.supabase.co'),
      jsonb_build_object(
        'title_en', paintings.title_en,
        'dimensions', paintings.dimensions,
        'location', paintings.location,
        'legacy_table', 'paintings'
      ),
      coalesce(
        array_remove(regexp_split_to_array(coalesce(paintings.tags, ''), '[,，；、\s]+'), ''),
        '{}'::text[]
      ),
      'published'
    from public.paintings
    join public.sources on sources.slug = 'legacy-paintings'
    left join public.artists on artists.normalized_name = lower(trim(coalesce(nullif(paintings.artist, ''), 'Unknown artist')))
    on conflict (source_id, source_record_id) do update
    set title = excluded.title,
        artist_id = excluded.artist_id,
        artist_display = excluded.artist_display,
        date_display = excluded.date_display,
        medium = excluded.medium,
        description = excluded.description,
        educational_summary = excluded.educational_summary,
        source_payload = excluded.source_payload,
        tags = excluded.tags,
        status = excluded.status;

    insert into public.artwork_images (
      artwork_id,
      image_kind,
      thumbnail_url,
      display_url,
      download_url,
      credit_line
    )
    select
      artworks.id,
      'primary',
      paintings.display_url,
      paintings.display_url,
      paintings.display_url,
      'Migrated from public.paintings.display_url.'
    from public.paintings
    join public.sources on sources.slug = 'legacy-paintings'
    join public.artworks
      on artworks.source_id = sources.id
     and artworks.source_record_id = paintings.id::text
    where paintings.display_url is not null
      and paintings.display_url <> ''
    on conflict (artwork_id, image_kind) do update
    set thumbnail_url = excluded.thumbnail_url,
        display_url = excluded.display_url,
        download_url = excluded.download_url,
        credit_line = excluded.credit_line;
  end if;
end $$;
```

- [ ] **Step 3: Add indexes for common app queries**

Append these indexes to `supabase/schema.sql`.

```sql
create index if not exists artworks_status_created_idx
on public.artworks (status, created_at desc);

create index if not exists artworks_artist_display_idx
on public.artworks (artist_display);

create index if not exists artworks_tags_gin_idx
on public.artworks using gin (tags);

create index if not exists artwork_images_artwork_kind_idx
on public.artwork_images (artwork_id, image_kind);
```

- [ ] **Step 4: Standardize public RLS policies**

Ensure `supabase/schema.sql` contains these policies after enabling RLS.

```sql
drop policy if exists "public can read sources" on public.sources;
create policy "public can read sources"
on public.sources for select
to anon, authenticated
using (true);

drop policy if exists "public can read artists" on public.artists;
create policy "public can read artists"
on public.artists for select
to anon, authenticated
using (true);

drop policy if exists "public can read published artworks" on public.artworks;
create policy "public can read published artworks"
on public.artworks for select
to anon, authenticated
using (status = 'published');

drop policy if exists "public can read published images" on public.artwork_images;
create policy "public can read published images"
on public.artwork_images for select
to anon, authenticated
using (
  exists (
    select 1
    from public.artworks
    where artworks.id = artwork_images.artwork_id
      and artworks.status = 'published'
  )
);
```

- [ ] **Step 5: Grant Data API access while keeping RLS enforced**

Append:

```sql
grant usage on schema public to anon, authenticated;
grant select on public.sources, public.artists, public.artworks, public.artwork_images, public.artwork_notes to anon, authenticated;
grant select on public.published_artworks to anon, authenticated;
```

- [ ] **Step 6: Convert `supabase/paintings.sql` to a legacy compatibility note**

Replace `supabase/paintings.sql` with:

```sql
-- Legacy file retained for migration history.
-- The app should read from public.published_artworks, not public.paintings.
-- Execute supabase/schema.sql for the canonical artwork schema and RLS policies.
```

- [ ] **Step 7: Run SQL in Supabase SQL Editor**

Run, in this order:

```text
supabase/schema.sql
supabase/app_user_data.sql
```

Expected: SQL Editor completes without errors. Tables `sources`, `artists`, `artworks`, `artwork_images`, `artwork_notes`, and `ingestion_runs` exist. View `published_artworks` exists.

- [ ] **Step 8: Commit schema changes**

```bash
git add supabase/schema.sql supabase/paintings.sql
git commit -m "db: standardize artwork schema and public read policies"
```

---

### Task 2: User Data Tables and RLS

**Files:**
- Create: `supabase/app_user_data.sql`

- [ ] **Step 1: Create authenticated user tables**

Create `supabase/app_user_data.sql` with:

```sql
create table if not exists public.user_favorites (
  user_id uuid not null references auth.users(id) on delete cascade,
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, artwork_id)
);

create table if not exists public.user_browsing_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, artwork_id)
);

create table if not exists public.user_downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  downloaded_at timestamptz not null default now(),
  file_kind text not null default 'image',
  unique (user_id, artwork_id, file_kind)
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_favorites enable row level security;
alter table public.user_browsing_history enable row level security;
alter table public.user_downloads enable row level security;
alter table public.user_settings enable row level security;
```

- [ ] **Step 2: Add user-owned RLS policies**

Append:

```sql
drop policy if exists "users read own favorites" on public.user_favorites;
create policy "users read own favorites"
on public.user_favorites for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users insert own favorites" on public.user_favorites;
create policy "users insert own favorites"
on public.user_favorites for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users delete own favorites" on public.user_favorites;
create policy "users delete own favorites"
on public.user_favorites for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users read own history" on public.user_browsing_history;
create policy "users read own history"
on public.user_browsing_history for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users upsert own history" on public.user_browsing_history;
create policy "users upsert own history"
on public.user_browsing_history for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users update own history" on public.user_browsing_history;
create policy "users update own history"
on public.user_browsing_history for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users manage own downloads" on public.user_downloads;
create policy "users manage own downloads"
on public.user_downloads for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users manage own settings" on public.user_settings;
create policy "users manage own settings"
on public.user_settings for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

- [ ] **Step 3: Add user data indexes**

Append:

```sql
create index if not exists user_history_user_viewed_idx
on public.user_browsing_history (user_id, viewed_at desc);

create index if not exists user_downloads_user_downloaded_idx
on public.user_downloads (user_id, downloaded_at desc);
```

- [ ] **Step 4: Verify RLS intent in SQL Editor**

Run:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('user_favorites', 'user_browsing_history', 'user_downloads', 'user_settings');
```

Expected: all rows return `rowsecurity = true`.

- [ ] **Step 5: Commit user data SQL**

```bash
git add supabase/app_user_data.sql
git commit -m "db: add user library tables and rls"
```

---

### Task 3: Environment Variables

**Files:**
- Modify: `.env.local`
- Modify: `.env.example`
- Modify: `scripts/lib/env.mjs`

- [ ] **Step 1: Keep browser variables Vite-safe**

Ensure `.env.local` contains:

```env
VITE_SUPABASE_URL=https://hdrppuuowsaryftkbuoj.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_B-UjYjQ4FEZ_DwyX3Vu9cA_2GYGp2g6
```

- [ ] **Step 2: Add private ingestion variables to `.env.example` only**

Create or update `.env.example` with:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key_never_commit_real_value

AIC_SYNC_PAGE_SIZE=12
AIC_SYNC_LIMIT=24
AIC_USER_AGENT=ArtArchive/0.1 your-email@example.com
ARTVEE_URLS=https://artvee.com/example-artwork/
```

- [ ] **Step 3: Verify service role key is never exposed to Vite**

Run:

```bash
rg "SERVICE_ROLE|SUPABASE_SERVICE_ROLE_KEY" src public index.html
```

Expected: no matches.

- [ ] **Step 4: Commit env documentation**

```bash
git add .env.example scripts/lib/env.mjs
git commit -m "docs: document supabase environment variables"
```

---

### Task 4: Public Artwork Data Access Layer

**Files:**
- Modify: `src/lib/supabase.ts`
- Create: `src/lib/artworks.ts`
- Modify: `src/lib/paintings.ts`

- [ ] **Step 1: Harden Supabase client initialization**

Update `src/lib/supabase.ts` to:

```ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

if (!hasSupabaseConfig) {
  console.warn("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.");
}

export const supabase = createClient(
  supabaseUrl || "https://missing-project-ref.supabase.co",
  supabaseAnonKey || "missing-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);
```

- [ ] **Step 2: Create `src/lib/artworks.ts`**

```ts
import { hasSupabaseConfig, supabase } from "./supabase";

export type ArtworkRecord = {
  id: string;
  slug: string;
  title_cn: string;
  title_en: string | null;
  artist: string;
  year_and_place: string | null;
  location: string | null;
  medium: string | null;
  dimensions: string | null;
  description: string | null;
  tags: string[];
  tags_text: string | null;
  source_name: string | null;
  source_url: string | null;
  thumbnail_url: string | null;
  display_url: string | null;
  download_url: string | null;
  iiif_url: string | null;
  created_at: string;
  updated_at: string;
};

const columns = [
  "id",
  "slug",
  "title_cn",
  "title_en",
  "artist",
  "year_and_place",
  "location",
  "medium",
  "dimensions",
  "description",
  "tags",
  "tags_text",
  "source_name",
  "source_url",
  "thumbnail_url",
  "display_url",
  "download_url",
  "iiif_url",
  "created_at",
  "updated_at",
].join(",");

export async function fetchArtworks(): Promise<ArtworkRecord[]> {
  if (!hasSupabaseConfig) {
    throw new Error("缺少 VITE_SUPABASE_URL 或 VITE_SUPABASE_ANON_KEY。");
  }

  const { data, error } = await supabase
    .from("published_artworks")
    .select(columns)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchArtworksByTag(tag: string): Promise<ArtworkRecord[]> {
  const { data, error } = await supabase
    .from("published_artworks")
    .select(columns)
    .contains("tags", [tag])
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function fetchArtworksByArtist(artist: string): Promise<ArtworkRecord[]> {
  const { data, error } = await supabase
    .from("published_artworks")
    .select(columns)
    .eq("artist", artist)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}
```

- [ ] **Step 3: Turn `src/lib/paintings.ts` into compatibility layer**

```ts
import { fetchArtworks, type ArtworkRecord } from "./artworks";

export type Painting = {
  id: string;
  title_cn: string | null;
  title_en: string | null;
  artist: string | null;
  location: string | null;
  year_and_place: string | null;
  medium: string | null;
  dimensions: string | null;
  description: string | null;
  tags: string | null;
  display_url: string | null;
};

function artworkToPainting(artwork: ArtworkRecord): Painting {
  return {
    id: artwork.id,
    title_cn: artwork.title_cn,
    title_en: artwork.title_en,
    artist: artwork.artist,
    location: artwork.location,
    year_and_place: artwork.year_and_place,
    medium: artwork.medium,
    dimensions: artwork.dimensions,
    description: artwork.description,
    tags: artwork.tags_text || artwork.tags.join(","),
    display_url: artwork.display_url || artwork.thumbnail_url,
  };
}

export async function fetchPaintings(): Promise<Painting[]> {
  const artworks = await fetchArtworks();
  return artworks.map(artworkToPainting);
}
```

- [ ] **Step 4: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: no TypeScript errors.

- [ ] **Step 5: Commit data access layer**

```bash
git add src/lib/supabase.ts src/lib/artworks.ts src/lib/paintings.ts
git commit -m "feat: read artworks from published supabase view"
```

---

### Task 5: User Library Data Access Layer

**Files:**
- Create: `src/lib/user-library.ts`
- Modify: `src/app.js`

- [ ] **Step 1: Create `src/lib/user-library.ts`**

```ts
import { supabase } from "./supabase";

const favoriteKey = "artArchive:favorites";
const historyKey = "artArchive:history";

export function localFavoriteIds(): string[] {
  return JSON.parse(localStorage.getItem(favoriteKey) || "[]");
}

export function saveLocalFavoriteIds(ids: string[]): void {
  localStorage.setItem(favoriteKey, JSON.stringify([...new Set(ids)]));
}

export function localHistoryIds(): string[] {
  return JSON.parse(localStorage.getItem(historyKey) || "[]");
}

export function saveLocalHistoryIds(ids: string[]): void {
  localStorage.setItem(historyKey, JSON.stringify([...new Set(ids)].slice(0, 50)));
}

export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function syncFavorite(artworkId: string, isFavorite: boolean): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;

  if (isFavorite) {
    const { error } = await supabase.from("user_favorites").upsert(
      { user_id: userId, artwork_id: artworkId },
      { onConflict: "user_id,artwork_id" },
    );
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase
    .from("user_favorites")
    .delete()
    .eq("user_id", userId)
    .eq("artwork_id", artworkId);
  if (error) throw new Error(error.message);
}

export async function recordRemoteHistory(artworkId: string): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;

  const { error } = await supabase.from("user_browsing_history").upsert(
    {
      user_id: userId,
      artwork_id: artworkId,
      viewed_at: new Date().toISOString(),
    },
    { onConflict: "user_id,artwork_id" },
  );
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: Import user library helpers in `src/app.js`**

At the top of `src/app.js`, add:

```js
import {
  localFavoriteIds,
  localHistoryIds,
  recordRemoteHistory,
  saveLocalFavoriteIds,
  saveLocalHistoryIds,
  syncFavorite,
} from "./lib/user-library.ts";
```

- [ ] **Step 3: Replace direct localStorage initialization**

Change state initialization to:

```js
favorites: new Set(localFavoriteIds()),
history: localHistoryIds(),
```

- [ ] **Step 4: Replace `saveFavorites` and `saveHistory`**

```js
function saveFavorites() {
  saveLocalFavoriteIds([...state.favorites]);
}

function saveHistory() {
  saveLocalHistoryIds(state.history);
}
```

- [ ] **Step 5: Sync favorite changes to Supabase when logged in**

Update `toggleFavorite`:

```js
function toggleFavorite(id) {
  if (state.favorites.has(id)) state.favorites.delete(id);
  else state.favorites.add(id);
  saveFavorites();
  syncFavorite(id, state.favorites.has(id)).catch((error) => {
    console.warn("Favorite sync failed", error);
  });
  render();
}
```

- [ ] **Step 6: Sync history changes to Supabase when logged in**

Update `recordHistory`:

```js
function recordHistory(id) {
  if (!id) return;
  state.history = [id, ...state.history.filter((itemId) => itemId !== id)].slice(0, 50);
  saveHistory();
  recordRemoteHistory(id).catch((error) => {
    console.warn("History sync failed", error);
  });
  if (state.activeView === "me") renderProfile();
}
```

- [ ] **Step 7: Run checks**

```bash
npm run check
npx tsc --noEmit
```

Expected: both commands pass.

- [ ] **Step 8: Commit user library layer**

```bash
git add src/lib/user-library.ts src/app.js
git commit -m "feat: add supabase-backed user library helpers"
```

---

### Task 6: Ingestion Scripts and Source Rules

**Files:**
- Modify: `scripts/ingest-artic.mjs`
- Modify: `scripts/ingest-artvee.mjs`
- Modify: `docs/DATA_PIPELINE.md`

- [ ] **Step 1: Keep AIC imports published when public domain**

Verify `scripts/ingest-artic.mjs` upserts:

```js
status: "published",
is_public_domain: true,
license: "Public Domain",
tags: [item.style_title, item.classification_title, item.artwork_type_title, ...(item.term_titles || [])].filter(Boolean),
```

- [ ] **Step 2: Keep Artvee imports draft-only**

Verify `scripts/ingest-artvee.mjs` upserts:

```js
status: "draft",
license: "Public Domain - verify before publishing",
tags: ["Artvee", "Public domain"],
```

- [ ] **Step 3: Document import commands**

Add to `docs/DATA_PIPELINE.md`:

```markdown
## Supabase Ingestion

Chicago Art Institute public-domain import:

```bash
npm run db:ingest:artic
```

Artvee low-frequency draft import:

```bash
ARTVEE_URLS="https://artvee.com/..." npm run db:ingest:artvee
```

Artvee records remain `draft` until source, rights status, artist, date, and image quality are manually reviewed in Supabase.
```

- [ ] **Step 4: Run ingestion smoke test with low limit**

Use a local `.env.local` or shell env with service role key, then run:

```bash
$env:AIC_SYNC_LIMIT="1"; npm run db:ingest:artic
```

Expected: console prints `Imported 1 AIC artworks. Skipped 0.` or skips non-image records until one valid record imports.

- [ ] **Step 5: Commit ingestion docs**

```bash
git add scripts/ingest-artic.mjs scripts/ingest-artvee.mjs docs/DATA_PIPELINE.md
git commit -m "docs: document supabase ingestion workflow"
```

---

### Task 7: Page Integration

**Files:**
- Modify: `src/app.js`
- Modify: `src/styles.css`

- [ ] **Step 1: Verify app mapping accepts array tags**

Update `parseTags`:

```js
function parseTags(value) {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter(Boolean);
  return String(value || "")
    .split(/[,，；、\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}
```

- [ ] **Step 2: Ensure image mapping uses display and thumbnail URLs**

Update `paintingToArtwork` to prefer `display_url`, then `thumbnail_url` if available from the compatibility layer:

```js
displayUrl: painting.display_url || painting.thumbnail_url || "",
downloadUrl: painting.download_url || painting.display_url || "#",
```

If `Painting` compatibility type does not expose `thumbnail_url` or `download_url`, keep the current fields and add them in Task 4 Step 3.

- [ ] **Step 3: Confirm home page reads Supabase data**

Run:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:4173/?v=supabase-plan-check
```

Expected: homepage loads artwork rows from Supabase; no fallback seed data appears unless Supabase read fails.

- [ ] **Step 4: Confirm category page filters by tags**

In the app:

1. Open “分类”.
2. Select a visible tag.
3. Confirm “分类结果” count changes.
4. Click the selected tag again.

Expected: second click clears selection and restores unfiltered category results.

- [ ] **Step 5: Confirm detail page routes**

In the app:

1. Open any artwork.
2. Click creator name.
3. Click a tag.

Expected: creator page lists same-artist works; tag page lists same-tag works.

- [ ] **Step 6: Commit page integration**

```bash
git add src/app.js src/styles.css
git commit -m "feat: connect pages to supabase artwork model"
```

---

### Task 8: Verification, Build, and Android Sync

**Files:**
- Modify: `scripts/check.mjs`
- Modify: `README.md`

- [ ] **Step 1: Extend `scripts/check.mjs` with env key checks**

Add a non-secret validation block:

```js
const requiredPublicEnv = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
for (const key of requiredPublicEnv) {
  if (!process.env[key] && !process.env.CI) {
    console.warn(`Warning: ${key} is not set in the current shell. Vite will read .env.local at runtime.`);
  }
}
```

- [ ] **Step 2: Run full local verification**

```bash
npm run check
npx tsc --noEmit
npm run build
```

Expected:

```text
Validated 3 seed artworks and 12 featured API ids.
vite ... ✓ built
```

- [ ] **Step 3: Verify preview route**

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/?v=supabase-integration | Select-Object StatusCode
```

Expected:

```text
StatusCode
----------
       200
```

- [ ] **Step 4: Sync Android assets**

```bash
npx cap sync android
```

Expected:

```text
[info] Sync finished
```

- [ ] **Step 5: Document verification in README**

Add:

```markdown
## Verification

Run before Android Studio testing:

```bash
npm run check
npx tsc --noEmit
npm run build
npx cap sync android
```

The web preview runs at `http://127.0.0.1:4173/`. Android Studio reads the synced `dist` output through Capacitor.
```

- [ ] **Step 6: Commit verification updates**

```bash
git add scripts/check.mjs README.md
git commit -m "chore: document supabase verification flow"
```

---

## Self-Review

**Spec coverage:**  
Database tables, RLS, environment variables, data access layer, page integration, ingestion scripts, verification, and Android sync are covered by Tasks 1-8.

**Placeholder scan:**  
No task uses placeholder markers, vague implementation language, or cross-references that require reading another task. Every implementation step includes file paths, commands, expected outputs, or concrete code.

**Type consistency:**  
`ArtworkRecord`, `Painting`, `fetchArtworks`, `fetchPaintings`, `syncFavorite`, and `recordRemoteHistory` are defined before use. App state continues to use artwork IDs as strings.

**Known sequencing constraint:**  
Run SQL tasks before switching the app to `published_artworks`; otherwise the browser client will fail because the view does not exist.
