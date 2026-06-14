# Local Environment Setup

This project uses Supabase from both browser code and local Node.js maintenance scripts.

## Required Variables

Create a local-only `.env.local` file from the template:

```powershell
Copy-Item .env.local.example .env.local
```

Then fill in:

```text
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Browser code may use only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
Node.js batch scripts that update Supabase data or Storage must use `SUPABASE_SERVICE_ROLE_KEY`.
Do not add a `VITE_` prefix to the service role key.

## Where To Find Values

In the Supabase Dashboard:

1. Open the project.
2. Go to Project Settings.
3. Open API.
4. Copy the Project URL into `VITE_SUPABASE_URL`.
5. Copy the anon or publishable key into `VITE_SUPABASE_ANON_KEY`.
6. Copy the service role key into `SUPABASE_SERVICE_ROLE_KEY`.

## Service Role Safety

The service role key bypasses Row Level Security and can read or modify protected data. It must never be committed to GitHub, pasted into frontend code, or exposed through any `VITE_` environment variable.

If a service role key is exposed, rotate it in Supabase Dashboard before using it again.

## Verify Local Configuration

Run:

```powershell
node scripts/check-env.mjs
```

The script reports whether required variables are present and their lengths. It does not print full keys.

## Confirm `.env.local` Is Not Tracked

Run:

```powershell
git status --short .env.local
git check-ignore -v .env.local
```

Expected:

- `git status --short .env.local` should print nothing.
- `git check-ignore -v .env.local` should show the `.gitignore` rule that ignores `.env.local`.
