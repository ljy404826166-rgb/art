# Artwork Downloads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an MVP download flow from the artwork detail page, with a local download record list available from "我的" -> "下载管理".

**Architecture:** Keep this stage local-first and browser-compatible. Reuse the existing detail drawer, motion toast, profile route drawer, `localStorage` conventions, and `download_url` data already exposed by Supabase reads. Do not change Auth, RLS, RBAC, SQL, or the existing favorite behavior.

**Tech Stack:** Vite, vanilla JavaScript, CSS, `localStorage`, browser download APIs, existing Supabase read-only artwork fields.

---

## 1. 本阶段目标

本阶段实现 Web MVP 下载功能：

- 在作品详情页右上角收藏按钮左侧新增下载按钮。
- 点击下载按钮后显示 toast：“已加入下载列表”。
- 将当前作品加入本地下载记录，记录标题、作者、缩略图、下载状态、下载时间、图源 URL。
- 尝试触发浏览器文件下载。
- 在「我的」页面的「下载管理」入口展示下载记录。
- 在普通 Web 环境下清楚区分“触发浏览器下载”和“保存到系统相册”。

## 2. 不做什么

本阶段明确不做：

- 不修改 Supabase 数据库结构。
- 不修改 RBAC / RLS / Auth 权限逻辑。
- 不接入 `user_downloads` 远端同步。
- 不修改现有收藏功能逻辑。
- 不修改详情页主体视觉布局。
- 不修改作品卡片、分类内容、我的页头像/统计/菜单主体布局。
- 不实现系统相册保存。
- 不实现后台真实下载进度百分比。
- 不自动 commit、merge、push。

## 3. 需要修改或新增的文件

### 修改 `index.html`

职责：只增加详情页顶部操作区的下载按钮。

预期改动：

- 在 `#detailFavoriteButton` 左侧新增 `#detailDownloadButton`。
- 使用现有 `detail-icon-button` 风格。
- 使用与底部导航、详情页收藏按钮一致的线性 SVG 图标。
- 保持 `detail-brand` 和详情主体结构不变。

### 修改 `src/app.js`

职责：下载按钮节点、下载记录读写、下载触发、toast、下载管理渲染。

预期改动：

- 在 `nodes` 中增加 `detailDownload`。
- 增加下载记录读写 helper。
- 增加 `downloadArtwork(item)` 或等价函数。
- 增加 `triggerBrowserDownload(record)` 或等价函数。
- 在详情页打开时更新下载按钮可用状态。
- 给下载按钮绑定点击事件。
- 改造 `profileRouteConfig("downloads")` 或 `openProfileRoute("downloads")`，让下载管理显示真实下载记录。
- 保持 `toggleDetailFavorite()`、`toggleFavorite()`、`syncFavorite()` 行为不变。

### 修改 `src/styles.css`

职责：只补顶部下载按钮和下载记录列表需要的最小样式。

预期改动：

- 为详情页右侧双按钮布局增加样式支持。
- 为下载记录列表增加轻量行项目样式。
- 保持黑白灰为主，少量深酒红/艺术棕只用于状态或强调。
- 不改详情页主体视觉布局。

### 可选修改 `src/lib/user-library.ts`

职责：如果希望减少 `app.js` 内本地存储散落，可增加本地下载记录 helper。

预期改动：

- `localDownloadRecords()`
- `saveLocalDownloadRecords(records)`
- 保留现有 `clearLocalDownloads()`。

建议：如果实现者希望最小改动，可以先把 helper 留在 `src/app.js`；如果下载逻辑超过几个函数，再移入 `src/lib/user-library.ts`。

## 4. 详情页下载按钮设计

按钮位置：

- 位于详情页顶部右侧操作区。
- 放在收藏按钮左侧。
- 返回按钮仍在左侧，标题仍居中显示“详情”。

按钮视觉：

- 尺寸复用 `.detail-icon-button`。
- 图标使用下载箭头线性 SVG。
- 默认颜色与收藏按钮未选中态一致。
- 点击时不改变收藏按钮状态。
- URL 不可用时按钮可 disabled 或点击后记录失败，MVP 推荐点击后显示失败 toast 并保留失败记录。

