# Profile Settings and Security Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current placeholder Settings and Security Center profile routes with polished mobile app pages that provide real local interactions where possible and clearly marked account-backed placeholders where backend capability is not available yet.

**Architecture:** Keep the existing Vite + Capacitor + vanilla DOM architecture. Use the existing `profileRouteDrawer` right-to-left route overlay, split profile settings data into a focused local preference module, and keep Supabase-dependent account capabilities gated behind current Auth/session checks rather than inventing backend behavior.

**Tech Stack:** Vite, vanilla JavaScript DOM rendering, TypeScript utility modules under `src/lib`, Supabase browser client, localStorage, existing CSS in `src/styles.css`, existing `npm.cmd run check`, `npx.cmd tsc --noEmit`, `npm.cmd run build`, and `npx.cmd cap sync android`.

---

## Scope and Non-Goals

This plan covers two profile sub-pages only:

- `settings`: application preferences, cache/data controls, downloads, sync status, and about information.
- `security`: account/session status, binding placeholders, local privacy controls, logout, and future security features.

This plan does not implement full Supabase Auth UI, phone OTP, email update flows, device/session management, two-factor authentication, or account deletion. Those need separate backend/API work and should remain disabled UI placeholders in this phase.

## Files to Modify or Create

- Modify: `src/app.js`
  - Replace `profileRouteConfig("settings")` and `profileRouteConfig("security")` placeholder output with dedicated route rendering.
  - Add event delegation or explicit listeners for settings/security controls.
  - Add real local interactions for preference changes and local data clearing.
  - Add auth/session status rendering via existing Supabase helper functions.

- Create: `src/lib/app-settings.ts`
  - Own default app settings, localStorage read/write/reset, and validation.
  - Expose a small API consumed by `src/app.js`.

- Modify: `src/lib/user-library.ts`
  - Add safe helpers for current auth/session state and sign out.
  - Add local clear helpers for favorites, history, and downloads.
  - Do not add service-role or admin-only behavior.

- Modify: `src/styles.css`
  - Add reusable profile route page styles: section groups, rows, toggles, segmented controls, disabled states, danger rows, status badges, and confirmation affordances.
  - Keep visual language consistent with current profile cards, bottom nav, and detail route.

- No schema change required for this phase.
  - Existing `public.user_settings` table can support future cloud settings sync.
  - Current phase stores settings locally and shows cloud sync as login-gated.

- Optional later file after implementation stabilizes: `docs/PROFILE_SETTINGS_SECURITY.md`
  - Not required for this phase unless product documentation is requested.

## Route Design

The project does not use a framework router. Profile sub-pages already use an in-app overlay route:

- Trigger: profile menu row with `data-profile-panel="settings"` or `data-profile-panel="security"`.
- Entry: `openProfileRoute(panel)` in `src/app.js`.
- Container: existing `#profileRouteDrawer`.
- Animation: existing right-to-left overlay motion.
- Exit: existing `#profileRouteClose` and `closeProfileRoute()`.

Planned route behavior:

- `settings`
  - `nodes.profileRouteTitle.textContent = "设置"`.
  - Render a full settings page into `nodes.profileRouteMain`.
  - Keep overlay mounted while toggles/selectors change.
  - Changes save immediately and update the route UI in place.

- `security`
  - `nodes.profileRouteTitle.textContent = "安全中心"`.
  - Render a full security page into `nodes.profileRouteMain`.
  - Account-related rows show enabled or disabled state based on Supabase session.
  - Local privacy actions are available regardless of login state.

No URL hash or browser-history route is required in this phase. This preserves the existing mobile app style and avoids browser back-stack inconsistencies in Capacitor.

## Component Split Plan

Because the app is vanilla DOM, components are renderer functions and data helpers rather than React/Vue components.

### Data Unit: `src/lib/app-settings.ts`

Responsibilities:

- Define `AppSettings`.
- Define `defaultAppSettings`.
- Read settings from `localStorage`.
- Merge corrupted or partial settings with defaults.
- Save settings to `localStorage`.
- Reset settings.
- Export option metadata for UI labels.

Public API:

- `readAppSettings(): AppSettings`
- `saveAppSettings(settings: AppSettings): AppSettings`
- `updateAppSettings(patch: Partial<AppSettings>): AppSettings`
- `resetAppSettings(): AppSettings`
- `appSettingsKey: "artArchive:settings"`

### Data Unit: `src/lib/user-library.ts`

Add responsibilities:

- Return current auth user summary without throwing when unauthenticated.
- Sign out if a session exists.
- Clear local favorites/history/downloads.

Public additions:

- `currentUserSummary(): Promise<{ id: string; email: string | null; phone: string | null } | null>`
- `signOutCurrentUser(): Promise<void>`
- `clearLocalFavorites(): void`
- `clearLocalHistory(): void`
- `clearLocalDownloads(): void`

### UI Unit: `src/app.js`

Keep DOM rendering here for this phase to avoid a large migration:

- `renderSettingsRoute()`
- `renderSecurityRoute()`
- `settingsRouteHtml(settings)`
- `securityRouteHtml(authSummary)`
- `bindSettingsRouteEvents()`
- `bindSecurityRouteEvents()`
- `confirmDestructiveAction(message, action)`

This is intentionally pragmatic. The file is already large, but splitting renderers into new UI modules would require moving many shared helpers (`escapeHtml`, route nodes, render refresh). That can happen later as a focused refactor.

## Settings Page Functional Modules

### 1. Page Header Summary

Purpose:

- Replace the current placeholder card with a concise product-level summary.

