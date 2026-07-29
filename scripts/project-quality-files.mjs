import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const REPOSITORY_ROOT = fs.realpathSync(path.resolve(SCRIPT_DIR, ".."));

const ACTIVE_ROOTS = ["src", "miniapp", "scripts", "tests"];
const ROOT_CODE_FILES = [
  "eslint.config.js",
  "playwright.config.ts",
  "vite.config.js",
  "vitest.config.ts",
];
const IGNORED_DIRECTORIES = new Set([
  ".codex",
  ".git",
  ".idea",
  ".superpowers",
  ".worktrees",
  "backups",
  "csv",
  "data",
  "dist",
  "miniprogram",
  "node_modules",
  "outputs",
  "public",
  "recovery",
  "test-results",
  "tmp",
]);

function walkDirectory(directory, output) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(absolutePath, output);
    } else if (entry.isFile()) {
      output.push(absolutePath);
    }
  }
}

function toRepositoryRelative(absolutePath) {
  return path.relative(REPOSITORY_ROOT, absolutePath).replaceAll("\\", "/");
}

export function findActiveFiles(predicate) {
  const candidates = [];

  for (const rootName of ACTIVE_ROOTS) {
    const rootPath = path.join(REPOSITORY_ROOT, rootName);
    if (fs.existsSync(rootPath)) {
      walkDirectory(rootPath, candidates);
    }
  }

  for (const relativePath of ROOT_CODE_FILES) {
    const absolutePath = path.join(REPOSITORY_ROOT, relativePath);
    if (fs.existsSync(absolutePath)) {
      candidates.push(absolutePath);
    }
  }

  return candidates
    .map(toRepositoryRelative)
    .filter(predicate)
    .sort((left, right) => left.localeCompare(right, "en"));
}

export function findActiveJavaScriptFiles() {
  return findActiveFiles((file) => /\.(?:c|m)?js$/i.test(file));
}

export function findNodeTestFiles() {
  return findActiveFiles((file) => /\.test\.(?:c|m)?js$/i.test(file));
}
