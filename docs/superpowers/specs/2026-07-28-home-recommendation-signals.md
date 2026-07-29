# 首页推荐信号体系

## 状态

- 任务：规范化分类与推荐体系，任务四
- 信号版本：`recommendation-signals-v1`
- 频道版本：`recommendation-channels-v1`
- 当前状态：只读云端预演，未执行生产写入

## 数据边界

首页推荐和分类页面使用不同的内容边界：

- `classification_ids`：长期稳定、可被用户严格筛选的流派、题材和 decade。
- `tag_ids`：媒介、技法、载体、系列、地区等受控元数据。
- `artist_ids`：规范画家实体，每位已审核且有作品的 person 画家都是独立推荐维度。
- `recommendation_signal_ids`：色彩、视觉语言、场景、母题、活动、艺术家阶段和临时策展专题。

推荐信号必须设置 `classification_filter=false`，不得进入分类页目录。

## 推荐信号

任务三留下的旧标签全部进入版本化信号目录；分类修订和增量导入中产生的“花鸟虫兽”“西班牙浪漫主义”“英国浪漫主义”等宽泛语义也只进入推荐信号，不回写严格分类。当前目录共 88 个信号，分为：

1. `palette`：色彩倾向。
2. `visual_language`：构图、光色、形态与运动。
3. `setting`：自然、户外、花园、咖啡馆等场景。
4. `motif`：人物、物件或命名主题。
5. `activity`：旅行、垂钓、缝纫等活动。
6. `cultural_theme`：东方题材、锦绘、武者绘等文化专题。
7. `chronology`：19 世纪末、20 世纪初等宽泛年代。
8. `artist_period`：阿尔勒、圣雷米等画家创作阶段。
9. `series`：白杨树、威尼斯等系列。
10. `design_theme`：设计、海报、礼拜堂和总体艺术。

原始 `tag_keys` 继续作为来源证据保留，运行时首页查询迁移至信号 ID。

## 作品推荐字段

每件作品生成：

```json
{
  "recommendation_signal_ids": [],
  "recommendation_status": "eligible",
  "recommendation_ineligibility_reasons": [],
  "recommendation_quality_score": 0.9,
  "random_bucket": 1234,
  "recommendation_signal_version": "recommendation-signals-v1",
  "recommendation_random_version": "fnv1a-v1"
}
```

`random_bucket` 由作品 ID 稳定计算，范围为 0–9999。它用于低成本随机窗口选择，不随发布时间和数据库自然顺序变化。

只有已发布、具备可用图片且至少拥有一个规范推荐维度的作品进入推荐池。质量分只用于同等候选中的轻量排序，不替代人工审核或用户行为信号。

## 频道发布规则

- 跨画家频道：不少于 8 件作品、不少于 3 位画家、最大单一画家占比不超过 65%。
- 画家聚焦频道：不少于 8 件作品，并明确记录 `artist_scope_id`。
- 少于 8 件的频道保留为 `long_tail`，可被搜索或手动策展，但不自动进入首页。
- 草稿标准词条形成 candidate 频道，不自动发布。
- 每位已审核且至少有一件合格作品的 person 画家都创建 `artist:<artist_id>` 频道；8 件门槛只决定自动展示资格。

## 后续发布

任务四只生成信号、作品字段、频道目录和回滚快照。下一阶段在审核产物后批量写入云端，并将首页栏目发现从旧标签切换到已发布频道。
