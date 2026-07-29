# 画家肖像候选流水线

本目录的任务三工具只生成候选与审核材料，不会上传图片，也不会写入 CloudBase 或 COS。

## 输入

- 任务一的 `scope.json`
- 任务一的 `existing-artwork-candidates.jsonl`

默认输入目录是：

```text
outputs/artist-portraits/20260726T064155Z
```

## 执行

```powershell
node scripts/artist-portraits/fetch-portrait-candidates.mjs
node scripts/artist-portraits/build-portrait-review-sheet.mjs
node scripts/artist-portraits/audit-portrait-candidates.mjs
```

首次采集会读取：

- Wikidata `wbgetentities` 的 `P18` 声明。
- Wikimedia Commons `imageinfo` 与 `extmetadata`。
- 项目 COS 图片的只读 `imageInfo` 元数据。

API 原始结果以单实体或单文件为单位写入
`outputs/artist-portraits/.cache`，后续可以使用 `--offline` 重放。请求失败只会生成失败记录或人工检索任务，不会生成“已通过”候选。

## 输出

默认输出目录：

```text
outputs/artist-portraits/20260726T064155Z-task3
```

主要文件：

- `portrait-candidates.jsonl`：每位画家最多 3 条统一候选。
- `portrait-review-sheet.csv`：人工审核工作表。
- `portrait-candidate-contact-sheet.html`：本地候选联系表。
- `portrait-manual-search.jsonl` / `.csv`：没有合格 P18 时的检索词和定向来源。
- `portrait-candidate-failures.jsonl`：API、去重和数量截断记录。
- `candidate-audit.json`：验收报告。
- `candidate-manifest.json`：输出哈希清单。
- `task3-manifest.json`：候选、审核表、联系表和审计报告的最终哈希清单。

## 审核边界

- `eligible_for_manual_review` 只表示自动校验没有发现硬性阻断项，不等于批准。
- 正式上线必须由后续任务人工确认图片与画家的代表关联、来源页、版权、署名、构图和清晰度。
- 授权不明、说明页缺失、尺寸过小、格式异常或 API 元数据缺失会自动标记为 `auto_rejected`。
- `reviewer_decision` 和 `reviewer_notes` 由人工审核填写；流水线不会自动填写 `approved`。

## 首批 20 位试点

任务四使用固定配置与人工结论：

```text
pilot-20.json
pilot-20-decisions.json
```

执行：

```powershell
node scripts/artist-portraits/build-portrait-pilot.mjs
node scripts/artist-portraits/finalize-portrait-pilot.mjs
```

默认输出到：

```text
outputs/artist-portraits/20260726T064155Z-task4-pilot
```

试点只下载审核用预览衍生图，并生成列表尺寸、详情尺寸圆形裁切联系表。主图原文件的下载、512 × 512 处理与 COS 受控上传属于任务五。

任务四修订后的产品目标是“头像能清楚代表该画家”，不要求画面一定是经严格认证的本人照片。可接受本人照片、自画像、历史肖像、传统归属肖像和具有明确画家关联的代表性视觉资源；审核表以 `representation_review` 记录关联结论，同时保留 `identity_review` 说明是否属于本人图像及其确定程度。版权、来源、质量、圆形裁切和非人物边界门禁不放宽。

## 任务五：图片处理与受控 COS 上传

默认模式完成本地下载、签名与尺寸校验、512 × 512 WebP 处理、联系表生成和 COS 只读预演：

```powershell
node scripts/artist-portraits/process-upload-portrait-pilot.mjs
```

确认 `upload-dry-run.json` 没有不可变对象冲突后，使用显式 `--run` 上传，并通过公开域名逐个回读验证：

```powershell
node scripts/artist-portraits/process-upload-portrait-pilot.mjs --run
```

正式对象键固定为：

```text
artist-portraits/{artist_id}/v1/portrait-512.webp
```

工具不覆盖内容不同的既有对象，也不写生产数据库。Wikimedia 原图端连续返回 429 或发生无状态瞬时网络失败时，可以回退到同一已批准 Commons 文件的官方 960px 衍生图；记录会以 `source_delivery = official_preview_fallback` 明确标记，仍需通过文件签名、尺寸、处理质量和版权来源校验。

## 任务六：试点生产写入与回读

默认模式只读取生产数据、验证 19 个 COS 对象并生成逐字段差异、写入前备份和回滚清单：

```powershell
node scripts/artist-portraits/apply-portrait-pilot-production.mjs
```

只有在预演通过后，才使用生产环境 ID 进行双重显式确认：

```powershell
node scripts/artist-portraits/apply-portrait-pilot-production.mjs `
  --run `
  --confirm-production cloudbase-d6gvny27ib05e0ede
```

工具只更新生产 `artists` 集合中的 8 个头像字段，不执行 upsert，不修改集合权限，也不重建其他集合。外部图片会清除可能残留的 `portrait_artwork_id`；只有确实复用项目作品的记录才保留该关系。写入后会再次回读 19 条记录，并验证非目标画家的头像字段和目标画家的非头像字段均未变化。

生产写入前的精确备份位于任务六输出目录的 `production-backup.jsonl`，对应恢复动作记录在 `rollback-manifest.jsonl`。回滚时保留任务五 COS 文件，前端会继续使用文字头像兜底。

## 任务七：全量分批上线

任务七按当前生产可见画家重新读取范围，将试点之外的记录分为每批最多
20 条。每批都独立保存候选、最终决定、裁切联系表、COS 上传记录、生产
备份、写入预演和回读报告。

批处理工具支持动态数量：

```powershell
node scripts/artist-portraits/process-upload-portrait-pilot.mjs `
  --input-dir <batch-dir> `
  --output-dir <batch-dir>/task5 `
  --expected-count <selected-count>

node scripts/artist-portraits/apply-portrait-pilot-production.mjs `
  --task4-dir <batch-dir> `
  --task5-dir <batch-dir>/task5 `
  --output-dir <batch-dir>/task6 `
  --expected-count <batch-record-count>
```

没有合格头像或属于非人物机构的记录不需要 COS 对象；生产写入只保存
`portrait_status` 与 `portrait_updated_at`，并确保图片 URL 等展示字段为空。
最终聚合审计命令：

```powershell
node scripts/artist-portraits/audit-task7-rollout.mjs `
  --scope-dir outputs/artist-portraits/20260726T141009Z `
  --root outputs/artist-portraits/20260726T132051Z-task7
```