可访问性：

- `aria-label="下载作品"`。
- 下载中可临时设置 `aria-busy="true"`。
- 不复用收藏按钮的 `aria-pressed`，下载不是 toggle 状态。

## 5. 下载 toast 反馈设计

成功加入队列：

- 文案固定为：“已加入下载列表”。
- 复用现有 `showMotionToast(message, tone)`。
- tone 建议用 `success` 或默认 `info`，保持轻量。

失败反馈：

- 缺少 URL：“暂无可下载图源”。
- 浏览器触发失败：“下载未能启动”。
- 失败 toast 不应阻塞用户继续浏览。

交互时机：

- 点击后先写入本地记录，再显示“已加入下载列表”。
- 下载触发失败后更新该记录状态为 `failed`，并显示失败 toast。

## 6. 下载文件实现方式

普通 Web MVP 使用浏览器能力：

- 优先使用当前作品的 `downloadUrl`。
- 如果 `downloadUrl` 为空或为 `"#"`，fallback 到 `displayUrl`。
- 创建临时 `<a>` 元素，设置 `href` 为图源 URL。
- 设置 `download` 文件名，文件名来自作品标题，做安全字符清理。
- 触发 click 后移除临时元素。

跨域限制处理：

- 如果资源允许同源或 CORS，`download` 属性更可能按预期生效。
- 如果跨域服务不允许下载属性，浏览器可能打开图片或按原始响应行为处理。
- 本阶段不强制 `fetch -> blob -> objectURL`，因为跨域图片常会被 CORS 拦截。
- 可在直接链接触发失败时降级为 `window.open(downloadUrl, "_blank")`，让用户自行保存。

状态口径：

- 不建议把状态命名为严格的“已保存到本地”，因为浏览器不给前端可靠确认。
- 推荐状态：
  - `queued`: 已加入队列。
  - `started`: 已触发浏览器下载。
  - `failed`: 缺少 URL 或触发失败。

## 7. 下载记录数据结构

本地记录存储在 `localStorage["artArchive:downloads"]`。

建议字段：

- `id`: 下载记录 ID，建议使用作品 ID。
- `artworkId`: 作品 ID。
- `title`: 作品中文标题或 fallback 标题。
- `artist`: 作者。
- `thumbnailUrl`: 缩略图，优先 `displayUrl`。
- `downloadUrl`: 实际下载 URL。
- `status`: `queued | started | failed`。
- `createdAt`: 加入下载列表时间，ISO 字符串。
- `updatedAt`: 最近状态更新时间，ISO 字符串。
- `error`: 失败原因，可选。

去重策略：

- 同一 `artworkId` 只保留一条记录。
- 重复点击时把记录移动到列表顶部。
- 重复点击时更新 `updatedAt` 和 `status`。
- 不重复增加下载管理数量。

## 8. 下载管理页面设计

入口：

- 继续使用「我的」页现有“下载管理”菜单入口。
- 继续使用 profile route drawer，不新增路由。

列表内容：

- 每条记录展示：
  - 缩略图。
  - 作品标题。
  - 作者。
  - 状态文案。
  - 下载时间。

状态文案建议：

- `queued`: 已加入。
- `started`: 已触发下载。
- `failed`: 下载失败。

空状态：

- 没有记录时显示：“还没有下载记录”。

点击行为：

- MVP 可以只展示记录，不支持打开文件。
- 可选：点击失败记录或已触发记录时重新触发下载，但这会增加交互范围。建议本阶段不做，除非用户后续确认。

## 9. localStorage / IndexedDB / Supabase 的选择建议

本阶段推荐 `localStorage`。

原因：

- 当前项目已经用 `localStorage` 保存收藏、历史、设置和下载占位。
- 下载记录只存元数据，不存图片二进制，体积小。
- 实现成本低，验证简单，符合 MVP。

不推荐本阶段使用 IndexedDB：

- IndexedDB 更适合存 Blob、离线缓存、大量记录。
- 本阶段不保存图片文件本体，只保存下载记录。
- 使用 IndexedDB 会增加调试和迁移成本。

