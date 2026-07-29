#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_CONFIRMATION = "READ_ONLY_RELEASE_GATE";

function required(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

export function parseArgs(args) {
  const options = {
    version: "",
    changelog: "",
    rollback: "",
    environment: "",
    confirmation: "",
    androidApproved: false,
    iosApproved: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = required(args, index + 1, argument);
    index += 1;
    if (argument === "--version") options.version = value;
    else if (argument === "--changelog") options.changelog = value;
    else if (argument === "--rollback") options.rollback = value;
    else if (argument === "--environment") options.environment = value;
    else if (argument === "--confirmation") options.confirmation = value;
    else if (argument === "--android-approved") options.androidApproved = value === "true";
    else if (argument === "--ios-approved") options.iosApproved = value === "true";
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function repositoryPath(repositoryRoot, relativePath, label) {
  if (!relativePath || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a non-empty repository-relative path.`);
  }
  const resolvedRoot = path.resolve(repositoryRoot);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} must remain inside the repository.`);
  }
  return resolvedPath;
}

function readJson(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error.message}`);
  }
}

function isSha256(value) {
  return /^[a-f0-9]{64}$/u.test(String(value || ""));
}

export function validateReleaseGate(options, repositoryRoot = process.cwd()) {
  const errors = [];
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(options.version)) {
    errors.push("Version must use semantic version syntax.");
  }
  if (options.confirmation !== EXPECTED_CONFIRMATION) {
    errors.push(`Confirmation must exactly equal ${EXPECTED_CONFIRMATION}.`);
  }
  if (!options.androidApproved) errors.push("Android acceptance approval is required.");
  if (!options.iosApproved) errors.push("iOS acceptance approval is required.");
  if (!String(options.environment || "").trim()) {
    errors.push("Production environment ID is required.");
  }

  const packagePath = path.join(repositoryRoot, "package.json");
  const packageJson = readJson(packagePath, "package.json");
  if (packageJson.version !== options.version) {
    errors.push(
      `Requested version ${options.version} does not match package.json ${packageJson.version}.`,
    );
  }

  let changelogPath = "";
  try {
    changelogPath = repositoryPath(repositoryRoot, options.changelog, "Changelog");
    if (!fs.existsSync(changelogPath)) errors.push("Changelog file does not exist.");
    else {
      const changelog = fs.readFileSync(changelogPath, "utf8");
      const escapedVersion = options.version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      if (!new RegExp(`^##\\s+(?:\\[)?${escapedVersion}(?:\\])?(?:\\s|$)`, "mu").test(changelog)) {
        errors.push(`Changelog does not contain a level-two entry for ${options.version}.`);
      }
    }
  } catch (error) {
    errors.push(error.message);
  }

  let rollbackPath = "";
  let rollbackManifest = null;
  try {
    rollbackPath = repositoryPath(repositoryRoot, options.rollback, "Rollback manifest");
    if (!fs.existsSync(rollbackPath)) errors.push("Rollback manifest does not exist.");
    else {
      rollbackManifest = readJson(rollbackPath, "Rollback manifest");
      if (rollbackManifest.schema_version !== 1) {
        errors.push("Rollback manifest schema_version must equal 1.");
      }
      if (rollbackManifest.release_version !== options.version) {
        errors.push("Rollback manifest release_version does not match the requested version.");
      }
      if (rollbackManifest.environment !== options.environment) {
        errors.push("Rollback manifest environment does not match the requested environment.");
      }
      if (rollbackManifest.production_ready !== true) {
        errors.push("Rollback manifest must be explicitly marked production_ready.");
      }
      if (!Array.isArray(rollbackManifest.artifacts) || rollbackManifest.artifacts.length === 0) {
        errors.push("Rollback manifest must contain at least one artifact.");
      } else {
        rollbackManifest.artifacts.forEach((artifact, index) => {
          if (!String(artifact?.name || "").trim()) {
            errors.push(`Rollback artifact ${index + 1} requires a name.`);
          }
          if (!String(artifact?.path || "").trim()) {
            errors.push(`Rollback artifact ${index + 1} requires a path.`);
          }
          if (!isSha256(artifact?.sha256)) {
            errors.push(`Rollback artifact ${index + 1} requires a SHA-256 digest.`);
          }
        });
      }
      if (
        !Array.isArray(rollbackManifest.procedures) ||
        rollbackManifest.procedures.length === 0 ||
        rollbackManifest.procedures.some((step) => !String(step || "").trim())
      ) {
        errors.push("Rollback manifest must contain non-empty recovery procedures.");
      }
    }
  } catch (error) {
    errors.push(error.message);
  }

  return {
    ok: errors.length === 0,
    errors,
    version: options.version,
    environment: options.environment,
    changelog_path: changelogPath,
    rollback_manifest_path: rollbackPath,
    rollback_artifact_count: rollbackManifest?.artifacts?.length || 0,
    approvals: {
      android: options.androidApproved,
      ios: options.iosApproved,
    },
    mode: "read-only-release-gate",
  };
}

export function main(args = process.argv.slice(2)) {
  const result = validateReleaseGate(parseArgs(args));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
  return result;
}

const isDirectRun =
  process.argv[1] &&
  path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url));
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
