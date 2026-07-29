import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPOSITORY_ROOT = fs.realpathSync(path.resolve(SCRIPT_DIR, ".."));

const MINIAPP_PROJECT_CONFIG = "miniapp/project.config.json";

function normalizeRelativeDirectory(value) {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.replaceAll("\\", "/");
  if (normalized === "./") {
    return normalized;
  }

  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function readJson(repositoryRoot, relativePath) {
  const absolutePath = path.join(repositoryRoot, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function addMismatch(errors, label, left, right) {
  if (left !== right) {
    errors.push(`${label}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`);
  }
}

export function validateProjectEntry(repositoryRoot = DEFAULT_REPOSITORY_ROOT) {
  const canonicalRoot = fs.realpathSync(repositoryRoot);
  const errors = [];
  const requiredFiles = [
    MINIAPP_PROJECT_CONFIG,
    "miniapp/app.json",
    "package.json",
    "vite.config.js",
  ];

  for (const relativePath of requiredFiles) {
    if (!fs.existsSync(path.join(canonicalRoot, relativePath))) {
      errors.push(`缺少入口文件：${relativePath}`);
    }
  }

  if (fs.existsSync(path.join(canonicalRoot, "project.config.json"))) {
    errors.push("仓库根目录不应存在 project.config.json；微信开发者工具必须只导入 miniapp/");
  }

  if (errors.length > 0) {
    return { canonicalRoot, errors };
  }

  const miniappConfig = readJson(canonicalRoot, MINIAPP_PROJECT_CONFIG);

  addMismatch(
    errors,
    "小程序配置 miniprogramRoot",
    normalizeRelativeDirectory(miniappConfig.miniprogramRoot),
    "./",
  );
  addMismatch(
    errors,
    "小程序配置 cloudfunctionRoot",
    normalizeRelativeDirectory(miniappConfig.cloudfunctionRoot),
    "cloudfunctions/",
  );
  addMismatch(errors, "小程序配置 compileType", miniappConfig.compileType, "miniprogram");
  if (!String(miniappConfig.appid || "").trim()) {
    errors.push("小程序配置 appid 不能为空");
  }
  if (!String(miniappConfig.projectname || "").trim()) {
    errors.push("小程序配置 projectname 不能为空");
  }
  if (!String(miniappConfig.libVersion || "").trim()) {
    errors.push("小程序配置 libVersion 不能为空");
  }

  return { canonicalRoot, errors };
}

export function formatProjectEntryReport(result, requestedWorkingDirectory = process.cwd()) {
  const requestedRoot = path.resolve(requestedWorkingDirectory);
  const lines = [`请求路径：${requestedRoot}`, `真实路径：${result.canonicalRoot}`];

  if (result.errors.length === 0) {
    lines.push("项目入口检查通过。");
  } else {
    lines.push("项目入口检查失败：", ...result.errors.map((error) => `- ${error}`));
  }

  return lines.join("\n");
}

const isDirectRun =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const result = validateProjectEntry();
  console.log(formatProjectEntryReport(result));
  if (result.errors.length > 0) {
    process.exitCode = 1;
  }
}
