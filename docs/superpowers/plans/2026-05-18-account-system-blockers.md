# Account System Blocker Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove false blockers from account-system verification, fix real verification script drift, and define a reliable manual + command verification path for Supabase Auth.

**Architecture:** Keep the account feature implementation intact. Treat Supabase email-confirmation behavior and shell execution policy as environment/config constraints, while fixing repository-owned verification scripts so they match the current Vite app structure. Do not change RBAC, RLS, SQL, seed scripts, or database validation scripts.

**Tech Stack:** Vite, vanilla JavaScript DOM app, Supabase Auth via `@supabase/supabase-js`, PowerShell on Windows, npm.cmd/npx.cmd verification commands.

---

## 1. Root Cause Judgments

### 1. Supabase signUp succeeds but `hasSession: false`

**Root cause:** This is expected when Supabase Auth email confirmation is enabled. `signUp()` can return a user object without a session because the account must confirm email before becoming logged in.

**Classification:** Supabase project configuration / product flow issue, not a frontend code bug.

**Should block account system?** No, as long as the UI clearly tells users to confirm email and logged-in verification uses an already confirmed account.

**Fix direction:**
- Keep current register flow behavior: show “注册成功，请前往邮箱完成验证后再登录” when `data.session` is absent.
- Update verification expectations: registration success does not imply logged-in state when email confirmation is enabled.
- Use a confirmed test account for login-state verification.

### 2. `example.com` test email rejected

**Root cause:** Supabase Auth rejected `codex.auth...@example.com` as invalid. This can happen due to Auth email validation, anti-abuse rules, or domain restrictions.

**Classification:** Test data issue, not app code.

**Should block account system?** No.

**Fix direction:**
- Stop using `example.com` for Supabase Auth tests.
- Use a real inbox or a domain accepted by the project, such as a dedicated QA Gmail address or another controlled test domain.
- If using email confirmation, ensure the inbox is accessible.

### 3. PowerShell blocks `npm.ps1` / `npx.ps1`

**Root cause:** Windows PowerShell execution policy blocks `.ps1` shim scripts.

**Classification:** Local shell environment issue.

**Should block account system?** No.

**Fix direction:**
- Use `npm.cmd` and `npx.cmd` in verification commands.
- Do not change execution policy as part of the app.

### 4. `npm.cmd run check` fails because `src/data/seed-artworks.js` is missing

**Root cause:** `scripts/check.mjs` still validates an old local seed module that no longer exists. Current source files are `src/lib/artworks.ts` and `src/lib/paintings.ts`, with data read from Supabase and/or current app modules.

**Classification:** Repository verification script drift. This is a codebase maintenance issue, but not an account-system runtime bug.

**Should block account system?** It should block “all checks pass” claims until fixed, but it should not block account UI/Auth behavior verification.

**Fix direction:**
- Inspect current data ownership in `src/lib/artworks.ts`, `src/lib/paintings.ts`, and app usage before editing.
- Replace the stale seed-artwork validation with checks that match current files.
- Do not create an empty `src/data/seed-artworks.js`.
- Do not modify Supabase SQL, seed scripts, or validation scripts outside `scripts/check.mjs`.

### 5. `npx.cmd tsc --noEmit` fails because there is no `tsconfig.json`

**Root cause:** The repo is primarily a Vite JavaScript app with a few TypeScript helper modules. There is no project-level TypeScript config, so bare `tsc --noEmit` has no project to compile.

**Classification:** Verification command mismatch / project configuration gap.

**Should block account system?** No, unless the team decides this repo should become a TS-checked project.

**Fix direction:**
- For the current stage, use an explicit TypeScript helper command that lists TS files and compiler options.
- Optionally add a small `tsconfig.json` later, but that is a separate project-quality task because it changes the repository’s validation contract.

### 6. Headless Chrome / CDP UI automation is unstable

**Root cause:** The current Windows/Chrome/CDP environment is unreliable for page-level Runtime evaluation in this session.

**Classification:** Tooling environment issue.

**Should block account system?** No.

**Fix direction:**
- Use the live in-app browser/manual verification checklist for UI flow.
- Use direct Supabase Auth API checks for backend reachability.
- Keep browser automation as a future improvement, not a release gate for this stage.

---

## 2. Code Problems vs Environment / Config Problems

**Code / repository-owned problems:**
- `scripts/check.mjs` points to a removed file and must be updated to current app data structure.
- Verification docs/scripts should use `npm.cmd` and `npx.cmd` for Windows PowerShell.
- The formal verification command list should not require bare `npx.cmd tsc --noEmit` unless a `tsconfig.json` is added.

