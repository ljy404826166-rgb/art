# Profile Center MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the static "我的" page into an editable personal center MVP with local profile data, without changing RBAC/RLS/database schema, bottom navigation, downloads, favorites, or browsing history.

**Architecture:** First stage is local-first: profile fields live in app state and `localStorage`, rendered through the existing `profileRouteDrawer`. Supabase Auth remains read-only for account status; `user_profiles` and Supabase Storage are documented as a second-stage backend plan that requires explicit approval before any schema, RLS, or Storage changes.

**Tech Stack:** Vite, vanilla JavaScript DOM rendering, CSS, `localStorage`, existing Supabase Auth summary helper, existing profile route drawer.

---

## Scope

### This Stage Builds

- Editable local personal profile data:
  - display name
  - bio
  - location
  - website
  - email display text
  - avatar preview data URL or initials fallback
- A new "个人资料" route inside the existing profile drawer.
- A new "编辑资料" / "个人资料" entry from the "我的" page.
- Loading/saving/success/failure states for local profile save.
- Form validation for profile fields and local avatar file preview.
- Read-only display of account/Auth status where already available.

### This Stage Does Not Build

- No `user_profiles` table creation.
- No Supabase Storage bucket or avatar upload.
- No RBAC/RLS policy changes.
- No edits to `supabase/rbac.sql`.
- No edits to seed scripts or validation scripts.
- No remote profile sync.
- No email change flow. Auth email remains managed by Supabase Auth, not profile editing.
- No bottom navigation changes.
- No changes to download management, favorites, or browsing history logic.
- No automatic commit.

## Current Code Facts

- "我的" identity UI is generated in `src/app.js` inside `mountProfileShell()`.
- The current profile avatar/name/email are hard-coded in that shell.
- `currentUserSummary()` in `src/lib/user-library.ts` reads Supabase Auth and returns only `id`, `email`, and `phone`.
- `supabase/app_user_data.sql` has `user_favorites`, `user_browsing_history`, `user_downloads`, and `user_settings`.
- There is no current `user_profiles` table and no current `avatar_url` column in SQL.
- Settings already use a focused local helper in `src/lib/app-settings.ts`; profile data should follow the same pattern with a new helper.

## File Structure

### Modify

- `src/app.js`
  - Add profile state to the global `state`.
  - Render identity section from `state.profile`.
  - Add "个人资料" / "编辑资料" entry and route handling.
  - Add profile route HTML and event binding.
  - Integrate Supabase Auth summary only as read-only account status.

- `src/styles.css`
  - Add styles for profile edit route, avatar preview, form fields, validation messages, save bar, and status feedback.
  - Do not touch `.main-nav`, `.main-nav-item`, download progress selectors, card layout selectors, or bottom navigation rules.

### Create

- `src/lib/user-profile.ts`
  - Owns local profile shape, defaults, validation constants, read/write/reset helpers, and file validation constants.
  - Keeps profile persistence isolated from the large `app.js`.

### Do Not Modify

- `supabase/`
- `scripts/`
- SQL files
- seed files
- validation scripts
- `src/lib/supabase.ts`
- `src/lib/user-library.ts`, except only if a later approved phase adds profile reads
- bottom navigation markup or CSS

---

## Data Model

### First Stage Local Profile

`src/lib/user-profile.ts` should define:

```ts
export const userProfileKey = "artArchive:profile";

export const profileLimits = {
  displayNameMin: 1,
  displayNameMax: 24,
  bioMax: 120,
  locationMax: 40,
  websiteMax: 80,
  emailDisplayMax: 80,
  avatarMaxBytes: 1024 * 1024,
  avatarMimeTypes: ["image/jpeg", "image/png", "image/webp"],
};

export type LocalUserProfile = {
  displayName: string;
  bio: string;
  location: string;
  website: string;
  emailDisplay: string;
  avatarDataUrl: string;
  avatarInitials: string;
  updatedAt: string;
};

export const defaultUserProfile: LocalUserProfile = {
  displayName: "林熙和",
  bio: "收藏、浏览和整理我的艺术档案。",
  location: "",
  website: "",
  emailDisplay: "lin.xihe@curatorial.art",
  avatarDataUrl: "",
  avatarInitials: "林",
  updatedAt: "",
};
```

