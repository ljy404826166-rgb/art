# Image, Empty, and Error States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consistent image loading, image failure, empty, loading, and page error states to the mobile art gallery app without changing data, auth, database, or unrelated UI behavior.

**Architecture:** Keep the implementation local to the existing frontend. Add small reusable render helpers in `src/app.js` and a restrained shared visual system in `src/styles.css`, then replace scattered ad hoc state markup only where the current pages already render loading, error, empty, or image fallback states.

**Tech Stack:** Vanilla JavaScript, Vite, existing CSS, existing inline SVG/icon style. No new runtime dependency is required.

---

## 1. 本阶段目标

- 统一图片加载中状态：作品卡片、分类卡片、详情页大图、下载记录缩略图、头像。
- 统一图片加载失败状态：避免 broken image 和大面积空白。
- 统一页面级错误状态：首页、分类页、详情页、下载管理页。
- 统一空状态：收藏、浏览历史、下载管理、分类结果、搜索结果。
- 保持艺术画廊气质：克制、干净、留白、低对比度、轻量细线图标。
- 保持移动端布局稳定：图片失败时卡片比例不塌，详情大图区域不跳动。

## 2. 不做什么

- 不修改 RBAC / Supabase / Auth / RLS 逻辑。
- 不修改数据库 SQL、seed 脚本、验证脚本。
- 不重做整体 UI，不调整首页卡片主体、分类主体、详情页主体、底部导航。
- 不引入大型图片、状态管理或动效库。
- 不自动 commit、merge 或 push。
- 不改变现有路由和数据加载流程，只在现有结果分支上替换 UI 状态表达。

## 3. 文件结构

- Modify: `src/app.js`
  - 新增 `ImageWithFallback`、`ImagePlaceholder`、`EmptyState`、`ErrorState`、`LoadingState` 对应的轻量渲染函数。
  - 扩展现有 `attachImageFallback` 或用新的统一图片状态函数替代其内部逻辑。
  - 替换首页、分类页、详情页、下载管理页现有散落的 `.empty-state` / 错误文案。
- Modify: `src/styles.css`
  - 新增统一状态样式：图片占位、页面空状态、页面错误状态、页面加载状态。
  - 补充 `prefers-reduced-motion` 降级。
  - 保留现有 `.empty-state` 兼容样式，避免旧节点失控。
- No change: `index.html`
  - 除非实施时发现缺少全局 aria-live 容器，否则不修改。
- No change: `supabase/**`, `scripts/**`, SQL files, seed files, validation files.

## 4. 需要新增的组件

### ImageWithFallback

职责：
- 接收图片 URL、alt、variant、className。
- 在图片加载前为容器添加 loading 状态。
- 图片加载成功后添加 loaded 状态。
- 图片加载失败或 URL 为空时切换为 placeholder 状态。

建议 variant：
- `card`：首页作品卡片、推荐卡片。
- `category`：分类作品卡片。
- `detail`：详情页大图。
- `thumb`：下载管理缩略图。
- `avatar`：用户头像。

### ImagePlaceholder

职责：
- 输出统一图片占位 UI。
- 支持 `loading` 和 `error` 两种状态。
- 根据 variant 控制是否显示文案。

文案策略：
- 卡片缩略图：只显示细线图标，不显示长文案。
- 详情页大图：显示“图像暂不可见”。
- 下载缩略图：只显示小图标。
- 头像：显示用户首字或默认文字，不显示错误文案。

### EmptyState

职责：
- 输出统一空状态。
- 接收 title、description、icon、compact。

使用场景：
- 暂无收藏。
- 暂无浏览历史。
- 暂无下载内容。
- 分类结果为空。
- 搜索结果为空。

### ErrorState

职责：
- 输出页面级错误状态。
- 包含标题、说明、“重试”按钮。
- 重试按钮调用现有数据加载函数，不新增数据逻辑。

使用场景：
- 首页数据加载失败。
- 分类页数据加载失败。
- 详情页数据加载失败。
- 下载管理页读取本地记录失败。

### LoadingState

职责：
- 输出页面级加载状态。
- 替代当前分散的“正在加载 paintings...”文字。
- 使用轻量静态或低强度 loading UI。

## 5. 需要修改的页面

### 首页作品卡片

当前相关位置：
- `src/app.js` 中 `recommendationCard`
- `src/app.js` 中 `artworkCard`
- `src/app.js` 中 `renderHome`
- `src/styles.css` 中 `.recommendation-image`、`.image-button`、`.empty-state`

计划：
- 保持卡片结构和比例。
- 将图片加载前的区域设为浅灰纸感底。
- 图片失败时显示统一占位，不出现 broken image。
- 首页错误和空数据使用 `ErrorState` / `EmptyState`。

### 分类页作品卡片

当前相关位置：
- `src/app.js` 中 `categoryArtworkCard`
- `src/app.js` 中 `renderCategoryCards`
- `src/styles.css` 中分类图片样式和 `.empty-state`

计划：
- 分类缩略图接入统一图片 fallback。
- 分类加载失败使用 `ErrorState`。
- 分类结果为空使用 `EmptyState`，文案为“当前分类暂无作品”。

