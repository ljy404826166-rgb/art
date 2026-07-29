import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";

const requiredPublicEnv = ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
for (const key of requiredPublicEnv) {
  if (!process.env[key] && !process.env.CI) {
    console.warn(
      `Warning: ${key} is not set in the current shell. Vite will read .env.local at runtime.`,
    );
  }
}

const requiredFiles = [
  ".gitignore",
  "src/app.js",
  "src/lib/paintings.ts",
  "src/lib/supabase.ts",
  "src/lib/auth.ts",
  "src/lib/user-settings.ts",
  "src/lib/remote-user-profile.ts",
  "src/lib/artwork-search.ts",
  "src/lib/artwork-schema.ts",
  "src/lib/local-library-store.ts",
  "eslint.config.js",
  ".prettierrc.json",
  "vitest.config.ts",
  "playwright.config.ts",
  "tests/e2e/app-smoke.spec.ts",
  "supabase/app_user_data.sql",
];

for (const file of requiredFiles) {
  await access(new URL(`../${file}`, import.meta.url), constants.R_OK);
}

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const authSource = await readFile(new URL("../src/lib/auth.ts", import.meta.url), "utf8");
const viteConfigSource = await readFile(new URL("../vite.config.js", import.meta.url), "utf8");
const packageSource = await readFile(new URL("../package.json", import.meta.url), "utf8");
const packageJson = JSON.parse(packageSource);
const gitignoreSource = await readFile(new URL("../.gitignore", import.meta.url), "utf8");
const userSqlSource = await readFile(
  new URL("../supabase/app_user_data.sql", import.meta.url),
  "utf8",
);
const readmeSource = await readFile(new URL("../README.md", import.meta.url), "utf8");

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

const requiredGitignoreEntries = [".env.local", "node_modules/", "dist/", "csv/", "data/"];
for (const entry of requiredGitignoreEntries) {
  if (!gitignoreSource.includes(entry)) {
    throw new Error(`.gitignore must protect ${entry}`);
  }
}

const dependencies = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};
for (const dependency of [
  "openseadragon",
  "vite-plugin-pwa",
  "typescript",
  "minisearch",
  "zod",
  "dexie",
  "vitest",
  "@playwright/test",
  "eslint",
  "prettier",
]) {
  if (!dependencies[dependency]) {
    throw new Error(`Missing package dependency: ${dependency}`);
  }
}

for (const script of [
  "typecheck",
  "verify",
  "db:ingest:artvee",
  "test:unit",
  "test:e2e",
  "lint",
  "format:check",
]) {
  if (!packageJson.scripts?.[script]) {
    throw new Error(`Missing package script: ${script}`);
  }
}

if (!userSqlSource.includes("create table if not exists public.user_profiles")) {
  throw new Error("Missing Supabase user_profiles table definition.");
}

if (!viteConfigSource.includes("VitePWA") || !appSource.includes("registerSW")) {
  throw new Error("PWA plugin and app registration must stay wired.");
}

if (!appSource.includes('import("openseadragon")')) {
  throw new Error("OpenSeadragon must be dynamically imported for detail zoom.");
}

if (!appSource.includes("searchArtworks")) {
  throw new Error("MiniSearch-backed artwork search must stay wired.");
}

if (readmeSource.includes("db:ingest:artic") || readmeSource.includes("npx.cmd tsc --noEmit")) {
  throw new Error("README references stale verification or ingest commands.");
}

const miniappDisplayFiles = [
  "miniapp/components/artwork-image/artwork-image.js",
  "miniapp/components/artwork-image/artwork-image.wxml",
  "miniapp/components/artwork-card/artwork-card.js",
  "miniapp/components/artwork-card/artwork-card.wxml",
  "miniapp/pages/detail/detail.wxml",
];

for (const file of miniappDisplayFiles) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  if (source.includes("download_url") || source.includes("original_url")) {
    throw new Error(
      `Default miniapp display layer must not reference original/download images: ${file}`,
    );
  }
}

console.log(`Validated ${requiredFiles.length} app files and account-system markers.`);