### Future Supabase `user_profiles` Fields

Do not implement in this stage. Before the backend phase, inspect the live database and SQL files for `user_profiles`. If absent, propose a migration with:

```sql
create table public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url text,
  bio text,
  location text,
  website text,
  updated_at timestamptz not null default now()
);
```

Field decisions:

- `display_name`: yes, needed for editable nickname.
- `avatar_url`: yes, second-stage Storage URL reference.
- `bio`: yes, editable intro.
- `location`: yes, optional profile enrichment.
- `website`: yes, optional external link, must validate URL.
- `updated_at`: yes, sync and conflict visibility.
- `email_display`: optional. Prefer local-only first; future backend can add it if product wants a public/display email separate from Auth email.
- `preferences jsonb`: not needed because `user_settings` already exists.

Future RLS shape, only after approval:

```sql
alter table public.user_profiles enable row level security;

create policy "users manage own profile"
on public.user_profiles for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

Do not use `user_metadata` for authorization.

---

## Avatar Upload Strategy

### First Stage: Local Preview Only

- Use `<input type="file" accept="image/png,image/jpeg,image/webp">`.
- Validate MIME type before preview.
- Validate size `<= 1MB`.
- Read with `FileReader.readAsDataURL()`.
- Save data URL in `localStorage` as `avatarDataUrl`.
- Provide a "移除头像" action that clears `avatarDataUrl` and falls back to initials.

### Second Stage: Supabase Storage

Requires separate approval. Proposed shape:

- Bucket: `avatars`
- Path: `${user.id}/avatar.webp` or `${user.id}/${timestamp}.webp`
- Upload policy: authenticated users can insert/update/select only under their own folder.
- Store public or signed URL in `user_profiles.avatar_url`.
- Consider image compression/cropping before upload.
- Decide old-file cleanup strategy before implementation.

Web limitations:

- Mobile browsers may provide HEIC even when JPEG is expected.
- Large camera files can exceed memory limits if read directly.
- EXIF orientation may need normalization.
- Data URLs in localStorage are size-sensitive; keep first-stage max small.
- Storage upsert requires correct insert/select/update policies in Supabase Storage.

---

### Task 1: Add Local Profile Persistence Helper

**Files:**
- Create: `src/lib/user-profile.ts`
- Modify: none

- [ ] **Step 1: Create `src/lib/user-profile.ts` with profile shape and helpers**

```ts
export const userProfileKey = "artArchive:profile";

export const profileLimits = {
  displayNameMin: 1,
  displayNameMax: 24,
  bioMax: 120,
  locationMax: 40,
  websiteMax: 80,
  emailDisplayMax: 80,
  avatarMaxBytes: 1024 * 1024,
  avatarMimeTypes: ["image/jpeg", "image/png", "image/webp"],
} as const;

export type LocalUserProfile = {
  displayName: string;
  bio: string;
  location: string;
  website: string;
  emailDisplay: string;
  avatarDataUrl: string;
  avatarInitials: string;
  updatedAt: string;
};