Structure:

- Eyebrow: `应用偏好`
- Title: `设置`
- Copy: `管理阅读体验、下载画质、缓存与数据同步。`

Real interaction: none.

### 2. Display and Reading

Rows:

- `主题`
  - Control: segmented control with `跟随系统 / 浅色 / 深色`.
  - Current phase: real setting saved locally; only `浅色` affects current visual state unless dark theme CSS is implemented in the same task. `深色` can save but display a “即将支持完整深色主题” note.

- `字体大小`
  - Control: segmented control with `小 / 标准 / 大`.
  - Real interaction: add root class or dataset such as `document.documentElement.dataset.fontSize`.
  - Applies to readable text areas such as detail description and profile route body.

- `动画效果`
  - Control: segmented control with `完整 / 减弱`.
  - Real interaction: add root class or dataset such as `document.documentElement.dataset.motion`.
  - CSS can reduce route transition durations and loading animation intensity.

### 3. Downloads

Rows:

- `默认下载画质`
  - Control: segmented control with `标准 / 高清 / 原图优先`.
  - Real interaction: save local preference.
  - Does not alter download behavior until download flow is implemented.

- `下载前确认`
  - Control: switch.
  - Real interaction: save local preference.

- `保存下载记录`
  - Control: switch.
  - Real interaction: save local preference.
  - Current app already has `artArchive:downloads` local storage but no full download manager behavior.

### 4. Data and Cache

Rows:

- `清除浏览历史`
  - Real interaction: clear `artArchive:history`, update state/history count, re-render profile.
  - Confirmation required.

- `清除本机收藏`
  - Real interaction: clear `artArchive:favorites`, update state/favorite count, re-render profile.
  - Confirmation required because data loss is user-visible.

- `清除下载记录`
  - Real interaction: clear `artArchive:downloads`, update state/download count.
  - Confirmation required.

- `重置应用偏好`
  - Real interaction: reset `artArchive:settings` to defaults.
  - Confirmation required.

Do not claim to clear browser HTTP image cache. Browser cache and WebView cache are not reliably controlled from the frontend.

### 5. Sync and Account

Rows:

- `收藏同步`
  - Logged out: disabled, text `未登录，仅保存在本机`.
  - Logged in: enabled status row, text `已登录后自动同步收藏变更`.

- `浏览历史同步`
  - Logged out: disabled, text `未登录，仅保存在本机`.
  - Logged in: enabled status row, text `已登录后自动同步浏览记录`.

- `云端设置同步`
  - Static UI placeholder in this phase.
  - Reason: `user_settings` exists, but no complete login/settings sync flow is wired yet.

### 6. About

Rows:

- `版本`
  - Real value: `0.1.0`, from current hard-coded profile copy or `package.json` if later exposed.

- `数据来源`
  - Static info: Supabase, Artvee, Art Institute of Chicago, public/open artwork data.

- `隐私政策`
  - Static placeholder row.

- `用户协议`
  - Static placeholder row.

## Security Center Functional Modules

### 1. Security Status Summary

Purpose:

- Replace the placeholder card with actual current account status.

States:

- Logged out:
  - Eyebrow: `账号状态`
  - Title: `未登录`
  - Copy: `收藏和浏览历史会保存在本机。登录功能完善后，可同步到云端。`

- Logged in:
  - Eyebrow: `账号状态`
  - Title: `已登录`
  - Copy: show masked email or phone when available.

Real interaction:

- Read via Supabase `auth.getUser()` or helper wrapper.

### 2. Account Bindings

Rows:

- `邮箱`
  - Logged in with email: show email.
  - Logged out or missing: show `未绑定`.
  - Action: placeholder `更换邮箱` disabled or opens static explanation.

- `手机号`
  - Current phase: `未配置`.
  - Action: placeholder `绑定手机号` disabled.
  - Reason: project has not implemented Supabase phone OTP flow.

### 3. Login and Devices

Rows:

- `当前设备`
  - Real local display: `本机设备`.
  - No actual device fingerprinting.

- `登录设备管理`
  - Static placeholder.
  - Reason: Supabase client does not expose safe frontend device-management controls for all sessions.

- `登录记录`
  - Static placeholder.
  - Reason: no `security_events` table or Edge Function exists.

### 4. Local Privacy

Rows:

- `清除本机浏览历史`
  - Real interaction: clear local history.
  - Confirmation required.

- `清除本机收藏`
  - Real interaction: clear local favorites.
  - Confirmation required.

- `清除本机下载记录`
  - Real interaction: clear local downloads.
  - Confirmation required.

These duplicate settings data controls intentionally because Security Center is also where users expect privacy-sensitive cleanup.

### 5. Account Actions

Rows:

- `退出登录`
  - Real interaction if Supabase session exists: call `supabase.auth.signOut()`, then re-render security/profile.
  - Logged out: disabled or show `当前未登录`.

- `修改密码`
  - Static placeholder.
  - Reason: requires email flow and auth UI.

- `两步验证`
  - Static placeholder.
  - Reason: not currently implemented.

- `注销账号`
  - Static dangerous placeholder.
  - Reason: account deletion must not be done with frontend publishable key; requires secure backend/Admin API or Edge Function.

## Data Structures

### `AppSettings`

Use localStorage key: `artArchive:settings`.

Shape:

```ts
export type AppTheme = "system" | "light" | "dark";
export type AppFontSize = "small" | "medium" | "large";
export type AppMotion = "full" | "reduced";
export type DownloadQuality = "standard" | "high" | "original";

export type AppSettings = {
  theme: AppTheme;
  fontSize: AppFontSize;
  motion: AppMotion;
  downloadQuality: DownloadQuality;
  confirmBeforeDownload: boolean;
  saveDownloadHistory: boolean;
  syncFavorites: boolean;
  syncHistory: boolean;
};
```

Default:

```ts
export const defaultAppSettings: AppSettings = {
  theme: "system",
  fontSize: "medium",
  motion: "full",
  downloadQuality: "high",
  confirmBeforeDownload: true,
  saveDownloadHistory: true,
  syncFavorites: true,
  syncHistory: true,
};
```

### Local Library Keys

Existing:

- `artArchive:favorites`: array of artwork IDs.
- `artArchive:history`: array of artwork IDs, max 50.
- `artArchive:downloads`: array of local download record objects.

New:

- `artArchive:settings`: `AppSettings`.

## Supabase Requirements

Existing relevant tables:

- `public.user_favorites`
- `public.user_browsing_history`
- `public.user_downloads`
- `public.user_settings`

No SQL migration is required for this implementation phase.

Allowed current usage:

- `supabase.auth.getUser()` or `getSession()` for read-only login state.
- `supabase.auth.signOut()` for logout when logged in.
- Existing favorite/history sync helpers.

Not implemented in this phase:

- Writing `user_settings` to Supabase.
- Changing email.
- Binding or changing phone.
- Listing devices/sessions.
- Security logs.
- Password reset/change UI.
- Account deletion.

Future backend needs:

- Supabase Auth login/register UI.
- Optional `profiles` table:
  - `user_id uuid primary key references auth.users(id)`
  - `nickname text`
  - `avatar_url text`
  - `phone_masked text`
  - `created_at timestamptz`
  - `updated_at timestamptz`
- Optional `security_events` table or Edge Function for login/security history.
- Edge Function or server-side endpoint for account deletion. Do not use service role keys in frontend code.

## Static UI vs Real Interactions

### Real Interactions in This Phase

- Settings page:
  - Save theme preference locally.
  - Save font size preference locally and apply root dataset/class.
  - Save motion preference locally and apply root dataset/class.
  - Save download quality preference locally.
  - Toggle download confirmation locally.
  - Toggle save download record preference locally.
  - Clear browsing history after confirmation.
  - Clear local favorites after confirmation.
  - Clear download records after confirmation.
  - Reset app preferences after confirmation.
  - Show version/data source info.

- Security Center:
  - Read Supabase auth user/session state.
  - Show logged-out/logged-in status.
  - Show user email when available.
  - Sign out when session exists.
  - Clear local history/favorites/download records after confirmation.

### Static UI Placeholders in This Phase

- Full dark theme visual implementation if not completed alongside settings.
- Cloud settings sync.
- Bind/change email.
- Bind/change phone.
- Login device list.
- Kick out other devices.
- Login/security logs.
- Change password.
- Two-step verification.
- Account deletion.
- Privacy policy and user agreement detail pages.

## Task 1: Add Local Settings Data Layer

**Files:**

- Create: `src/lib/app-settings.ts`
- Modify: none

- [ ] **Step 1: Create the settings type and defaults**

Create `src/lib/app-settings.ts` with:

```ts
export const appSettingsKey = "artArchive:settings";

export type AppTheme = "system" | "light" | "dark";
export type AppFontSize = "small" | "medium" | "large";
export type AppMotion = "full" | "reduced";
export type DownloadQuality = "standard" | "high" | "original";

export type AppSettings = {
  theme: AppTheme;
  fontSize: AppFontSize;
  motion: AppMotion;
  downloadQuality: DownloadQuality;
  confirmBeforeDownload: boolean;
  saveDownloadHistory: boolean;
  syncFavorites: boolean;
  syncHistory: boolean;
};

export const defaultAppSettings: AppSettings = {
  theme: "system",
  fontSize: "medium",
  motion: "full",
  downloadQuality: "high",
  confirmBeforeDownload: true,
  saveDownloadHistory: true,
  syncFavorites: true,
  syncHistory: true,
};
```

- [ ] **Step 2: Add validation and persistence helpers**

Append to `src/lib/app-settings.ts`:

```ts
const themes: AppTheme[] = ["system", "light", "dark"];
const fontSizes: AppFontSize[] = ["small", "medium", "large"];
const motions: AppMotion[] = ["full", "reduced"];
const qualities: DownloadQuality[] = ["standard", "high", "original"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeSettings(value: unknown): AppSettings {
  if (!isRecord(value)) return defaultAppSettings;

  return {
    theme: themes.includes(value.theme as AppTheme) ? (value.theme as AppTheme) : defaultAppSettings.theme,
    fontSize: fontSizes.includes(value.fontSize as AppFontSize)
      ? (value.fontSize as AppFontSize)
      : defaultAppSettings.fontSize,
    motion: motions.includes(value.motion as AppMotion) ? (value.motion as AppMotion) : defaultAppSettings.motion,
    downloadQuality: qualities.includes(value.downloadQuality as DownloadQuality)
      ? (value.downloadQuality as DownloadQuality)
      : defaultAppSettings.downloadQuality,
    confirmBeforeDownload:
      typeof value.confirmBeforeDownload === "boolean"
        ? value.confirmBeforeDownload
        : defaultAppSettings.confirmBeforeDownload,
    saveDownloadHistory:
      typeof value.saveDownloadHistory === "boolean" ? value.saveDownloadHistory : defaultAppSettings.saveDownloadHistory,
    syncFavorites: typeof value.syncFavorites === "boolean" ? value.syncFavorites : defaultAppSettings.syncFavorites,
    syncHistory: typeof value.syncHistory === "boolean" ? value.syncHistory : defaultAppSettings.syncHistory,
  };
}

export function readAppSettings(): AppSettings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(appSettingsKey) || "null"));
  } catch {
    return defaultAppSettings;
  }
}

export function saveAppSettings(settings: AppSettings): AppSettings {
  const normalized = normalizeSettings(settings);
  localStorage.setItem(appSettingsKey, JSON.stringify(normalized));
  return normalized;
}

export function updateAppSettings(patch: Partial<AppSettings>): AppSettings {
  return saveAppSettings({ ...readAppSettings(), ...patch });
}

export function resetAppSettings(): AppSettings {
  localStorage.setItem(appSettingsKey, JSON.stringify(defaultAppSettings));
  return defaultAppSettings;
}
```

