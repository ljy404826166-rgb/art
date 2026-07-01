# Art Database Normalization And Relationship System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a governed art-data system that normalizes artworks, artists, tags, vocabularies, and relationships so future imports can be matched, reviewed, searched, and displayed consistently.

**Architecture:** Keep WeChat Cloud Database as the app-facing datastore, but stop treating free-text fields as the source of truth. Add stable entity IDs, explicit relationship collections, validation scripts, review artifacts, and derived app-read fields so the miniapp can query by `artist_ids` and `tag_ids` instead of fragile text matching.

**Tech Stack:** WeChat Mini Program, WeChat Cloud Database, Node.js scripts, JSON Lines review/import files, local validation tests, existing `miniapp/services/*` data layer, MiniSearch for local search indexing, optional future Typesense/Meilisearch search service.

---

## 1. 背景与问题

当前项目已经完成：

- `artworks` 作品集合迁移到微信云数据库。
- `artists` 画家集合初步建立，包含 reviewed 与 candidate 记录。
- 小程序已有首页、分类、画家页、画家详情页、作品详情页。
- 图片字段已分流为 `thumbnail_url`、`display_url`、`download_url`。
- 搜索、画家详情相关作品、分类结果等功能多次迭代。

当前核心问题不是单一页面 bug，而是数据关系缺少统一标准：

- 画作作者存在于 `artworks.artist` 文本字段中，格式不稳定。
- 部分作品的 `tag_keys` 包含画家名，部分不包含，导致查询结果不一致。
- 候选画家与已审核画家混在同一业务路径中，缺少明确的治理流程。
- tag 同时承担题材、流派、年代、媒介、画家名等多种语义，后续扩展会继续混乱。
- 画家详情页、分类页、搜索页依赖文本匹配，容易出现漏查、误查、重复查。
- 数据导入、清洗、审核、发布、回滚没有形成稳定流水线。

目标是建立一套长期可维护的数据规范系统，而不是继续逐个页面修补。

## 2. 借鉴项目与方法论

本计划不建议直接引入大型系统替换当前项目，而是借鉴成熟项目的方法：

- OpenRefine: 参考其数据清洗、去重、reconciliation、批处理审核流程。
- Linked Art / CIDOC CRM 思路: 参考艺术品、人物、地点、时期、材料、来源之间的实体关系建模。
- Omeka S: 参考文化遗产馆藏对象、媒体、元数据、公开展示的内容组织方式。
- Arches Project: 参考文化遗产资产管理中的实体、关系、权限、审核流程。
- MiniSearch: 继续用于小程序或本地脚本侧的轻量搜索索引。
- Typesense / Meilisearch: 作为未来独立搜索服务的可选方案，短期不引入。

参考链接：

- OpenRefine: https://github.com/OpenRefine/OpenRefine
- Linked Art: https://linked.art/model/
- Omeka S: https://github.com/omeka/omeka-s
- Arches Project: https://github.com/archesproject/arches
- MiniSearch: https://github.com/lucaong/minisearch
- Typesense: https://github.com/typesense/typesense
- Meilisearch: https://github.com/meilisearch/meilisearch

## 3. 总体原则

1. **文本不是主键。** 画家、tag、时期、媒介、地区都必须有稳定 ID。
2. **关系显式化。** 画作与画家、画作与 tag、画家与风格都使用关系字段或关系集合表达。
3. **原始数据不可丢。** 保留 raw 字段，规范字段作为派生结果。
4. **审核优先。** `candidate` 不等于 `reviewed`，不应被当作最终权威数据。
5. **小程序读派生字段。** 小程序不做复杂数据治理，只读取已发布、已派生的字段。
6. **脚本默认 dry-run。** 所有批量写库脚本默认只生成报告，必须 `--apply` 才写库。
7. **可回滚。** 每次写库必须输出 manifest，记录旧值、新值、时间和影响范围。
8. **不破坏图片分流。** 规范化不改 `thumbnail_url`、`display_url`、`download_url` 的语义。

## 4. 目标数据模型

### 4.1 `artists` 画家实体

用途：保存已审核或候选画家身份信息。

关键字段：

