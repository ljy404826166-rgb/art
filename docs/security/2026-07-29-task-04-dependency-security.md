# Masterpiece 任务四：依赖安全治理记录

日期：2026-07-29  
适用范围：Web/PWA、小程序、数据治理脚本、CloudBase/COS 部署工具

## 1. 结论

- `npm audit --omit=dev`：0 个漏洞；
- 生产依赖中不存在未豁免的 critical、high、moderate 或 low；
- COS SDK 已由 2.15.4 升级到 3.0.0，并移入开发/治理依赖；
- Vite 已升级到 8.1.5，PostCSS 已解析到 8.5.24；
- `sharp` 已升级到 0.35.3；
- CloudBase 管理 SDK 已升级到 5.6.5；
- 未被项目使用的 `miniprogram-ci` 已移除；
- CI 已增加生产依赖审计门禁；
- COS 3.x 上传、HEAD、读取、删除回滚及删除后不存在校验均已通过。
- 微信开发者工具真实小程序冒烟已通过，运行时无控制台错误或异常。

## 2. 依赖边界

### 用户运行时

以下依赖可能进入 Web/PWA 客户端产物或参与用户端数据处理：

- `@supabase/supabase-js`
- `dexie`
- `minisearch`
- `openseadragon`
- `undici`
- `zod`

### 构建、测试与本地开发

- `vite`
- `vite-plugin-pwa`
- `vitest`
- `typescript`
- `eslint`
- `prettier`
- `playwright`
- `miniprogram-automator`

### 数据治理与云端部署

- `cos-nodejs-sdk-v5`
- `@cloudbase/manager-node`
- `sharp`

COS、CloudBase 和图像处理依赖不进入小程序或 Web/PWA 用户运行时。

## 3. 已执行修复

| 依赖或风险链 | 修复前 | 修复后 | 处理 |
| --- | ---: | ---: | --- |
| `cos-nodejs-sdk-v5` | 2.15.4 | 3.0.0 | 主版本升级并迁移至 devDependencies |
| `vite` | 8.0.11 | 8.1.5 | 升级并迁移至 devDependencies |
| `postcss` | 受影响版本 | 8.5.24 | 通过安全依赖树更新 |
| `sharp` | 0.34.5 | 0.35.3 | 升级 |
| `@cloudbase/manager-node` | 5.5.4 | 5.6.5 | 升级至当前最新版 |
| `miniprogram-ci` | 2.1.31 | 已移除 | 项目无调用，删除未使用依赖 |

## 4. COS 3.x 验证

新增：

- `scripts/cos-sdk-v3-smoke.mjs`
- `scripts/cos-sdk-v3-smoke.test.mjs`
- `npm run cos:smoke`
- `npm run test:cos`

真实生命周期测试只使用
`healthchecks/masterpiece-task4/<timestamp>-<uuid>.txt`
随机临时对象，执行：

1. `putObject` 上传；
2. `headObject` 验证；
3. `getObject` 读取并逐字节比较；
4. `deleteObject` 回滚；
5. 再次 `headObject`，确认对象不存在。

测试对象已经删除，未修改任何现有作品图片或数据库记录。

## 5. 开发依赖剩余风险与临时豁免

完整 `npm audit` 仍会报告开发工具链中的问题。这些问题不进入生产依赖审计，也不会被打包进 Web/PWA 或小程序。

### `@cloudbase/manager-node` 5.6.5

- **影响范围**：本地数据治理、CloudBase 查询和显式部署脚本；
- **风险来源**：上游仍间接依赖 COS 2.x 及其 `request`、`form-data`、XML 解析链；
- **用户运行时**：否；
- **输入可信度**：仅由项目维护者运行，使用受控参数和显式生产确认；
- **缓解措施**：
  - 保持在 `devDependencies`；
  - 不向浏览器或小程序打包；
  - 生产写入脚本继续要求环境 ID 和显式确认；
  - 凭据只从本地环境读取，不进入仓库；
  - 项目直接控制的 COS 操作统一使用 COS SDK 3.x；
- **复查条件**：CloudBase 官方管理 SDK 发布移除 COS 2.x 风险链的版本时立即升级；在此之前若要接收不可信 URL、XML 或第三方参数，必须先重新评估。

### `miniprogram-automator` 0.12.1

- **影响范围**：微信开发者工具页面自动化冒烟；
- **风险来源**：上游旧版 Jimp、`mkdirp`、`minimist` 和 `jpeg-js`；
- **用户运行时**：否；
- **输入可信度**：仅连接本机 `127.0.0.1` 开发者工具，不处理用户上传图片；
- **缓解措施**：
  - 保持在 `devDependencies`；
  - 自动化端口不得暴露到公网；
  - 只对项目自有页面和受控截图运行；
  - CI 和生产环境不配置微信开发者工具凭据；
- **复查条件**：微信官方发布修复依赖链的新版本时升级；若自动化需要处理外部图片或远程端口，豁免立即失效。

以上豁免不适用于生产依赖。生产依赖仍由零 critical/high 门禁约束。

## 6. 持续门禁

- 本地命令：`npm run audit:production`
- GitHub Actions：`.github/workflows/dependency-audit.yml`
- 门禁规则：`npm audit --omit=dev --audit-level=high`
- 安装使用 lockfile：`npm ci --ignore-scripts`

后续任务六可在此基础上扩展完整测试、构建、数据审计和分层发布门禁。

## 7. 回归结果

- Node 测试：508/508；
- 单元测试：7/7；
- Web 端到端测试：1/1；
- Vite 8.1.5 生产构建：通过；
- 微信开发者工具：
  - 首页数据加载：通过；
  - 下拉随机刷新：通过；
  - 横向增量加载且无重复作品：通过；
  - “查看更多”分类导航：通过；
  - 云端失败降级：通过；
  - 控制台错误与运行时异常：0。
