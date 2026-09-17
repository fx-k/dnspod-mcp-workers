# v3 工具清单

全部 31 个工具。所有写工具都需要 Confirmed=true，且通过服务端写开关、域名白名单、危险操作开关和 CAM 权限。只读工具不会被写白名单过滤；需要限制可读域名时必须在 CAM 层授权。

| MCP Tool | 腾讯 API | 类型 | 必填输入 |
| --- | --- | --- | --- |
| `describe_domain_list` | `DescribeDomainList` | 只读 | 无 |
| `create_domain` | `CreateDomain` | 写入 | `Domain`、`Confirmed` |
| `describe_domain` | `DescribeDomain` | 只读 | `Domain` |
| `describe_domain_log_list` | `DescribeDomainLogList` | 只读 | `Domain` |
| `describe_record_list` | `DescribeRecordList` | 只读 | `Domain` |
| `describe_record` | `DescribeRecord` | 只读 | `Domain`、`RecordId` |
| `describe_record_line_category_list` | `DescribeRecordLineCategoryList` | 只读 | `Domain` |
| `describe_record_line_list` | `DescribeRecordLineList` | 只读 | `Domain` |
| `describe_record_type` | `DescribeRecordType` | 只读 | `Domain` |
| `create_record` | `CreateRecord` | 写入 | `Domain`、`SubDomain`、`RecordType`、`Value`、`Confirmed` |
| `modify_record` | `ModifyRecord` | 破坏性写入 | `Domain`、`RecordId`、`Confirmed` |
| `delete_record` | `DeleteRecord` | 破坏性写入 | `Domain`、`RecordId`、`Confirmed` |
| `modify_record_status` | `ModifyRecordStatus` | 破坏性写入 | `Domain`、`RecordId`、`Status`、`Confirmed` |
| `modify_record_remark` | `ModifyRecordRemark` | 写入 | `Domain`、`RecordId`、`Remark`、`Confirmed` |
| `modify_dynamic_dns` | `ModifyDynamicDNS` | 破坏性写入 | `Domain`、`RecordId`、`Value`、`Confirmed` |
| `describe_record_group_list` | `DescribeRecordGroupList` | 只读 | `Domain` |
| `create_record_group` | `CreateRecordGroup` | 写入 | `Domain`、`GroupName`、`Confirmed` |
| `modify_record_group` | `ModifyRecordGroup` | 写入 | `Domain`、`GroupId`、`GroupName`、`Confirmed` |
| `modify_record_to_group` | `ModifyRecordToGroup` | 写入 | `Domain`、`GroupId`、`RecordIds`、`Confirmed` |
| `delete_record_group` | `DeleteRecordGroup` | 破坏性写入 | `Domain`、`GroupId`、`Confirmed` |
| `create_record_batch` | `CreateRecordBatch` | 写入 | `Domain`、`RecordList`、`Confirmed` |
| `modify_record_batch` | `ModifyRecordBatchV3` | 破坏性写入 | `Domain`、`ModifyRecordList`、`Confirmed` |
| `delete_record_batch` | `DeleteRecordBatch` | 破坏性写入 | `Domain`、`RecordIdList`、`Confirmed` |
| `describe_batch_task` | `DescribeBatchTask` | 只读 | `JobId` |
| `create_snapshot` | `CreateSnapshot` | 写入 | `Domain`、`Confirmed` |
| `describe_snapshot_list` | `DescribeSnapshotList` | 只读 | `Domain` |
| `check_snapshot_rollback` | `CheckSnapshotRollback` | 只读 | `Domain`、`SnapshotId` |
| `rollback_snapshot` | `RollbackSnapshot` | 破坏性写入 | `Domain`、`SnapshotId`、`Confirmed` |
| `describe_snapshot_rollback_result` | `DescribeSnapshotRollbackResult` | 只读 | `Domain`、`TaskId` |
| `describe_domain_analytics` | `DescribeDomainAnalytics` | 只读 | `Domain`、`StartDate`、`EndDate` |
| `describe_subdomain_analytics` | `DescribeSubdomainAnalytics` | 只读 | `Domain`、`StartDate`、`EndDate` |

完整输入定义见 `src/tools.js`。域名级工具统一要求 Domain；DomainId 可选且必须匹配。子域统计还需提供 Subdomain / SubDomain 之一。describe_record_type 和 describe_record_line_list 会自动多执行一次只读 DescribeDomain。