### 详情页大图

当前相关位置：
- `src/app.js` 中 `openDrawer`
- `src/app.js` 中 `nodes.drawerImage`
- `src/styles.css` 中 `.detail-hero-image`

计划：
- 详情大图加载前保留稳定高度。
- 详情大图加载失败时显示大图占位。
- 不改变收藏、下载按钮逻辑。
- 不调整详情页主体信息布局。

### 我的页头像或统计区域

当前相关位置：
- `src/app.js` 中 profile shell/avatar markup
- `src/styles.css` 中 `.profile-avatar`

计划：
- 当前头像是文字头像时，保留现有表达。
- 如果后续存在头像图片 URL，失败时降级为文字头像。
- 不修改统计项、菜单项、底部导航。

### 收藏 / 浏览历史 / 下载管理空状态

当前相关位置：
- `src/app.js` 中收藏、历史、下载管理路由渲染分支。
- `src/app.js` 中 `renderDownloadRecords`
- `src/styles.css` 中 `.profile-route-empty`

计划：
- 替换为统一 `EmptyState`。
- 下载管理继续展示现有下载记录结构，不修改本地存储格式。
- 空状态只影响无记录时的 UI。

## 6. 图片加载失败处理逻辑

- 如果 URL 为空：不创建真实图片请求，直接显示 error placeholder。
- 如果 URL 存在：先显示 loading placeholder，同时加载图片。
- 图片 `load` 成功：显示图片并标记 loaded。
- 图片 `error`：移除或隐藏失败图片，显示 error placeholder。
- 不将 `/assets/icon.svg` 作为所有图片失败的视觉替代，避免品牌图标在作品卡片中误导用户。
- 保留原 `alt` 信息；失败占位使用 `role="img"` 或合适 aria label。

## 7. 图片加载中处理逻辑

- 图片容器默认有稳定尺寸或比例。
- loading 状态显示浅灰背景和细腻骨架。
- 不依赖强动画；动画只作为增强。
- `prefers-reduced-motion: reduce` 时关闭 shimmer/淡入，只保留静态占位。
- 详情页大图 loading 状态设置最小高度，避免内容上跳。

## 8. 页面级错误状态处理逻辑

- 首页：`state.error` 时渲染 `ErrorState`，按钮触发现有初始化或重新加载函数。
- 分类页：分类列表加载失败时渲染 `ErrorState`，按钮触发现有拉取逻辑。
- 详情页：找不到作品或详情数据异常时渲染详情页区域内 `ErrorState`。
- 下载管理页：读取本地下载记录异常时渲染 `ErrorState`，按钮重新读取 localStorage。
- 不直接向用户展示原始异常堆栈；详细错误保留在控制台。

## 9. 空状态处理逻辑

- 收藏为空：标题“暂无收藏”，说明“收藏喜欢的作品后会显示在这里。”
- 浏览历史为空：标题“暂无浏览历史”，说明“浏览过的作品会保存在这里。”
- 下载内容为空：标题“暂无下载内容”，说明“下载过的作品会显示在这里。”
- 分类结果为空：标题“当前分类暂无作品”，说明“可以切换分类或稍后再试。”
- 搜索结果为空：标题“没有找到匹配作品”，说明“尝试更换关键词。”
- 空状态高度应适中，避免把页面撑成错误页。

## 10. CSS 设计规范

### 占位背景

- 主背景：`#f5f3f0` 或接近现有页面浅灰。
- 边界：`rgba(32, 28, 24, 0.08)`。
- 可加入极轻纸张质感，但不使用明显纹理图。

### 图标大小

- 缩略图占位：20-24px。
- 详情大图占位：32-40px。
- 页面空/错状态图标：36-44px。
- 头像占位：保持现有头像尺寸。

### 文案样式

- 标题：13-15px，中等字重，深灰。
- 说明：12-13px，浅灰，行高舒适。
- 卡片级占位尽量少文案。

### 按钮样式

- 错误状态按钮使用轻量描边。
- 高度 32-36px。
- 圆角沿用现有系统，不做厚重胶囊按钮。
- 文案为“重试”。

### 卡片比例

- 首页作品卡片沿用现有图片容器尺寸。
- 分类作品卡片沿用现有缩略图比例。
- 详情大图设置稳定 min-height 或 aspect-ratio。
- 下载缩略图保持现有固定尺寸。

## 11. 是否需要使用现有图标库

- 优先使用当前项目已经存在的图标风格。
- 如果当前没有安装图标库，不新增依赖。
- 与底部导航、详情页按钮保持线性、轻量、黑白灰风格。

## 12. 是否需要新增 SVG 图标

- 可以新增极少量内联 SVG 图标函数。
- 推荐两个图标：
  - 图片/画框占位图标。
  - 空状态/页面状态图标。
- SVG 保持 stroke 风格，不使用填充插画。

## 13. 如何避免图片失败时出现大面积空白