- [ ] **Step 3: Run type check**

Run:

```powershell
npx.cmd tsc --noEmit
```

Expected: exit code `0`.

- [ ] **Step 4: Commit**

Run:

```powershell
git add src/lib/app-settings.ts
git commit -m "feat: add local app settings store"
```

## Task 2: Add User Library Helpers for Security and Local Privacy

**Files:**

- Modify: `src/lib/user-library.ts`

- [ ] **Step 1: Add auth summary and sign-out helpers**

Modify `src/lib/user-library.ts` by adding:

```ts
export type UserSummary = {
  id: string;
  email: string | null;
  phone: string | null;
};

export async function currentUserSummary(): Promise<UserSummary | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    phone: data.user.phone ?? null,
  };
}

export async function signOutCurrentUser(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}
```

- [ ] **Step 2: Add local clear helpers**

Append to `src/lib/user-library.ts`:

```ts
export function clearLocalFavorites(): void {
  localStorage.removeItem(favoriteKey);
}

export function clearLocalHistory(): void {
  localStorage.removeItem(historyKey);
}

export function clearLocalDownloads(): void {
  localStorage.removeItem("artArchive:downloads");
}
```

- [ ] **Step 3: Run type check**

Run:

```powershell
npx.cmd tsc --noEmit
```

Expected: exit code `0`.

- [ ] **Step 4: Commit**

Run:

```powershell
git add src/lib/user-library.ts
git commit -m "feat: add profile privacy helpers"
```

## Task 3: Wire Settings State into App Initialization

**Files:**

- Modify: `src/app.js`
- Modify: `src/styles.css`

- [ ] **Step 1: Import settings helpers and user-library additions**

Update imports in `src/app.js`:

```js
import {
  readAppSettings,
  resetAppSettings,
  updateAppSettings,
} from "./lib/app-settings.ts";
import {
  clearLocalDownloads,
  clearLocalFavorites,
  clearLocalHistory,
  currentUserSummary,
  localFavoriteIds,
  localHistoryIds,
  recordRemoteHistory,
  saveLocalFavoriteIds,
  saveLocalHistoryIds,
  signOutCurrentUser,
  syncFavorite,
} from "./lib/user-library.ts";
```

- [ ] **Step 2: Extend app state**

Add fields to the `state` object:

```js
settings: readAppSettings(),
authSummary: null,
authLoaded: false,
routeMessage: "",
```

- [ ] **Step 3: Add preference application function**

Add to `src/app.js` near state helpers:

```js
function applyAppSettings() {
  document.documentElement.dataset.theme = state.settings.theme;
  document.documentElement.dataset.fontSize = state.settings.fontSize;
  document.documentElement.dataset.motion = state.settings.motion;
}
```

Call `applyAppSettings()` once after `state` is created and whenever settings change.

- [ ] **Step 4: Add CSS hooks**

Add to `src/styles.css`:

```css
:root[data-font-size="small"] {
  --profile-body-scale: 0.94;
}

:root[data-font-size="medium"] {
  --profile-body-scale: 1;
}

:root[data-font-size="large"] {
  --profile-body-scale: 1.08;
}

:root[data-motion="reduced"] .profile-route-drawer,
:root[data-motion="reduced"] .detail-page,
:root[data-motion="reduced"] .drawer-card,
:root[data-motion="reduced"] .loading-image {
  animation-duration: 0.01ms !important;
  transition-duration: 80ms !important;
}

.profile-route-main {
  font-size: calc(1rem * var(--profile-body-scale, 1));
}
```

- [ ] **Step 5: Run checks**

Run:

```powershell
npm.cmd run check
npx.cmd tsc --noEmit
```

Expected: both exit code `0`.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/app.js src/styles.css
git commit -m "feat: apply profile settings preferences"
```

## Task 4: Implement Settings Route UI and Interactions

**Files:**

- Modify: `src/app.js`
- Modify: `src/styles.css`

- [ ] **Step 1: Add reusable UI helpers**

Add helpers to `src/app.js`:

```js
function checkedText(value) {
  return value ? "开启" : "关闭";
}

function settingSelected(current, value) {
  return current === value ? "true" : "false";
}