不推荐本阶段同步 Supabase：

- 你要求不改 SQL/RBAC/RLS/Auth。
- 虽然项目已有 `user_downloads` SQL 文件，但前端尚未接入下载同步。
- 同步下载记录涉及用户会话、RLS 验证、失败回滚和隐私口径，适合后续单独做。

## 10. 普通 Web 环境下的下载限制说明

需要在设计和后续文案中明确：

- Web 页面可以请求浏览器下载文件。
- 浏览器决定文件最终保存位置，通常是默认下载目录。
- 前端不能可靠知道用户是否最终保存成功。
- 前端不能直接写入系统相册。
- 跨域图源可能忽略 `download` 文件名。
- 移动端浏览器可能预览图片而不是直接下载。

## 11. 如果无法保存到相册，如何降级为浏览器下载

降级路径：

1. 优先触发 `<a download>`。
2. 如果无法使用 `download` 行为，则打开图源 URL。
3. 在下载管理中记录为 `started`，表示“已触发浏览器处理”。
4. 如 URL 缺失，记录为 `failed`。

用户解释：

- 普通 Web：只能触发浏览器下载或打开图片，不能保证保存到相册。
- PWA：仍受浏览器沙箱限制，不能作为相册保存能力的可靠方案。
- Capacitor：后续可接入原生文件系统和相册插件，在用户授权后保存到系统相册。

## 12. 失败状态处理

失败场景：

- 作品没有 `downloadUrl` 且没有 `displayUrl`。
- 下载 URL 是 `"#"`。
- 临时链接触发时报错。
- 浏览器阻止弹窗式 fallback。

处理方式：

- 写入或更新本地记录，状态为 `failed`。
- `error` 写入简短原因。
- 显示失败 toast。
- 下载管理列表展示失败状态。
- 不影响详情页关闭、收藏、浏览历史。

## 13. 重复下载处理

同一作品重复点击：

- 不新增第二条记录。
- 更新原记录的 `updatedAt`。
- 把该记录移动到列表顶部。
- 状态从 `failed` 可更新为 `queued` 再尝试触发。
- 再次显示“已加入下载列表”。

数量统计：

- `profileDownloadCount` 显示唯一记录数量。
- 重复下载不增加数量。

## 14. 下载记录如何展示在「我的」→「下载管理」

实现路径：

- `renderProfile()` 继续读取 `state.downloads`。
- `profileDownloadCount` 使用 `state.downloads.length`。
- `profileRouteConfig("downloads")` 不再返回占位，而返回可渲染下载记录。
- 下载管理 route 使用专门的下载记录列表渲染，不复用作品卡片网格。

原因：

- 下载记录不是完整 artwork 对象。
- 下载记录需要显示状态和时间。
- 复用 `renderCategoryCards` 会丢失状态信息，也会误导为作品列表。

列表排序：

- 按 `updatedAt` 或 `createdAt` 倒序。
- 最近下载/重试的记录在最上方。

## 15. 验证方式

静态验证：

- 运行 `node --check src\app.js`。
- 运行 `npm.cmd run build`。

浏览器验证：

- 打开 `http://127.0.0.1:5173/`。
- 进入任意作品详情。
- 确认下载按钮在收藏按钮左侧。
- 点击下载按钮。
- 看到 toast：“已加入下载列表”。
- 检查浏览器是否触发下载或打开图源。
- 进入「我的」。
- 点击「下载管理」。
- 确认记录展示标题、作者、缩略图、状态、时间。
- 重复点击同一作品下载，确认记录不重复增加。
- 手动构造无下载 URL 的作品或临时让 URL 为 `"#"`，确认失败状态可展示。

回归验证：

- 收藏按钮仍可收藏/取消收藏。
- 详情页返回按钮仍可关闭详情。
- 浏览历史仍正常记录。
- 底部导航不变。
- Supabase/Auth/RLS 相关代码未修改。

## 16. 风险点

