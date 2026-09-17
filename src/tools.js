import { tencentRequest } from './tencent.js';
import { validate, canonicalDomain, validateDates, checkRecord } from './validation.js';

export const VERSION = '3.0.0';
export const MAX_BATCH = 20; // 本项目保守上限，不是腾讯云官方上限。
const s = (description, extra = {}) => ({type:'string', description, minLength:1, ...extra});
const i = (description, extra = {}) => ({type:'integer', description, minimum:1, ...extra});
const obj = (properties, required = []) => ({type:'object', properties, required, additionalProperties:false});
const arr = (description, items) => ({type:'array', description, items, minItems:1, maxItems:MAX_BATCH, uniqueItems:true});
const Domain = s('DNSPod 托管域名，例如 example.com，不是 URL。');
const DomainId = i('可选域名 ID；必须与 Domain 一致，服务端会核验。');
const domain = {Domain, DomainId};
const RecordId = i('记录 ID，先通过 describe_record_list / describe_record 核实，不要猜测。');
const GroupId = i('记录分组 ID；0 为默认分组。', {minimum:0});
const GroupName = s('记录分组名称。');
const SubDomain = s('相对主机头：@、www、api.v1；不要传完整域名，也不接受逗号批量写法。');
const RecordType = s('记录类型；不确定时查询 describe_record_type，不猜套餐支持情况。');
const RecordLine = s('线路名称。免费版也支持基础线路；通过线路查询工具核实。修改时省略会保留原线路。');
const RecordLineId = s('线路 ID；同时提供名称与 ID 时，以 ID 为准。');
const Value = s('记录值。A=IPv4，AAAA=IPv6，TXT 保留原文，不自动探测用户公网 IP。');
const TTL = i('缓存秒数，套餐最小值由腾讯云判断；省略不强制写成 600。', {maximum:604800});
const MX = i('MX / HTTPS / SVCB 优先级，0 也合法。', {minimum:0, maximum:65535});
const Weight = i('权重 0–100，0 表示关闭权重。', {minimum:0, maximum:100});
const Status = s('记录状态：ENABLE 启用、DISABLE 暂停。', {enum:['ENABLE','DISABLE']});
const Remark = s('备注；空字符串明确表示清空备注。', {minLength:0});
const DnssecConflictMode = s('仅明确需要强制处理 DNSSEC 冲突时传 force。', {enum:['force']});
const Confirmed = {type:'boolean', description:'必须在用户确认本次具体变更后传 true。此参数不是身份认证或用户确认凭据。'};
const ExpectedValue = s('可选：预期旧记录值。不匹配时停止；这只是操作前核验，不是腾讯云原子 CAS。', {minLength:0});
const SnapshotId = s('快照 ID，必须从 describe_snapshot_list 获取；创建快照接口不直接返回 ID。');
const paging = {Offset:i('分页偏移。', {minimum:0, default:0}), Limit:i('每页数量，本项目默认 100。', {maximum:3000, default:100})};
const recordFields = {SubDomain, RecordType, RecordLine, RecordLineId, Value, TTL, MX, Weight, Status, Remark, DnssecConflictMode};
const definitions = [];
function add(name, action, title, properties, required = [], options = {}) {
  const write = options.write === true;
  definitions.push({name, action, write, destructive:options.destructive === true, ...options, tool:{
    name, title,
    description:`${title}。${options.info || ''} 对应腾讯云 ${action}。${write ? '会修改服务端数据；先展示并确认变更。' : '只读，不修改 DNS。'}`,
    inputSchema:obj({...properties, ...(write ? {Confirmed} : {})}, [...required, ...(write ? ['Confirmed'] : [])]),
    annotations:{readOnlyHint:!write, destructiveHint:options.destructive === true,
      idempotentHint:options.idempotent ?? !write, openWorldHint:true}
  }});
}
add('describe_domain_list','DescribeDomainList','查询域名列表',{
  Type:s('域名分组过滤。', {enum:['ALL','MINE','SHARE','ISMARK','PAUSE','VIP','RECENT','SHARE_OUT','FREE'], default:'ALL'}),
  ...paging, Limit:i('每页最多 100 个。',{maximum:100, default:20}), GroupId, Keyword:s('域名关键字。')
},[],{defaults:{Type:'ALL', Offset:0, Limit:20},info:'返回的是一页；全部域名必须继续分页。'});
add('create_domain','CreateDomain','添加 DNSPod 托管域名',{Domain, GroupId},['Domain'],{write:true, info:'只是添加托管对象，不购买域名；不会替你修改注册商 NS。'});
add('describe_domain','DescribeDomain','查询域名详情',domain,['Domain']);
add('describe_domain_log_list','DescribeDomainLogList','查询域名操作日志',{
  ...domain, ...paging, Limit:i('每页最多 500 条。',{maximum:500,default:100})
},['Domain'],{defaults:{Offset:0,Limit:100}});
add('describe_record_list','DescribeRecordList','查询解析记录列表',{
  ...domain, SubDomain, Subdomain:{...SubDomain,description:'旧版兼容别名，优先使用 SubDomain。'},
  RecordType, RecordLine, RecordLineId, GroupId, Keyword:s('记录关键字。'), ...paging,
  SortField:s('排序字段。',{enum:['name','line','type','value','weight','mx','ttl','updated_on']}),
  SortType:s('排序方向。',{enum:['ASC','DESC']}), ErrorOnEmpty:s('查不到记录是否报错。',{enum:['yes','no'],default:'no'})
},['Domain'],{defaults:{Offset:0,Limit:100,ErrorOnEmpty:'no'},info:'默认空结果返回空列表；仍是分页查询，不把一页当全部。'});
add('describe_record','DescribeRecord','查询单条记录',{...domain,RecordId},['Domain','RecordId']);
add('describe_record_line_category_list','DescribeRecordLineCategoryList','分类查询解析线路',domain,['Domain'],{
  info:'分类结果可能包含不可用线路，必须检查每项 Useful，不能把返回的所有线路都当成可用。'});