**Environment / Supabase configuration problems:**
- Supabase email confirmation returns `hasSession: false` after registration.
- `example.com` is not accepted by Supabase Auth for test registration.
- PowerShell blocks `.ps1` command shims.
- Headless Chrome/CDP automation is unreliable.
- Browser-in-sandbox network may fail while sandbox-external Supabase calls work.

**Not blockers for account system functionality:**
- `hasSession: false` after signUp when the UI explains email confirmation.
- `example.com` rejection when tests use valid accepted emails.
- PowerShell `.ps1` restrictions when `.cmd` commands work.
- Bare `tsc --noEmit` failure in a repo without `tsconfig.json`.
- CDP instability when manual UI verification is available.

---

## 3. File Structure and Responsibilities

**Modify: `scripts/check.mjs`**
- Remove stale dependency on `src/data/seed-artworks.js`.
- Validate current app-critical modules without changing app runtime.
- Suggested minimal checks:
  - Confirm required files exist: `src/app.js`, `src/lib/paintings.ts`, `src/lib/supabase.ts`, `src/lib/auth.ts`, `src/lib/user-settings.ts`, `src/lib/remote-user-profile.ts`.
  - Confirm public Supabase env variables are present in shell or `.env.local`.
  - Confirm `src/app.js` does not contain the old logout placeholder copy “当前版本尚未接入 Supabase Auth”.
  - Confirm account system helper files contain the required exported methods.

**Optional modify: `README.md`**
- Update Windows verification commands:
  - `npm.cmd run check`
  - explicit TypeScript helper check
  - `git diff --check`
  - `npm.cmd run build`
- Document that signUp may require email confirmation.

**Do not modify:**
- `supabase/`
- `scripts` other than `scripts/check.mjs`
- database SQL
- seed scripts
- RBAC / RLS policies
- Auth permissions
- app feature files unless a later execution uncovers a real UI copy bug

---

## 4. Fix Order

### Task 1: Normalize Verification Expectations

**Files:**
- Modify: `README.md` only if verification instructions are maintained there.

- [ ] **Step 1: Record the correct Auth expectation**

Add wording to developer verification notes:

```markdown
When Supabase email confirmation is enabled, `signUp()` returning `user` with `session: null` is expected. Registration verification should assert that the UI shows an email-confirmation message. Login-state verification must use an already confirmed test account.
```

- [ ] **Step 2: Define accepted test email policy**

Add wording:

```markdown
Do not use `example.com` addresses for Supabase Auth tests. Use a real accessible QA inbox or a project-approved test domain.
```

- [ ] **Step 3: No app behavior change**

Run:

```powershell
git diff -- README.md
```

Expected:
- Only documentation text changes if README is edited.

### Task 2: Fix `scripts/check.mjs`

**Files:**
- Modify: `scripts/check.mjs`

- [ ] **Step 1: Replace stale seed validation**

Change the script so it no longer reads:

```js
../src/data/seed-artworks.js
```

Use current file existence and static content checks instead.

Suggested complete structure:

```js
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

const requiredPublicEnv = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
for (const key of requiredPublicEnv) {
  if (!process.env[key] && !process.env.CI) {
    console.warn(`Warning: ${key} is not set in the current shell. Vite will read .env.local at runtime.`);
  }
}

const requiredFiles = [
  "src/app.js",
  "src/lib/paintings.ts",
  "src/lib/supabase.ts",
  "src/lib/auth.ts",
  "src/lib/user-settings.ts",
  "src/lib/remote-user-profile.ts",
];

for (const file of requiredFiles) {
  await access(new URL(`../${file}`, import.meta.url), constants.R_OK);
}

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const authSource = await readFile(new URL("../src/lib/auth.ts", import.meta.url), "utf8");

const requiredAppMarkers = [
  "initializeAuthState",
  "startAuthSubscription",
  "handleAuthSubmit",
  "handleSignOut",
  "renderAuthRoute",
];

for (const marker of requiredAppMarkers) {
  if (!appSource.includes(marker)) {
    throw new Error(`Missing account marker in src/app.js: ${marker}`);
  }
}

const forbiddenRuntimeCopy = "当前版本尚未接入 Supabase Auth";
if (appSource.includes(forbiddenRuntimeCopy)) {
  throw new Error(`Stale logout placeholder copy is still present: ${forbiddenRuntimeCopy}`);
}

const requiredAuthExports = [
  "getCurrentSession",
  "signInWithEmailPassword",
  "signUpWithEmailPassword",
  "signOutCurrentSession",
  "subscribeAuthState",
];

for (const marker of requiredAuthExports) {
  if (!authSource.includes(`function ${marker}`)) {
    throw new Error(`Missing auth helper export: ${marker}`);
  }
}

console.log(`Validated ${requiredFiles.length} app files and account-system markers.`);
```

