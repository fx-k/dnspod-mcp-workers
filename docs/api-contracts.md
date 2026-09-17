# v3 API 契约与范围

核对时间：2026-09-17。以腾讯云 DNSPod `2021-03-23` API 为基础。下面是代码设计依据，而非对所有真实账户的调用成功证明。

| 项目 | 核对结果与项目行为 | 官方依据 |
| --- | --- | --- |
| 记录列表主机头 | `SubDomain` 是新增规范参数，旧 `Subdomain` 并非已失效；MCP 兼容两者并拒绝冲突，发记录列表时统一新字段 | [DescribeRecordList](https://cloud.tencent.com/document/api/1427/56166) |
| 子域统计主机头 | 保留统计接口的 `Subdomain`，不全局盲替换字段大小写 | [API 概览](https://cloud.tencent.com/document/api/1427/56194) |
| 单条修改 | 先查询记录详情，补齐云 API 必填字段，保留省略字段；局部修改是本 MCP 的增强，不是宣称 ModifyRecord 本身是 PATCH | [DescribeRecord](https://cloud.tencent.com/document/api/1427/56168)、[ModifyRecord](https://cloud.tencent.com/document/product/1427/56157) |
| 线路分类 | 返回项需判断 Useful，不能把全部分类都当作套餐可用线路 | [DescribeRecordLineCategoryList](https://cloud.tencent.com/document/product/1427/104320) |
| 线路/类型发现 | 自动先 DescribeDomain 获取 Grade，再查询套餐能力 | [DescribeRecordLineList](https://cloud.tencent.com/document/api/1427/56167)、[DescribeRecordType](https://cloud.tencent.com/document/api/1427/56165) |
| MX / HTTPS / SVCB | 优先级 0–65535；新建相应类型时显式要求 MX；套餐和记录类型是否支持仍由 API 判断 | [CreateRecord](https://cloud.tencent.com/document/api/1427/56180) |
| DDNS | 使用规范 TTL 字段；本 MCP 强制显式 Value，不以 Worker 出口 IP 代替用户地址 | [ModifyDynamicDNS](https://cloud.tencent.com/document/api/1427/56158) |
| 分组移动 | RecordId 是以 `\|` 分隔的字符串；输入向模型提供整型数组，服务端转换 | [ModifyRecordToGroup](https://cloud.tencent.com/document/api/1427/83223) |
| 批量创建 | DomainIdList 是字符串数组；每项只包含 AddRecordBatch 支持的字段；不透传已移除的 Enabled / Weight / Remark | [CreateRecordBatch](https://cloud.tencent.com/document/api/1427/56179)、[数据结构](https://cloud.tencent.com/document/product/1427/56185) |
| 批量修改 | 使用 ModifyRecordBatchV3；Enabled 为字符串 1/0；项目不虚构 RecordLineId 参数 | [ModifyRecordBatchV3](https://cloud.tencent.com/document/api/1427/130371)、[数据结构](https://cloud.tencent.com/document/product/1427/56185) |
| 批量状态 | JobId 只表示已提交；检查 TotalCount / SuccessCount / FailCount / DetailList | [DescribeBatchTask](https://cloud.tencent.com/document/api/1427/56174) |
| 快照创建 | CreateSnapshot 只返回 RequestId，不能直接得到 SnapshotId；后续查列表核对 | [CreateSnapshot](https://cloud.tencent.com/document/api/1427/83184)、[DescribeSnapshotList](https://cloud.tencent.com/document/api/1427/83180) |
| 快照回滚 | 预检失败或超时就停止；回滚返回 TaskId 后查询实际状态，不把提交当成功 | [CheckSnapshotRollback](https://cloud.tencent.com/document/product/1427/83185)、[RollbackSnapshot](https://cloud.tencent.com/document/api/1427/83174)、[DescribeSnapshotRollbackResult](https://cloud.tencent.com/document/api/1427/83179) |

## 不承诺的能力

不覆盖所有 DNSPod API，不自动付费、不转移域名所有权、不承诺快照免费/立即可用、不把不同腾讯接口包装成跨接口原子事务。

## OAuth 存储选择

v2 的 KV get/delete 不提供一次性授权状态消费所需的事务语义。v3 使用 [Durable Object storage transactions](https://developers.cloudflare.com/durable-objects/api/storage-api/) 与 SQLite namespace；参考 [Durable Objects](https://developers.cloudflare.com/durable-objects/) 和 [MCP 授权](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)。部署需使用仓库完整 Wrangler 配置，旧 OAuth 会话需重建。