```json
{
  "_id": "claude-monet",
  "entity_type": "artist",
  "name_zh": "克洛德·莫奈",
  "name_en": "Claude Monet",
  "display_name": "克洛德·莫奈",
  "birth_year": 1840,
  "death_year": 1926,
  "lifespan_text": "1840-1926",
  "country_id": "country-france",
  "country_label": "法国",
  "region_id": "region-europe",
  "region_label": "欧洲",
  "style_ids": ["style-impressionism"],
  "period_ids": ["period-19th-century", "period-20th-century-early"],
  "aliases": ["克洛德·莫奈", "Claude Monet", "Monet", "莫奈"],
  "bio_zh": "法国印象派代表画家，长期研究自然光线、空气和时间变化。",
  "representative_work_ids": [],
  "representative_work_labels": ["睡莲", "日出·印象"],
  "authority_ids": {
    "wikidata": "Q296",
    "ulan": "500019484",
    "viaf": "24605513"
  },
  "review_status": "reviewed",
  "reviewed_by": "codex-assisted-review",
  "reviewed_at": "2026-06-30",
  "updated_at": "2026-06-30"
}
```

规则：

- `_id` 使用稳定 slug，不随中文译名变化。
- `aliases` 必须包含现有 `artworks.artist` 中出现过的常见文本。
- `review_status` 只允许 `candidate`、`reviewed`、`rejected`。
- 小程序生产页面默认只展示 `reviewed`，候选画家详情可以单独标识“待审核”。

### 4.2 `artworks` 画作实体

用途：保存小程序展示所需的公开作品数据。

保留原始字段，新增规范派生字段：

```json
{
  "_id": "artwork_xxx",
  "title_cn": "睡莲",
  "title_en": "Water Lilies",
  "artist": "克洛德·莫奈（Claude Monet, 1840-1926）",
  "raw_artist_text": "克洛德·莫奈（Claude Monet, 1840-1926）",
  "primary_artist_id": "claude-monet",
  "artist_ids": ["claude-monet"],
  "artist_labels": ["克洛德·莫奈"],
  "artist_relation_roles": ["creator"],
  "tag_ids": ["subject-water-lilies", "style-impressionism", "medium-oil"],
  "tag_labels": ["睡莲", "印象派", "油画"],
  "medium_id": "medium-oil",
  "period_id": "period-19th-century",
  "location_id": "",
  "thumbnail_url": ".../thumb/xxx.webp",
  "display_url": ".../display/xxx.webp",
  "download_url": ".../xxx.jpg",
  "normalization_status": "reviewed",
  "status": "published"
}
```

规则：

- `artist` 保留原始显示文本，不作为查询主依据。
- `primary_artist_id` 用于作品详情页作者按钮。
- `artist_ids` 用于画家详情页查询相关作品。
- `tag_ids` 用于分类页、标签页、首页“查看更多”。
- `download_url` 仍只用于下载，不进入默认展示组件。

### 4.3 `vocab_terms` 规范词表

用途：统一 tag、流派、题材、媒介、年代、地区等概念。

```json
{
  "_id": "style-impressionism",
  "type": "style",
  "label_zh": "印象派",
  "label_en": "Impressionism",
  "aliases": ["印象主义", "Impressionist"],
  "parent_id": "",
  "authority_ids": {
    "wikidata": "",
    "aat": ""
  },
  "review_status": "reviewed",
  "sort_order": 100
}
```

建议 `type`：

- `style`: 流派
- `subject`: 题材
- `medium`: 媒介
- `period`: 年代
- `region`: 地区
- `country`: 国家
- `collection`: 收藏地
- `source`: 来源平台

### 4.4 `artwork_artist_links` 画作-画家关系

用途：表达“创作者”“仿某人”“归属待考”“工作室”等复杂关系。

```json
{
  "_id": "link_artwork_xxx_claude-monet_creator",
  "artwork_id": "artwork_xxx",
  "artist_id": "claude-monet",
  "role": "creator",
  "confidence": "manual",
  "source_field": "artist",
  "source_text": "克洛德·莫奈（Claude Monet, 1840-1926）",
  "review_status": "reviewed"
}
```