add('describe_record_line_list','DescribeRecordLineList','查询当前套餐允许的解析线路',domain,['Domain'],{
  info:'自动先 DescribeDomain 获取 DomainGrade，用户无需知道 DP_FREE 等内部值。', grade:true});
add('describe_record_type','DescribeRecordType','查询当前套餐支持的记录类型',domain,['Domain'],{
  info:'自动查询域名 Grade；不硬编码套餐可用类型。', grade:true});
add('create_record','CreateRecord','新增解析记录',{...domain,...recordFields,GroupId},['Domain','SubDomain','RecordType','Value'],{
  write:true, info:'新建默认线路为“默认”；保留 Status、GroupId、DNSSEC 选项。'});
add('modify_record','ModifyRecord','修改单条解析记录',{...domain,RecordId,...recordFields,ExpectedValue},['Domain','RecordId'],{
  write:true,destructive:true,idempotent:true,
  info:'支持局部输入：自动读取现有记录，保留未指定字段，特别是线路、TTL、启停状态。至少指定一个待改字段。'});
add('delete_record','DeleteRecord','删除单条解析记录',{...domain,RecordId,ExpectedValue},['Domain','RecordId'],{
  write:true,destructive:true,info:'先核实 RecordId；删除可能导致业务中断，不能保证自动恢复。'});
add('modify_record_status','ModifyRecordStatus','启用或暂停记录',{...domain,RecordId,Status,ExpectedValue},['Domain','RecordId','Status'],{
  write:true,destructive:true,idempotent:true,info:'暂停也可能中断业务；不是低风险只读操作。'});
add('modify_record_remark','ModifyRecordRemark','修改记录备注',{...domain,RecordId,Remark},['Domain','RecordId','Remark'],{write:true,idempotent:true});
add('modify_dynamic_dns','ModifyDynamicDNS','更新 DDNS 记录',{
  ...domain,RecordId,SubDomain,RecordLine,RecordLineId,Value,TTL,ExpectedValue
},['Domain','RecordId','Value'],{write:true,destructive:true,idempotent:true,
  info:'只更新用户明确提供的 IP；不能把 Worker 的出口 IP 当成用户家宽 IP；省略线路时保留原线路。'});
