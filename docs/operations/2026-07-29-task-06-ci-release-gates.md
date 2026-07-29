# 任务六：持续集成与分层发布门禁执行记录

日期：2026-07-29  
仓库：`ljy404826166-rgb/art`  
实施分支：`codex/supabase-integration`  
状态：仓库内实施完成，GitHub 远端保护规则与凭据等待管理员启用

## 1. 实施结果

本任务把发布检查拆成三个权限逐级提升、默认只读的门禁。

| 层级 | 工作流 | 触发方式 | 主要检查 | 云端权限 |
| --- | --- | --- | --- | --- |
| PR | `.github/workflows/pr-quality.yml` | PR、`main` push、手动 | 锁定依赖安装、格式、Lint、类型、Node/单元/E2E、构建、静态检查、生产依赖审计 | 无 |
| 合并后 | `.github/workflows/post-merge.yml` | `main` push、手动 | staging CloudBase 全库审计、微信开发者工具真实冒烟、证据归档 | 仅 staging 只读 |
| 正式发布 | `.github/workflows/release-gate.yml` | 仅手动 | 版本与变更日志、回滚清单、双端签字、生产只读审计、小程序预览 | 仅 production 只读 |

生产依赖审计位于 `.github/workflows/dependency-audit.yml`，由 PR 门禁复用。高危或严重生产依赖漏洞会令门禁失败，并保留审计日志。

正式发布门禁不会部署、上传版本、执行数据迁移或写入生产数据。它只生成可供人工扫码验收的小程序预览。真正的生产写入仍须在本门禁全部通过后，通过独立、显式授权的操作完成。

## 2. 发布输入约束

正式发布必须同时提供：

- 与 `package.json` 完全一致的语义化版本号；
- `CHANGELOG.md` 中对应版本的章节；
- 仓库内、禁止路径穿越的 rollback manifest；
- 精确确认短语 `READ_ONLY_RELEASE_GATE`；
- Android 与 iOS 验收均为通过；
- 目标生产环境 ID；
- GitHub `production-readonly` Environment 的人工批准。

校验由 `scripts/ci/validate-release-gate.mjs` 执行。回滚清单要求：

- `schema_version` 为 `1`；
- 版本和环境与发布输入一致；
- `production_ready` 明确为 `true`；
- 每个回滚产物包含名称、仓库相对路径和 SHA-256；
- 至少包含一条可操作的回滚步骤；
- 运行模式明确为 `read-only`。

`docs/releases/0.1.0-rollback-manifest.example.json` 是模板，故意保持
`production_ready: false`，不能误用于正式发布。

## 3. GitHub 远端启用清单

以下属于 GitHub 仓库管理配置，代码无法代替管理员完成。启用后任务六才会在远端真正阻止合并和发布。

### 3.1 Environments

建立两个 Environment：

1. `staging-readonly`
   - Secret：`STAGING_READONLY_TENCENT_SECRET_ID`
   - Secret：`STAGING_READONLY_TENCENT_SECRET_KEY`
   - Variable：`STAGING_CLOUDBASE_ENV_ID`
2. `production-readonly`
   - Secret：`PRODUCTION_READONLY_TENCENT_SECRET_ID`
   - Secret：`PRODUCTION_READONLY_TENCENT_SECRET_KEY`
   - 配置 required reviewers；
   - 禁止未受保护分支使用。

两个 Secret 对应的腾讯云身份均只授予查询和审计所需的最小只读权限，不能拥有集合写入、函数部署、COS 写入或环境管理权限。

### 3.2 Repository Variables

供 Windows 自托管 runner 使用：

- `WECHAT_DEVTOOLS_CLI`：runner 上微信开发者工具 CLI 的绝对路径；
- `WECHAT_DEVTOOLS_PORT`：开发者工具服务端口，当前建议 `32070`。

runner 需要标签：

- `self-hosted`
- `windows`
- `wechat-devtools`

runner 机器需要 Node.js 24、微信开发者工具、已登录且可以打开当前小程序项目。自动化 WebSocket 端口为 `9420`。工作流会先探测现有服务并复用，避免重复 `auto` 导致卡死；启动、冒烟和预览均有超时保护。

### 3.3 Branch protection

在 `main` 的 branch protection 或 ruleset 中：

- 要求 PR；
- 要求 PR quality gate 的质量检查通过；
- 要求 production dependency audit 通过；
- 要求分支在合并前保持最新；
- 禁止绕过失败检查直接合并；
- 外部分支不得获得 Environment Secret。

首次推送工作流后，以 GitHub 实际显示的 check 名称添加 required status checks，避免手工猜测名称。

## 4. 报告与追溯

所有层级均通过 `actions/upload-artifact@v4` 保存证据：

- PR：测试日志、Playwright 报告、测试结果与 `dist`；
- 合并后：staging CloudBase 审计报告、微信冒烟 JSON 与截图；
- 正式发布：发布校验报告、生产只读审计报告、小程序预览二维码和预览信息；
- 生产依赖审计：完整 npm audit 日志。

PR、合并后报告默认保存 30 天；正式发布报告保存 90 天。

## 5. 本地验证结果

在删除并重新安装依赖的干净环境中执行：

```text
npm ci --ignore-scripts
npm run ci:pr
```

结果：

- production dependency audit：0 个已知漏洞；
- Node 测试：528/528 通过；
- 单元测试：7/7 通过；
- Chromium E2E：1/1 通过；
- Vite 生产构建：通过；
- 格式、Lint、TypeScript、语法与静态检查：通过。

工作流与发布校验专项测试：

- `scripts/ci-workflows.test.mjs`
- `scripts/ci/validate-release-gate.test.mjs`
- 合计 9/9 通过；
- 已验证工作流不包含开发者机器固定盘符；
- 已验证正式发布工作流不含生产写入、迁移或小程序上传命令。

微信开发者工具最近一次真实冒烟报告：

- `outputs/recommendation-system/task-06/devtools/task-06-devtools-smoke.json`
- 生成时间：2026-07-29 20:31（Asia/Shanghai）；
- 首页初始加载、标题契约、随机刷新、横向加载、查看更多导航、断网降级与运行时异常检查均为 `ok: true`；
- 同目录保留初始、刷新、详情和降级截图。

在本任务收尾联调中，已监听的 `9420` 端口再次执行 CLI `auto` 会等待不返回。工作流因此增加端口复用与步骤超时；该问题不影响上述已通过的真实冒烟证据。

## 6. 发布操作顺序

1. PR 工作流全部通过后合并；
2. 等待合并后 staging 审计和开发者工具冒烟通过；
3. 准备真实、校验和完整的 rollback manifest；
4. 完成 Android 与 iOS 人工验收；
5. 由获授权人员手动运行 Formal release gate；
6. `production-readonly` reviewer 核对目标环境后批准；
7. 下载并检查生产审计、预览二维码和全部报告；
8. 只有以上步骤均通过，才进入独立的正式上传或生产写入流程。

## 7. 尚未执行的外部配置

本地仓库无法证明以下远端状态已生效：

- GitHub Environment、Secret 和 Variable 已创建；
- Windows 自托管 runner 已注册并在线；
- `main` required status checks 已启用；
- Environment required reviewers 已配置；
- 正式发布 workflow 已在 GitHub Actions 上成功跑通。

这些配置必须由具有仓库管理权限的人员在 GitHub 中完成。未完成前，仓库内工作流定义是可复现的，但不能宣称远端发布门禁已经正式启用。
