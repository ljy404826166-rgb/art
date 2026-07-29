# Masterpiece 头衔（成就）系统：云端授予引擎

状态：任务三已实现  
依赖：目录版本 `1`、数据模型版本 `1`

## 1. 默认登记

用户首次创建资料或旧用户首次重新进入时，云端在事务中：

1. 检查 `users.achievement_registered`。
2. 创建确定性的 `ordinary_user` 成就记录。
3. 将 `achievement_statistics/global.active_user_count` 加一。
4. 将默认头衔获得人数加一。
5. 将用户的 `achievement_registered` 更新为 `true`。

重复请求只读取已经完成的登记，不重复增加任何计数。

## 2. 自动授予

`syncLibrary` 完成云端合并后，从返回的去重记录计算：

- `favorite_unique_count`
- `followed_artist_unique_count`
- `history_unique_count`

只统计 `deleted !== true` 的不同记录。满足目录阈值后，在多文档事务中创建确定性成就记录并增加对应聚合计数。事务发现记录已存在时返回 `granted: false`，不会重复计数。

同步响应增加：

```json
{
  "achievements": {
    "metrics": {
      "favorite_unique_count": 20,
      "followed_artist_unique_count": 10,
      "history_unique_count": 50
    },
    "newly_unlocked": [
      "first_masterpiece",
      "treasure_with_care",
      "artist_confidant",
      "art_wanderer"
    ]
  }
}
```

当前客户端可以忽略这个附加字段；后续通知任务使用 `newly_unlocked`。

## 3. 人工授予

云函数支持受保护动作 `adminGrantAchievement`，但小程序不提供普通用户入口。

请求字段：

```json
{
  "action": "adminGrantAchievement",
  "target_user_id": "usr_<48位摘要>",
  "achievement_id": "learned_all_ages",
  "grant_reference": "support-case-2026-18"
}
```

安全边界：

- 调用者身份只读取 `Cloud.getWXContext().OPENID`。
- 调用者必须出现在环境变量 `ACHIEVEMENT_ADMIN_OPENIDS` 的逗号分隔白名单中。
- 环境变量为空时，人工授予全部关闭。
- 客户端传入的管理员标志、OPENID 或账户状态均不可信且不会使用。
- 只能授予目录中 `grant_type = manual` 的头衔。
- 必须填写内部审核引用；不保存客服消息正文。

## 4. 注销

注销开始后，云端读取用户已获得的头衔，在事务中：

- 有效用户总数减一；
- 每个已获得头衔人数减一；
- 用户登记状态设为 `false`；
- 当前佩戴头衔恢复为 `ordinary_user`。

随后删除该用户的全部成就记录。重复注销或中断后重试不会再次递减。

## 5. 并发和修复边界

- 首次建号使用事务检查确定性用户文档，避免并发请求覆盖登记状态。
- 默认登记、自动授予、人工授予和注销计数都使用事务。
- 计数最低为零，成就人数不会超过后续接口计算中的有效用户人数。
- 定期全量对账与历史用户批量迁移保留到迁移和上线任务执行。