`role` 建议值：

- `creator`: 明确创作者
- `after`: 仿、临摹、after
- `attributed_to`: 归属
- `workshop`: 工作室
- `publisher`: 出版/印刷者
- `unknown`: 未知或待审核

### 4.5 `artwork_tag_links` 画作-tag 关系

用途：替代混杂的 `tag_keys` 文本。

```json
{
  "_id": "link_artwork_xxx_style-impressionism",
  "artwork_id": "artwork_xxx",
  "tag_id": "style-impressionism",
  "tag_type": "style",
  "confidence": "inferred",
  "source_field": "tag_keys",
  "review_status": "reviewed"
}
```

### 4.6 `search_documents` 搜索索引文档

用途：小程序或未来搜索服务读取的扁平化索引。

```json
{
  "_id": "artwork_xxx",
  "document_type": "artwork",
  "title_text": "睡莲 Water Lilies",
  "artist_text": "克洛德·莫奈 Claude Monet Monet 莫奈",
  "tag_text": "印象派 油画 睡莲 19世纪",
  "description_text": "作品说明文本",
  "priority_fields": {
    "title": 3,
    "artist": 2,
    "description": 1
  },
  "thumbnail_url": "...",
  "target_path": "/pages/detail/detail?id=artwork_xxx"
}
```

## 5. 数据处理流水线

```text
raw import
  -> normalize text
  -> reconcile entities
  -> generate candidates
  -> manual review
  -> publish entities
  -> build relationship links
  -> backfill derived fields
  -> build search documents
  -> miniapp reads published data
```

### 5.1 Raw Import

输入：

- 当前 `artworks` 云数据库导出。
- 后续新增 Supabase、CSV、Artvee 或其他来源数据。

输出：

- `data/raw/*.jsonl`
- 保留原始 `artist`、`tags`、`medium`、`year_and_place`。

### 5.2 Normalize Text

处理内容：

- 中英文括号统一。
- 全角半角符号统一。
- `达芬奇` 与 `达·芬奇` 搜索归一化。
- `Artvee`、`Artvee 图像记录` 等来源噪声从展示字段中剥离。
- 年代字段拆分为 `year_start`、`year_end`、`period_id`。
- 媒介字段清洗为 `medium_id`。

### 5.3 Reconcile Entities

匹配优先级：

1. 已有 `_id` 精确匹配。
2. `artists.aliases` 精确匹配。
3. 规范化文本匹配。
4. 外部 authority ID 匹配。
5. 低置信候选进入 `candidate`。

### 5.4 Manual Review

必须人工确认：

- 新画家。
- 新 tag。
- `after`、`attributed_to`、`workshop` 等非创作者关系。
- 年代不确定字段。
- 收藏地、来源、尺寸等展示字段。

### 5.5 Publish

发布动作：

- reviewed `artists` 写入 `artists` 集合。
- reviewed `vocab_terms` 写入 `vocab_terms` 集合。
- reviewed links 写入关系集合。
- 回填 `artworks` 派生字段。

### 5.6 App Read

小程序只读：

- `artworks.primary_artist_id`
- `artworks.artist_ids`
- `artworks.tag_ids`
- `artists.review_status`
- `vocab_terms.review_status`

小程序不做：

- 权威来源查询。
- 大规模 reconciliation。
- 批量写库。
- 数据审核。

## 6. 文件结构规划

### 6.1 新增文档

- Create: `docs/art-database-normalization.md`
  - 数据模型、字段定义、关系规则。
- Create: `docs/art-data-review-workflow.md`
  - 审核流程、候选处理、发布和回滚规则。
- Create: `docs/art-data-import-checklist.md`
  - 每次导入前后的检查清单。

### 6.2 新增本地数据文件

