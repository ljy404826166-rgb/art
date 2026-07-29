# 艺术数据库规范化模型

## 目标

本文件定义 MASTERPIECE / 传世杰作 项目的长期数据模型。目标是让画作、画家、标签、词表和关系拥有稳定 ID，避免继续依赖不稳定的文本匹配。

小程序可以继续读取微信云数据库，但应逐步从以下旧模式：

```text
artworks.artist 文本
artworks.tag_keys 文本数组
页面临时文本匹配
```

迁移到以下新模式：

```text
artists 稳定画家实体
vocab_terms 稳定词表实体
artwork_artist_links 显式画作-画家关系
artwork_tag_links 显式画作-tag 关系
artworks 派生 artist_ids / tag_ids
```

## 总体原则

1. 文本字段可以展示，但不能作为长期查询主键。
2. 每个画家、tag、媒介、年代、地区都应有稳定 `_id`。
3. 原始字段保留，规范字段作为派生结果新增。
4. 复杂归属关系必须显式表达，不能全部当作创作者。
5. 小程序读取已发布派生字段，不在客户端做大规模数据清洗。
6. 所有批量回填必须有 dry-run、manifest 和 rollback。

## 集合设计

### `artists`

保存画家实体。生产页面默认展示 `review_status = reviewed` 的记录。

推荐字段：

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
  "sources": [
    {
      "title": "Wikidata: Claude Monet",
      "url": "https://www.wikidata.org/wiki/Q296",
      "fields": ["name_en", "birth_year", "death_year"]
    }
  ],
  "review_status": "reviewed",
  "reviewed_by": "codex-assisted-review",
  "reviewed_at": "2026-06-30",
  "updated_at": "2026-06-30"
}
```

字段规则：

- `_id`: 稳定 slug，使用小写英文和短横线，例如 `claude-monet`。
- `name_zh`: 中文显示名。
- `name_en`: 英文显示名。
- `aliases`: 所有可用于匹配的别名，必须包含现有 `artworks.artist` 中常见写法。
- `authority_ids`: 外部权威 ID，可为空，但 reviewed 记录至少应有一个来源。
- `review_status`: 只允许 `candidate`、`reviewed`、`rejected`。

### `artworks`

保存公开画作实体。保留原始字段，并新增规范派生字段。

推荐新增字段：

```json
{
  "raw_artist_text": "克洛德·莫奈（Claude Monet, 1840-1926）",
  "primary_artist_id": "claude-monet",
  "artist_ids": ["claude-monet"],
  "artist_labels": ["克洛德·莫奈"],
  "artist_relation_roles": ["creator"],
  "tag_ids": ["subject-water-lilies", "style-impressionism", "medium-oil"],
  "tag_labels": ["睡莲", "印象派", "油画"],
  "medium_id": "medium-oil",
  "period_id": "period-19th-century",
  "location_id": "collection-musee-orsay",
  "normalization_status": "reviewed",
  "normalization_updated_at": "2026-06-30"
}
```

字段规则：

- `artist` 继续保留，用作展示和回溯，不作为主查询依据。
- `raw_artist_text` 保存导入时的原始作者文本。
- `primary_artist_id` 用于作品详情页作者按钮。
- `artist_ids` 用于画家详情页查询相关作品。
- `tag_ids` 用于分类页、标签页、首页“查看更多”。
- `thumbnail_url`、`display_url`、`download_url` 不改变语义。

### `vocab_terms`

保存规范词表，包括流派、题材、媒介、年代、地区、国家、收藏地和来源。

推荐字段：

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
  "sort_order": 100,
  "updated_at": "2026-06-30"
}
```

推荐 `type`：

- `style`: 流派
- `subject`: 题材
- `medium`: 媒介
- `period`: 年代
- `region`: 地区
- `country`: 国家
- `collection`: 收藏地
- `source`: 数据来源

### `artwork_artist_links`

保存画作与画家的显式关系。

```json
{
  "_id": "link_artwork_xxx_claude-monet_creator",
  "artwork_id": "artwork_xxx",
  "artist_id": "claude-monet",
  "role": "creator",
  "confidence": "manual",
  "source_field": "artist",
  "source_text": "克洛德·莫奈（Claude Monet, 1840-1926）",
  "review_status": "reviewed",
  "updated_at": "2026-06-30"
}
```

推荐 `role`：

- `creator`: 明确创作者
- `after`: 仿某人、after
- `attributed_to`: 归属或传为某人
- `workshop`: 工作室
- `publisher`: 出版、印刷或发行者
- `subject`: 作品描绘对象，不是创作者
- `unknown`: 未确认

### `artwork_tag_links`

保存画作与词表项的显式关系。

```json
{
  "_id": "link_artwork_xxx_style-impressionism",
  "artwork_id": "artwork_xxx",
  "tag_id": "style-impressionism",
  "tag_type": "style",
  "confidence": "inferred",
  "source_field": "tag_keys",
  "source_text": "印象派",
  "review_status": "reviewed",
  "updated_at": "2026-06-30"
}
```

## 命名规则

### Entity ID

画家：

```text
claude-monet
vincent-van-gogh
leonardo-da-vinci
```

词表：

```text
style-impressionism
subject-portrait
medium-oil
period-19th-century
country-france
region-europe
```

关系：

```text
link_<artwork_id>_<entity_id>_<role>
```

### 状态字段

统一状态：

```text
candidate
reviewed
rejected
```

含义：

- `candidate`: 由脚本生成或低置信匹配产生，允许内部查看，不作为权威数据。
- `reviewed`: 经人工确认，可以进入生产 UI。
- `rejected`: 明确不采用，保留用于去重和审计。

### 置信度字段

推荐值：

```text
exact
inferred
manual
low_confidence
```

含义：

- `exact`: ID 或完整别名精确匹配。
- `inferred`: 由文本、tag 或规则推断。
- `manual`: 人工确认。
- `low_confidence`: 低置信，仅用于候选。

## 小程序读取规则

### 作品详情页

优先读取：

```text
artwork.primary_artist_id
artwork.artist_labels[0]
```

作者按钮跳转：

```text
/pages/artist-detail/artist-detail?id=<primary_artist_id>
```

若 `primary_artist_id` 缺失，可临时 fallback 到 `artist` 文本匹配，但应记录为待治理数据。

### 画家详情页

主查询：

```text
where artist_ids contains artist_id
```

过渡期 fallback：

```text
where artist matches artist.aliases
```

### 分类页与标签页

主查询：

```text
where tag_ids contains tag_id
```

过渡期 fallback：

```text
where tag_keys contains label_zh
```

### 搜索

搜索应读取规范化后的扁平字段：

```text
title_text
artist_text
tag_text
description_text
```

排序权重：

1. 作品名称
2. 作者名称和别名
3. tag / 流派 / 媒介 / 年代
4. 简介内容

## 迁移兼容策略

迁移期间允许双轨存在：

```text
旧字段：artist / tag_keys
新字段：primary_artist_id / artist_ids / tag_ids
```

客户端查询顺序：

1. 优先使用新字段。
2. 新字段缺失时 fallback 到旧字段。
3. fallback 命中时记录审计报告。
4. 数据治理脚本逐步减少 fallback 数量。

## 不变约束

- 不删除原始 `artist`、`tag_keys`、`tags_text` 字段。
- 不修改图片分流字段语义。
- 不在小程序客户端写入治理字段。
- 不让未审核数据替代已审核数据。
- 不直接用来源平台名称作为收藏地或权威字段。
