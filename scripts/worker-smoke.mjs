/** 本地 workerd 验收：无真实云凭据，无 Cloudflare 部署，无 DNS API 写入。 */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
const port=8799,origin=`http://127.0.0.1:${port}`;
const password='local-smoke-only-password-not-for-production';
const secret='local-smoke-only-jwt-secret-not-for-production-12345';
const child=spawn('node_modules/.bin/wrangler',['dev','--local','--ip','127.0.0.1','--port',String(port),'--persist-to','.wrangler-ci','--var',`OAUTH_PASSWORD:${password}`,'--var',`OAUTH_JWT_SECRET:${secret}`],{env:{...process.env,WRANGLER_SEND_METRICS:'false',CI:'true'},stdio:['ignore','pipe','pipe'],detached:true});
let logs='';const collect=b=>{logs=(logs+b.toString()).slice(-30000);};child.stdout.on('data',collect);child.stderr.on('data',collect);
const post=(path,body,headers={})=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),redirect:'manual'});
try {
 let ready=false;
 for(let i=0;i<90;i++){
  if(child.exitCode!==null)throw new Error(`workerd 提前退出：${child.exitCode}`);
  try{const r=await fetch(origin+'/health');if(r.ok){ready=true;break;}}catch{}
  await delay(1000);
 }
 assert.ok(ready,'workerd 未就绪');
 assert.equal((await post('/mcp',{})).status,401);
 const redirect='https://client.example.test/callback';
 const clientResponse=await post('/register',{redirect_uris:[redirect],token_endpoint_auth_method:'none',client_name:'local smoke'});assert.equal(clientResponse.status,201);
 const client=await clientResponse.json();
 const verifier='z'.repeat(64);const challenge=createHash('sha256').update(verifier).digest('base64url');
 const params=new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',code_challenge:challenge,code_challenge_method:'S256',scope:'mcp',resource:origin+'/mcp',state:'smoke'});
 const page=await fetch(origin+'/authorize?'+params);assert.equal(page.status,200);
 const pageText=await page.text();const csrf=pageText.match(/name="csrf" value="([^"]+)"/u)?.[1];assert.ok(csrf);
 const accepted=await fetch(origin+'/authorize?'+params,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({csrf,password}),redirect:'manual'});assert.equal(accepted.status,303);
 const callback=new URL(accepted.headers.get('Location'));assert.equal(callback.searchParams.get('state'),'smoke');assert.equal(callback.searchParams.get('iss'),origin);
 const code=callback.searchParams.get('code');
 const exchange={grant_type:'authorization_code',client_id:client.client_id,redirect_uri:redirect,code,code_verifier:verifier,resource:origin+'/mcp'};
 const issued=await Promise.all([post('/token',exchange),post('/token',exchange)]);assert.deepEqual(issued.map(r=>r.status).sort(),[200,400]);
 const tokens=await issued.find(r=>r.status===200).json();
 const headers={Authorization:'Bearer '+tokens.access_token};
 const rpc=(method,params)=>post('/mcp',{jsonrpc:'2.0',id:1,method,params},headers);
 assert.equal((await (await rpc('initialize',{protocolVersion:'2025-06-18'})).json()).result.serverInfo.version,'3.0.0');
 const tools=await (await rpc('tools/list')).json();assert.equal(tools.result.tools.length,31);
 const denied=await (await rpc('tools/call',{name:'delete_record',arguments:{Domain:'example.com',RecordId:11,Confirmed:true}})).json();assert.equal(denied.result.isError,true);assert.match(denied.result.content[0].text,/只读/);
 const refresh={grant_type:'refresh_token',client_id:client.client_id,refresh_token:tokens.refresh_token,resource:origin+'/mcp'};
 const rotations=await Promise.all([post('/token',refresh),post('/token',refresh)]);assert.deepEqual(rotations.map(r=>r.status).sort(),[200,400]);
 console.log('PASS: 真实本地 workerd + SQLite DO，OAuth issuer/PKCE / 原子防重放 / MCP 31 工具发现 / 默认只读；无真实云 API 调用。');
} catch(e) {console.error(logs);throw e;}
finally {try{process.kill(-child.pid,'SIGTERM');}catch{} }