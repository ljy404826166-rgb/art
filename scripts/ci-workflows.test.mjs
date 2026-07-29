import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const WORKFLOW_DIR = path.join(ROOT, ".github", "workflows");

function workflow(name) {
  return fs.readFileSync(path.join(WORKFLOW_DIR, name), "utf8");
}

test("PR quality gate blocks on every local quality layer and archives evidence", () => {
  const source = workflow("pr-quality.yml");
  assert.match(source, /pull_request:/u);
  assert.match(source, /npm ci --ignore-scripts/u);
  assert.match(source, /npm run verify/u);
  assert.match(source, /dependency-audit\.yml/u);
  assert.match(source, /actions\/upload-artifact@v4/u);
  assert.match(source, /if:\s*\$\{\{\s*always\(\)\s*\}\}/u);
  assert.match(source, /permissions:\s*\n\s+contents:\s+read/u);
});

test("post-merge gate uses staging-only secrets and a self-hosted WeChat runner", () => {
  const source = workflow("post-merge.yml");
  assert.match(source, /branches:\s*\n\s+- main/u);
  assert.match(source, /environment:\s+staging-readonly/u);
  assert.match(source, /STAGING_READONLY_TENCENT_SECRET_ID/u);
  assert.match(source, /STAGING_READONLY_TENCENT_SECRET_KEY/u);
  assert.match(source, /test "\$CLOUDBASE_ENV_ID" != "cloudbase-d6gvny27ib05e0ede"/u);
  assert.match(source, /self-hosted/u);
  assert.match(source, /wechat-devtools/u);
  assert.match(source, /recommendation:devtools-smoke/u);
  assert.match(source, /Test-NetConnection/u);
  assert.match(source, /timeout-minutes:\s+8/u);
  assert.match(source, /actions\/upload-artifact@v4/u);
});

test("formal release is manual, read-only, approved, recoverable, and traceable", () => {
  const source = workflow("release-gate.yml");
  assert.match(source, /workflow_dispatch:/u);
  assert.match(source, /android_approved:/u);
  assert.match(source, /ios_approved:/u);
  assert.match(source, /READ_ONLY_RELEASE_GATE/u);
  assert.match(source, /rollback_manifest/u);
  assert.match(source, /environment:\s+production-readonly/u);
  assert.match(source, /PRODUCTION_READONLY_TENCENT_SECRET_ID/u);
  assert.match(source, /cloudbase-audit-artworks\.mjs/u);
  assert.match(source, /recommendation:audit/u);
  assert.match(source, /recommendation:smoke/u);
  assert.match(source, /preview\.png/u);
  assert.match(source, /Test-NetConnection/u);
  assert.match(source, /timeout-minutes:\s+12/u);
  assert.match(source, /actions\/upload-artifact@v4/u);

  const forbiddenWrites = [
    /cloudbase:[A-Za-z0-9:_-]*deploy/iu,
    /cloudbase:upload/iu,
    /cos:migrate/iu,
    /images:apply/iu,
    /\s--run(?:\s|$)/u,
    /permissions:\s*[\s\S]*contents:\s+write/iu,
  ];
  forbiddenWrites.forEach((pattern) => assert.doesNotMatch(source, pattern));
});

test("workflow commands never depend on a developer machine drive path", () => {
  const sources = fs
    .readdirSync(WORKFLOW_DIR)
    .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
    .map((name) => workflow(name));
  sources.forEach((source) => {
    assert.doesNotMatch(source, /[A-Z]:[\\/]/u);
    assert.doesNotMatch(source, /C:\\Users/iu);
  });
});

test("dependency audit is reusable and rejects production high or critical findings", () => {
  const source = workflow("dependency-audit.yml");
  assert.match(source, /workflow_call:/u);
  assert.match(source, /npm audit --omit=dev --audit-level=high/u);
  assert.match(source, /production-dependency-audit/u);
});
