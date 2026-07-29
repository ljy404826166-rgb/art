# Masterpiece 头衔（成就）系统：数据基础

状态：任务二已实现  
数据模型版本：`1`  
用户资料版本：`2`

## 1. 用户资料字段

`users` 新建文档包含：

```json
{
  "equipped_title_id": "ordinary_user",
  "achievement_schema_version": 1,
  "achievement_registered": false,
  "schema_version": 2
}
```

服务端读取旧资料时，如果佩戴ID缺失或不在当前目录中，返回 `ordinary_user`。任务三的默认登记会在旧用户下一次进入时完成持久化回填；上线任务仍会执行一次全量对账。

成就引擎完成默认登记后将 `achievement_registered` 更新为 `true`。该内部字段不返回客户端，用于保证全站有效用户数和默认头衔人数只增加一次。

## 2. 用户成就集合

集合：`user_achievements`  
权限：`ADMINONLY`

```json
{
  "_id": "ach_<48位摘要>",
  "_openid": "<可信微信身份>",
  "user_id": "usr_<48位摘要>",
  "achievement_id": "first_masterpiece",
  "grant_type": "automatic",
  "grant_reference": "",
  "catalog_version": 1,
  "schema_version": 1,
  "unlocked_at": "<serverDate>",
  "created_at": "<serverDate>",
  "updated_at": "<serverDate>"
}
```

`_id` 由可信 `_openid + achievement_id` 确定性生成。唯一索引同时约束 `_openid + achievement_id`，确保重复触发不会形成重复记录。

## 3. 聚合统计集合

集合：`achievement_statistics`  
固定文档：`global`  
权限：`ADMINONLY`

```json
{
  "kind": "global",
  "active_user_count": 0,
  "unlocked_counts": {
    "ordinary_user": 0,
    "first_masterpiece": 0,
    "treasure_with_care": 0,
    "artist_confidant": 0,
    "art_wanderer": 0,
    "learned_all_ages": 0
  },
  "catalog_version": 1,
  "schema_version": 1,
  "created_at": "<serverDate>",
  "updated_at": "<serverDate>",
  "reconciled_at": null
}
```

任务二只定义该文档的受控初始结构。创建用户、授予成就、注销账户时的事务性计数更新属于任务三。

## 4. 安全与删除

- 两个集合均不可由小程序数据库权限直接读写，只能经云函数访问。
- 客户端不得提交头衔名称、阈值、授予类型或统计数值。
- 注销账户时删除该用户的全部 `user_achievements` 文档。
- 聚合统计不保存用户身份；注销时的计数递减在授予引擎任务中实现。
- 人工授予的 `grant_reference` 只保存内部审核引用，不保存客服消息正文或用户敏感内容。