export const defaultUserProfile: LocalUserProfile = {
  displayName: "林熙和",
  bio: "收藏、浏览和整理我的艺术档案。",
  location: "",
  website: "",
  emailDisplay: "lin.xihe@curatorial.art",
  avatarDataUrl: "",
  avatarInitials: "林",
  updatedAt: "",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function limitText(value: unknown, maxLength: number): string {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function initialsFromName(value: string): string {
  const text = value.trim();
  if (!text) return defaultUserProfile.avatarInitials;
  return Array.from(text).slice(0, 2).join("");
}

export function normalizeUserProfile(value: unknown): LocalUserProfile {
  if (!isRecord(value)) return defaultUserProfile;
  const displayName = limitText(value.displayName, profileLimits.displayNameMax) || defaultUserProfile.displayName;
  return {
    displayName,
    bio: limitText(value.bio, profileLimits.bioMax),
    location: limitText(value.location, profileLimits.locationMax),
    website: limitText(value.website, profileLimits.websiteMax),
    emailDisplay: limitText(value.emailDisplay, profileLimits.emailDisplayMax),
    avatarDataUrl: String(value.avatarDataUrl || ""),
    avatarInitials: limitText(value.avatarInitials, 2) || initialsFromName(displayName),
    updatedAt: String(value.updatedAt || ""),
  };
}

export function readUserProfile(): LocalUserProfile {
  try {
    return normalizeUserProfile(JSON.parse(localStorage.getItem(userProfileKey) || "null"));
  } catch {
    return defaultUserProfile;
  }
}

export function saveUserProfile(profile: LocalUserProfile): LocalUserProfile {
  const normalized = normalizeUserProfile({
    ...profile,
    updatedAt: new Date().toISOString(),
  });
  localStorage.setItem(userProfileKey, JSON.stringify(normalized));
  return normalized;
}

export function resetUserProfile(): LocalUserProfile {
  localStorage.setItem(userProfileKey, JSON.stringify(defaultUserProfile));
  return defaultUserProfile;
}
```

- [ ] **Step 2: Run a syntax/build sanity check**

Run:

```powershell
node --check src\app.js
```

Expected:

- Exit code `0`.

Note: TypeScript compilation may not be available because the current repo has no `tsconfig.json`; still run requested checks at the end.

---

### Task 2: Wire Profile State Into The App

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Import profile helpers**

At the top of `src/app.js`, add:

```js
import {
  defaultUserProfile,
  initialsFromName,
  profileLimits,
  readUserProfile,
  saveUserProfile,
} from "./lib/user-profile.ts";
```

- [ ] **Step 2: Add profile state fields**

In the global `state` object, add:

```js
profile: readUserProfile(),
profileDraft: null,
profileSaving: false,
profileMessage: "",
profileError: "",
```

- [ ] **Step 3: Add display helpers near existing profile helpers**

```js
function profileDisplayEmail() {
  return state.profile.emailDisplay || state.authSummary?.email || "未绑定邮箱";
}

function profileAvatarMarkup(profile = state.profile) {
  if (profile.avatarDataUrl) {
    return `<img src="${escapeHtml(profile.avatarDataUrl)}" alt="" />`;
  }
  return escapeHtml(profile.avatarInitials || initialsFromName(profile.displayName));
}
```

Rationale:

- Keeps "我的" page driven by state rather than hard-coded identity text.
- Uses Auth email only as fallback display, not as editable Auth data.

---

### Task 3: Update "我的" Identity Surface And Entry Points

**Files:**
- Modify: `src/app.js`, `mountProfileShell()` and profile route handlers.
- Modify: `src/styles.css`, profile avatar image rules if needed.

- [ ] **Step 1: Replace hard-coded identity markup in `mountProfileShell()`**

Change the identity section to render placeholders with stable IDs:

```html
<section class="profile-identity" aria-label="个人信息">
  <div class="profile-avatar" id="profileAvatar" aria-hidden="true"></div>
  <div class="profile-identity-copy">
    <h1 id="profileDisplayName"></h1>
    <p id="profileDisplayEmail"></p>
    <small id="profileBio"></small>
  </div>
  <button class="profile-edit-button" id="profileEditButton" type="button">编辑资料</button>
</section>
```

- [ ] **Step 2: Add node references**

Add to `nodes`:

```js
profileAvatar: document.querySelector("#profileAvatar"),
profileDisplayName: document.querySelector("#profileDisplayName"),
profileDisplayEmail: document.querySelector("#profileDisplayEmail"),
profileBio: document.querySelector("#profileBio"),
profileEdit: document.querySelector("#profileEditButton"),
```

- [ ] **Step 3: Render profile identity from state**

Add:

```js
function renderProfileIdentity() {
  if (nodes.profileAvatar) nodes.profileAvatar.innerHTML = profileAvatarMarkup();
  if (nodes.profileDisplayName) nodes.profileDisplayName.textContent = state.profile.displayName;
  if (nodes.profileDisplayEmail) nodes.profileDisplayEmail.textContent = profileDisplayEmail();
  if (nodes.profileBio) nodes.profileBio.textContent = state.profile.bio || "还没有个人简介";
}
```

Call `renderProfileIdentity()` at the start of `renderProfile()`.

- [ ] **Step 4: Add a menu row for "个人资料"**

Inside the account/profile menu area, before 安全中心 or 设置, add:

```html
<button class="profile-menu-row" type="button" data-profile-panel="profile">
  <span class="profile-menu-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 12.5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" /><path d="M5 20c.7-3.5 3.4-5.6 7-5.6s6.3 2.1 7 5.6" /></svg></span>
  <span>个人资料</span>
  <svg class="profile-chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
</button>
```

- [ ] **Step 5: Wire edit button to the same route**

After existing profile panel event listeners are attached:

```js
nodes.profileEdit?.addEventListener("click", () => openProfileRoute("profile"));
```

Rationale:

- Adds both obvious top-level edit affordance and menu entry.
- Keeps bottom navigation unchanged.

---

### Task 4: Add Personal Profile Route

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Add profile draft helpers**

```js
function startProfileDraft() {
  state.profileDraft = { ...state.profile };
  state.profileMessage = "";
  state.profileError = "";
}

function currentProfileDraft() {
  if (!state.profileDraft) startProfileDraft();
  return state.profileDraft;
}
```

- [ ] **Step 2: Add validation**

```js
function validateProfileDraft(profile) {
  const errors = [];
  const displayName = profile.displayName.trim();
  if (!displayName) errors.push("昵称不能为空");
  if (displayName.length > profileLimits.displayNameMax) errors.push(`昵称不能超过 ${profileLimits.displayNameMax} 个字符`);
  if (profile.bio.length > profileLimits.bioMax) errors.push(`简介不能超过 ${profileLimits.bioMax} 个字符`);
  if (profile.location.length > profileLimits.locationMax) errors.push(`所在地不能超过 ${profileLimits.locationMax} 个字符`);
  if (profile.website.length > profileLimits.websiteMax) errors.push(`网站不能超过 ${profileLimits.websiteMax} 个字符`);
  if (profile.website && !/^https?:\/\/\S+\.\S+/.test(profile.website)) errors.push("网站需要以 http:// 或 https:// 开头");
  return errors;
}
```

- [ ] **Step 3: Add route HTML**

```js
function profileRouteHtml() {
  const profile = currentProfileDraft();
  const authLabel = state.authLoaded ? (state.authSummary ? "已登录" : "未登录") : "读取中";
  const message = state.profileMessage
    ? `<div class="profile-route-message" data-tone="success">${escapeHtml(state.profileMessage)}</div>`
    : "";
  const error = state.profileError
    ? `<div class="profile-route-message" data-tone="error">${escapeHtml(state.profileError)}</div>`
    : "";

  return `
    <section class="profile-route-page profile-edit-route">
      <section class="profile-route-hero">
        <p>个人中心</p>
        <h1>个人资料</h1>
        <div>${state.authSummary ? "当前账号资料先保存在本机，云端同步将在后续阶段开启。" : "未登录状态下，资料仅保存在当前设备。"}</div>
      </section>

      ${message}
      ${error}

      <section class="profile-setting-group">
        <h2>头像</h2>
        <div class="profile-avatar-editor">
          <div class="profile-avatar profile-avatar-preview" id="profileAvatarPreview">${profileAvatarMarkup(profile)}</div>
          <div class="profile-avatar-actions">
            <label class="profile-file-button">
              <span>选择图片</span>
              <input id="profileAvatarInput" type="file" accept="image/png,image/jpeg,image/webp" />
            </label>
            <button class="text-button" type="button" data-profile-edit-action="removeAvatar">移除头像</button>
          </div>
        </div>
        <p class="profile-form-help">支持 JPG、PNG、WebP，最大 1MB。第一阶段仅本机预览，不上传云端。</p>
      </section>

      <section class="profile-setting-group">
        <h2>基础资料</h2>
        <label class="profile-form-field">
          <span>昵称</span>
          <input id="profileDisplayNameInput" type="text" maxlength="${profileLimits.displayNameMax}" value="${escapeHtml(profile.displayName)}" />
        </label>
        <label class="profile-form-field">
          <span>个人简介</span>
          <textarea id="profileBioInput" maxlength="${profileLimits.bioMax}">${escapeHtml(profile.bio)}</textarea>
        </label>
        <label class="profile-form-field">
          <span>所在地</span>
          <input id="profileLocationInput" type="text" maxlength="${profileLimits.locationMax}" value="${escapeHtml(profile.location)}" />
        </label>
        <label class="profile-form-field">
          <span>个人网站</span>
          <input id="profileWebsiteInput" type="url" maxlength="${profileLimits.websiteMax}" value="${escapeHtml(profile.website)}" placeholder="https://example.com" />
        </label>
        <label class="profile-form-field">
          <span>邮箱展示</span>
          <input id="profileEmailDisplayInput" type="text" maxlength="${profileLimits.emailDisplayMax}" value="${escapeHtml(profile.emailDisplay)}" />
        </label>
      </section>

      <section class="profile-setting-group">
        <h2>账号状态</h2>
        <div class="profile-setting-row"><div><strong>登录状态</strong><span>${escapeHtml(authLabel)}</span></div>${profileStatusBadge(authLabel, state.authSummary ? "ok" : "muted")}</div>
        <div class="profile-setting-row"><div><strong>Auth 邮箱</strong><span>${accountValue(state.authSummary?.email)}</span></div>${profileStatusBadge(state.authSummary?.email ? "来自 Auth" : "未配置", state.authSummary?.email ? "ok" : "muted")}</div>
      </section>

      <div class="profile-save-bar">
        <button class="state-action" type="button" data-profile-edit-action="save" ${state.profileSaving ? "disabled" : ""}>${state.profileSaving ? "保存中..." : "保存资料"}</button>
      </div>
    </section>
  `;
}
```

- [ ] **Step 4: Add route renderer**

```js
function renderProfileEditRoute() {
  nodes.profileRouteTitle.textContent = "个人资料";
  nodes.profileRouteMain.innerHTML = profileRouteHtml();
  bindProfileEditRouteEvents();
}
```

- [ ] **Step 5: Route `profile` panel in `openProfileRoute()`**

Before `settings` and `security` branches:

```js
if (panel === "profile") {
  window.clearTimeout(profileRouteCloseTimer);
  startProfileDraft();
  renderProfileEditRoute();
  nodes.profileRoute.dataset.mounted = "true";
  requestAnimationFrame(() => {
    nodes.profileRoute.setAttribute("aria-hidden", "false");
  });
  document.body.classList.add("profile-route-open");
  return;
}
```

---

### Task 5: Implement Profile Edit Interactions

**Files:**
- Modify: `src/app.js`

- [ ] **Step 1: Add draft syncing from form fields**

```js
function syncProfileDraftFromForm() {
  const draft = currentProfileDraft();
  draft.displayName = document.querySelector("#profileDisplayNameInput")?.value.trim() || "";
  draft.bio = document.querySelector("#profileBioInput")?.value.trim() || "";
  draft.location = document.querySelector("#profileLocationInput")?.value.trim() || "";
  draft.website = document.querySelector("#profileWebsiteInput")?.value.trim() || "";
  draft.emailDisplay = document.querySelector("#profileEmailDisplayInput")?.value.trim() || "";
  draft.avatarInitials = initialsFromName(draft.displayName);
}
```

- [ ] **Step 2: Add avatar file handling**

```js
function handleProfileAvatarFile(file) {
  if (!file) return;
  if (!profileLimits.avatarMimeTypes.includes(file.type)) {
    state.profileError = "头像仅支持 JPG、PNG 或 WebP";
    renderProfileEditRoute();
    return;
  }
  if (file.size > profileLimits.avatarMaxBytes) {
    state.profileError = "头像文件不能超过 1MB";
    renderProfileEditRoute();
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    currentProfileDraft().avatarDataUrl = String(reader.result || "");
    state.profileError = "";
    renderProfileEditRoute();
  });
  reader.addEventListener("error", () => {
    state.profileError = "头像读取失败，请重新选择";
    renderProfileEditRoute();
  });
  reader.readAsDataURL(file);
}
```

- [ ] **Step 3: Add save action**

```js
function saveProfileDraft() {
  syncProfileDraftFromForm();
  const draft = currentProfileDraft();
  const errors = validateProfileDraft(draft);
  if (errors.length) {
    state.profileError = errors[0];
    state.profileMessage = "";
    renderProfileEditRoute();
    return;
  }

  state.profileSaving = true;
  state.profileError = "";
  state.profileMessage = "";
  renderProfileEditRoute();

  try {
    state.profile = saveUserProfile(draft);
    state.profileDraft = { ...state.profile };
    state.profileMessage = "资料已保存";
  } catch (error) {
    console.error("Profile save failed", error);
    state.profileError = "保存失败，请稍后重试";
  } finally {
    state.profileSaving = false;
    renderProfile();
    renderProfileEditRoute();
  }
}
```

- [ ] **Step 4: Bind profile edit events**

```js
function bindProfileEditRouteEvents() {
  nodes.profileRouteMain.querySelector("#profileAvatarInput")?.addEventListener("change", (event) => {
    handleProfileAvatarFile(event.target.files?.[0]);
  });

  nodes.profileRouteMain.querySelectorAll("[data-profile-edit-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.profileEditAction === "removeAvatar") {
        currentProfileDraft().avatarDataUrl = "";
        state.profileError = "";
        renderProfileEditRoute();
      }

      if (button.dataset.profileEditAction === "save") {
        saveProfileDraft();
      }
    });
  });
}
```

Loading/save states:

- `profileSaving = true`: save button shows `保存中...` and is disabled.
- `profileMessage`: success message.
- `profileError`: validation/save failure message.

---

### Task 6: Add Profile Center Styles

**Files:**
- Modify: `src/styles.css`

- [ ] **Step 1: Add identity and edit button styles**

```css
.profile-identity-copy {
  min-width: 0;
}

