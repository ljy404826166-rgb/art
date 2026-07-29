# 艺术数据库规范化验收与回滚说明

本文档用于收尾《艺术数据库规范化与关系体系落地计划》的 Task 9，覆盖云数据库只读审计、小程序人工验收、回滚路径和后续维护要求。

## 1. 验收目标

本阶段不再扩展新的数据结构，重点确认已经落地的规范化字段和关系数据可被稳定使用：

- `artworks` 中公开作品仍可正常读取。
- 作品的 `primary_artist_id` / `artist_ids` 能覆盖主要画家归属。
- 作品的 `tag_ids` 能覆盖主要分类与标签归属。
- `artists` 中 reviewed / candidate 状态可被区分。
- 画家详情、分类标签、首页搜索、作品详情作者跳转等小程序链路可正常工作。
- 出现问题时可基于回滚清单恢复派生字段，不删除原始作品、图片或云存储文件。

## 2. 只读审计脚本

新增脚本：

```bash
node scripts/data-governance/audit-normalized-cloud-data.mjs
```

该脚本只执行 CloudBase `QUERY` 命令，不执行新增、更新、删除或集合结构变更。

常用命令：

```bash
node scripts/data-governance/audit-normalized-cloud-data.mjs --out csv/cloudbase/normalized-cloud-audit-latest.json
```

严格模式：

```bash
node scripts/data-governance/audit-normalized-cloud-data.mjs --strict --min-artist-coverage 0.8 --min-tag-coverage 0.9
```

环境变量要求：

- `CLOUDBASE_ENV_ID`
- `TENCENT_SECRET_ID`
- `TENCENT_SECRET_KEY`

脚本会从 `.env`、`.env.local` 或当前进程环境变量读取配置。输出中不会打印密钥。

## 3. 审计指标

审计报告会输出以下核心指标：

- `artworks_total`：云端 `artworks` 总量。
- `published_artworks_total`：参与前端展示判断的公开作品总量。
- `primary_artist_id_non_empty`：已写入主画家 ID 的作品数量。
- `artist_ids_non_empty`：已写入画家 ID 列表的作品数量。
- `tag_ids_non_empty`：已写入标签 ID 列表的作品数量。
- `artist_ids_coverage`：画家关系覆盖率。
- `tag_ids_coverage`：标签关系覆盖率。
- `reviewed_artists`：已审核画家数量。
- `candidate_artists`：候选画家数量。
- `unresolved_artist_text_count`：仍未解析为画家 ID 的画家文本数量。
- `unmatched_tag_text_count`：仍未解析为标签 ID 的标签文本数量。
- `duplicate_artwork_id_count`：重复作品 ID 数量。

建议验收标准：

- `duplicate_artwork_id_count` 为 0。
- `artist_ids_coverage` 达到当前阶段设定阈值。
- `tag_ids_coverage` 达到当前阶段设定阈值。
- `unresolved_artist_text_count` 和 `unmatched_tag_text_count` 能导出样本并进入后续人工治理队列。

## 4. 小程序人工验收清单

需要在微信开发者工具或真机中完成以下验收：

- 首页可正常读取作品，搜索清空后能恢复首页内容。
- 首页搜索始终走全库搜索，不使用首页随机样本。
- 搜索 `达芬奇`、`达·芬奇`、`Leonardo` 时，能命中归一化后的相关作品。
- 作品卡片点击后进入作品详情页，详情页主图使用展示图，不默认请求下载原图。
- 作品详情页点击画家按钮后进入对应画家详情页。
- 画家详情页展示画家基础信息，并按该画家关系加载作品。
- 画家详情页相关作品首屏分页加载，触底后追加下一页，已加载内容不丢失。
- 分类页点击标签后能展示该标签下作品。
- 标签全部作品页使用双列作品卡片，卡片点击可进入详情页。
- 下载功能仅在用户主动下载时使用 `download_url`。

## 5. 回滚方案

规范化字段写入前应保留回滚清单：

```text
miniapp/data/review/derived-artworks-rollback.jsonl
```

回滚命令：

```bash
node scripts/data-governance/cloudbase-apply-derived-artworks.mjs --rollback --in miniapp/data/review/derived-artworks-rollback.jsonl --apply
```

回滚范围：

- 恢复 `primary_artist_id`
- 恢复 `artist_ids`
- 恢复 `artist_labels`
- 恢复 `artist_relation_roles`
- 恢复 `tag_ids`
- 恢复 `tag_labels`
- 恢复 `tag_types`

回滚不会做以下操作：

- 不删除 `artworks` 原始记录。
- 不删除 `artists` 原始记录。
- 不删除 `vocab_terms` 原始记录。
- 不删除云存储图片。
- 不修改 `thumbnail_url` / `display_url` / `download_url` 图片分流字段。

## 6. 回滚后验证

执行回滚后应重新运行：

```bash
node scripts/data-governance/audit-normalized-cloud-data.mjs --out csv/cloudbase/normalized-cloud-audit-after-rollback.json
```

并在小程序中验证：

- 首页仍可正常显示作品。
- 作品详情页仍可打开。
- 画家详情页如果关系字段被回滚，应显示可理解的空状态或候选信息。
- 下载、收藏、浏览历史入口不受影响。

## 7. 当前限制

- 审计脚本依赖云开发管理端密钥，只适合本地治理或受控 CI 环境使用。
- 审计脚本不会自动修复数据，只输出指标和样本。
- 微信开发者工具人工验收仍需要手动完成，不能仅依赖命令行结果。
- 若线上集合尚未创建或权限不足，审计报告会显示集合查询错误，需要先修复云环境配置。

## 8. 后续维护建议

- 每次大批量导入、回填或删除作品前后都运行只读审计。
- 规范化字段写库前必须先生成回滚清单。
- 新增画家、标签、作品时优先写入稳定 ID，再写展示文本。
- 对 candidate 画家和未匹配标签定期人工审核，审核通过后再进入 reviewed 状态。
