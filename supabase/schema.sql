create extension if not exists pgcrypto;

create table if not exists public.sources (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  base_url text not null,
  source_type text not null default 'museum',
  rights_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text generated always as (lower(trim(name))) stored,
  birth_year integer,
  death_year integer,
  nationality text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_name)
);

create table if not exists public.artworks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources(id) on delete restrict,
  source_record_id text not null,
  slug text not null unique,
  title text not null,
  artist_id uuid references public.artists(id) on delete set null,
  artist_display text not null default 'Unknown artist',
  date_display text,
  year_start integer,
  year_end integer,
  place_of_origin text,
  movement text,
  medium text,
  department text,
  description text,
  educational_summary text,
  license text not null default 'Rights status needs review',
  is_public_domain boolean not null default false,
  source_url text not null,
  source_payload jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}'::text[],
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_id, source_record_id)
);

create table if not exists public.artwork_images (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  image_kind text not null default 'primary',
  image_id text,
  width integer,
  height integer,
  thumbnail_url text,
  display_url text not null,
  download_url text,
  iiif_url text,
  credit_line text,
  created_at timestamptz not null default now(),
  unique (artwork_id, image_kind)
);

create table if not exists public.artwork_notes (
  id uuid primary key default gen_random_uuid(),
  artwork_id uuid not null references public.artworks(id) on delete cascade,
  note_type text not null default 'study',
  content text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references public.sources(id) on delete set null,
  source_slug text not null,
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_sources_updated_at on public.sources;
create trigger touch_sources_updated_at before update on public.sources
for each row execute function public.touch_updated_at();

drop trigger if exists touch_artists_updated_at on public.artists;
create trigger touch_artists_updated_at before update on public.artists
for each row execute function public.touch_updated_at();

drop trigger if exists touch_artworks_updated_at on public.artworks;
create trigger touch_artworks_updated_at before update on public.artworks
for each row execute function public.touch_updated_at();

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
  artwork_images.image_id,
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

create index if not exists artworks_status_created_idx
on public.artworks (status, created_at desc);

create index if not exists artworks_artist_display_idx
on public.artworks (artist_display);

create index if not exists artworks_tags_gin_idx
on public.artworks using gin (tags);

create index if not exists artwork_images_artwork_kind_idx
on public.artwork_images (artwork_id, image_kind);

alter table public.sources enable row level security;
alter table public.artists enable row level security;
alter table public.artworks enable row level security;
alter table public.artwork_images enable row level security;
alter table public.artwork_notes enable row level security;
alter table public.ingestion_runs enable row level security;

drop policy if exists "public can read sources" on public.sources;
create policy "public can read sources" on public.sources for select to anon, authenticated using (true);

drop policy if exists "public can read artists" on public.artists;
create policy "public can read artists" on public.artists for select to anon, authenticated using (true);

drop policy if exists "public can read published artworks" on public.artworks;
create policy "public can read published artworks" on public.artworks for select to anon, authenticated using (status = 'published');

drop policy if exists "public can read published images" on public.artwork_images;
create policy "public can read published images" on public.artwork_images
for select to anon, authenticated using (
  exists (
    select 1 from public.artworks
    where artworks.id = artwork_images.artwork_id
      and artworks.status = 'published'
  )
);

drop policy if exists "public can read published notes" on public.artwork_notes;
create policy "public can read published notes" on public.artwork_notes
for select to anon, authenticated using (
  exists (
    select 1 from public.artworks
    where artworks.id = artwork_notes.artwork_id
      and artworks.status = 'published'
  )
);

grant usage on schema public to anon, authenticated;
grant select on public.sources, public.artists, public.artworks, public.artwork_images, public.artwork_notes to anon, authenticated;
grant select on public.published_artworks to anon, authenticated;

insert into public.sources (slug, name, base_url, source_type, rights_notes)
values
  ('artic', 'Art Institute of Chicago', 'https://www.artic.edu', 'museum', 'Metadata is largely CC0; description field may be CC-BY. Images are accessed through IIIF when public domain.'),
  ('artvee', 'Artvee', 'https://artvee.com', 'aggregator', 'Use low-frequency metadata imports and verify original source and public-domain status before publishing.')
on conflict (slug) do update
set name = excluded.name,
    base_url = excluded.base_url,
    source_type = excluded.source_type,
    rights_notes = excluded.rights_notes;

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
