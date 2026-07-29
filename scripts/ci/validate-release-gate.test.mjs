import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseArgs, validateReleaseGate } from "./validate-release-gate.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "release-gate-"));
  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ version: "1.2.3" }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), "# Changelog\n\n## [1.2.3]\n\n- Release.\n");
  fs.writeFileSync(
    path.join(root, "rollback.json"),
    `${JSON.stringify(
      {
        schema_version: 1,
        release_version: "1.2.3",
        environment: "production-env",
        production_ready: true,
        artifacts: [
          {
            name: "database",
            path: "artifacts/rollback/database.jsonl",
            sha256: "a".repeat(64),
          },
        ],
        procedures: ["Restore the verified database backup."],
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

function validOptions() {
  return {
    version: "1.2.3",
    changelog: "CHANGELOG.md",
    rollback: "rollback.json",
    environment: "production-env",
    confirmation: "READ_ONLY_RELEASE_GATE",
    androidApproved: true,
    iosApproved: true,
  };
}

test("release gate accepts an exact version, changelog, rollback, and two mobile approvals", () => {
  const result = validateReleaseGate(validOptions(), fixture());
  assert.equal(result.ok, true);
  assert.equal(result.mode, "read-only-release-gate");
  assert.equal(result.rollback_artifact_count, 1);
});

test("release gate rejects missing approval, confirmation, and rollback integrity", () => {
  const root = fixture();
  const rollbackPath = path.join(root, "rollback.json");
  const rollback = JSON.parse(fs.readFileSync(rollbackPath, "utf8"));
  rollback.production_ready = false;
  rollback.artifacts[0].sha256 = "unsafe";
  fs.writeFileSync(rollbackPath, JSON.stringify(rollback));

  const result = validateReleaseGate(
    {
      ...validOptions(),
      confirmation: "DEPLOY",
      androidApproved: false,
    },
    root,
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("READ_ONLY_RELEASE_GATE")));
  assert.ok(result.errors.some((error) => error.includes("Android")));
  assert.ok(result.errors.some((error) => error.includes("production_ready")));
  assert.ok(result.errors.some((error) => error.includes("SHA-256")));
});

test("release gate cannot read changelog or rollback files outside the repository", () => {
  const result = validateReleaseGate(
    {
      ...validOptions(),
      changelog: "../CHANGELOG.md",
      rollback: "C:\\outside\\rollback.json",
    },
    fixture(),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("inside the repository")));
  assert.ok(result.errors.some((error) => error.includes("repository-relative")));
});

test("release CLI parser maps explicit boolean approvals only", () => {
  const options = parseArgs([
    "--version",
    "1.2.3",
    "--changelog",
    "CHANGELOG.md",
    "--rollback",
    "rollback.json",
    "--environment",
    "production-env",
    "--confirmation",
    "READ_ONLY_RELEASE_GATE",
    "--android-approved",
    "true",
    "--ios-approved",
    "false",
  ]);
  assert.equal(options.androidApproved, true);
  assert.equal(options.iosApproved, false);
});
