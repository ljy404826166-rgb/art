# 小程序头衔成就客户端合同（任务四）

## 目标

为“我的成就”页面提供稳定的数据读取与佩戴能力。任务四完成云端接口、客户端服务与缓存；任务五已在此合同之上实现页面。

## 云函数接口

云函数名称：`accountProfile`

### 读取成就状态

请求：

```json
{
  "action": "getAchievementState"
}
```

成功响应的 `data`：

```json
{
  "profile": {
    "equipped_title_id": "ordinary_user",
    "equipped_title": {
      "id": "ordinary_user",
      "title": "普通用户"
    }
  },
  "achievements": {
    "catalog_version": 1,
    "equipped_title": {
      "id": "ordinary_user",
      "title": "普通用户"
    },
    "active_user_count": 100,
    "statistics_updated_at": null,
    "items": [
      {
        "id": "ordinary_user",
        "title": "普通用户",
        "description": "进入 Masterpiece，开始自己的艺术探索。",
        "requirement": "所有用户默认拥有",
        "grant_type": "default",
        "unlocked": true,
        "equipped": true,
        "unlocked_at": null,
        "progress": {
          "current": 1,
          "target": 1
        },
        "unlocked_user_count": 100,
        "unlock_rate": "100.00%"
      }
    ]
  }
}
```

读取时会根据云端收藏、关注和浏览数据补发已经满足条件但尚未登记的自动成就，便于旧用户平滑升级。

### 佩戴头衔

请求：

```json
{
  "action": "equipAchievement",
  "achievement_id": "first_masterpiece"
}
```

服务端会校验头衔是否存在、用户是否已获得。默认头衔“普通用户”始终可以佩戴；未获得的其他头衔返回 `ACHIEVEMENT_NOT_UNLOCKED`。成功响应与读取接口一致，并返回更新后的 `profile` 和完整 `achievements`。

`users.equipped_title_id` 是当前佩戴状态的唯一云端事实来源，因此同一微信账号在不同设备登录后会获得一致结果。

## 进度与占比

- 阈值成就的 `progress.current` 不超过 `progress.target`。
- 人工成就未获得时为 `0 / 1`，获得后为 `1 / 1`。
- `unlock_rate` 的分母为全部未注销用户，服务端固定格式化为两位小数。
- `active_user_count` 为零时，占比返回 `0.00%`。

## 客户端服务

入口：`miniapp/services/account.js`

- `loadAchievementState(options)`：优先读取有效缓存，必要时请求云端。
- `equipAchievement({ achievementId })`：提交佩戴请求，并同时更新资料缓存和成就缓存。
- `readCachedAchievementState()`：供页面首屏读取。
- `clearCachedAchievementState()`：显式失效成就缓存。

账户资料缓存版本为 `v2`，包含当前佩戴头衔；旧 `v1` 缓存不会被继续使用。成就状态缓存版本为 `v1`，有效期 15 分钟。收藏、关注或浏览历史完成云端同步并触发成就计算后，客户端会清除成就缓存，避免展示旧进度。

客户端对缺失或异常的佩戴字段使用：

```json
{
  "id": "ordinary_user",
  "title": "普通用户"
}
```

作为安全回退，但云端返回仍是最终依据。

## 数据清理边界

- “清除本机个人数据”会清除账号资料与成就状态缓存，不删除云端成就。
- “注销账号”会删除用户成就记录，并从统计中的活跃用户及已获得人数中移除。
- 下载记录和系统相册图片不属于头衔成就数据。

## 后续页面接入

“我的成就”页面位于 `miniapp/pages/achievements/achievements`，只消费本文合同，不直接查询云数据库。页面先用 `readCachedAchievementState()` 完成首屏，再调用 `loadAchievementState()` 更新；佩戴操作统一调用 `equipAchievement()`。

页面实现以下状态：

- 设计稿中的成就进度卡、六个头衔卡片与两位小数获得率。
- 已佩戴、已达成和未获得三种明确文字状态。
- 未获得头衔显示当前进度；已达成但未佩戴的头衔可点击佩戴。
- 首次加载骨架、无缓存错误页、缓存可用但云端失败提示及重试入口。
- “我的”页当前头衔标签和“账户与数据”菜单均可进入该页面。