- Create: `miniapp/data/schemas/artists.schema.json`
- Create: `miniapp/data/schemas/artworks-normalized.schema.json`
- Create: `miniapp/data/schemas/vocab-terms.schema.json`
- Create: `miniapp/data/schemas/artwork-artist-links.schema.json`
- Create: `miniapp/data/schemas/artwork-tag-links.schema.json`
- Create: `miniapp/data/review/candidate-artists.jsonl`
- Create: `miniapp/data/review/candidate-tags.jsonl`
- Create: `miniapp/data/review/candidate-artwork-artist-links.jsonl`
- Create: `miniapp/data/review/reviewed-artists.jsonl`
- Create: `miniapp/data/review/reviewed-vocab-terms.jsonl`
- Create: `miniapp/data/review/reviewed-artwork-artist-links.jsonl`

### 6.3 新增脚本

- Create: `scripts/data-governance/lib/text-normalize.mjs`
- Create: `scripts/data-governance/lib/entity-slug.mjs`
- Create: `scripts/data-governance/lib/authority-fields.mjs`
- Create: `scripts/data-governance/audit-art-data.mjs`
- Create: `scripts/data-governance/generate-artist-candidates.mjs`
- Create: `scripts/data-governance/generate-vocab-candidates.mjs`
- Create: `scripts/data-governance/generate-artwork-links.mjs`
- Create: `scripts/data-governance/validate-reviewed-data.mjs`
- Create: `scripts/data-governance/build-derived-artworks.mjs`
- Create: `scripts/data-governance/build-search-documents.mjs`
- Create: `scripts/data-governance/cloudbase-apply-derived-artworks.mjs`

### 6.4 修改小程序服务

- Modify: `miniapp/services/artworks.js`
  - 逐步把画家详情查询从文本匹配改成 `artist_ids` 查询。
- Modify: `miniapp/services/artists.js`
  - 区分 reviewed 与 candidate 展示策略。
- Modify: `miniapp/services/search-engine.js`
  - 使用 `search_documents` 或规范化字段。
- Modify: `miniapp/pages/artist-detail/artist-detail.js`
  - 先读 `artist_id`，再按 `artist_ids` 分页查询作品。
- Modify: `miniapp/pages/category/category.js`
  - 未来按 `tag_ids` 查询，不再依赖中文 tag 文本。
- Modify: `miniapp/pages/tag/tag.js`
  - 未来按 `tag_id` 查询完整作品列表。

## 7. 分阶段实施计划

### Task 1: 写入规范文档

**Files:**

- Create: `docs/art-database-normalization.md`
- Create: `docs/art-data-review-workflow.md`
- Create: `docs/art-data-import-checklist.md`

- [ ] **Step 1: 创建数据模型文档**

写入 `docs/art-database-normalization.md`，包含 collections、字段、状态、关系角色、命名规则。

- [ ] **Step 2: 创建审核流程文档**

写入 `docs/art-data-review-workflow.md`，明确 candidate、reviewed、rejected 的流转。

- [ ] **Step 3: 创建导入检查清单**

写入 `docs/art-data-import-checklist.md`，用于每次云数据库导入前后核验。

- [ ] **Step 4: 检查文档**

Run:

```powershell
git diff -- docs/art-database-normalization.md docs/art-data-review-workflow.md docs/art-data-import-checklist.md
```

Expected:

- 只新增文档。
- 不修改 `miniapp/` 运行代码。
- 不修改云数据库。

### Task 2: 建立 schema 与验证基础

**Files:**

- Create: `miniapp/data/schemas/artists.schema.json`
- Create: `miniapp/data/schemas/vocab-terms.schema.json`
- Create: `miniapp/data/schemas/artwork-artist-links.schema.json`
- Create: `scripts/data-governance/validate-reviewed-data.mjs`
- Test: `scripts/data-governance/validate-reviewed-data.test.mjs`

- [ ] **Step 1: 写失败测试**

测试应覆盖：

- reviewed artist 缺少 authority source 时失败。
- candidate artist 可以没有 authority source。
- duplicate alias 应失败。
- artwork-artist link 缺少 `role` 应失败。

Run:

```powershell
node --test scripts/data-governance/validate-reviewed-data.test.mjs
```

Expected:

- 初次运行失败，因为脚本尚未实现。

- [ ] **Step 2: 实现 schema 校验**

实现字段检查、状态检查、重复别名检查、关系角色检查。

- [ ] **Step 3: 跑测试**

Run:

```powershell
node --test scripts/data-governance/validate-reviewed-data.test.mjs
```

Expected:

- 所有测试通过。

### Task 3: 生成候选画家与候选 tag

**Files:**

- Create: `scripts/data-governance/generate-artist-candidates.mjs`
- Create: `scripts/data-governance/generate-vocab-candidates.mjs`
- Output: `miniapp/data/review/candidate-artists.jsonl`
- Output: `miniapp/data/review/candidate-tags.jsonl`
- Test: `scripts/data-governance/generate-candidates.test.mjs`

- [ ] **Step 1: 写失败测试**

输入一组 mock artworks：

```json
[
  {
    "_id": "artwork_a",
    "artist": "克洛德·莫奈（Claude Monet, 1840-1926）",
    "tag_keys": ["印象派", "油画", "19世纪"]
  }
]
```

期望输出：

- artist candidate `_id = claude-monet`
- aliases 包含中文名、英文名、完整原始 artist 文本。
- vocab candidates 包含 style/medium/period 的候选。

- [ ] **Step 2: 实现候选生成**

脚本默认读取 `miniapp/data/artworks.cloudbase.json`。

Run:

```powershell
node scripts/data-governance/generate-artist-candidates.mjs --out miniapp/data/review/candidate-artists.jsonl
node scripts/data-governance/generate-vocab-candidates.mjs --out miniapp/data/review/candidate-tags.jsonl
```

Expected:

- 生成 JSON Lines。
- 不写云数据库。

### Task 4: 建立关系生成脚本

**Files:**

- Create: `scripts/data-governance/generate-artwork-links.mjs`
- Output: `miniapp/data/review/candidate-artwork-artist-links.jsonl`
- Output: `miniapp/data/review/candidate-artwork-tag-links.jsonl`
- Test: `scripts/data-governance/generate-artwork-links.test.mjs`

- [ ] **Step 1: 写失败测试**

覆盖场景：

- 普通创作者：`creator`
- `after Jacques Louis David`：`after`
- `Studio of`：`workshop`
- 未识别：`unknown`

- [ ] **Step 2: 实现关系生成**

脚本从 reviewed artists、reviewed vocab、artworks 生成关系候选。

- [ ] **Step 3: 输出审计摘要**

摘要字段：

```json
{
  "artworks_total": 3000,
  "artist_links_total": 2800,
  "tag_links_total": 12000,
  "unmatched_artist_count": 120,
  "unknown_relation_count": 30
}
```

### Task 5: 构建派生 artworks 字段

**Files:**

- Create: `scripts/data-governance/build-derived-artworks.mjs`
- Output: `miniapp/data/review/derived-artworks-patch.jsonl`
- Output: `miniapp/data/review/derived-artworks-rollback.jsonl`
- Test: `scripts/data-governance/build-derived-artworks.test.mjs`

- [ ] **Step 1: 写失败测试**

输入：

- artwork 原始记录。
- reviewed artist link。
- reviewed tag link。

期望输出：

```json
{
  "_id": "artwork_a",
  "primary_artist_id": "claude-monet",
  "artist_ids": ["claude-monet"],
  "artist_labels": ["克洛德·莫奈"],
  "tag_ids": ["style-impressionism"],
  "tag_labels": ["印象派"]
}
```

- [ ] **Step 2: 实现 dry-run patch 生成**

Run:

```powershell
node scripts/data-governance/build-derived-artworks.mjs --dry-run --out miniapp/data/review/derived-artworks-patch.jsonl
```

Expected:

- 输出 patch。
- 输出 rollback。
- 不写云数据库。

### Task 6: 小程序读取路径改造

**Files:**

- Modify: `miniapp/services/artworks.js`
- Modify: `miniapp/pages/artist-detail/artist-detail.js`
- Modify: `miniapp/pages/category/category.js`
- Modify: `miniapp/pages/tag/tag.js`
- Test: `miniapp/services/artworks-normalized.test.mjs`
- Test: `miniapp/pages/artist-detail/artist-detail.test.mjs`

- [ ] **Step 1: 写服务层测试**

测试：