function profileStatusBadge(text, tone = "neutral") {
  return `<span class="profile-status-badge" data-tone="${escapeHtml(tone)}">${escapeHtml(text)}</span>`;
}
```

- [ ] **Step 2: Add settings route HTML renderer**

Add `settingsRouteHtml()` to `src/app.js`:

```js
function settingsRouteHtml() {
  const settings = state.settings;
  const loggedIn = Boolean(state.authSummary);

  return `
    <section class="profile-route-page settings-route">
      <section class="profile-route-hero">
        <p>应用偏好</p>
        <h1>设置</h1>
        <div>管理阅读体验、下载画质、缓存与数据同步。</div>
      </section>

      <section class="profile-setting-group">
        <h2>显示与阅读</h2>
        <div class="profile-setting-row">
          <div><strong>主题</strong><span>当前完整视觉以浅色为主</span></div>
          <div class="profile-segmented" data-setting="theme">
            <button type="button" data-value="system" aria-pressed="${settingSelected(settings.theme, "system")}">跟随系统</button>
            <button type="button" data-value="light" aria-pressed="${settingSelected(settings.theme, "light")}">浅色</button>
            <button type="button" data-value="dark" aria-pressed="${settingSelected(settings.theme, "dark")}">深色</button>
          </div>
        </div>
        <div class="profile-setting-row">
          <div><strong>字体大小</strong><span>影响详情页和个人页正文</span></div>
          <div class="profile-segmented" data-setting="fontSize">
            <button type="button" data-value="small" aria-pressed="${settingSelected(settings.fontSize, "small")}">小</button>
            <button type="button" data-value="medium" aria-pressed="${settingSelected(settings.fontSize, "medium")}">标准</button>
            <button type="button" data-value="large" aria-pressed="${settingSelected(settings.fontSize, "large")}">大</button>
          </div>
        </div>
        <div class="profile-setting-row">
          <div><strong>动画效果</strong><span>可降低页面动效强度</span></div>
          <div class="profile-segmented" data-setting="motion">
            <button type="button" data-value="full" aria-pressed="${settingSelected(settings.motion, "full")}">完整</button>
            <button type="button" data-value="reduced" aria-pressed="${settingSelected(settings.motion, "reduced")}">减弱</button>
          </div>
        </div>
      </section>

      <section class="profile-setting-group">
        <h2>下载</h2>
        <div class="profile-setting-row">
          <div><strong>默认下载画质</strong><span>下载功能完善后使用该偏好</span></div>
          <div class="profile-segmented" data-setting="downloadQuality">
            <button type="button" data-value="standard" aria-pressed="${settingSelected(settings.downloadQuality, "standard")}">标准</button>
            <button type="button" data-value="high" aria-pressed="${settingSelected(settings.downloadQuality, "high")}">高清</button>
            <button type="button" data-value="original" aria-pressed="${settingSelected(settings.downloadQuality, "original")}">原图优先</button>
          </div>
        </div>
        <button class="profile-setting-row profile-switch-row" type="button" data-toggle-setting="confirmBeforeDownload" aria-pressed="${String(settings.confirmBeforeDownload)}">
          <div><strong>下载前确认</strong><span>${checkedText(settings.confirmBeforeDownload)}</span></div>
          <span class="profile-switch" aria-hidden="true"></span>
        </button>
        <button class="profile-setting-row profile-switch-row" type="button" data-toggle-setting="saveDownloadHistory" aria-pressed="${String(settings.saveDownloadHistory)}">
          <div><strong>保存下载记录</strong><span>${checkedText(settings.saveDownloadHistory)}</span></div>
          <span class="profile-switch" aria-hidden="true"></span>
        </button>
      </section>

      <section class="profile-setting-group">
        <h2>数据与缓存</h2>
        <button class="profile-setting-row" type="button" data-local-action="clearHistory"><div><strong>清除浏览历史</strong><span>${state.history.length} 条本机记录</span></div></button>
        <button class="profile-setting-row" type="button" data-local-action="clearFavorites"><div><strong>清除本机收藏</strong><span>${state.favorites.size} 件作品</span></div></button>
        <button class="profile-setting-row" type="button" data-local-action="clearDownloads"><div><strong>清除下载记录</strong><span>${Array.isArray(state.downloads) ? state.downloads.length : 0} 个文件</span></div></button>
        <button class="profile-setting-row" type="button" data-local-action="resetSettings"><div><strong>重置应用偏好</strong><span>恢复默认设置</span></div></button>
      </section>

      <section class="profile-setting-group">
        <h2>数据同步</h2>
        <div class="profile-setting-row"><div><strong>收藏同步</strong><span>${loggedIn ? "已登录后自动同步收藏变更" : "未登录，仅保存在本机"}</span></div>${profileStatusBadge(loggedIn ? "可用" : "未登录", loggedIn ? "ok" : "muted")}</div>
        <div class="profile-setting-row"><div><strong>浏览历史同步</strong><span>${loggedIn ? "已登录后自动同步浏览记录" : "未登录，仅保存在本机"}</span></div>${profileStatusBadge(loggedIn ? "可用" : "未登录", loggedIn ? "ok" : "muted")}</div>
        <div class="profile-setting-row is-disabled"><div><strong>云端设置同步</strong><span>已有 user_settings 表，完整登录流程完成后启用</span></div>${profileStatusBadge("占位", "muted")}</div>
      </section>

      <section class="profile-setting-group">
        <h2>关于</h2>
        <div class="profile-setting-row"><div><strong>版本</strong><span>0.1.0</span></div></div>
        <div class="profile-setting-row"><div><strong>数据来源</strong><span>Supabase、Artvee、芝加哥艺术博物馆等公开资料</span></div></div>
        <div class="profile-setting-row is-disabled"><div><strong>隐私政策</strong><span>App Store / Google Play 上线前补齐</span></div>${profileStatusBadge("占位", "muted")}</div>
        <div class="profile-setting-row is-disabled"><div><strong>用户协议</strong><span>上线前补齐</span></div>${profileStatusBadge("占位", "muted")}</div>
      </section>
    </section>
  `;
}
```

- [ ] **Step 3: Add settings event binding**

Add `bindSettingsRouteEvents()`:

```js
function bindSettingsRouteEvents() {
  nodes.profileRouteMain.querySelectorAll("[data-setting]").forEach((group) => {
    group.querySelectorAll("button[data-value]").forEach((button) => {
      button.addEventListener("click", () => {
        const key = group.dataset.setting;
        state.settings = updateAppSettings({ [key]: button.dataset.value });
        applyAppSettings();
        renderSettingsRoute();
      });
    });
  });

  nodes.profileRouteMain.querySelectorAll("[data-toggle-setting]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.toggleSetting;
      state.settings = updateAppSettings({ [key]: !state.settings[key] });
      applyAppSettings();
      renderSettingsRoute();
    });
  });

  nodes.profileRouteMain.querySelectorAll("[data-local-action]").forEach((button) => {
    button.addEventListener("click", () => runLocalDataAction(button.dataset.localAction));
  });
}
```

- [ ] **Step 4: Add local data actions**

Add `runLocalDataAction()`:

```js
function runLocalDataAction(action) {
  const messages = {
    clearHistory: "确认清除本机浏览历史？",
    clearFavorites: "确认清除本机收藏？",
    clearDownloads: "确认清除下载记录？",
    resetSettings: "确认恢复默认设置？",
  };

  if (!window.confirm(messages[action] || "确认执行该操作？")) return;

  if (action === "clearHistory") {
    clearLocalHistory();
    state.history = [];
  }

  if (action === "clearFavorites") {
    clearLocalFavorites();
    state.favorites = new Set();
  }

  if (action === "clearDownloads") {
    clearLocalDownloads();
    state.downloads = [];
  }

  if (action === "resetSettings") {
    state.settings = resetAppSettings();
    applyAppSettings();
  }

  renderProfile();
  renderSettingsRoute();
}
```

- [ ] **Step 5: Add `renderSettingsRoute()`**

Add:

```js
function renderSettingsRoute() {
  nodes.profileRouteTitle.textContent = "设置";
  nodes.profileRouteMain.innerHTML = settingsRouteHtml();
  bindSettingsRouteEvents();
}
```

- [ ] **Step 6: Route settings panel to dedicated renderer**

Modify `openProfileRoute(panel)`:

```js
if (panel === "settings") {
  window.clearTimeout(profileRouteCloseTimer);
  renderSettingsRoute();
  nodes.profileRoute.dataset.mounted = "true";
  requestAnimationFrame(() => {
    nodes.profileRoute.setAttribute("aria-hidden", "false");
  });
  document.body.classList.add("profile-route-open");
  return;
}
```

Place this before the generic `profileRouteConfig(panel)` branch.

- [ ] **Step 7: Add CSS for settings route**

Add to `src/styles.css`:

```css
.profile-route-page {
  display: grid;
  gap: 20px;
  padding: 24px 20px 110px;
}

