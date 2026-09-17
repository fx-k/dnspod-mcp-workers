# DNSPod MCP v3 实现范围与验收边界

保留 Cloudflare Workers + Remote MCP 架构，在上游 9 个工具基础上补充线路/类型发现、单条记录详情与启停/备注/DDNS、记录分组、批量任务、快照与回滚结果查询。文档与新增说明以中文为主。

## API 核对中发现的边界

- `DescribeRecordList` 新规范字段为 `SubDomain`，旧 `Subdomain` 仍作为兼容字段；不能笼统说旧字段已失效。
- `CreateSnapshot` 返回 `RequestId`，并不直接返回 `SnapshotId`；需要后续查询快照列表确认。
- `RollbackSnapshot` 返回 `TaskId`，只代表提交任务；应查询 `DescribeSnapshotRollbackResult` 验证终态及失败项。
- 批量操作返回 `JobId` 后，应查询 `DescribeBatchTask`，不能直接宣称全部成功。
- `ModifyRecordToGroup.RecordId` 是使用 `|` 分隔的字符串，而不是逗号分隔。
- v3 不添加购买、扣款、自动续费、域名所有权转移等能力。

## 验收层次

1. 本地与 CI：语法、参数契约、模拟腾讯云响应、MCP HTTP 与 OAuth 回归测试。
2. Cloudflare 构建：Wrangler dry-run，不创建线上资源。
3. 真实部署：需要维护者的 Cloudflare 配置与腾讯云凭据；没有真实调用证据时，明确标记未验收。

本次开发不执行生产 DNS 写操作，不上传真实密钥，不自动部署到 Cloudflare。