- `fetchArtworksByArtistId("claude-monet", { pageSize: 8, skip: 0 })` 使用 `artist_ids`。
- `countArtworksByArtistId("claude-monet")` 与分页查询使用同一条件。
- 无 `artist_ids` 时临时 fallback 到 aliases 文本匹配。

- [ ] **Step 2: 实现服务函数**

新增：

```js
fetchArtworksByArtistId(artistId, options)
countArtworksByArtistId(artistId)
fetchArtworksByTagId(tagId, options)
countArtworksByTagId(tagId)
```

- [ ] **Step 3: 页面接入**

画家详情页优先使用 `artist.id` 查询。

分类页/tag 页优先使用 `tag_id` 查询。

- [ ] **Step 4: 验证兼容**

Run:

```powershell
node --test miniapp/pages/artist-detail/artist-detail.test.mjs
node --test miniapp/services/artworks-normalized.test.mjs
npm run check
npx tsc --noEmit
npm run build
```

Expected:

- 测试通过。
- 现有未规范化数据仍可 fallback。

### Task 7: 构建搜索索引文档

**Files:**

- Create: `scripts/data-governance/build-search-documents.mjs`
- Output: `miniapp/data/review/search-documents.jsonl`
- Modify: `miniapp/services/search-engine.js`
- Test: `miniapp/services/search-engine.test.mjs`

- [ ] **Step 1: 写搜索排序测试**

搜索结果优先级：

1. 标题命中。
2. 作者命中。
3. 简介命中。
4. tag 命中。

测试 `达芬奇` 应命中：

- `达·芬奇`
- `达芬奇`
- `Leonardo da Vinci`
- 包含该画家 ID 的作品。
- 标题里包含“达芬奇”的其他画家作品。

- [ ] **Step 2: 生成搜索文档**

Run:

```powershell
node scripts/data-governance/build-search-documents.mjs --out miniapp/data/review/search-documents.jsonl
```

Expected:

- 输出可用于 MiniSearch 的扁平数据。

- [ ] **Step 3: 搜索服务改造**

搜索不再扫首页样本。

搜索分页每次 20 条，触底追加下一批 20 条。

### Task 8: 云数据库写入脚本

**Files:**

- Create: `scripts/data-governance/cloudbase-apply-derived-artworks.mjs`
- Create: `scripts/data-governance/cloudbase-upsert-vocab-terms.mjs`
- Create: `scripts/data-governance/cloudbase-upsert-relationship-links.mjs`
- Test: `scripts/data-governance/cloudbase-apply-derived-artworks.test.mjs`

- [ ] **Step 1: 写 dry-run 测试**

验证：

- 默认不写库。
- 没有 `--apply` 不允许调用 update。
- 每条更新必须写入 rollback manifest。

- [ ] **Step 2: 实现 apply 脚本**

Run:

```powershell
node scripts/data-governance/cloudbase-apply-derived-artworks.mjs --dry-run --in miniapp/data/review/derived-artworks-patch.jsonl
```

Expected:

- 打印影响范围。
- 不写云数据库。

- [ ] **Step 3: 小批量 apply**

只在用户确认后运行：

```powershell
node scripts/data-governance/cloudbase-apply-derived-artworks.mjs --apply --limit 20 --in miniapp/data/review/derived-artworks-patch.jsonl --manifest miniapp/data/review/derived-artworks-apply-20.jsonl
```

Expected:

- 只更新 20 条。
- 输出 manifest 和 rollback。

### Task 9: 验收与回滚

**Files:**

- Create: `docs/art-data-normalization-acceptance.md`
- Create: `scripts/data-governance/audit-normalized-cloud-data.mjs`

- [ ] **Step 1: 写云数据审计脚本**

检查：

- published artworks 总数。
- `primary_artist_id` 非空数量。
- `artist_ids` 非空数量。
- `tag_ids` 非空数量。
- reviewed artists 数量。
- candidate artists 数量。
- unresolved artist 文本数量。
- tag 未匹配数量。

- [ ] **Step 2: 验收小程序**

在微信开发者工具验证：