- 浏览器无法确认文件是否真实落盘，只能确认下载动作被触发。
- 跨域图片可能不遵守 `download` 文件名。
- 移动端浏览器下载行为差异较大。
- 部分图源可能失效或返回 HTML，而不是图片文件。
- `localStorage` 记录可能被用户清理。
- 如果未来接入 Supabase 同步，需要定义下载隐私策略和 RLS 验证方式。
- 如果未来接入 Capacitor 相册保存，需要处理 Android/iOS 权限、媒体库刷新、文件名冲突和失败回滚。

## Task 1: Detail Topbar Download Button

**Files:**

- Modify: `D:\art\index.html`
- Modify: `D:\art\src\styles.css`

- [ ] Step 1: Inspect current detail topbar markup and CSS selectors.
- [ ] Step 2: Add a download button immediately before `#detailFavoriteButton`.
- [ ] Step 3: Reuse `detail-icon-button`; add only minimal spacing style if two right-side buttons overlap.
- [ ] Step 4: Verify the detail title remains centered enough for mobile layout.
- [ ] Step 5: Verify favorite button behavior is unchanged.

## Task 2: Local Download Record Model

**Files:**

- Modify: `D:\art\src\app.js`
- Optional modify: `D:\art\src\lib\user-library.ts`

- [ ] Step 1: Define the local record shape used by `state.downloads`.
- [ ] Step 2: Add helper logic to read existing records defensively.
- [ ] Step 3: Add helper logic to save records to `localStorage["artArchive:downloads"]`.
- [ ] Step 4: Add helper logic to upsert by `artworkId`, move repeated records to the top, and update timestamps.
- [ ] Step 5: Verify malformed localStorage data does not crash app startup.

## Task 3: Browser Download Trigger

**Files:**

- Modify: `D:\art\src\app.js`

- [ ] Step 1: Add a function that resolves the best URL from `downloadUrl` then `displayUrl`.
- [ ] Step 2: Add a safe filename builder from artwork title.
- [ ] Step 3: Add browser download trigger using a temporary anchor element.
- [ ] Step 4: Add fallback behavior for unavailable URL and trigger failure.
- [ ] Step 5: Update download record status after trigger attempt.

## Task 4: Toast and Button Event Wiring

**Files:**

- Modify: `D:\art\src\app.js`

- [ ] Step 1: Add `detailDownload` to `nodes`.
- [ ] Step 2: Bind click handler after existing detail favorite binding.
- [ ] Step 3: On click, guard against missing `currentDetailItem`.
- [ ] Step 4: Add record to queue and show “已加入下载列表”.
- [ ] Step 5: If trigger fails, update record to `failed` and show failure toast.

## Task 5: Download Management Route

**Files:**

- Modify: `D:\art\src\app.js`
- Modify: `D:\art\src\styles.css`

- [ ] Step 1: Change downloads profile route from placeholder to a real list route.
- [ ] Step 2: Render one row per local download record.
- [ ] Step 3: Show title, artist, thumbnail, status, and time.
- [ ] Step 4: Show empty state “还没有下载记录”.
- [ ] Step 5: Keep existing menu entry and download count behavior.

## Task 6: Verification

**Files:**

- No source changes expected.

- [ ] Step 1: Run `node --check src\app.js`.
- [ ] Step 2: Run `npm.cmd run build`.
- [ ] Step 3: Start `npm.cmd run dev` at `http://127.0.0.1:5173/`.
- [ ] Step 4: In mobile viewport, open a detail page and click download.
- [ ] Step 5: Verify toast, localStorage record, browser download behavior, and download manager list.
- [ ] Step 6: Verify favorite, detail close, bottom nav, and profile navigation still work.

## Self-Review

- Spec coverage: The plan covers button placement, toast feedback, file download trigger, local records, download management display, storage choice, browser limits, failure handling, repeated downloads, verification, and risks.
- Placeholder scan: No unresolved placeholders are left in the plan.
- Type consistency: The plan consistently uses `downloadUrl`, `displayUrl`, `artworkId`, `state.downloads`, and `artArchive:downloads`.
- Scope check: The plan is one MVP feature and does not require splitting into separate subsystem plans.
