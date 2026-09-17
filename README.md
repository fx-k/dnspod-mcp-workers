# DNSPod MCP on Cloudflare Workers · v3

[![验收](https://github.com/fx-k/dnspod-mcp-workers/actions/workflows/ci.yml/badge.svg)](https://github.com/fx-k/dnspod-mcp-workers/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

通过 **Cloudflare Workers + OAuth + Remote MCP**，让 ChatGPT、Claude 等支持远程 MCP 的客户端访问腾讯云 DNSPod。基于 [zfx-t/dnspod-mcp-workers](https://github.com/zfx-t/dnspod-mcp-workers) 的社区增强 fork，保留上游 MIT 许可与署名，不是腾讯云或 OpenAI 官方产品。

v3 从原来的 9 个工具扩展到 **31 个工具**，增加线路/类型发现、记录详情、启停、备注、DDNS、分组、批量任务、快照和回滚结果查询。

> [!IMPORTANT]
> **默认只读，不会因为模型传 `Confirmed=true` 就开放写权限。** 写操作还需维护者明确配置服务端开关、域名白名单，并具备腾讯云 CAM 权限。
>
> **v2 → v3 有兼容变更：** OAuth 状态从 KV 改为 SQLite Durable Object，旧客户端/令牌不迁移，需要重新连接授权；旧 `/sse`、`/message` 路径返回 410，请改用 `/mcp`。不要直接把 v3 代码覆盖到仍使用旧 KV 配置的 Worker。
>
> 自动化验收不等于真实云端验收：CI 不携带云凭据、不部署线上 Worker、不修改真实 DNS。详见 [验收说明](docs/acceptance.md)。

## 架构

```text
ChatGPT / Claude / 其他支持 Remote MCP 的客户端
                   │ HTTPS + OAuth
                   ▼
          Cloudflare Worker /mcp
             ├─ 工具参数与写权限校验
             ├─ OAuth：PKCE S256、JWT 资源绑定
             └─ SQLite Durable Object：授权码/刷新令牌原子消费
                   │ TC3-HMAC-SHA256
                   ▼
           腾讯云 DNSPod OpenAPI
```

没有 VPS、Docker、OpenAI Tunnel Runtime Key 或自建反向代理。腾讯云凭据保存在 **你自己的 Worker Secrets**。这仍是一个公网 HTTPS 服务，必须保留授权、防重放和最小 CAM 权限；不是“用了 Cloudflare 就自动安全”。

## 能做什么

| 范围 | 工具 |
| --- | --- |
| 域名 | `describe_domain_list`、`describe_domain`、`create_domain`、`describe_domain_log_list` |
| 记录与能力发现 | `describe_record_list`、`describe_record`、`describe_record_line_list`、`describe_record_line_category_list`、`describe_record_type` |
| 单条变更 | `create_record`、`modify_record`、`delete_record`、`modify_record_status`、`modify_record_remark`、`modify_dynamic_dns` |
| 记录分组 | `describe_record_group_list`、`create_record_group`、`modify_record_group`、`modify_record_to_group`、`delete_record_group` |
| 批量与任务 | `create_record_batch`、`modify_record_batch`（使用 V3 API）、`delete_record_batch`、`describe_batch_task` |
| 快照与回滚 | `create_snapshot`、`describe_snapshot_list`、`check_snapshot_rollback`、`rollback_snapshot`、`describe_snapshot_rollback_result` |
| 解析量 | `describe_domain_analytics`、`describe_subdomain_analytics` |

参数、腾讯 API 映射与副作用标记见 [工具清单](docs/tools.md)。不暴露购买、扣款、自动续费、域名所有权转移或任意 Action 执行工具。

### 几个关键行为

**修改 IP 不顺带改线路。** `modify_record` 可以只传要改的字段。服务端先读取原记录，保留未指定的线路、TTL、启停状态和备注；指定新线路名称时会移除旧线路 ID，避免旧 ID 覆盖新名称。

**免费版不是只有默认线路。** 可用线路以 `describe_record_line_list` 返回值为准；分类接口的结果还要查看每项 `Useful`。线路列表和记录类型工具自动获取域名 `Grade`，不要求模型猜 `DP_FREE`。

**空备注不被吞掉。** `Remark=""` 明确表示清空，数字 `0` 和布尔 `false` 同样不会被当作“未填写”。MX / HTTPS / SVCB 优先级允许 0–65535，套餐条件仍由腾讯云执行。

**任务提交不等于成功。** 批量操作的 `JobId`、回滚的 `TaskId` 都只标记 `McpOperation.state=submitted`，必须随后查任务结果。`CreateSnapshot` 只返回 RequestId，不编造 SnapshotId；需要查询列表核对新增快照的时间、ID 和状态。

**不会自动探测家宽 IP。** DDNS 必须显式提供 IP，避免把 Cloudflare 出口地址误写到 NAS 的记录里。

## 部署

### 1. 准备

需要 Node.js 22 或更新的受支持版本、npm、Cloudflare 账号、腾讯云 SecretId / SecretKey。建议使用专门的 CAM 子用户，而不是主账号密钥。

```bash
git clone https://github.com/fx-k/dnspod-mcp-workers.git
cd dnspod-mcp-workers
npm install
npx wrangler login
```

依赖范围在 `package.json` 中声明；目前未随仓库提供 npm 锁文件，不能把构建描述为完全可复现。CI 会重新安装并验证当次构建。

### 2. 配置 Worker

编辑 `wrangler.toml`，按需更改 Worker 名称。保留 `OAUTH_STATE` binding 和 `v3-oauth-sqlite` migration，首次部署由 Wrangler 创建 SQLite Durable Object namespace，**不用再手动创建 KV**。

默认策略：

```toml
[vars]
DNSPOD_READ_ONLY = "true"
DNSPOD_ALLOW_DESTRUCTIVE = "false"
DNSPOD_WRITE_DOMAINS = ""
```

设置四项 Secrets：

```bash
npx wrangler secret put TENCENTCLOUD_SECRET_ID
npx wrangler secret put TENCENTCLOUD_SECRET_KEY
npx wrangler secret put OAUTH_PASSWORD
npx wrangler secret put OAUTH_JWT_SECRET
```

`OAUTH_PASSWORD` 至少 16 字符；`OAUTH_JWT_SECRET` 至少 32 字符，使用独立随机值，不要使用示例文本。使用临时 STS 凭据时，还需设置 `TENCENTCLOUD_TOKEN`，并自行负责过期轮换。

### 3. 测试、构建、部署

```bash
npm run check
npm test
npm run build           # Wrangler dry-run，不发布
npm run test:worker     # 启动本地 workerd，使用固定测试凭据，不调用腾讯云
npm run deploy         # 这一条才是真实发布
```

部署产生 `https://<你的 Worker>.workers.dev` 地址。生产流量、Durable Object 和存储均受 Cloudflare 套餐配额约束；本项目不承诺无成本或无限量。

### 4. 接入 ChatGPT

在具备开发者模式与自定义 MCP 能力的 ChatGPT 工作区中新建应用：

```text
名称：tencent-dnspod
连接：Remote MCP / URL
URL：https://<你的 Worker>.workers.dev/mcp
授权：OAuth
```

完成授权页密码登录，再刷新工具。界面名称、套餐和工作区是否开放自定义 MCP，以 [OpenAI 当前官方文档](https://developers.openai.com/apps-sdk/build/auth) 和实际界面为准；本仓库不声称所有账号都已端到端验证。

首次只测试查询：“列出我 DNSPod 的域名”“查询 example.com 的解析线路”。31 个工具可被发现不代表 31 个工具都获准执行；默认写工具会被服务端拒绝。

## 如何开放写入

先确认只读查询正常，再编辑服务端配置，例如只允许一个专用测试域名：

```toml
DNSPOD_READ_ONLY = "false"
DNSPOD_ALLOW_DESTRUCTIVE = "true"
DNSPOD_WRITE_DOMAINS = "example.com"
```

多个域名用英文逗号分隔，按**完整托管域名精确匹配**。空白列表拒绝全部写入；`*` 明确代表全部域名，不建议使用。

`DNSPOD_ALLOW_DESTRUCTIVE=true` 不只影响删除：修改现有记录、停用记录、DDNS、批量修改和整域回滚也可能中断业务，均按破坏性变更处理。新增记录仍可能发生业务冲突，必须确认目标。

所有写工具要求 `Confirmed=true`。**它只是调用意图参数，模型也能填写，不是“人类已点击批准”的可信凭据。** 真正的安全边界是服务端开关、域名白名单、腾讯云 CAM 和客户端审批。工具 annotations 只是提示，不是权限控制。

可选传 `ExpectedValue` 核对旧值，发现变化就停止。检查与执行之间仍存在时间窗口；腾讯云接口没有被本项目改造成原子 CAS 或事务。

## 批量、快照和恢复

批量操作只接受单个域名、最多 **20** 项，这是本项目的保守上限，不是腾讯云官方上限。修改/删除/移动分组会先核验全部 RecordId；任何核验失败都不提交批量写入，但这不保证云端任务不会部分成功。

推荐流程：查询目标 → 展示变更 → 创建快照并查列表确认快照可用 → 用户确认 → 批量变更 → 查询 JobId 的结果 → 再查记录核验。

本项目**不会自动为每个写操作创建快照，也不会自动回滚生产配置**。快照可能有套餐、配额和异步完成限制；无法确认备份可用时应停止后续重大变更。

当前 `rollback_snapshot` 是**整域回滚**，不提供选择部分记录的参数。服务端执行前会再次调用 `CheckSnapshotRollback`，失败、超时或缺关键结果时停止。获得 TaskId 后还必须调用 `describe_snapshot_rollback_result`，不能立即报告恢复完成。

网络超时后不自动重试写操作，因为腾讯云可能已受理。先用记录/任务查询核实。

## 本地开发与 v2 迁移

```bash
cp .env.example .dev.vars
chmod 600 .dev.vars
# 填自己的开发凭据，切勿提交
npm run dev
```

从 v2 升级：保存旧部署版本和配置；合并 v3 的 Durable Object binding/migration；设置足够强且独立的密码与签名密钥；保持默认只读部署；在客户端删除旧连接并重新 OAuth 授权；先验收读操作，再按测试域名逐步开放写入。旧 KV 不再使用但不会被自动删除。

当前仅支持 `/mcp` 无状态 Streamable HTTP JSON 响应，GET 返回 405 是正常的“不支持服务端事件流”。不宣称兼容旧 SSE 会话传输。需要旧 SSE 的客户端应继续使用旧版本或更新客户端。

## 安全与已知限制

- 授权码和刷新令牌使用 SQLite DO 原子消费，S256 必选；JWT 校验 issuer、audience、scope、有效期和版本，不提供默认签名密钥。
- 授权页有 CSRF 防护、回调严格匹配和基本限流。可用 `OAUTH_ALLOWED_REDIRECT_URIS` 限制动态注册的完整回调 URL；客户端真实回调地址变化后需同步维护。
- 默认不反射陌生浏览器 Origin；有浏览器直连需求时配置精确的 `CORS_ALLOWED_ORIGINS`。
- 单个 MCP 请求体上限 256 KiB；外部 API 超时 12 秒且不自动重试。这些是项目配置边界，并非服务商 SLA。
- `/health` 只表示进程存活与配置概况，**不代表腾讯云凭据有效或真实 DNS 验收通过**。
- `.env`、`.dev.vars`、令牌、运行日志和真实 DNS 导出不要提交；公开过的凭据应轮换。
- 依赖云 API 的额度、套餐、权限及实际部署环境，所有写功能上线前需在专用测试域名验收。本次回归测试不是安全审计认证。

## 开发与上游关系

上游：<https://github.com/zfx-t/dnspod-mcp-workers>，贡献者和许可见 Git 历史与 [LICENSE](LICENSE)。TC3 签名实现沿用其思路；v3 将工具、请求、校验和 OAuth 拆分为独立模块，并新增测试与中文文档。

腾讯官方接口：<https://cloud.tencent.com/document/api/1427/56194>。v3 字段核对说明见 [API 契约说明](docs/api-contracts.md)。
