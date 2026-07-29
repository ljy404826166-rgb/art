# 画家信息规范化与网络核验规则 v1

## 目标

生产环境中的每条 `artists` 记录都必须具有明确的实体类型、身份状态、规范字段和可追溯来源。完整不等于强行填满：无法可靠确认的事实保存为空，并记录 `unresolved_reason`。

## 实体类型

- `person`：可确认身份的个人艺术家。
- `organization`：出版社、印刷公司、艺术社等机构。
- `workshop`：某艺术家的工作室或作坊归属。
- `attribution`：某艺术家圈子、追随者等归属描述。
- `anonymous`：明确属于匿名或未知作者。
- `unresolved`：现有署名不足以确认身份。

## 来源优先级

1. 博物馆、国家艺术馆、艺术家专业名录和档案机构。
2. Getty ULAN。
3. VIAF 及参与的国家图书馆权威记录。
4. Wikidata，用于实体发现、交叉链接和结构化事实核对。
5. 可信的学术出版物或拍卖图录，只作为辅助证据。

单一聚合页面不能独立支持有争议的身份判断。发生冲突时保留不同说法、来源和访问日期，并将 `identity_status` 设为 `conflicted`。

## 简介规则

- 个人画家的 `bio_zh` 必须为 200–300 个非空白 Unicode 字符。
- 内容必须包含生卒信息、身份或头衔、主要生涯、艺术史地位。
- 已知生年和卒年必须在简介正文中出现。
- `bio_facts.lifespan`、`title`、`career`、`standing` 必须分别保存核验后的事实摘要。
- 简介只能由已有来源支持的事实组成，不推断心理、动机或影响。
- 机构和工作室可使用同长度的实体简介，说明成立或活跃时期、业务身份、主要活动和历史地位。
- 匿名或无法确认身份的记录不生成虚构人物简介。

## 字段关系

- `style_ids`、`subject_ids`、`decade_ids` 是受控分类字段。
- `styles`、`periods` 和显示标签应从受控 ID 派生，不作为权威事实来源。
- `representative_artwork_ids` 关联本项目 `artworks._id`。
- 数据库中不存在的代表作保存在 `representative_work_labels`，不得伪造作品 ID。
- `artwork_count` 和 `classified_artwork_count` 由作品关系自动计算。
- 所有事实字段必须能追溯到 `sources` 或 `authority_ids`。

## 画家肖像字段

- 画家肖像是现有 `artists` 主记录的一部分，不建立平行的头像画家资料库。
- `portrait_url` 只保存项目受控存储中的正式展示地址。
- 只有 `portrait_status = approved` 时，前端才允许显示 `portrait_url`。
- `portrait_source` 指向原始文件说明页或机构对象页，不能指向图片搜索结果。
- `portrait_license` 和 `portrait_credit` 保存复用所需的许可证与署名信息。
- `portrait_kind` 使用照片、绘画肖像、自画像、素描、版画、雕塑或其他受控类型。
- 如果肖像来自项目现有作品，`portrait_artwork_id` 必须指向真实存在的稳定作品 ID。
- 候选、拒绝理由、文件哈希和裁切记录保存在独立审核清单，通过稳定 `artist_id` 与画家关联。
- `avatar_text` 永久保留，用于无合格肖像、非人物实体、离线和图片加载失败回退。
