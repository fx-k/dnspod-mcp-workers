import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {signedRequest,tencentRequest,clean} from '../src/tencent.js';
const env={TENCENTCLOUD_SECRET_ID:'test-only-secret-id',TENCENTCLOUD_SECRET_KEY:'test-only-secret-key'};
test('TC3 签名与独立 node:crypto 实现一致',async()=>{
 const now=1700000000000,ts=Math.floor(now/1000),date=new Date(now).toISOString().slice(0,10);
 const hash=s=>createHash('sha256').update(s).digest('hex');const hmac=(k,s)=>createHmac('sha256',k).update(s).digest();
 const body=JSON.stringify({Domain:'example.com',Remark:'',Weight:0});
 const headers='content-type:application/json; charset=utf-8\nhost:dnspod.tencentcloudapi.com\nx-tc-action:modifyrecordremark\n';
 const canonical=['POST','/','',headers,'content-type;host;x-tc-action',hash(body)].join('\n');
 const scope=`${date}/dnspod/tc3_request`;const stringToSign=['TC3-HMAC-SHA256',ts,scope,hash(canonical)].join('\n');
 const key=hmac(hmac(hmac('TC3'+env.TENCENTCLOUD_SECRET_KEY,date),'dnspod'),'tc3_request');const signature=hmac(key,stringToSign).toString('hex');
 const result=await signedRequest(env,'ModifyRecordRemark',{Domain:'example.com',Remark:'',Weight:0,Unused:undefined},now);
 assert.equal(result.body,body);assert.equal(result.headers.Authorization,`TC3-HMAC-SHA256 Credential=${env.TENCENTCLOUD_SECRET_ID}/${scope}, SignedHeaders=content-type;host;x-tc-action, Signature=${signature}`);
});
test('清理函数保留空字符串、0 和 false',()=>assert.deepEqual(clean({a:'',b:0,c:false,d:undefined,list:[{e:undefined,x:0}]}),{a:'',b:0,c:false,list:[{x:0}]}));
test('传输固定腾讯域名，保留可选 STS token',async t=>{
 let target,init;t.mock.method(globalThis,'fetch',async(u,i)=>{target=u;init=i;return Response.json({Response:{RequestId:'test-id',RecordList:[]}});});
 const result=await tencentRequest({...env,TENCENTCLOUD_TOKEN:'test-only-sts'},'DescribeRecordList',{});assert.equal(target,'https://dnspod.tencentcloudapi.com/');assert.equal(init.headers['X-TC-Token'],'test-only-sts');assert.deepEqual(result.RecordList,[]);
});
test('腾讯 API 错误保留 Code / RequestId，不伪装成功',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({Response:{Error:{Code:'AuthFailure',Message:'Denied'},RequestId:'test-id'}}));
 await assert.rejects(()=>tencentRequest(env,'DescribeDomain',{}),e=>e.code==='AuthFailure'&&e.requestId==='test-id');
});
test('网络失败不自动重放写请求',async t=>{let count=0;t.mock.method(globalThis,'fetch',async()=>{count++;throw new Error('timeout');});await assert.rejects(()=>tencentRequest(env,'CreateRecord',{}),/结果未知/);assert.equal(count,1);});
test('非 JSON / HTTP 失败 / 缺失 Response 拒绝',async t=>{
 const responses=[new Response('bad',{status:502}),Response.json({bad:true}),Response.json({Response:{}},{status:500})];
 t.mock.method(globalThis,'fetch',async()=>responses.shift());for(let i=0;i<3;i++)await assert.rejects(()=>tencentRequest(env,'DescribeDomain',{}));
});
