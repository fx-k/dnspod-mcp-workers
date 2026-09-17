# v3 验收记录

## 验收边界

本次改动区分三层，不能互相替代：

| 层次 | 方法 | 证明什么 |
| --- | --- | --- |
| 单元/契约 | `npm test` | 工具参数、腾讯 Action 映射、写保护、TC3、OAuth、MCP 的离线回归行为 |
| 运行时 | `npm run build` + `npm run test:worker` | Wrangler 打包、本地 workerd + SQLite Durable Object 的真实执行；不连接腾讯云 |
| 真实部署 | 手动受控验收 | ChatGPT OAuth 连接、CAM 权限、真实 API 套餐/数据语义；本次没有执行 |

## 离线验收

2026-09-17 在 Node.js 22 环境运行 **78 个自动测试，78 通过、0 失败**。31 个 inputSchema 通过 JSON Schema Draft 2020-12 元 Schema 检查。全部源模块通过语法检查。

测试覆盖全部 31 个工具的路由，另覆盖：默认只读、危险操作开关、白名单与 DomainId 防绕过、局部修改保留线路/TTL/状态、空备注与零值、套餐 Grade 查询、线路 Useful、批量数组上限/重复 ID/全量预检、分组 `|` 转换、快照异步提交与回滚失败拦截、腾讯请求签名和错误 RequestId、OAuth PKCE/CSRF/客户端密钥/错误 audience/issuer/过期 token、授权码/刷新令牌并发防重放及 HTTP/MCP 协议错误。

TC3 测试使用 Node.js 原生 crypto 的独立实现交叉比对。模拟腾讯响应使用 `example.com`、文档保留 IP 和测试 ID，不代表真实账户信息。

## CI 与 Worker 验收

已验证的实现提交：`d3eda776cbb7ef4ff1487c89a26fe1f91c80080b`。

[GitHub CI run 35200821402](https://github.com/fx-k/dnspod-mcp-workers/actions/runs/35200821402) 已完成，所有步骤通过：JavaScript 语法、78 项回归、31 个 Schema、Wrangler dry-run，以及实际本地 workerd + SQLite Durable Object 端到端测试。

首轮真实运行时测试发现 Workers 主入口不能导出普通字符串常量；已将 MCP 协议逻辑移到 `src/mcp.js`，主入口仅导出默认处理器和 Durable Object 类，新增入口导出回归用例。不是跳过失败测试后宣称通过。

CI 文件：`.github/workflows/ci.yml`。其中本地 workerd 测试会用实际 SQLite Durable Object 运行完整 OAuth 授权码流程，验证并发兑换只有一个成功，检查 MCP 工具数和默认写入拒绝；不会提供腾讯云 Secret。

查看该提交关联的 [GitHub Actions](https://github.com/fx-k/dnspod-mcp-workers/actions) 结论，以运行结果为准，不将“工作流已提交”当成“运行已通过”。

## 尚未验收

- Cloudflare 线上发布和真实 Worker 域名。
- ChatGPT 界面 OAuth、刷新工具、实际客户端审批行为。
- 真实 DNSPod 凭据、CAM 权限、免费/付费套餐差异。
- 真实 DNS 记录 CRUD、分组、批量任务和整域快照回滚。

真实写验收必须在专用测试托管域名中执行，先保存原配置，只开放该域名白名单。整域快照回滚尤其不能拿生产域名测试。没有这些证据前，不把 v3 宣称为“31 个工具已全部生产验证”。
