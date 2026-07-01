# 艺术数据导入检查清单

## 使用场景

每次导入新画作、新画家、新 tag，或批量回填规范化字段前，都应使用本清单。目标是防止错误数据直接进入小程序生产展示。

## 导入前检查

### 1. 工作区检查

运行：

```powershell
git status --short
```

确认：

- 当前变更范围清楚。
- 没有未归属的大量 diff。
- 不会把临时导出、密钥、备份文件误提交。

### 2. 环境变量检查

确认本地存在：

```text
CLOUDBASE_ENV_ID
TENCENT_SECRET_ID
TENCENT_SECRET_KEY
```

限制：

- 不在终端输出完整密钥。
- 不把 `.env.local` 提交到 Git。
- 不在文档中记录真实密钥。

### 3. 输入文件检查

确认输入文件格式：

```text
JSON Lines
每行一条完整 JSON
文件外层没有数组 []
记录之间没有逗号
```

建议路径：

```text
miniapp/data/review/candidate-artists.jsonl
miniapp/data/review/candidate-tags.jsonl
miniapp/data/review/reviewed-artists.jsonl
miniapp/data/review/reviewed-vocab-terms.jsonl
miniapp/data/review/derived-artworks-patch.jsonl
```

### 4. schema 检查

检查内容：

- `_id` 不为空。
- `review_status` 合法。
- reviewed 记录有来源说明。
- aliases 不重复。
- tag 有明确 `type`。
- relationship link 有明确 `role`。

### 5. 关系风险检查

重点检查以下文本：

```text
after
attributed
workshop
circle of
school of
follower of
仿
归属
工作室
```

这些不能自动当作 `creator`。

## Dry-run 检查

所有写库脚本必须先 dry-run。

期望输出：

```json
{
  "mode": "dry-run",
  "input_count": 100,
  "valid_count": 96,
  "invalid_count": 4,
  "would_update_count": 80,
  "would_insert_count": 16,
  "would_skip_count": 4
}
```

确认：

- dry-run 不调用写库 API。
- 输出 manifest。
- 输出 rollback。
- invalid records 有原因。

## 小批量导入检查

第一次 apply 限制：

```text
limit: 20
```

导入后检查：

- 20 条是否写入成功。
- 是否有 skipped、failed、conflict。
- rollback manifest 是否完整。
- 小程序是否仍能打开首页、分类页、画家页、详情页。

## 扩大导入检查

建议批次：

```text
20 -> 100 -> 500 -> 全量
```

每批后检查：

- `artists` reviewed 数量。
- `vocab_terms` reviewed 数量。
- `artworks.primary_artist_id` 非空数量。
- `artworks.artist_ids` 非空数量。
- `artworks.tag_ids` 非空数量。
- unresolved artist 文本数量。
- unresolved tag 数量。

## 小程序验收检查

### 首页

检查：

- 推荐作品能正常显示。
- 首页搜索仍使用全库搜索。
- 搜索结果支持分页加载。
- 画作卡片仍使用 `thumbnail_url`。

### 分类页

检查：

- 分类标签正常展示。
- 点击 tag 能展示对应作品。
- 作品数量与查询结果一致。
- 触底加载不丢失已有内容。

### 作品详情页

检查：

- 主图使用 `display_url`。
- 下载使用 `download_url`。
- 作者按钮优先通过 `primary_artist_id` 跳转。
- 缺少 `primary_artist_id` 时有 fallback。

### 画家页

检查：

- reviewed 画家正常展示。
- candidate 画家按产品策略显示或隐藏。
- 筛选和搜索正常。
- 触底加载不丢失已有内容。

### 画家详情页

检查：

- 相关作品通过 `artist_ids` 查询。
- 首批加载 8 条。
- 触底追加 8 条。
- 加载完全部作品后显示完成状态。
- 作品数量不再依赖首屏数量。

## 回滚检查

回滚前确认：

- rollback 文件与 apply manifest 对应。
- rollback 只恢复派生字段。
- 不删除原始数据。
- 不删除图片。

回滚后检查：

- affected records 已恢复旧值。
- 小程序能正常读取旧数据。
- 错误 patch 标记为 rejected 或归档。

## 禁止事项

- 不在没有 dry-run 的情况下直接 apply。
- 不把 candidate 当 reviewed 使用。
- 不用文本字段覆盖稳定 ID 字段。
- 不把下载原图 URL 用作列表展示图。
- 不在小程序客户端写治理字段。
- 不提交 `.env.local`、真实密钥、临时大文件。

## 验收命令

文档和脚本阶段：

```powershell
npm run check
npx tsc --noEmit
git diff --check
```

小程序逻辑阶段：

```powershell
node --test miniapp/services/artworks-normalized.test.mjs
node --test miniapp/pages/artist-detail/artist-detail.test.mjs
npm run check
npx tsc --noEmit
npm run build
```

云数据阶段：

```powershell
node scripts/data-governance/audit-normalized-cloud-data.mjs --dry-run
```

## 导入记录模板

每次导入后记录：

```markdown
## YYYY-MM-DD Import

- Environment:
- Collection:
- Input file:
- Mode:
- Limit:
- Inserted:
- Updated:
- Skipped:
- Failed:
- Manifest:
- Rollback:
- Manual verification:
- Next action:
```