.profile-route-hero,
.profile-setting-group {
  border-radius: 8px;
  background: #fff;
}

.profile-route-hero {
  padding: 28px 24px;
  text-align: center;
}

.profile-route-hero p,
.profile-route-hero div {
  margin: 0;
  color: #8c8c8c;
  line-height: 1.65;
}

.profile-route-hero h1 {
  margin: 10px 0 12px;
  color: #0f1720;
  font-size: 28px;
  line-height: 1.2;
}

.profile-setting-group {
  overflow: hidden;
  box-shadow: 0 6px 16px rgba(31, 35, 40, 0.05);
}

.profile-setting-group h2 {
  margin: 0;
  padding: 18px 20px 8px;
  font-size: 18px;
  line-height: 1.35;
}

.profile-setting-row {
  display: flex;
  width: 100%;
  min-height: 64px;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border: 0;
  border-top: 1px solid #f1f1ef;
  padding: 14px 20px;
  color: #111827;
  background: #fff;
  text-align: left;
}

.profile-setting-row strong {
  display: block;
  font-size: 15px;
  line-height: 1.4;
}

.profile-setting-row span {
  display: block;
  margin-top: 4px;
  color: #7d858c;
  font-size: 12px;
  line-height: 1.45;
}

.profile-setting-row.is-disabled {
  color: #9aa1a8;
}

.profile-segmented {
  display: inline-flex;
  flex-shrink: 0;
  gap: 4px;
  padding: 4px;
  border-radius: 999px;
  background: #f5f5f4;
}

.profile-segmented button {
  min-width: 46px;
  border: 0;
  border-radius: 999px;
  padding: 7px 10px;
  color: #59616a;
  background: transparent;
  font-size: 12px;
  font-weight: 700;
}

.profile-segmented button[aria-pressed="true"] {
  color: #fff;
  background: #0f1720;
}

.profile-switch {
  position: relative;
  width: 46px;
  height: 28px;
  border-radius: 999px;
  background: #d9dde1;
}

.profile-switch::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #fff;
  transition: transform 180ms ease;
}

.profile-switch-row[aria-pressed="true"] .profile-switch {
  background: #111827;
}

.profile-switch-row[aria-pressed="true"] .profile-switch::after {
  transform: translateX(18px);
}

.profile-status-badge {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 6px 10px;
  background: #f5f5f4;
  color: #7d858c;
  font-size: 12px;
  font-weight: 700;
}

