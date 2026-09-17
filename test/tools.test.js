import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOLS,callTool,MAX_BATCH,ACTIONS} from '../src/tools.js';
import {validate,canonicalDomain,checkRecord,validateDates} from '../src/validation.js';
import {cloud,DOMAIN,writeEnv,baseRecord} from './helpers.js';
const d={Domain:DOMAIN};const r={...d,RecordId:11};const w={Confirmed:true};
const add={SubDomain:'www',RecordType:'A',Value:'192.0.2.20'};
const samples={
 describe_domain_list:{}, create_domain:{...d,...w},describe_domain:d,describe_domain_log_list:d,
 describe_record_list:d,describe_record:r,describe_record_line_category_list:d,describe_record_line_list:d,describe_record_type:d,
 create_record:{...d,...add,...w},modify_record:{...r,Value:'192.0.2.20',...w},delete_record:{...r,...w},
 modify_record_status:{...r,Status:'DISABLE',...w},modify_record_remark:{...r,Remark:'',...w},modify_dynamic_dns:{...r,Value:'192.0.2.30',...w},
 describe_record_group_list:d,create_record_group:{...d,GroupName:'Lab',...w},modify_record_group:{...d,GroupId:1,GroupName:'Lab',...w},
 modify_record_to_group:{...d,GroupId:1,RecordIds:[11,12],...w},delete_record_group:{...d,GroupId:1,...w},
 create_record_batch:{...d,RecordList:[add],...w},modify_record_batch:{...d,ModifyRecordList:[{RecordId:11,Value:'192.0.2.20'}],...w},
 delete_record_batch:{...d,RecordIdList:[11,12],...w},describe_batch_task:{JobId:99},
 create_snapshot:{...d,...w},describe_snapshot_list:d,check_snapshot_rollback:{...d,SnapshotId:'test-snapshot'},
 rollback_snapshot:{...d,SnapshotId:'test-snapshot',...w},describe_snapshot_rollback_result:{...d,TaskId:123},
 describe_domain_analytics:{...d,StartDate:'2026-09-01',EndDate:'2026-09-02'},
 describe_subdomain_analytics:{...d,Subdomain:'www',StartDate:'2026-09-01',EndDate:'2026-09-02'}
};
const expectedActions=['DescribeDomainList','CreateDomain','DescribeDomain','DescribeDomainLogList','DescribeRecordList','DescribeRecord','DescribeRecordLineCategoryList','DescribeRecordLineList','DescribeRecordType','CreateRecord','ModifyRecord','DeleteRecord','ModifyRecordStatus','ModifyRecordRemark','ModifyDynamicDNS','DescribeRecordGroupList','CreateRecordGroup','ModifyRecordGroup','ModifyRecordToGroup','DeleteRecordGroup','CreateRecordBatch','ModifyRecordBatchV3','DeleteRecordBatch','DescribeBatchTask','CreateSnapshot','DescribeSnapshotList','CheckSnapshotRollback','RollbackSnapshot','DescribeSnapshotRollbackResult','DescribeDomainAnalytics','DescribeSubdomainAnalytics'];
test('31 个工具有唯一名称、严格对象输入及明确副作用标记',()=>{
 assert.equal(TOOLS.length,31);assert.equal(new Set(TOOLS.map(t=>t.name)).size,31);assert.deepEqual(ACTIONS,expectedActions);
 for(const t of TOOLS){assert.equal(t.inputSchema.type,'object');assert.equal(t.inputSchema.additionalProperties,false);
  for(const field of t.inputSchema.required)assert.ok(Object.hasOwn(t.inputSchema.properties,field));
  assert.equal(typeof t.annotations.readOnlyHint,'boolean');assert.ok(samples[t.name]);
  validate(t.inputSchema,samples[t.name]);
 }
 assert.ok(!ACTIONS.some(a=>/Pay|Deal|Owner|DeleteDomain|AutoRenew/.test(a)));
});
for(const [name,args]of Object.entries(samples))test(`路由契约：${name}`,async()=>{
 const c=cloud();const out=await callTool(writeEnv,name,args,c.api);
 assert.equal(c.last().action,expectedActions[TOOLS.findIndex(t=>t.name===name)]);assert.ok(out.RequestId || out.DomainInfo || out.RecordInfo || out.Total!==undefined);
 assert.equal(c.last().payload.Confirmed,undefined);assert.equal(c.last().payload.ExpectedValue,undefined);
});
test('所有写工具默认禁止，且拒绝发生在任何云 API 之前',async()=>{
 for(const t of TOOLS.filter(t=>!t.annotations.readOnlyHint)){
  const c=cloud();await assert.rejects(()=>callTool({},t.name,samples[t.name],c.api),/只读/);assert.equal(c.calls.length,0);
 }
});
test('确认、破坏性开关和域名白名单均由服务端执行',async()=>{
 for(const [env,args,error]of [[{...writeEnv,DNSPOD_ALLOW_DESTRUCTIVE:'false'},samples.delete_record,/破坏/],[writeEnv,{...r,Confirmed:false},/确认/],[{...writeEnv,DNSPOD_WRITE_DOMAINS:'elsewhere.com'},samples.delete_record,/白名单/]]){
  const c=cloud();await assert.rejects(()=>callTool(env,'delete_record',args,c.api),error);assert.equal(c.calls.length,0);
 }
});
test('DomainId 不能绕过 Domain 白名单',async()=>{
 const c=cloud();await assert.rejects(()=>callTool(writeEnv,'delete_record',{...samples.delete_record,DomainId:101},c.api),/不匹配/);
 assert.deepEqual(c.calls.map(x=>x.action),['DescribeDomain']);
});
test('合法 DomainId 核验后不携带高优先级 ID 调写接口',async()=>{
 const c=cloud();await callTool(writeEnv,'create_record',{...samples.create_record,DomainId:100},c.api);assert.equal(c.last().payload.DomainId,undefined);
});
test('局部修改保留线路、TTL、停用状态和零值，不覆盖未指定字段',async()=>{
 const c=cloud();await callTool(writeEnv,'modify_record',samples.modify_record,c.api);
 assert.deepEqual(c.last().payload,{Domain:DOMAIN,RecordId:11,SubDomain:'www',RecordType:'A',RecordLine:'电信',RecordLineId:'10=0',Value:'192.0.2.20',TTL:900,MX:0,Weight:0,Status:'DISABLE',Remark:'old'});
});
test('改线路名称时移除旧 LineId，避免旧 ID 覆盖新名称',async()=>{
 const c=cloud();await callTool(writeEnv,'modify_record',{...r,RecordLine:'联通',...w},c.api);assert.equal(c.last().payload.RecordLine,'联通');assert.equal(c.last().payload.RecordLineId,undefined);
});
test('修改前 ExpectedValue 冲突停止，不自动重试',async()=>{
 const c=cloud();await assert.rejects(()=>callTool(writeEnv,'modify_record',{...samples.modify_record,ExpectedValue:'192.0.2.99'},c.api),/ExpectedValue/);assert.equal(c.calls.length,1);
});
test('缺少可靠记录信息或启停状态时不执行修改',async()=>{
 for(const RecordInfo of [null,{...baseRecord,Id:12},{...baseRecord,Enabled:undefined}]){
  const c=cloud({DescribeRecord:()=>({RecordInfo})});await assert.rejects(()=>callTool(writeEnv,'modify_record',samples.modify_record,c.api));assert.equal(c.calls.length,1);
 }
});
test('空备注保留到请求中',async()=>{const c=cloud();await callTool(writeEnv,'modify_record_remark',samples.modify_record_remark,c.api);assert.equal(c.last().payload.Remark,'');});
test('查询别名按 API 区分，空结果不开错误，分页显式保留',async()=>{
 const c=cloud({DescribeRecordList:()=>({RecordList:[],RecordCountInfo:{TotalCount:0}})});
 const out=await callTool({},'describe_record_list',{...d,Subdomain:'www',Offset:100,GroupId:0},c.api);
 assert.deepEqual(out.RecordList,[]);assert.equal(c.last().payload.SubDomain,'www');assert.equal(c.last().payload.Subdomain,undefined);assert.equal(c.last().payload.ErrorOnEmpty,'no');assert.equal(c.last().payload.Offset,100);assert.equal(c.last().payload.GroupId,0);
 await callTool({},'describe_subdomain_analytics',{...samples.describe_subdomain_analytics,SubDomain:'www'},c.api);assert.equal(c.last().payload.Subdomain,'www');assert.equal(c.last().payload.SubDomain,undefined);
 await assert.rejects(()=>callTool({},'describe_record_list',{...d,Subdomain:'www',SubDomain:'api'},c.api),/冲突/);
});
test('自动 Grade 与分类 Useful 原样保留，不猜套餐',async()=>{
 const c=cloud({DescribeRecordLineCategoryList:()=>({LineList:[{LineName:'高级',Useful:false}]})});
 await callTool({},'describe_record_line_list',d,c.api);assert.deepEqual(c.calls.map(x=>x.action),['DescribeDomain','DescribeRecordLineList']);assert.equal(c.last().payload.DomainGrade,'DP_FREE');
 await callTool({},'describe_record_type',d,c.api);assert.deepEqual(c.last().payload,{DomainGrade:'DP_FREE'});
 const result=await callTool({},'describe_record_line_category_list',d,c.api);assert.equal(result.LineList[0].Useful,false);
 const bad=cloud({DescribeDomain:()=>({DomainInfo:{Domain:DOMAIN}})});await assert.rejects(()=>callTool({},'describe_record_type',d,bad.api),/Grade/);
});
test('DDNS 只接受显式 IP，保留线路，不支持非 A/AAAA',async()=>{
 const c=cloud();await callTool(writeEnv,'modify_dynamic_dns',samples.modify_dynamic_dns,c.api);assert.equal(c.last().payload.RecordLineId,baseRecord.RecordLineId);
 await assert.rejects(()=>callTool(writeEnv,'modify_dynamic_dns',{...r,...w},c.api),/Value/);
 const bad=cloud({DescribeRecord:()=>({RecordInfo:{...baseRecord,RecordType:'CNAME'}})});await assert.rejects(()=>callTool(writeEnv,'modify_dynamic_dns',samples.modify_dynamic_dns,bad.api),/A \/ AAAA/);
});
test('批量创建 DomainIdList 为字符串且不透传不支持的参数',async()=>{
 const c=cloud();await callTool(writeEnv,'create_record_batch',samples.create_record_batch,c.api);assert.deepEqual(c.last().payload,{DomainIdList:['100'],RecordList:[add]});
 await assert.rejects(()=>callTool(writeEnv,'create_record_batch',{...d,RecordList:[{...add,Status:'DISABLE'}],...w},c.api),/不支持的参数/);
});
test('批量 V3 保留 Enabled=0 及空 Remark，不发送 Domain 或 LineId',async()=>{
 const c=cloud();await callTool(writeEnv,'modify_record_batch',{...d,ModifyRecordList:[{RecordId:11,Enabled:'0',Remark:''}],...w},c.api);
 assert.deepEqual(c.last().payload,{ModifyRecordList:[{RecordId:11,Enabled:'0',Remark:''}]});
 await assert.rejects(()=>callTool(writeEnv,'modify_record_batch',{...d,ModifyRecordList:[{RecordId:11,RecordLineId:'0'}],...w},c.api),/不支持/);
});
test('批量核验中途失败时，没有任何写 API 调用',async()=>{
 const c=cloud({DescribeRecord:p=>{if(p.RecordId===12)throw new Error('not in domain');return{RecordInfo:baseRecord};}});
 await assert.rejects(()=>callTool(writeEnv,'delete_record_batch',samples.delete_record_batch,c.api),/not in domain/);assert.ok(c.calls.every(x=>x.action==='DescribeRecord'));
});
test('批量空数组/超限/重复 ID/无修改字段都拒绝',async()=>{
 const c=cloud();for(const ids of [[],[11,11],Array.from({length:MAX_BATCH+1},(_,i)=>i+1)])await assert.rejects(()=>callTool(writeEnv,'delete_record_batch',{...d,RecordIdList:ids,...w},c.api));
 for(const list of [[{RecordId:11}],[{RecordId:11,Remark:'a'},{RecordId:11,Remark:'b'}]])await assert.rejects(()=>callTool(writeEnv,'modify_record_batch',{...d,ModifyRecordList:list,...w},c.api));
});
test('记录分组按 | 拼接，保护默认系统分组',async()=>{
 const c=cloud();await callTool(writeEnv,'modify_record_to_group',samples.modify_record_to_group,c.api);assert.equal(c.last().payload.RecordId,'11|12');assert.equal(c.last().payload.RecordIds,undefined);
 await assert.rejects(()=>callTool(writeEnv,'delete_record_group',{...d,GroupId:0,...w},c.api),/默认系统/);
});
test('快照创建、批量提交、回滚都只标记 submitted',async()=>{
 for(const name of ['create_snapshot','create_record_batch','modify_record_batch','delete_record_batch','rollback_snapshot']){
  const c=cloud();const out=await callTool(writeEnv,name,samples[name],c.api);assert.deepEqual([out.McpOperation.state,out.McpOperation.verified],['submitted',false]);
  if(name==='create_snapshot')assert.equal(out.SnapshotId,undefined);
 }
});
test('回滚检查失败/超时/不完整全部停止',async()=>{
 for(const check of [{Total:1,Failed:1,Timeout:null},{Total:1,Failed:0,Timeout:1},{Total:1,Failed:0,Timeout:2},{Total:1,Failed:0},{Total:1,Failed:0,Timeout:0,FailedRecordList:[{}]},{}]){
  const c=cloud({CheckSnapshotRollback:()=>check});await assert.rejects(()=>callTool(writeEnv,'rollback_snapshot',samples.rollback_snapshot,c.api),/预检/);assert.equal(c.calls.length,1);
 }
});
test('任务 waiting 和部分失败原样返回，不能变成成功',async()=>{
 const c=cloud({DescribeBatchTask:()=>({TotalCount:2,SuccessCount:1,FailCount:1}),DescribeSnapshotRollbackResult:()=>({Status:'waiting',Progress:0,Failed:null})});
 assert.equal((await callTool({},'describe_batch_task',samples.describe_batch_task,c.api)).FailCount,1);
 assert.equal((await callTool({},'describe_snapshot_rollback_result',samples.describe_snapshot_rollback_result,c.api)).Status,'waiting');
});
test('Schema 拒绝错误参数类型、幽灵参数、安全整数溢出',async()=>{
 for(const args of [null,[],{...r,RecordId:'11'},{...r,RecordId:Number.MAX_SAFE_INTEGER+1},{...r,Foo:1}])await assert.rejects(()=>callTool({},'describe_record',args,cloud().api));
 await assert.rejects(()=>callTool({},'PayOrderWithBalance',{},cloud().api),/Unknown tool/);
});
test('IP/MX 范围、主机头和日期边界',()=>{
 const schema=TOOLS.find(t=>t.name==='create_record').inputSchema;
 for(const MX of [0,65535])validate(schema,{...samples.create_record,RecordType:'MX',Value:'mail.example.net',MX});
 assert.throws(()=>validate(schema,{...samples.create_record,MX:65536}));
 assert.throws(()=>checkRecord({RecordType:'MX',Value:'mail.example.net'},DOMAIN));
 for(const Value of ['999.1.1.1','01.2.3.4','example.com'])assert.throws(()=>checkRecord({RecordType:'A',Value},DOMAIN));
 for(const SubDomain of ['www.example.com','a,b','example.com'])assert.throws(()=>checkRecord({SubDomain},DOMAIN));
 checkRecord({SubDomain:'api.v1',RecordType:'AAAA',Value:'2001:db8::1'},DOMAIN);
 assert.equal(canonicalDomain('EXAMPLE.COM.'),DOMAIN);assert.throws(()=>canonicalDomain('https://example.com'));
 for(const args of [{StartDate:'2026-02-30'},{StartDate:'2026-09-02',EndDate:'2026-09-01'}])assert.throws(()=>validateDates(args));
});