- 图片容器始终保留背景、尺寸和比例。
- 失败后不要只移除图片，要立即显示 `ImagePlaceholder`。
- 详情页大图失败时保留 hero 区域高度。
- 下载缩略图失败时显示固定尺寸 placeholder。
- 对旧数据空 URL 直接走 placeholder，不等待浏览器 error。

## 14. 如何兼容旧数据中 imageUrl 为空或失效

- 统一 `imageUrl` 解析后仍为空时，视为 missing image。
- 对 `displayUrl`、`image_url`、`source_url` 等字段的兼容不扩展数据模型，只沿用现有 `imageUrl(item)` 返回值。
- URL 失效时由图片 error 事件切换 UI。
- 下载记录旧数据没有 `thumbnailUrl` 时显示缩略图占位。

## 15. 验证方式

- 运行静态检查：`npm.cmd run check`。
- 运行构建：`npm.cmd run build`。
- 如果项目已有 TypeScript 配置，再运行：`npx.cmd tsc --noEmit`。
- 手动将某张作品图片 URL 改为无效值，确认首页和分类页卡片不出现空白。
- 手动打开详情页并模拟大图失败，确认详情大图区域不跳动。
- 清空或模拟收藏、历史、下载记录为空，确认空状态文案正确。
- 模拟首页或分类数据加载失败，确认错误状态有标题、说明和重试按钮。
- 在移动端宽度下检查：占位不挤压底部导航、不破坏卡片比例。
- 开启 reduced motion 检查：无强制动画依赖。

## 16. 风险点

- 现有 `.empty-state` 在多个区域重复定义，替换时需要避免影响非目标区域。
- 图片容器比例分散在 CSS 中，新增 placeholder 时要复用现有尺寸，避免布局回归。
- 详情页大图目前直接设置 `src`，如果处理不谨慎可能影响现有详情打开流程。
- 浏览器图片失败原因不可控，不能向用户展示过于具体的错误原因。
- 如果远端图片跨域或缓存行为特殊，加载成功/失败事件可能表现不同，需要以 UI 稳定为优先。

## 17. 执行任务清单

### Task 1: Add shared state render helpers

**Files:**
- Modify: `src/app.js`

- [ ] 新增 `renderImagePlaceholder`，支持 `loading`、`error`、`avatar`、`detail`、`card`、`thumb` variants。
- [ ] 新增 `renderEmptyState`，支持 title、description、compact。
- [ ] 新增 `renderErrorState`，支持 title、description、retryLabel。
- [ ] 新增 `renderLoadingState`，支持 compact 和 page variants。
- [ ] 不改任何数据请求、权限、收藏、下载逻辑。

### Task 2: Apply image loading and fallback to image surfaces

**Files:**
- Modify: `src/app.js`
- Modify: `src/styles.css`

- [ ] 扩展或替换 `attachImageFallback`，让卡片图片统一进入 loading/loaded/error 状态。
- [ ] 将分类卡片图片接入同一逻辑。
- [ ] 将详情页大图接入同一逻辑。
- [ ] 将下载管理缩略图接入同一逻辑。
- [ ] 保持头像当前文字降级策略，预留图片失败降级。

### Task 3: Replace scattered empty states

**Files:**
- Modify: `src/app.js`
- Modify: `src/styles.css`

- [ ] 首页无数据使用 `EmptyState`。
- [ ] 分类结果为空使用 `EmptyState`。
- [ ] 搜索结果为空使用 `EmptyState`。
- [ ] 收藏为空使用 `EmptyState`。
- [ ] 浏览历史为空使用 `EmptyState`。
- [ ] 下载管理为空使用 `EmptyState`。

### Task 4: Replace scattered page error states

**Files:**
- Modify: `src/app.js`
- Modify: `src/styles.css`

- [ ] 首页加载失败使用 `ErrorState`。
- [ ] 分类页加载失败使用 `ErrorState`。
- [ ] 详情页数据不可用使用 `ErrorState`。
- [ ] 下载管理读取异常使用 `ErrorState`。
- [ ] 重试按钮只调用已有加载入口。

### Task 5: Add restrained CSS system for states

**Files:**
- Modify: `src/styles.css`

- [ ] 增加 `.image-placeholder`、`.image-placeholder-icon`、`.image-placeholder-copy`。
- [ ] 增加 `.state-empty`、`.state-error`、`.state-loading`。
- [ ] 增加 `.state-action` 重试按钮样式。
- [ ] 增加 `@media (prefers-reduced-motion: reduce)` 降级。
- [ ] 检查不会影响底部导航、首页主体卡片信息、详情主体排版。

### Task 6: Verification

**Files:**
- No source changes.

- [ ] 运行 `npm.cmd run check`。
- [ ] 运行 `npm.cmd run build`。
- [ ] 如项目具备 TypeScript 配置，运行 `npx.cmd tsc --noEmit`。
- [ ] 在浏览器中检查首页、分类页、详情页、我的页、下载管理页。
- [ ] 人工模拟图片失败和空数据。
- [ ] 确认没有修改 Supabase/Auth/RLS/SQL/seed/验证脚本。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-18-image-empty-error-states.md`.

Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Wait for explicit confirmation before implementation.
