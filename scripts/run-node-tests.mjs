import { spawnSync } from "node:child_process";

import { findNodeTestFiles, REPOSITORY_ROOT } from "./project-quality-files.mjs";

const files = findNodeTestFiles();

if (files.length === 0) {
  console.error("No active Node test files were found.");
  process.exitCode = 1;
} else {
  console.log(`Running ${files.length} active Node test files.`);
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd: REPOSITORY_ROOT,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
}
