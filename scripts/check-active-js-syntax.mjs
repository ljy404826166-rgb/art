import { spawnSync } from "node:child_process";
import path from "node:path";

import { findActiveJavaScriptFiles, REPOSITORY_ROOT } from "./project-quality-files.mjs";

const files = findActiveJavaScriptFiles();
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    failures.push({
      file,
      output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
    });
  }
}

if (failures.length > 0) {
  console.error(`JavaScript syntax check failed for ${failures.length}/${files.length} files.`);
  for (const failure of failures) {
    console.error(`\n${path.normalize(failure.file)}\n${failure.output}`);
  }
  process.exitCode = 1;
} else {
  console.log(`JavaScript syntax check passed for ${files.length} active files.`);
}
