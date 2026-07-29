# 成就系统生产部署记录（2026-07-28）

## 部署目标

- CloudBase 环境：`cloudbase-d6gvny27ib05e0ede`
- 小程序运行环境与部署环境一致
- 云函数：`accountProfile`
- 运行时：`Nodejs18.15`
- 入口：`index.main`

## 已部署资源

以下集合均已验证为 `ADMINONLY`：

- `users`
- `user_favorites`
- `user_followed_artists`
- `user_history`
- `user_achievements`
- `achievement_statistics`

新增并验证：

- `user_achievements`
  - `openid_achievement_unique`：唯一索引
  - `achievement_unlocked_at`：普通索引
- `achievement_statistics`
  - 固定统计文档：`global`

原有收藏、关注和历史唯一索引仍存在。

## 云函数验收

- `accountProfile` 状态：`Active`
- 超时：20 秒
- 内存：256 MB
- 无微信身份的管理端烟雾调用返回：
  - `InvokeResult: 0`
  - `ACCOUNT_UNAUTHENTICATED`

这表示函数运行正常，且没有允许调用参数伪造微信身份。

## 旧账户迁移

迁移脚本：

`scripts/cloudbase/migrate-achievement-accounts.mjs`

生产环境迁移结果：

- 有效账户：2
- 待迁移账户：0
- 待新增成就记录：0
- `ordinary_user`：2
- `first_masterpiece`：1
- 其他自动头衔：0
- `learned_all_ages`：0

`achievement_statistics/global` 已验证：

- `active_user_count`：2
- 目录版本：1
- 数据版本：1
- 已写入 `reconciled_at`

迁移脚本具备生产环境双重确认、幂等写入和写后复核。重复执行不会重复授予头衔或重复累计人数。

## 管理员配置

`ACHIEVEMENT_ADMIN_OPENIDS` 当前为空，因此人工授予“博古通今”的接口保持关闭。自动头衔、进度、获得率和用户佩戴不受影响。

以后启用人工授予时，应先把受信任管理员的微信 OPENID 以逗号分隔写入本机部署环境，再重新部署 `accountProfile`；不要把真实 OPENID 提交到仓库。