.profile-identity small {
  display: block;
  max-width: 100%;
  overflow: hidden;
  margin-top: 4px;
  color: #77716b;
  font-size: 12px;
  line-height: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-avatar img,
.profile-avatar-preview img {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.profile-edit-button {
  border: 0;
  border-radius: 999px;
  padding: 8px 12px;
  color: #ffffff;
  background: #1f2328;
  font-size: 12px;
  font-weight: 750;
}
```

- [ ] **Step 2: Add route form styles**

```css
.profile-edit-route {
  gap: 16px;
}

.profile-avatar-editor {
  display: flex;
  align-items: center;
  gap: 14px;
}

.profile-avatar-preview {
  width: 72px;
  height: 72px;
  flex: 0 0 auto;
}

.profile-avatar-actions {
  display: grid;
  gap: 8px;
}

.profile-file-button {
  position: relative;
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 999px;
  padding: 0 14px;
  color: #ffffff;
  background: #1f2328;
  font-size: 13px;
  font-weight: 750;
}

.profile-file-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
}

.profile-form-help {
  margin: 4px 0 0;
  color: #77716b;
  font-size: 12px;
  line-height: 18px;
}

.profile-form-field {
  display: grid;
  gap: 7px;
}

.profile-form-field span {
  color: #6d6863;
  font-size: 12px;
  font-weight: 750;
}

.profile-form-field input,
.profile-form-field textarea {
  width: 100%;
  border: 1px solid rgba(31, 35, 40, 0.1);
  border-radius: 8px;
  padding: 11px 12px;
  color: #1f2328;
  background: #ffffff;
  font: inherit;
}

.profile-form-field textarea {
  min-height: 92px;
  resize: vertical;
}

.profile-save-bar {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid rgba(31, 35, 40, 0.06);
  padding: 12px 0 0;
  background: #ffffff;
}

.profile-route-message[data-tone="success"] {
  color: #315f52;
  background: #eef7f2;
}

.profile-route-message[data-tone="error"] {
  color: #6f1d1b;
  background: rgba(111, 29, 27, 0.08);
}
```

UI requirements:

- Use existing route drawer.
- Keep sections compact and scannable.
- Do not add landing-page style cards.
- Keep bottom navigation unchanged.
- Make avatar editing clear but not dominant.

---

### Task 7: Verification

**Files:**
- No new source files beyond previous tasks.

- [ ] **Step 1: Static checks for forbidden changes**

Run:

```powershell
git diff -- supabase scripts
```

Expected:

- Empty output.

Run:

```powershell
git diff -- src/styles.css | Select-String -Pattern "main-nav|main-nav-item|download-progress|favorite|history"
```

Expected:

- No changes to bottom navigation or download progress selectors for this feature.

- [ ] **Step 2: Syntax and project checks**

Run:

```powershell
node --check src\app.js
npm run check
npx tsc --noEmit
git diff --check
```

Expected:

- `node --check src\app.js`: exit `0`.
- `git diff --check`: exit `0`, allowing existing CRLF warnings.
- In the current repo, `npm run check` may fail because `src/data/seed-artworks.js` is absent. Record exact output; do not modify scripts or seed files.
- In the current repo, `npx tsc --noEmit` may print help and exit non-zero if no `tsconfig.json` exists. Record exact output; do not add TypeScript config in this task.

- [ ] **Step 3: Manual browser verification**

In `http://127.0.0.1:5173/`:

1. Open bottom nav `我的`.
2. Confirm top identity shows state-driven display name, email display, and bio.
3. Click `编辑资料`.
4. Confirm `个人资料` route opens in existing drawer.
5. Save with empty nickname.
6. Confirm validation message: `昵称不能为空`.
7. Enter a valid nickname and bio.
8. Click `保存资料`.
9. Confirm success message: `资料已保存`.
10. Close drawer.
11. Confirm "我的" identity updates.
12. Refresh browser.
13. Confirm local profile persists.
14. Choose an invalid avatar file type.
15. Confirm error: `头像仅支持 JPG、PNG 或 WebP`.
16. Choose an image over 1MB.
17. Confirm error: `头像文件不能超过 1MB`.
18. Choose a valid JPG/PNG/WebP under 1MB.
19. Confirm local avatar preview appears.
20. Confirm downloads, favorites, history routes still open and counts still render.
21. Confirm bottom navigation visual style and behavior are unchanged.

---

## Future Backend Phase: Supabase Profile Sync

Do not implement without explicit approval.

### Schema Check

Before proposing migration:

```powershell
rg -n "user_profiles|avatar_url|display_name|bio|location|website" supabase
```

If absent, propose `user_profiles` migration separately.

### Storage Check

Before avatar upload:

- Decide bucket name, public/signed URL model, max size, image processing, and cleanup.
- Add Storage policies only after security review.
- Verify Storage upload in browser with authenticated session.

### Sync Strategy

- When logged out: local profile only.
- When logged in and `user_profiles` exists: fetch remote profile.
- If no remote profile exists: offer "同步本机资料到云端".
- If both local and remote exist: prefer remote by default and show updated time.
- On save: upsert remote profile and mirror to local cache.

---

## Risks

- `app.js` is already large; adding more route logic increases complexity. Creating `src/lib/user-profile.ts` keeps persistence bounded.
- localStorage data URLs can grow quickly. Keep avatar max at 1MB and consider future compression.
- Auth email is not profile email. Do not let the profile editor imply it changes Supabase Auth credentials.
- Future `user_profiles` RLS requires a SELECT policy for UPDATE to work correctly.
- Supabase Storage upsert requires INSERT, SELECT, and UPDATE permissions; incomplete policies can silently fail.
- Unsanitized website URLs can create unsafe links. First stage only stores text; future clickable rendering must validate URL.
- Profile sync can conflict with local edits. Defer conflict handling to backend phase.
- Current verification commands have known environment/repo blockers; record them without changing forbidden files.

## Rollback Plan

If the feature causes regressions:

1. Remove `src/lib/user-profile.ts`.
2. Revert `mountProfileShell()` identity markup to the previous static section.
3. Remove `profile` state fields and profile route functions from `src/app.js`.
4. Remove the `profile` menu row and `profileEditButton` listener.
5. Remove profile edit CSS blocks from `src/styles.css`.
6. Clear local test data in browser console if needed:

```js
localStorage.removeItem("artArchive:profile");
```

Rollback must not touch downloads, favorites, history, bottom navigation, Supabase SQL, RBAC/RLS, seed scripts, or validation scripts.

## Self-Review

- Spec coverage: The plan covers stage goal, exclusions, pages, personal profile route, "我的" entries, `user_profiles` field check, recommended future fields, avatar local/Storage phases, local/Supabase save strategy, logged-out behavior, loading/saving/success/failure states, validation rules, UI requirements, file list, verification, risks, and rollback.
- Placeholder scan: No task contains unspecified implementation placeholders; code snippets name exact functions, fields, and selectors.
- Type consistency: `LocalUserProfile`, `profileLimits`, `readUserProfile`, `saveUserProfile`, `profileRouteHtml`, `renderProfileEditRoute`, and `bindProfileEditRouteEvents` are used consistently.
