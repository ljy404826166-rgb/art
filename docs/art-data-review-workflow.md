# 艺术数据审核流程

## 目标

本文件定义画家、画作、tag、词表和关系的审核流程。目标是让新增数据先进入候选池，再经过人工确认后发布到小程序可读取的正式字段。

## 审核状态

### `candidate`

候选数据，来源包括：

- 从 `artworks.artist` 自动提取的新画家。
- 从 `tag_keys` 自动提取的新 tag。
- 从文本规则推断出的画作-画家关系。
- 从批量导入文件中新出现的国家、地区、媒介、年代。

候选数据可以用于内部排查，但不能被当作最终权威数据。

### `reviewed`

已审核数据，必须满足：

- 名称、别名、年代、国家或来源字段已检查。
- 复杂关系已确认，例如 `after`、`attributed_to`、`workshop`。
- 画家记录至少包含一个来源或明确说明来自当前馆藏数据。
- tag 类型明确，不混用流派、题材、媒介和年代。
- 可以进入小程序生产展示。

### `rejected`

废弃数据，适用于：

- 错误拆分的画家。
- 重复 tag。
- 错误的画作归属。
- 无法确认且不应展示的候选项。

`rejected` 记录不应直接删除，应保留用于后续去重和审计。

## 画家审核流程

### 1. 生成候选画家

来源字段：

```text
artworks.artist
artists.aliases
artwork_artist_links.source_text
```

候选画家至少应包含：

```json
{
  "_id": "jean-baptist-lodewijk-maes",
  "name_zh": "让-巴蒂斯特·洛德韦克·马斯",
  "name_en": "Jean Baptist Lodewijk Maes",
  "aliases": [
    "让-巴蒂斯特·洛德韦克·马斯（Jean Baptist Lodewijk Maes）",
    "让-巴蒂斯特·洛德韦克·马斯",
    "Jean Baptist Lodewijk Maes"
  ],
  "review_status": "candidate"
}
```

### 2. 人工核验

检查项：

- 中文名是否合理。
- 英文名是否存在权威来源。
- 生卒年是否可靠。
- 国家、地区、流派是否可信。
- 是否只是作品题名中的人物、出版者或仿作对象。
- 是否应该与已有画家合并。

### 3. 发布 reviewed

通过审核后：

- 设置 `review_status = reviewed`。
- 补齐 `sources`。
- 补齐 `authority_ids`，如果没有权威 ID，需在 `sources` 中说明依据。
- 更新 `aliases`，保证能覆盖现有作品中的作者写法。

## Tag 与词表审核流程

### 1. 生成候选词表

来源字段：

```text
artworks.tag_keys
artworks.tags
artworks.medium
artworks.year_and_place
artists.styles
artists.periods
artists.country
artists.region
```

### 2. 分类类型

每个 tag 必须归入一个明确 `type`：

- `style`: 流派，例如“印象派”
- `subject`: 题材，例如“肖像画”
- `medium`: 媒介，例如“油画”
- `period`: 年代，例如“19世纪”
- `region`: 地区，例如“欧洲”
- `country`: 国家，例如“法国”
- `collection`: 收藏地，例如“奥赛博物馆”
- `source`: 数据来源，例如“Artvee”

### 3. 合并重复项

示例：

```text
达芬奇
达·芬奇
Leonardo da Vinci
Da Vinci
```

这些不应成为多个互相独立的 tag，应作为画家 aliases 或统一词表项的别名处理。

### 4. 发布 reviewed

发布前检查：

- `_id` 稳定。
- `label_zh` 与 `label_en` 明确。
- `type` 不为空。
- aliases 不与其他 reviewed 词表冲突。

## 画作-画家关系审核流程

### 1. 自动推断

根据 `artworks.artist` 生成候选关系。

常见模式：

```text
克洛德·莫奈（Claude Monet, 1840-1926） -> creator
after Jacques Louis David -> after
Studio of Georges Rouget -> workshop
attributed to Rembrandt -> attributed_to
```

### 2. 人工确认

必须人工确认的情况：

- 作品名中包含另一位画家的名字。
- 作者文本含有“仿”“after”“attributed”“workshop”“circle of”“school of”。
- 作者文本包含多个名字。
- 作者是出版商、印刷商、工作室或未知机构。

### 3. 发布关系

发布后的关系用于回填：

```text
artworks.primary_artist_id
artworks.artist_ids
artworks.artist_labels
artworks.artist_relation_roles
```

## 画作-tag 关系审核流程

### 1. 自动推断

从 `tag_keys`、`medium`、`year_and_place` 生成候选关系。

示例：

```text
tag_keys: ["肖像画", "新古典主义", "油画", "19世纪"]
```

生成：

```text
subject-portrait
style-neoclassicism
medium-oil
period-19th-century
```

### 2. 人工确认

需要确认：

- tag 是否归类正确。
- 是否存在重复词。
- 是否应该作为画家别名，而不是 tag。
- 是否属于来源噪声，例如“Artvee 图像记录”。

## 发布流程

每次发布应分为四步：

1. `dry-run`
   - 生成 patch。
   - 生成 rollback。
   - 输出影响数量。

2. 小批量 `apply`
   - 默认 20 条。
   - 检查小程序页面是否正常。

3. 扩大批量
   - 100 条。
   - 500 条。
   - 全量。

4. 验收
   - 画家详情页作品数量一致。
   - 分类页 tag 查询一致。
   - 搜索结果可分页。
   - 作品详情页作者按钮跳转正确。

## 回滚流程

每次写库前必须保存：

```json
{
  "_id": "artwork_xxx",
  "previous": {
    "primary_artist_id": "",
    "artist_ids": [],
    "tag_ids": []
  },
  "next": {
    "primary_artist_id": "claude-monet",
    "artist_ids": ["claude-monet"],
    "tag_ids": ["style-impressionism"]
  },
  "updated_at": "2026-06-30T00:00:00.000Z"
}
```

回滚只恢复数据库派生字段，不删除图片，不删除原始作品，不删除已审核来源文件。

## 审核责任边界

脚本负责：

- 生成候选。
- 检测重复。
- 检测缺失字段。
- 输出风险报告。
- 生成 patch 和 rollback。

人工负责：

- 判断画家身份是否准确。
- 判断关系角色是否正确。
- 判断 tag 类型是否正确。
- 决定是否发布 reviewed。

小程序负责：

- 读取 reviewed 数据。
- 展示 fallback 或空状态。
- 不承担数据审核。
