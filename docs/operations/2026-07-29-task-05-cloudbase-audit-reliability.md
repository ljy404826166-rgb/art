# Masterpiece 任务五：CloudBase 审计可靠性执行记录

日期：2026-07-29  
环境：`cloudbase-d6gvny27ib05e0ede`  
集合：`artworks`

## 1. 实施结果

`scripts/cloudbase-audit-artworks.mjs` 已从一次性分页脚本升级为可恢复的生产审计工具：

- 每页查询支持有限重试；
- 重试采用指数退避和随机抖动；
- 只重试超时、连接重置、限流、5xx 和 CloudBase `InternalError` 等可恢复错误；
- 权限、认证、参数和分页完整性错误立即停止；
- 分页固定按 `_id` 排序，默认页大小从 1000 调整为更稳定的 500；
- 每完成一页即原子写入检查点；
- 支持 `--resume` 从 `next_skip` 继续；
- 重复页和跨页重复 `_id` 会生成分页完整性失败；
- 图片 HEAD 使用受控并发、独立超时和独立失败列表；
- 报告明确区分 `complete`、`partial` 和 `failed`；
- 支持 `--compare <previous-report>` 比较两次生产状态；
- 请求日志保留 requestId、页号、skip、尝试次数和退避时间；
- 签名 URL 查询参数、密钥和令牌不会写入日志或报告。

## 2. 新增命令参数

- `--max-attempts`
- `--base-delay-ms`
- `--max-delay-ms`
- `--jitter-ratio`
- `--checkpoint`
- `--resume`
- `--head-concurrency`
- `--head-timeout-ms`
- `--compare`

原有 `npm run cloudbase:audit` 命令保持兼容。

## 3. 故障注入测试

新增 `scripts/cloudbase-audit-artworks.test.mjs`，覆盖：

1. 前两次失败、第三次成功；
2. 权限与参数错误不重试；
3. 达到最大次数后保留已完成页并生成 partial；
4. 从检查点续跑；
5. 空页正常结束；
6. 重复页停止并报告；
7. HEAD 受控并发；
8. HEAD 临时失败重试和单项失败隔离；
9. HEAD 超时；
10. 密钥和签名 URL 脱敏；
11. 两次报告状态差异计算。

## 4. 真实生产故障与恢复

真实验收过程中实际触发了两种生产故障：

1. 1000 条分页持续返回 CloudBase `InternalError`：
   - 工具按配置重试 4 次；
   - 最终生成 `failed` 报告；
   - 未丢失数据或泄露凭据；
   - 将默认页大小调整为 500，并增加 `_id` 稳定排序。
2. 完成首个 500 条分页后连接出现 `ECONNRESET`：
   - 工具保存包含 500 条记录的 `partial` 报告；
   - 检查点记录 `next_skip=500`；
   - 补充 CloudBase 包装型网络错误识别；
   - 使用 `--resume` 后从第 501 条继续，未重新读取第一页；
   - 最终完成 6,987 条记录和 14 个分页。

这两次真实故障验证了 failed、partial、检查点和 resume 路径，而不仅是模拟测试。

## 5. 连续生产审计结果

### 第一次完整报告（断点恢复）

- 状态：`complete`
- 作品：6,987
- 分页：14
- `resumed`：`true`
- COS URL：6,987
- Supabase 旧地址：0
- 缺失图片：0
- 缺失标签：0
- 重复 ID：0
- HEAD 失败：0

报告：

`outputs/product-audit/2026-07-29/task-05-cloudbase-audit/run-1/cloudbase-audit-20260729T124217Z-3586b846.json`

### 第二次完整报告（全新运行）

- 状态：`complete`
- 作品：6,987
- 分页：14
- `resumed`：`false`
- COS URL：6,987
- Supabase 旧地址：0
- 缺失图片：0
- 缺失标签：0
- 重复 ID：0
- HEAD 失败：0

报告：

`outputs/product-audit/2026-07-29/task-05-cloudbase-audit/run-2/cloudbase-audit-20260729T124259Z-7b436ed2.json`

两份完整报告的 `changed_fields` 为空，所有受审计指标 delta 均为 0。

## 6. 全量回归

- Node 测试：519/519；
- 单元测试：7/7；
- Web 端到端测试：1/1；
- Vite 生产构建：通过；
- ESLint、Prettier、TypeScript 和活动脚本语法检查：通过。