.profile-status-badge[data-tone="ok"] {
  background: #eef7f0;
  color: #257144;
}
```

- [ ] **Step 8: Run checks and build**

Run:

```powershell
npm.cmd run check
npx.cmd tsc --noEmit
npm.cmd run build
```

Expected: all exit code `0`. If build fails with `EPERM` on `dist/assets`, rerun `npm.cmd run build` with elevated permissions; that is a Windows file lock issue, not a code failure.

- [ ] **Step 9: Commit**

Run:

```powershell
git add src/app.js src/styles.css
git commit -m "feat: implement settings profile route"
```

## Task 5: Implement Security Center Route UI and Interactions

**Files:**

- Modify: `src/app.js`
- Modify: `src/styles.css`

- [ ] **Step 1: Add auth loading helper**

Add:

```js
async function loadAuthSummary() {
  state.authLoaded = false;
  try {
    state.authSummary = await currentUserSummary();
  } catch (error) {
    console.warn("Auth summary failed", error);
    state.authSummary = null;
  } finally {
    state.authLoaded = true;
  }
}
```

Call `loadAuthSummary()` during startup after `render()` and before/alongside `loadPaintings()`, without blocking artwork rendering:

```js
loadAuthSummary().then(() => {
  if (nodes.profileRoute?.getAttribute("aria-hidden") === "false") {
    renderSecurityRoute();
  }
  renderProfile();
});
```

- [ ] **Step 2: Add masking helper**

Add:

```js
function accountLabel() {
  if (!state.authSummary) return "未登录";
  return state.authSummary.email || state.authSummary.phone || "已登录账号";
}
```

- [ ] **Step 3: Add security route HTML renderer**

Add:

```js
function securityRouteHtml() {
  const loggedIn = Boolean(state.authSummary);
  const account = accountLabel();

  return `
    <section class="profile-route-page security-route">
      <section class="profile-route-hero">
        <p>账号状态</p>
        <h1>${loggedIn ? "已登录" : "未登录"}</h1>
        <div>${loggedIn ? escapeHtml(account) : "收藏和浏览历史会保存在本机。登录功能完善后，可同步到云端。"}</div>
      </section>

      <section class="profile-setting-group">
        <h2>绑定方式</h2>
        <div class="profile-setting-row">
          <div><strong>邮箱</strong><span>${loggedIn && state.authSummary?.email ? escapeHtml(state.authSummary.email) : "未绑定或未登录"}</span></div>
          ${profileStatusBadge(loggedIn && state.authSummary?.email ? "已绑定" : "未配置", loggedIn && state.authSummary?.email ? "ok" : "muted")}
        </div>
        <div class="profile-setting-row is-disabled">
          <div><strong>更换邮箱</strong><span>需要完整 Supabase Auth 邮件确认流程</span></div>
          ${profileStatusBadge("占位", "muted")}
        </div>
        <div class="profile-setting-row is-disabled">
          <div><strong>手机号</strong><span>项目尚未接入 phone OTP</span></div>
          ${profileStatusBadge("占位", "muted")}
        </div>
      </section>

      <section class="profile-setting-group">
        <h2>登录与设备</h2>
        <div class="profile-setting-row"><div><strong>当前设备</strong><span>本机设备</span></div>${profileStatusBadge("当前", "ok")}</div>
        <div class="profile-setting-row is-disabled"><div><strong>登录设备管理</strong><span>需要后端会话管理能力</span></div>${profileStatusBadge("占位", "muted")}</div>
        <div class="profile-setting-row is-disabled"><div><strong>登录记录</strong><span>需要 security_events 表或 Edge Function</span></div>${profileStatusBadge("占位", "muted")}</div>
      </section>

      <section class="profile-setting-group">
        <h2>本机隐私</h2>
        <button class="profile-setting-row" type="button" data-local-action="clearHistory"><div><strong>清除本机浏览历史</strong><span>${state.history.length} 条本机记录</span></div></button>
        <button class="profile-setting-row" type="button" data-local-action="clearFavorites"><div><strong>清除本机收藏</strong><span>${state.favorites.size} 件作品</span></div></button>
        <button class="profile-setting-row" type="button" data-local-action="clearDownloads"><div><strong>清除本机下载记录</strong><span>${Array.isArray(state.downloads) ? state.downloads.length : 0} 个文件</span></div></button>
      </section>

      <section class="profile-setting-group">
        <h2>账号操作</h2>
        <button class="profile-setting-row" type="button" data-security-action="signOut" ${loggedIn ? "" : "disabled"}>
          <div><strong>退出登录</strong><span>${loggedIn ? "退出当前 Supabase 会话" : "当前未登录"}</span></div>
        </button>
        <div class="profile-setting-row is-disabled"><div><strong>修改密码</strong><span>需要登录和邮件验证流程</span></div>${profileStatusBadge("占位", "muted")}</div>
        <div class="profile-setting-row is-disabled"><div><strong>两步验证</strong><span>当前阶段不启用</span></div>${profileStatusBadge("占位", "muted")}</div>
        <div class="profile-setting-row is-disabled profile-danger-row"><div><strong>注销账号</strong><span>需要安全后端或 Edge Function，不能在前端直接执行</span></div>${profileStatusBadge("占位", "muted")}</div>
      </section>
    </section>
  `;
}
```

- [ ] **Step 4: Add security route renderer and binding**

Add:

```js
function renderSecurityRoute() {
  nodes.profileRouteTitle.textContent = "安全中心";
  nodes.profileRouteMain.innerHTML = securityRouteHtml();
  nodes.profileRouteMain.querySelectorAll("[data-local-action]").forEach((button) => {
    button.addEventListener("click", () => runLocalDataAction(button.dataset.localAction));
  });
  nodes.profileRouteMain.querySelector("[data-security-action='signOut']")?.addEventListener("click", async () => {
    if (!window.confirm("确认退出当前账号？")) return;
    try {
      await signOutCurrentUser();
      state.authSummary = null;
      renderSecurityRoute();
      renderProfile();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "退出登录失败");
    }
  });
}
```

- [ ] **Step 5: Route security panel to dedicated renderer**

Modify `openProfileRoute(panel)`:

```js
if (panel === "security") {
  window.clearTimeout(profileRouteCloseTimer);
  renderSecurityRoute();
  nodes.profileRoute.dataset.mounted = "true";
  requestAnimationFrame(() => {
    nodes.profileRoute.setAttribute("aria-hidden", "false");
  });
  document.body.classList.add("profile-route-open");
  return;
}
```

Place this before generic `profileRouteConfig(panel)`.

- [ ] **Step 6: Add security-specific CSS**

Add to `src/styles.css`:

```css
.profile-danger-row strong {
  color: #b42318;
}

