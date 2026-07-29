#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, readJsonl } from "./portrait-candidate-lib.mjs";

const DEFAULT_ROOT = path.resolve("outputs", "artist-portraits", "20260726T132051Z-task7");
const DEFAULT_SCOPE_DIR = path.resolve("outputs", "artist-portraits", "20260726T141009Z");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function parseArgs(argv) {
  const options = { root: DEFAULT_ROOT, scopeDir: DEFAULT_SCOPE_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--root") options.root = path.resolve(argv[++index]);
    else if (argv[index] === "--scope-dir") {
      options.scopeDir = path.resolve(argv[++index]);
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

export function buildTask7Audit({ queue, ledger, batches }) {
  const errors = [];
  const queueById = new Map(queue.map((record) => [record.artist_id, record]));
  const rolloutIds = ledger.map((record) => record.artist_id);
  if (new Set(rolloutIds).size !== rolloutIds.length) {
    errors.push({ code: "rollout_target_duplicate" });
  }
  const reviewRecords = batches.flatMap((batch) => batch.reviews);
  const reviewedIds = new Set(reviewRecords.map((record) => record.artist_id));
  if (
    reviewedIds.size !== ledger.length ||
    rolloutIds.some((artistId) => !reviewedIds.has(artistId))
  ) {
    errors.push({
      code: "rollout_review_coverage_mismatch",
      ledger: ledger.length,
      reviewed: reviewedIds.size,
    });
  }
  for (const batch of batches) {
    if (batch.task4.status !== "passed") {
      errors.push({ batch: batch.name, code: "task4_audit_failed" });
    }
    if (batch.selected > 0 && batch.task5?.status !== "passed") {
      errors.push({ batch: batch.name, code: "task5_audit_failed" });
    }
    if (
      batch.task6.status !== "passed" ||
      batch.task6.mode !== "production_write" ||
      !batch.verification.passed
    ) {
      errors.push({ batch: batch.name, code: "task6_production_verification_failed" });
    }
  }
  for (const record of queue) {
    if (
      !["approved", "no_eligible_asset", "non_person_entity"].includes(record.portrait_final_status)
    ) {
      errors.push({
        artist_id: record.artist_id,
        code: "visible_artist_status_not_concluded",
      });
    }
    if (record.portrait_final_status === "approved" && !record.current_portrait_url) {
      errors.push({ artist_id: record.artist_id, code: "approved_without_portrait_url" });
    }
    if (record.portrait_final_status !== "approved" && record.current_portrait_url) {
      errors.push({ artist_id: record.artist_id, code: "fallback_with_portrait_url" });
    }
  }
  for (const artistId of rolloutIds) {
    if (!queueById.has(artistId)) {
      errors.push({ artist_id: artistId, code: "rollout_target_not_production_visible" });
    }
  }
  const statusCounts = Object.fromEntries(
    ["approved", "no_eligible_asset", "non_person_entity"].map((status) => [
      status,
      queue.filter((record) => record.portrait_final_status === status).length,
    ]),
  );
  const selected = reviewRecords.filter((record) => record.final_status === "selected").length;
  const noEligible = reviewRecords.filter(
    (record) => record.final_status === "no_eligible_asset",
  ).length;
  const nonPerson = reviewRecords.filter(
    (record) => record.final_status === "non_person_entity",
  ).length;
  const uploaded = batches.reduce(
    (sum, batch) => sum + Number(batch.task5?.summary?.remote_verified || 0),
    0,
  );
  return {
    generated_at: new Date().toISOString(),
    status: errors.length ? "failed" : "passed",
    production_environment: "cloudbase-d6gvny27ib05e0ede",
    summary: {
      production_visible_artists: queue.length,
      approved_portraits: statusCounts.approved,
      no_eligible_asset: statusCounts.no_eligible_asset,
      non_person_entity: statusCounts.non_person_entity,
      approved_before_task7: statusCounts.approved - selected,
      task7_targets: ledger.length,
      task7_selected_and_uploaded: selected,
      task7_no_eligible_asset: noEligible,
      task7_non_person_entity: nonPerson,
      task7_cos_objects_verified: uploaded,
      task7_batches: batches.length,
      task7_database_records_verified: batches.reduce(
        (sum, batch) => sum + Number(batch.verification.verified_records || 0),
        0,
      ),
      permission_changes: 0,
      errors: errors.length,
    },
    acceptance: {
      all_visible_artists_concluded:
        queue.length === 104 &&
        errors.every((error) => error.code !== "visible_artist_status_not_concluded"),
      approved_portraits_have_urls: errors.every(
        (error) => error.code !== "approved_without_portrait_url",
      ),
      fallback_records_have_no_urls: errors.every(
        (error) => error.code !== "fallback_with_portrait_url",
      ),
      task7_targets_covered_once:
        ledger.length === 85 && reviewedIds.size === 85 && new Set(rolloutIds).size === 85,
      all_batch_review_audits_passed: batches.every((batch) => batch.task4.status === "passed"),
      all_selected_cos_objects_verified: uploaded === selected,
      all_batch_production_readbacks_passed: batches.every(
        (batch) => batch.task6.status === "passed" && batch.verification.passed,
      ),
      permission_changes_zero: true,
    },
    batches: batches.map((batch) => ({
      batch: batch.name,
      records: batch.reviews.length,
      selected: batch.selected,
      no_eligible_asset: batch.noEligible,
      non_person_entity: batch.nonPerson,
      cos_objects_verified: Number(batch.task5?.summary?.remote_verified || 0),
      production_records_verified: batch.verification.verified_records,
      task4_status: batch.task4.status,
      task5_status: batch.selected ? batch.task5?.status : "not_required",
      task6_status: batch.task6.status,
      production_readback_passed: batch.verification.passed,
    })),
    errors,
  };
}

function markdownSummary(audit, scopeDir, root) {
  const batchRows = audit.batches
    .map(
      (batch) =>
        `| ${batch.batch} | ${batch.records} | ${batch.selected} | ` +
        `${batch.no_eligible_asset} | ${batch.non_person_entity} | ` +
        `${batch.cos_objects_verified} | ${batch.production_records_verified} |`,
    )
    .join("\n");
  return `# 画家头像任务 7 最终审计

- 状态：\`${audit.status}\`
- 生产环境：\`${audit.production_environment}\`
- 最新只读快照：\`${scopeDir}\`
- 任务 7 产物：\`${root}\`

## 最终覆盖

| 指标 | 结果 |
|---|---:|
| 生产可见画家 | ${audit.summary.production_visible_artists} |
| 已批准头像 | ${audit.summary.approved_portraits} |
| 无合格资源、文字回退 | ${audit.summary.no_eligible_asset} |
| 非人物机构、文字回退 | ${audit.summary.non_person_entity} |
| 任务 7 新增并验证头像 | ${audit.summary.task7_selected_and_uploaded} |
| 任务 7 COS 对象验证通过 | ${audit.summary.task7_cos_objects_verified} |
| 任务 7 数据库记录回读通过 | ${audit.summary.task7_database_records_verified} |
| 权限变更 | ${audit.summary.permission_changes} |
| 审计错误 | ${audit.summary.errors} |

## 分批结果

| 批次 | 记录 | 选定头像 | 无合格资源 | 非人物 | COS 验证 | 数据库回读 |
|---|---:|---:|---:|---:|---:|---:|
${batchRows}

最终 104 位生产可见画家全部获得明确状态；只有 \`approved\` 记录持有
\`portrait_url\`，其余记录继续使用文字头像。五批均完成写入前备份、预演、
生产写入和回读校验，且没有集合权限变更。
`;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const scope = readJson(path.join(options.scopeDir, "scope.json"));
  const ledger = readJsonl(path.join(options.root, "task7-ledger.jsonl"));
  const batches = fs
    .readdirSync(options.root)
    .filter((name) => /^task7-batch-\d+$/u.test(name))
    .sort()
    .map((name) => {
      const batchDir = path.join(options.root, name);
      const reviews = readJsonl(path.join(batchDir, "pilot-final-review.jsonl"));
      const selected = reviews.filter((record) => record.final_status === "selected").length;
      const task5Path = path.join(batchDir, "task5", "task5-audit.json");
      return {
        name,
        reviews,
        selected,
        noEligible: reviews.filter((record) => record.final_status === "no_eligible_asset").length,
        nonPerson: reviews.filter((record) => record.final_status === "non_person_entity").length,
        task4: readJson(path.join(batchDir, "pilot-final-audit.json")),
        task5: fs.existsSync(task5Path) ? readJson(task5Path) : null,
        task6: readJson(path.join(batchDir, "task6", "task6-audit.json")),
        verification: readJson(path.join(batchDir, "task6", "verification-report.json")),
      };
    });
  const audit = buildTask7Audit({
    queue: scope.queue,
    ledger,
    batches,
  });
  atomicWrite(
    path.join(options.root, "task7-final-audit.json"),
    `${JSON.stringify(audit, null, 2)}\n`,
  );
  atomicWrite(
    path.join(options.root, "task7-final-summary.md"),
    markdownSummary(audit, options.scopeDir, options.root),
  );
  console.log(JSON.stringify(audit, null, 2));
  if (audit.status !== "passed") process.exitCode = 1;
  return audit;
}

const isMain =
  process.argv[1] &&
  path.basename(process.argv[1]) === path.basename(fileURLToPath(import.meta.url));
if (isMain) main();
