# 画廊 Art Archive

面向移动端上线的绘画艺术资源库原型，用于欣赏、下载、收藏和科普公开领域艺术品。当前项目是 Vite + Capacitor 应用，数据源标准化接入 Supabase。

## 功能

- 首页推荐、搜索、标签内容流
- 分类页标签筛选
- 作品详情、艺术家作品页、标签作品页
- 本地收藏与浏览历史，登录后可同步到 Supabase 用户表
- Chicago Art Institute 官方 API 导入脚本
- Artvee 页面元数据草稿导入脚本

## 快速开始

```bash
npm.cmd run dev
```

打开 `http://127.0.0.1:4173/`。

## Supabase 初始化

1. 在 Supabase SQL Editor 执行 `supabase/schema.sql`。
2. 在 Supabase SQL Editor 执行 `supabase/app_user_data.sql`。
3. 复制 `.env.example` 为 `.env.local`，填入：

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
```

4. 如果要运行导入脚本，另行在本地 shell 或 `.env` 中提供：

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key_never_commit_real_value
```

不要把 service role key 放进 `src/`、`public/` 或任何前端可见文件。

## 数据导入

```bash
npm.cmd run db:ingest:artic
```

```powershell
$env:ARTVEE_URLS="https://artvee.com/..."; npm.cmd run db:ingest:artvee
```

Artvee 记录默认保持 `draft`，发布前需要人工确认来源、作者、年代、许可证和图片质量。

## Verification

Run before Android Studio testing:

```bash
npm.cmd run check
npx.cmd tsc --noEmit
npm.cmd run build
npx.cmd cap sync android
```

The web preview runs at `http://127.0.0.1:4173/`. Android Studio reads the synced `dist` output through Capacitor.