.profile-setting-row:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
```

- [ ] **Step 7: Run checks and build**

Run:

```powershell
npm.cmd run check
npx.cmd tsc --noEmit
npm.cmd run build
```

Expected: all exit code `0`.

- [ ] **Step 8: Commit**

Run:

```powershell
git add src/app.js src/styles.css
git commit -m "feat: implement security center route"
```

## Task 6: Manual Verification in Codex Preview

**Files:**

- No code changes unless verification finds defects.

- [ ] **Step 1: Build and sync**

Run:

```powershell
npm.cmd run build
npx.cmd cap sync android
```

Expected: both exit code `0`.

- [ ] **Step 2: Start stable static preview**

Use the stable preview pattern already proven in this workspace:

```powershell
$env:PORT="4174"
D:\node\node.exe D:\art\server.mjs D:\art\dist
```

Expected: output includes `Art Archive is running at http://localhost:4174`.

- [ ] **Step 3: Open Codex internal preview**

Open:

```text
http://127.0.0.1:4174/?v=profile-settings-security
```

Expected:

- Home renders normally.
- Bottom nav works.
- Tapping `我的` opens profile page.
- Tapping `设置` opens a right-to-left route page titled `设置`.
- Tapping `安全中心` opens a right-to-left route page titled `安全中心`.

- [ ] **Step 4: Verify settings real interactions**

Expected:

- Changing `字体大小` updates route text size and persists after closing/reopening Settings.
- Changing `动画效果` updates `document.documentElement.dataset.motion`.
- Changing `默认下载画质` persists after route close/open.
- Toggling `下载前确认` persists.
- Toggling `保存下载记录` persists.
- `清除浏览历史` asks for confirmation and sets profile history count to `0`.
- `清除本机收藏` asks for confirmation and sets favorites count to `0`.
- `重置应用偏好` restores default selected controls.

- [ ] **Step 5: Verify security real interactions**

Expected when logged out:

- Security summary shows `未登录`.
- Email row says `未绑定或未登录`.
- Sign out row is disabled or says `当前未登录`.
- Device management, login records, password, 2FA, and account deletion appear as disabled/placeholders.
- Local privacy clear actions work with confirmation.

Expected when logged in, if a Supabase session is manually established in a later auth flow:

- Security summary shows `已登录`.
- Email row displays current email when Supabase returns one.
- Sign out calls Supabase and then returns to logged-out status.

- [ ] **Step 6: Regression checks**

Expected:

- Favorite button on artwork detail still updates profile favorite count.
- Browsing an artwork still adds to history.
- Category page still filters by tag.
- Existing profile routes `浏览历史`, `我的收藏`, and `下载管理` still open.
- Detail drawer and profile route overlays do not remain partially visible after closing.

## Risk Points and Mitigations

- Risk: `src/app.js` is large and already owns many responsibilities.
  - Mitigation: introduce only focused helper functions and a separate data module. Avoid broad UI refactor in this phase.

- Risk: current source file contains mojibake in some string literals.
  - Mitigation: new strings should be saved as valid UTF-8 Chinese. Do not rewrite unrelated existing text unless necessary.

- Risk: browser `confirm()` is visually basic.
  - Mitigation: acceptable for this phase. A custom app-style confirm sheet can be a later polish task.

- Risk: dark theme option may imply more than implemented.
  - Mitigation: label it as preference storage or show helper copy that full dark theme is being prepared unless full CSS is added.

- Risk: localStorage can contain malformed data.
  - Mitigation: `app-settings.ts` normalizes corrupted or partial settings to defaults.

- Risk: Supabase session may be absent for most testers.
  - Mitigation: all account-backed features must render meaningful logged-out states and not throw.

- Risk: account deletion and device management require privileged backend behavior.
  - Mitigation: keep them disabled placeholders and explicitly state backend requirements.

- Risk: Codex preview on port `4173` has old service worker/cache history.
  - Mitigation: use stable static preview on `4174` for verification until old origin is intentionally cleaned.

## Final Verification Checklist

Run before declaring complete:

```powershell
npm.cmd run check
npx.cmd tsc --noEmit
npm.cmd run build
npx.cmd cap sync android
```

Expected:

- All commands exit `0`.
- If `npm.cmd run build` fails with Windows `EPERM` against `dist/assets`, close running preview processes or rerun with elevated permissions, then confirm the build itself succeeds.

Manual Codex preview:

- Use `http://127.0.0.1:4174/?v=profile-settings-security`.
- Verify Settings and Security Center route entry/exit.
- Verify local interactions persist.
- Verify placeholder rows are disabled or clearly marked.