- [ ] **Step 2: Run check**

Run:

```powershell
npm.cmd run check
```

Expected:

```text
Validated 6 app files and account-system markers.
```

Warnings about env variables are acceptable if running without shell env because Vite reads `.env.local`.

- [ ] **Step 3: Ensure no forbidden areas changed**

Run:

```powershell
git diff -- supabase
git diff -- scripts
```

Expected:
- `supabase` diff is empty.
- `scripts` diff only contains `scripts/check.mjs`.

### Task 3: Replace Bare TypeScript Verification

**Files:**
- Optional modify: `README.md`
- Do not add `tsconfig.json` in this blocker-fix stage unless explicitly approved.

- [ ] **Step 1: Use explicit TS helper check**

Run:

```powershell
npx.cmd tsc src\lib\auth.ts src\lib\user-settings.ts src\lib\remote-user-profile.ts src\lib\app-settings.ts src\lib\user-profile.ts src\lib\supabase.ts --noEmit --lib es2022,dom --moduleResolution bundler --module esnext --target es2022 --skipLibCheck --types vite/client
```

Expected:
- Exit code `0`.
- No compiler output.

- [ ] **Step 2: Mark bare `npx.cmd tsc --noEmit` as non-applicable**

Do not list bare `npx.cmd tsc --noEmit` as required until the repo has a `tsconfig.json`.

### Task 4: Supabase Auth Backend Verification

**Files:**
- No code changes.

- [ ] **Step 1: Confirm Supabase endpoint reachability**

Run in an environment with network access:

```powershell
$envPath = Join-Path (Get-Location) ".env.local"
$values = @{}
Get-Content $envPath | ForEach-Object {
  if ($_ -match "^\s*([^#][^=]+?)\s*=\s*(.*)\s*$") {
    $values[$matches[1].Trim()] = $matches[2].Trim().Trim('"').Trim("'")
  }
}
$url = $values["VITE_SUPABASE_URL"]
Invoke-WebRequest -Uri ($url.TrimEnd("/") + "/auth/v1/health") -UseBasicParsing -TimeoutSec 15
```

Expected:
- `401 Unauthorized` is acceptable for unauthenticated health access because it proves the server is reachable.
- DNS/timeout means environment network is still blocking verification.

- [ ] **Step 2: Register with accepted email domain**

Use a real QA inbox or accepted test domain. Expected outcomes:
- If email confirmation is enabled: `hasUser: true`, `hasSession: false`.
- If email confirmation is disabled: `hasUser: true`, `hasSession: true`.

- [ ] **Step 3: Do not treat `hasSession: false` as failure by itself**

If the app displays the email-confirmation message, registration flow passes.

### Task 5: Manual UI Verification

**Files:**
- No code changes unless manual verification exposes a real UI bug.

- [ ] **Step 1: Prepare test accounts**

Use one of:
- Confirmed test account: `qa-account@example-controlled-domain.com`
- New real inbox where confirmation email can be clicked.

Do not use:
- `example.com`
- invalid or disposable domains rejected by Supabase.

- [ ] **Step 2: Run local app**

Run:

```powershell
npm.cmd run dev
```

Expected:
- App available at `http://127.0.0.1:5173/`.

- [ ] **Step 3: Verify logged-out state**

Manual checks:
- Open `我的`.
- Shows `登录 / 注册` entry.
- Email line shows `未登录`.
- Bottom `登录 / 注册` button opens auth page, not old placeholder.

- [ ] **Step 4: Verify registration state**

Manual checks:
- Open register page.
- Enter valid accepted email and password of at least 8 characters.
- Submit.
- If project email confirmation is enabled, UI shows email-confirmation message and does not pretend to be logged in.
- If project email confirmation is disabled, UI enters logged-in state.

- [ ] **Step 5: Verify login with confirmed account**

Manual checks:
- Open login page.
- Enter confirmed test account email/password.
- Submit.
- App returns to `我的`.
- `我的` shows Auth email.
- Auth button says account is logged in.

- [ ] **Step 6: Verify session restore**

Manual checks:
- Refresh browser page.
- Open `我的`.
- User remains logged in.
- Email remains the Auth email.

- [ ] **Step 7: Verify profile edit**

Manual checks:
- Open `个人资料`.
- Change nickname and bio.
- Save.
- Return to `我的`.
- Nickname updates immediately.
- If `user_profiles` table is missing/unavailable, UI clearly says profile was saved locally or cloud profile table is unavailable.
- Avatar upload remains local preview only unless Storage is explicitly configured later.

- [ ] **Step 8: Verify settings**

