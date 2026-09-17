# 更新记录

## 3.0.0 — 2026-09-17

### 新增

- 从 9 扩展为 31 个 MCP 工具：记录/能力发现、状态/备注/DDNS、分组、批量及结果、快照及回滚结果。
- 默认只读、写域名白名单、危险操作开关和服务端参数校验。
- 局部修改前读取原记录；保留未指定字段，支持 ExpectedValue 预检。
- 78 项离线回归、31 个 Schema 元结构验收、Wrangler 构建和本地 workerd/DO 验收工作流。

### 修正

- 免费版线路说明、MX 优先级范围、空备注/零值丢失、批量 V3/记录分组字段契约。
- 不再把 JobId / TaskId 视为完成；不编造 CreateSnapshot 的 SnapshotId。
- 修复 workerd 主入口命名导出兼容问题；实际 workerd/SQLite DO 验收已通过。

### 兼容性变更

- OAuth 从 KV 改为 SQLite Durable Object，强制 S256、CSRF、严格资源与客户端绑定、令牌原子消费。旧连接需重新授权。
- 默认写入关闭；现有写客户端必须适配 Confirmed 和服务端权限配置。
- 只提供 `/mcp` 无状态 Streamable HTTP，不再声称支持原先不完整的 SSE 传输。
- Node.js 最低版本提升到 22。

真实 Cloudflare/ChatGPT/DNSPod 线上验收未执行，详见 docs/acceptance.md。
