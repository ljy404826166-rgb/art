# 受控分类词表与画家推荐维度规范

## 状态

- 任务：规范化分类与推荐体系，任务二
- 词表版本：`controlled-vocabulary-v1`
- 目标数据版本：`classification-v6`
- 当前状态：本地候选，未写入云端

## 1. 决策

作品的严格分类、推荐信号和画家推荐维度分开建模：

1. `classification_ids` 只保存已审核、适合分类页长期展示的标准分类。
2. `tag_ids` 保存更完整的受控元数据词条，包括媒介、技法、载体、形式、系列、版权和地区。
3. `recommendation_signal_ids` 保存任务四建立的情绪、色彩、场景、季节和策展信号。
4. 画家不是普通标签，也不写入 `vocab_terms`。画家维度直接使用 `artists._id` 和作品的 `artist_ids`。

## 2. 受控词表类型

| 类型 | 含义 | 分类页 | 首页推荐 |
|---|---|---|---|
| `style` | 流派、运动、艺术史风格 | 是 | 是 |
| `subject` | 作品描绘的题材或图像主题 | 是 | 是 |
| `period` | 十年、世纪或历史时期 | 仅 decade | 是 |
| `medium` | 媒介或作品类型 | 否 | 是 |
| `technique` | 制作技法 | 否 | 是 |
| `support` | 画布、纸本、木板等载体 | 否 | 是 |
| `format` | 习作、册页、书籍设计等形式 | 否 | 是 |
| `series` | 明确作品系列 | 否 | 是 |
| `region` | 大区 | 否 | 是 |
| `country` | 国家归属 | 否 | 是 |
| `rights` | 权利状态 | 否 | 否，仅用于准入 |

`collection` 和 `source` 仍可保留在 schema 中，但来源平台、导入批次等运行信息优先作为作品元数据，而不是推荐分类。

## 3. 稳定 ID

- ID 使用英文小写 kebab-case。
- ID 前缀必须与 `type` 一致，例如 `medium-oil-painting`。
- 中文名、英文名和显示文案改变时不修改 ID。
- 合并词条时旧 ID 不删除，设置 `publish_status=archived` 和 `merged_into_term_id`。
- 系列使用 `series-<canonical-name>`；画家专属系列额外保存 `artist_id`。

## 4. 别名规则

- 中文名、英文名和别名经过 NFKC、空白和引号规范化后必须唯一归属。
- “印象派/印象主义”“肖像画/肖像”“1880s/1880年代”等映射同一稳定 ID。
- 同一文本能够指向多个词条时不得自动发布，必须进入人工审核。
- 画家姓名和简称进入画家别名体系，不进入普通词表。
- 原始 `tag_keys` 永久保留为来源证据，不作为运行时分类依据。

## 5. 发布状态

词条同时具有：

- `review_status`: `candidate | reviewed | rejected`
- `publish_status`: `draft | published | archived`

只有 `reviewed + published` 的词条可以进入生产查询。任务二新增词条使用 `reviewed + draft`，表示语义已定义，但还没有经过迁移预演和生产发布。

分类页还要求：

- `display_enabled=true`
- `usage_scopes` 包含 `classification_filter`
- 类型为 `style`、`subject`，或 `period_kind=decade`

## 6. 层级

首版仅保存明确的直接上下级关系，例如：

- `subject-self-portrait` → `subject-portrait`
- `subject-seascape` → `subject-landscape`
- `subject-madonna-and-child` → `subject-christian`
- `style-italian-baroque` → `style-baroque`

首版查询不自动递归展开父级或子级，避免数量统计和筛选语义在客户端隐式变化。

## 7. 画家推荐维度

画家频道配置使用：

```json
{
  "dimension_type": "artist",
  "channel_key": "artist:claude-monet",
  "query_field": "artist_ids",
  "target_artist_id": "claude-monet"
}
```

每位满足以下条件的画家均拥有独立推荐维度：

1. `entity_type=person`
2. `review_status=reviewed`
3. ID 能解析到正式 `artists` 文档
4. 至少一件已发布作品引用该 ID

拥有至少8件作品仅表示适合自动成为常驻首页频道，不是创建推荐维度的必要条件。

### 7.1 非人物实体

- `organization`：保留创作者实体，但不作为“画家”频道。
- `workshop`：经策展确认后可形成工作室专题，不冒充画家本人。
- `attribution`：圈子、追随者、仿作等建立独立归属实体。
- `anonymous`：可进入“匿名艺术”专题，不形成具体画家频道。
- `unresolved`：身份解决前不得发布画家维度。
- `rejected`：不进入推荐体系。

### 7.2 未知和旧 ID

- 旧 slug 与正式 ID 仅有拼写或重音差异：映射正式 ID，旧值保留为别名。
- `French`、`Italian`、`Flemish` 等：建归属实体或映射地区，不虚构人物。
- `Unknown`、`暂不明确`：`artist_ids` 允许为空，保留 `raw_artist_text`。
- `workshop/circle/follower/after`：通过 `artwork_artist_links.role` 记录真实关系。

## 8. 与首页推荐的边界

首页可以组合以下条件：

```text
classification_ids
artist_ids
tag_ids 中的媒介/技法/系列/地区
recommendation_signal_ids
时间、质量、热度等运行字段
```

但情绪、色彩、季节、视觉气氛和临时策展内容不会进入严格分类页词表，它们在任务四的推荐信号体系中管理。

## 9. 任务二产物

- 版本化完整候选词表
- 词表校验报告
- 旧标签分流清单
- 画家推荐维度目录
- 画家维度准入与未知归属规则

任务三将依据这些产物生成作品—分类、作品—画家关系迁移方案，但不会直接修改原始 `tag_keys`。