add('describe_record_group_list','DescribeRecordGroupList','查询记录分组',{...domain,...paging},['Domain'],{defaults:{Offset:0,Limit:100}});
add('create_record_group','CreateRecordGroup','创建记录分组',{...domain,GroupName},['Domain','GroupName'],{write:true});
add('modify_record_group','ModifyRecordGroup','重命名记录分组',{...domain,GroupId,GroupName},['Domain','GroupId','GroupName'],{write:true,idempotent:true});
add('modify_record_to_group','ModifyRecordToGroup','把记录加入分组',{
  ...domain,GroupId,RecordIds:arr('记录 ID 数组，由服务端转换成腾讯 API 所需的 | 分隔字符串。',RecordId)
},['Domain','GroupId','RecordIds'],{write:true,idempotent:true});
add('delete_record_group','DeleteRecordGroup','删除记录分组',{...domain,GroupId},['Domain','GroupId'],{write:true,destructive:true});
const batchCreateFields = {SubDomain,RecordType,RecordLine,RecordLineId,Value,MX,TTL};
add('create_record_batch','CreateRecordBatch','批量新增解析记录',{
  ...domain,RecordList:arr('单一域名、最多 20 项，每项一个主机头。仅暴露 AddRecordBatch 实际支持的字段。',obj(batchCreateFields,['SubDomain','RecordType','Value']))
},['Domain','RecordList'],{write:true,info:'自动解析 DomainIdList；返回 JobId 只表示任务提交，随后查询 describe_batch_task。'});
const batchModifyFields = {RecordId,SubDomain,RecordType,RecordLine,Value,
  Enabled:s('注意 V3 使用字符串 1 / 0，而不是 ENABLE / DISABLE。',{enum:['1','0']}),Remark,Weight,MX,TTL};
add('modify_record_batch','ModifyRecordBatchV3','批量修改解析记录',{
  ...domain,ModifyRecordList:arr('最多 20 项，仅修改提供的字段。每个 ID 必须属于 Domain。',obj(batchModifyFields,['RecordId']))
},['Domain','ModifyRecordList'],{write:true,destructive:true,info:'先核验全部记录，全部通过才提交一次批量请求；并非腾讯云原子事务。使用 V3 API，返回 JobId。'});
add('delete_record_batch','DeleteRecordBatch','批量删除解析记录',{
  ...domain,RecordIdList:arr('单一域名、最多 20 个记录 ID，禁止重复。',RecordId)
},['Domain','RecordIdList'],{write:true,destructive:true,info:'核验全部目标后再提交；必须先展示删除清单。返回 JobId 后查询任务。'});
add('describe_batch_task','DescribeBatchTask','查询批量任务结果',{JobId:i('批量操作返回的 JobId。')},['JobId'],{
  info:'检查 TotalCount / SuccessCount / FailCount 及 DetailList；未完成或部分失败不能报告全部成功。'});
add('create_snapshot','CreateSnapshot','创建 DNS 快照',domain,['Domain'],{
  write:true,info:'可能受套餐/配额限制。响应仅有 RequestId，不代表拿到了可用快照；必须随后查列表核实新快照。'});
add('describe_snapshot_list','DescribeSnapshotList','查询快照列表',domain,['Domain'],{
  info:'保留 Id、CreatedOn、Status；不要不经核实就把列表首项当成本次创建的快照。'});
add('check_snapshot_rollback','CheckSnapshotRollback','检查整域快照回滚',{
  ...domain,SnapshotId
},['Domain','SnapshotId'],{info:'检查 Total、Failed、Timeout 和 FailedRecordList。检查不通过不能执行回滚。'});
add('rollback_snapshot','RollbackSnapshot','提交整域快照回滚',{
  ...domain,SnapshotId
},['Domain','SnapshotId'],{write:true,destructive:true,
  info:'整域回滚：必须明确确认。服务端会再次执行回滚前检查，失败或超时就停止。返回 TaskId 后还需查询结果。'});
add('describe_snapshot_rollback_result','DescribeSnapshotRollbackResult','查询快照回滚结果',{
  ...domain,TaskId:i('RollbackSnapshot 返回的 TaskId。')
},['Domain','TaskId'],{info:'Status=ok 且失败数为 0 才能确认成功；waiting / running / null 都不能视为成功。'});
const dates = {StartDate:s('开始日期 YYYY-MM-DD。'),EndDate:s('结束日期 YYYY-MM-DD。'),DnsFormat:s('统计粒度。',{enum:['DATE','HOUR'],default:'DATE'})};
add('describe_domain_analytics','DescribeDomainAnalytics','查询域名解析量',{...domain,...dates},['Domain','StartDate','EndDate'],{defaults:{DnsFormat:'DATE'}});
add('describe_subdomain_analytics','DescribeSubdomainAnalytics','查询子域名解析量',{
  ...domain,...dates,Subdomain:SubDomain,SubDomain:{...SubDomain,description:'兼容别名；此统计 API 的官方参数仍为 Subdomain。'}
},['Domain','StartDate','EndDate'],{defaults:{DnsFormat:'DATE'},info:'Subdomain / SubDomain 必须提供一个。统计量不等于网站访问量。'});