Manual checks:
- Open `设置`.
- Change theme/font/motion/download preference.
- Confirm UI state changes.
- If logged in and `user_settings` is accessible, sync message shows enabled/saved.
- If not logged in, message says settings are local only.

- [ ] **Step 9: Verify security center**

Manual checks:
- Open `安全中心`.
- Logged-in state shows real Auth email.
- Login status shows logged in.
- Phone/device/email-change/password/account-deletion rows remain placeholders or disabled when backend support is absent.
- No fake phone or device data appears.

- [ ] **Step 10: Verify logout**

Manual checks:
- Click `退出登录`.
- Confirmation dialog appears.
- Confirm.
- App calls real signOut path.
- Returns to `我的` logged-out state.
- Email line becomes `未登录`.
- Auth entry returns to `登录 / 注册`.
- Refresh page and confirm logged-out state persists.

- [ ] **Step 11: Verify logged-out protected routes**

Manual checks:
- Open `个人资料` while logged out.
- Page prompts user to log in before cloud sync.
- Local-only editing message is clear.

- [ ] **Step 12: Verify unrelated features**

Manual checks:
- Open `我的收藏`.
- Open `浏览历史`.
- Open `下载管理`.
- Existing entries still render.
- Bottom navigation style and behavior are unchanged.

---

## 5. Supabase Dashboard Manual Actions

These require user/admin action in Supabase Dashboard, not code changes:

1. **Decide email confirmation policy**
   - Keep enabled: registration is two-step and verification uses a confirmed account.
   - Disable for local QA only: registration can immediately return a session.

2. **Create or confirm a QA account**
   - Use an accepted real email domain.
   - Confirm the account if email confirmation is enabled.
   - Keep password in a secure place outside the repo.

3. **Check Auth email restrictions**
   - Confirm whether the project blocks `example.com` or disposable domains.
   - Document accepted QA domains.

4. **Check `user_settings` table availability**
   - Existing SQL includes `public.user_settings`.
   - Confirm table is applied to the current Supabase project if settings sync must be verified.

5. **Check `user_profiles` table availability**
   - Current repo SQL does not define `user_profiles`.
   - Do not add it in this blocker fix.
   - If cloud profile sync is required, approve a separate schema/RLS plan first.

---

## 6. Fixed Verification Commands

Use these commands on Windows PowerShell:

```powershell
npm.cmd run check
```

Expected after Task 2:

```text
Validated 6 app files and account-system markers.
```

```powershell
npx.cmd tsc src\lib\auth.ts src\lib\user-settings.ts src\lib\remote-user-profile.ts src\lib\app-settings.ts src\lib\user-profile.ts src\lib\supabase.ts --noEmit --lib es2022,dom --moduleResolution bundler --module esnext --target es2022 --skipLibCheck --types vite/client
```

Expected:
- Exit code `0`.

```powershell
git diff --check
```

Expected:
- Exit code `0`.
- CRLF warnings are acceptable unless converted into errors.

```powershell
npm.cmd run build
```

Expected:
- Vite build completes.
- If sandbox blocks deleting `dist`, rerun outside the sandbox or stop processes holding `dist`.

```powershell
git diff -- supabase scripts
```

Expected:
- `supabase` diff is empty.
- `scripts` diff only includes the intended `scripts/check.mjs` change.

---

## 7. Risk Points

- Updating `scripts/check.mjs` too broadly could turn it into a weak smoke test. Keep checks concrete and tied to current account-system markers.
- Adding `tsconfig.json` casually may reveal unrelated JS/TS issues and expand this task. Treat it as a separate quality improvement.
- Disabling Supabase email confirmation changes product behavior and should be a user/admin decision, not a code fix.
- If `user_profiles` is not present, cloud profile save cannot be fully verified. The current app should degrade clearly instead of pretending cloud sync worked.
- Direct Supabase verification must never print anon keys, session tokens, or passwords.

---

## 8. Rollback Plan

- Revert `scripts/check.mjs` if the new checks create false failures.
- Revert any README verification text changes if they conflict with team docs.
- No database rollback is needed because this plan does not modify SQL or Supabase project schema.
- No Auth/RBAC/RLS rollback is needed because this plan does not change permission logic.

---

## 9. Self-Review

**Spec coverage:**
- Covers each blocker root cause, fix plan, classification, non-blocking judgment, fix order, file list, Supabase dashboard actions, verification commands, and manual UI checklist.

**Placeholder scan:**
- No TBD/TODO placeholders.
- Manual account values are intentionally described as QA-owned secrets and must not be committed.

**Type/command consistency:**
- Uses `npm.cmd` / `npx.cmd` consistently for Windows PowerShell.
- Does not require bare `npx.cmd tsc --noEmit` without `tsconfig.json`.
