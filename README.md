# Art Archive

Mobile-first artwork archive prototype for browsing, saving, downloading, and studying public-domain paintings. The app is a Vite + Supabase web client that can be packaged later through Capacitor.

## Current Features

- Home recommendations, search, tag groups, artist routes, and artwork detail pages.
- Supabase-backed `published_artworks` data view with normalized artwork/source/image tables.
- Local favorites, browsing history, download records, profile settings, and account login.
- Authenticated user tables for favorites, browsing history, downloads, settings, and profiles.
- Artvee ingestion workflow for low-frequency draft imports that require source and rights review before publishing.
- PWA build support through `vite-plugin-pwa`.
- IIIF/image zoom support through `openseadragon` on artwork detail pages.

## Canonical Project Entry

Run every command from the repository root. The root is the only supported project entry, even when the workspace is reached through a Windows Junction or symbolic link.

```powershell
npm.cmd install
npm.cmd run check:entry
npm.cmd run dev
```

Open `http://127.0.0.1:5173/`.

For the native WeChat mini program, import `<repository-root>/miniapp` into WeChat DevTools. This is the only supported WeChat project entry. Keep npm and data commands at the repository root; importing the repository root into DevTools makes it scan unrelated web dependencies and can restore an invalid cached project identity.

DevTools automation uses the same root entry:

```powershell
cli.bat auto --project .\miniapp --auto-port 9421 --trust-project
$env:WECHAT_AUTOMATOR_ENDPOINT = "ws://localhost:9421"
npm.cmd run recommendation:devtools-smoke
```

`npm.cmd run check:entry` validates that the single WeChat project configuration lives inside `miniapp/`, rejects an accidental root config, and reports the real repository path, so `D:\art` and `E:\CodexProjects\art` cannot silently produce different build settings.

## Environment

Copy `.env.example` to `.env.local` and fill the browser-safe Supabase values:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
```

Only local scripts should receive privileged keys:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key_never_commit_real_value
```

Do not commit `.env.local` or any real service role/API keys. `.gitignore` excludes local env files and generated data directories.

## Supabase Setup

Run these SQL files in order:

```text
supabase/schema.sql
supabase/app_user_data.sql
```

`schema.sql` creates the public artwork catalog and `published_artworks` view. `app_user_data.sql` creates authenticated user-owned tables and RLS policies for favorites, history, downloads, settings, and profiles.

## Data Import

Artvee low-frequency draft import:

```powershell
$env:ARTVEE_URLS="https://artvee.com/example-artwork/"
npm.cmd run db:ingest:artvee
```

Artvee records should remain `draft` until original source, rights status, artist, date, and image quality are manually reviewed.

## Verification

Run the project gate before handing work off:

```bash
npm.cmd run verify
```

This runs:

- `npm.cmd run check`
- `npm.cmd run typecheck`
- `npm.cmd run test:artvee`
- `npm.cmd run build`

The web preview runs at `http://127.0.0.1:5173/`. Android Studio should consume the synced `dist` output when Capacitor is added back to the active workflow.