export const TOOLS = definitions.map(x => x.tool);
const catalog = new Map(definitions.map(x => [x.name,x]));
export const ACTIONS = [...new Set(definitions.map(x=>x.action))];
export function policy(env) {
  return {readOnly:env.DNSPOD_READ_ONLY !== 'false', destructive:env.DNSPOD_ALLOW_DESTRUCTIVE === 'true'};
}
function writeGuard(env, def, args) {
  if (!def.write) return;
  const p = policy(env);
  if (p.readOnly) throw new Error('服务端为只读模式；维护者需设置 DNSPOD_READ_ONLY=false 才能写入');
  if (def.destructive && !p.destructive) throw new Error('此变更可能破坏现有配置；维护者尚未启用 DNSPOD_ALLOW_DESTRUCTIVE');
  if (args.Confirmed !== true) throw new Error('请先展示具体变更并取得用户确认，再传 Confirmed=true');
  const allowed = String(env.DNSPOD_WRITE_DOMAINS || '').split(',').map(x=>x.trim()).filter(Boolean);
  if (!allowed.includes('*') && !allowed.map(canonicalDomain).includes(args.Domain)) throw new Error('该域名不在 DNSPOD_WRITE_DOMAINS 写入白名单内');
}
const pick = (a, keys) => Object.fromEntries(keys.filter(k=>a[k] !== undefined).map(k=>[k,a[k]]));
function normalize(def, raw) {
  validate(def.tool.inputSchema, raw);
  const a = {...def.defaults,...raw};
  if (a.Domain) a.Domain = canonicalDomain(a.Domain);
  if (a.Subdomain !== undefined && a.SubDomain !== undefined && a.Subdomain !== a.SubDomain) throw new Error('Subdomain 与 SubDomain 不能冲突');
  if (def.name === 'describe_subdomain_analytics') {
    a.Subdomain = a.Subdomain ?? a.SubDomain;
    if (!a.Subdomain) throw new Error('必须提供 Subdomain / SubDomain');
    checkRecord({SubDomain:a.Subdomain},a.Domain);
    delete a.SubDomain;
  } else if (a.Subdomain !== undefined) { a.SubDomain = a.SubDomain ?? a.Subdomain; delete a.Subdomain; }
  validateDates(a);
  return a;
}
async function recordInfo(api, a, recordId) {
  const result = await api('DescribeRecord', {Domain:a.Domain,RecordId:recordId});
  const info = result?.RecordInfo;
  if (!info || info.Id !== recordId) throw new Error('记录核验失败：未返回匹配的 RecordInfo.Id');
  if (a.ExpectedValue !== undefined && info.Value !== a.ExpectedValue) throw new Error('记录值已改变，与 ExpectedValue 不符，已停止');
  return info;
}
function existingFields(info) {
  const out = pick(info,Object.keys(recordFields));
  if (!out.Status) {
    if (info.Enabled === 1) out.Status='ENABLE';
    else if (info.Enabled === 0) out.Status='DISABLE';
    else throw new Error('无法确认现有记录启停状态，停止修改');
  }
  for (const key of Object.keys(out)) if (out[key] === null) delete out[key];
  return out;
}
export async function callTool(env, name, raw = {}, request = tencentRequest) {
  const def = catalog.get(name);
  if (!def) throw new Error(`Unknown tool: ${name}`);
  const a = normalize(def,raw);
  writeGuard(env,def,a); // 先检查本地权限，不要先发云 API。
  const api = (action,payload) => request(env,action,payload);
  let details;
  const getDomain = async () => {
    if (!details) {
      details = (await api('DescribeDomain',{Domain:a.Domain})).DomainInfo;
      if (!details || canonicalDomain(details.Domain || details.Punycode || '') !== a.Domain) throw new Error('域名详情核验失败');
    }
    return details;
  };
  // 不让 DomainId 的高优先级绕过域名白名单，所有实际调用以规范化 Domain 为准。
  if (a.DomainId !== undefined && (await getDomain()).DomainId !== a.DomainId) throw new Error('DomainId 与 Domain 不匹配，已停止');
  let payload = pick(a,Object.keys(def.tool.inputSchema.properties).filter(k=>!['Confirmed','ExpectedValue','DomainId','Subdomain'].includes(k)));
  if (name === 'describe_subdomain_analytics') payload = {...payload,Subdomain:a.Subdomain};
  if (def.grade) {
    const grade = (await getDomain()).Grade;
    if (typeof grade !== 'string' || !grade) throw new Error('无法确认 DomainGrade');
    payload = name === 'describe_record_type' ? {DomainGrade:grade} : {Domain:a.Domain,DomainGrade:grade};
  }
  if (name === 'create_record') { payload.RecordLine ??= '默认'; checkRecord(payload,a.Domain); }
  if (['modify_record','delete_record','modify_record_status','modify_record_remark','modify_dynamic_dns'].includes(name)) {
    const info = await recordInfo(api,a,a.RecordId);
    if (name === 'modify_record') {
      const changes = pick(a,Object.keys(recordFields));
      if (!Object.keys(changes).length) throw new Error('至少指定一个待修改字段');
      if (a.RecordType !== undefined && a.RecordType !== info.RecordType) checkRecord(a,a.Domain);
      payload = {...existingFields(info),...changes,Domain:a.Domain,RecordId:a.RecordId};
      if (a.RecordLine !== undefined && a.RecordLineId === undefined) delete payload.RecordLineId;
      checkRecord(payload,a.Domain);
    } else if (name === 'modify_dynamic_dns') {
      if (!['A','AAAA'].includes(info.RecordType)) throw new Error('DDNS 只支持现有 A / AAAA 记录');
      payload = {Domain:a.Domain,RecordId:a.RecordId,Value:a.Value,
        SubDomain:a.SubDomain ?? info.SubDomain,RecordLine:a.RecordLine ?? info.RecordLine,
        RecordLineId:a.RecordLineId ?? (a.RecordLine === undefined ? info.RecordLineId : undefined), TTL:a.TTL};
      checkRecord({...payload,RecordType:info.RecordType},a.Domain);
    }
  }
  if (name === 'modify_record_group' || name === 'delete_record_group') {
    if (a.GroupId === 0) throw new Error('不允许修改或删除默认系统分组');
  }
  if (name === 'modify_record_to_group') {
    for (const id of a.RecordIds) await recordInfo(api,a,id);
    payload = {Domain:a.Domain,GroupId:a.GroupId,RecordId:a.RecordIds.join('|')};
  }
  if (name === 'create_record_batch') {
    for (const r of a.RecordList) checkRecord(r,a.Domain);
    const id = (await getDomain()).DomainId;
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('无法获取可信 DomainId');
    payload = {DomainIdList:[String(id)],RecordList:a.RecordList};
  }
  if (name === 'modify_record_batch') {
    const ids = a.ModifyRecordList.map(r=>r.RecordId);
    if (new Set(ids).size !== ids.length) throw new Error('不能重复修改同一 RecordId');
    for (const r of a.ModifyRecordList) {
      if (Object.keys(r).length === 1) throw new Error('批量项必须至少包含一个待修改字段');
      const old = await recordInfo(api,a,r.RecordId);
      if (r.RecordType !== undefined && r.RecordType !== old.RecordType) checkRecord(r,a.Domain);
      checkRecord({...existingFields(old),...r},a.Domain);
    }
    payload = {ModifyRecordList:a.ModifyRecordList};
  }
  if (name === 'delete_record_batch') {
    for (const id of a.RecordIdList) await recordInfo(api,a,id);
    payload = {RecordIdList:a.RecordIdList};
  }
  if (name === 'rollback_snapshot') {
    const check = await api('CheckSnapshotRollback',payload);
    if (check.Failed !== 0 || ![0,null].includes(check.Timeout) || !Number.isInteger(check.Total) || check.Total < 0 ||
        (Array.isArray(check.FailedRecordList) && check.FailedRecordList.length)) throw new Error('快照预检失败、超时或结果不完整，未执行回滚');
  }
  const data = await api(def.action,payload);
  // 不猜云端完成状态，不把 TaskId / JobId 当成成功证明。
  if (['create_record_batch','modify_record_batch','delete_record_batch','rollback_snapshot','create_snapshot'].includes(name)) {
    return {...data,McpOperation:{state:'submitted',verified:false,
      nextTool:name === 'rollback_snapshot' ? 'describe_snapshot_rollback_result' : name === 'create_snapshot' ? 'describe_snapshot_list' : 'describe_batch_task'}};
  }
  return data;
}
