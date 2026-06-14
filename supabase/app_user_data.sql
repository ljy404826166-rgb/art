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

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  bio text,
  location text,
  website text,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_favorites enable row level security;
alter table public.user_browsing_history enable row level security;
alter table public.user_downloads enable row level security;
alter table public.user_profiles enable row level security;
alter table public.user_settings enable row level security;

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

drop policy if exists "users read own profile" on public.user_profiles;
create policy "users read own profile"
on public.user_profiles for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users insert own profile" on public.user_profiles;
create policy "users insert own profile"
on public.user_profiles for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users update own profile" on public.user_profiles;
create policy "users update own profile"
on public.user_profiles for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users delete own profile" on public.user_profiles;
create policy "users delete own profile"
on public.user_profiles for delete
to authenticated
using (auth.uid() = user_id);

drop policy if exists "users manage own settings" on public.user_settings;
create policy "users manage own settings"
on public.user_settings for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

grant select, insert, delete on public.user_favorites to authenticated;
grant select, insert, update on public.user_browsing_history to authenticated;
grant select, insert, update, delete on public.user_downloads to authenticated;
grant select, insert, update, delete on public.user_profiles to authenticated;
grant select, insert, update, delete on public.user_settings to authenticated;

create index if not exists user_history_user_viewed_idx
on public.user_browsing_history (user_id, viewed_at desc);

create index if not exists user_downloads_user_downloaded_idx
on public.user_downloads (user_id, downloaded_at desc);