- 画家详情页显示该画家的全部作品。
- 触底加载保留已加载内容。
- 分类页按 tag 查询稳定。
- 搜索 `达芬奇`、`达·芬奇`、`Leonardo` 都能返回相关内容。
- 作品详情页作者按钮跳到正确画家。

- [ ] **Step 3: 回滚路径**

若派生字段错误：

```powershell
node scripts/data-governance/cloudbase-apply-derived-artworks.mjs --rollback --in miniapp/data/review/derived-artworks-rollback.jsonl --apply
```

Expected:

- 恢复更新前的 `primary_artist_id`、`artist_ids`、`tag_ids`、`tag_labels`。
- 不删除图片。
- 不删除原始作品记录。

## 8. 风险点

1. **误把“仿某人”当成创作者。**
   - 必须使用 `role`，不能只用单个 `artist_id` 表达复杂关系。

2. **候选画家未经审核进入生产 UI。**
   - 需要 `review_status` 过滤。

3. **tag 语义混乱。**
   - 必须按 `type` 拆分 style/subject/medium/period/region。

4. **批量回填破坏现有页面。**
   - 所有写库脚本默认 dry-run。
   - 小批量 20 条验证后再扩大。

5. **搜索索引与云数据库不同步。**
   - 每次 publish 后重建搜索文档。

6. **云数据库查询性能下降。**
   - app-facing 字段必须扁平化。
   - 不在小程序端做复杂多集合 join。

7. **权威来源版权与引用问题。**
   - 只记录来源 URL 和字段依据。
   - 简介必须原创摘要，不复制长文本。

## 9. 验证指标

P0 指标：

- 规范文档完成。
- schema 能验证 reviewed/candidate/rejected。
- 候选画家、候选 tag 可生成。

P1 指标：

- 80% 以上 published artworks 有 `artist_ids`。
- 90% 以上 published artworks 有 `tag_ids`。
- 画家详情页不再依赖 `artist` 文本匹配作为主路径。
- 分类页支持 `tag_id` 查询。

P2 指标：

- 搜索支持规范化别名。
- 搜索结果分页加载。
- 作品详情页作者按钮稳定跳转。
- 新导入作品可自动生成候选关系。

P3 指标：

- 每次导入都有 audit report。
- 每次 apply 都有 rollback manifest。
- 新增画家/tag 能进入 candidate review 流程。

## 10. 推荐执行顺序

先做不写库的低风险阶段：

1. Task 1: 文档与字段规范。
2. Task 2: schema 与验证。
3. Task 3: candidate 生成。
4. Task 4: relationship link 生成。
5. Task 5: derived-artworks patch dry-run。

再做小程序读取改造：

6. Task 6: app query by IDs with fallback。
7. Task 7: search document and search pagination。

最后做云数据库小批量回填：

8. Task 8: cloud apply scripts。
9. Task 9: acceptance and rollback verification。

## 11. 执行前确认项

开始 Task 1 前无需线上权限。

开始 Task 5 前需要确认：

- 是否保留现有 `tag_keys` 文本字段作为兼容字段。
- 是否允许新增 `primary_artist_id`、`artist_ids`、`tag_ids`、`tag_labels` 到 `artworks`。

开始 Task 8 前需要确认：

- 微信云数据库环境 ID。
- `artists`、`artworks`、`vocab_terms`、relationship collections 是否已创建。
- 是否使用 20 条小批量 apply。
- rollback manifest 保存路径。

## 12. 当前任务边界

本计划只写落地方案，不执行以下动作：

- 不修改线上云数据库。
- 不导入新数据。
- 不重构小程序页面 UI。
- 不改变图片字段分流。
- 不提交 commit。

## 13. Plan Self-Review

- Spec coverage: 已覆盖画作、画家、tag、关系、搜索、审核、导入、回滚与小程序读取。
- 占位项扫描：未发现未完成标记、空白占位或模糊交付项。
- Type consistency: 计划统一使用 `artist_ids`、`tag_ids`、`review_status`、`primary_artist_id`、`vocab_terms`、`artwork_artist_links`、`artwork_tag_links`。
- Scope check: 该计划是总纲，后续执行时应按 Task 1-9 分阶段推进，每个 task 独立验收。
