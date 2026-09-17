import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../src/index.js';
import {handleMcp} from '../src/mcp.js';
import {signJwt} from '../src/oauth.js';
import {state} from '../src/oauth-state.js';
import {memoryNamespace} from './helpers.js';
const origin='https://mcp.example.test';
const redirect='https://client.example.test/callback';
const verifier='a'.repeat(64);
const challenge=createHash('sha256').update(verifier).digest('base64url');
const makeEnv=()=>({OAUTH_STATE:memoryNamespace(),OAUTH_PASSWORD:'test-only-password-12345',OAUTH_JWT_SECRET:'test-only-jwt-secret-never-use-in-production-12345'});
async function req(env,path,body,headers={},method) {
 return worker.fetch(new Request(origin+path,{method:method || (body===undefined?'GET':'POST'),headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),env);
}
async function registration(env,method='none') {
 const r=await req(env,'/register',{client_name:'测试客户端',redirect_uris:[redirect],token_endpoint_auth_method:method});assert.equal(r.status,201);return r.json();
}
async function authCode(env,client,changes={}) {
 const params=new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',code_challenge:challenge,code_challenge_method:'S256',scope:'mcp',state:'original-state',resource:origin+'/mcp',...changes});
 const path='/authorize?'+params;
 const get=await req(env,path);assert.equal(get.status,200);
 const cookie=get.headers.get('Set-Cookie').split(';')[0];const csrf=cookie.split('=')[1];
 const post=await req(env,path,new URLSearchParams({csrf,password:env.OAUTH_PASSWORD}).toString(),{'Content-Type':'application/x-www-form-urlencoded',Cookie:cookie});
 assert.equal(post.status,302);const target=new URL(post.headers.get('Location'));assert.equal(target.searchParams.get('state'),'original-state');
 return target.searchParams.get('code');
}
function authFields(client) {return {client_id:client.client_id,...(client.token_endpoint_auth_method==='client_secret_post'?{client_secret:client.client_secret}:{})};}
function authHeader(client){return client.token_endpoint_auth_method==='client_secret_basic'?{Authorization:'Basic '+btoa(client.client_id+':'+client.client_secret)}:{};}
async function exchange(env,client,code,changes={}) {return req(env,'/token',{grant_type:'authorization_code',code,redirect_uri:redirect,code_verifier:verifier,...authFields(client),...changes},authHeader(client));}
async function access(env,overrides={}) {
 const time=Math.floor(Date.now()/1000);return signJwt({ver:3,iss:origin,aud:origin+'/mcp',sub:'owner',client_id:'test-client',scope:'mcp',iat:time,exp:time+3600,...overrides},env.OAUTH_JWT_SECRET);
}
for(const method of ['none','client_secret_post','client_secret_basic'])test(`OAuth 完整授权与刷新：${method}`,async()=>{
 const env=makeEnv();const client=await registration(env,method);const code=await authCode(env,client);
 const result=await exchange(env,client,code);assert.equal(result.status,200);const tokens=await result.json();
 const list=await req(env,'/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'},{Authorization:'Bearer '+tokens.access_token});
 assert.equal(list.status,200);assert.equal((await list.json()).result.tools.length,31);
 const refreshed=await req(env,'/token',{grant_type:'refresh_token',refresh_token:tokens.refresh_token,...authFields(client)},authHeader(client));assert.equal(refreshed.status,200);const next=await refreshed.json();assert.notEqual(next.refresh_token,tokens.refresh_token);
 const reused=await req(env,'/token',{grant_type:'refresh_token',refresh_token:tokens.refresh_token,...authFields(client)},authHeader(client));assert.equal(reused.status,400);
});
test('同一个授权码并发兑换只有一次成功',async()=>{
 const env=makeEnv(),client=await registration(env),code=await authCode(env,client);
 const results=await Promise.all([exchange(env,client,code),exchange(env,client,code)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
});
test('同一个刷新令牌并发兑换只有一次成功',async()=>{
 const env=makeEnv(),client=await registration(env),code=await authCode(env,client);
 const tokens=await (await exchange(env,client,code)).json();
 const body={grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:client.client_id};
 const result=await Promise.all([req(env,'/token',body),req(env,'/token',body)]);assert.deepEqual(result.map(r=>r.status).sort(),[200,400]);
});
test('错误 PKCE / redirect / resource / 客户端不能兑换授权码',async()=>{
 const env=makeEnv(),client=await registration(env),other=await registration(env),code=await authCode(env,client);
 for(const changes of [{code_verifier:'b'.repeat(64)},{redirect_uri:'https://evil.example/cb'},{resource:'https://evil.example/mcp'},{client_id:other.client_id}])assert.equal((await exchange(env,client,code,changes)).status,400);
 assert.equal((await exchange(env,client,code)).status,200);
});
test('保密客户端刷新时仍必须验证密钥',async()=>{
 const env=makeEnv(),client=await registration(env,'client_secret_post'),code=await authCode(env,client);
 assert.equal((await exchange(env,client,code,{client_secret:'incorrect'})).status,401);
 const tokens=await (await exchange(env,client,code)).json();
 const r=await req(env,'/token',{grant_type:'refresh_token',client_id:client.client_id,client_secret:'incorrect',refresh_token:tokens.refresh_token});assert.equal(r.status,401);
});
test('无 JWT 密钥/过短密码不退回默认密钥',async()=>{
 for(const env of [{}, {...makeEnv(),OAUTH_JWT_SECRET:''},{...makeEnv(),OAUTH_PASSWORD:'short'}])assert.equal((await req(env,'/register',{redirect_uris:[redirect]})).status,503);
});
test('注册校验回调协议、白名单、认证方式及输入对象',async()=>{
 const env=makeEnv();for(const body of [null,[],{redirect_uris:[]},{redirect_uris:['javascript:alert(1)']},{redirect_uris:['https://x.example/#fragment']},{redirect_uris:[redirect],token_endpoint_auth_method:'unknown'}])assert.equal((await req(env,'/register',body)).status,400);
 env.OAUTH_ALLOWED_REDIRECT_URIS='https://only.example/cb';assert.equal((await req(env,'/register',{redirect_uris:[redirect]})).status,400);
});
test('未登记客户端与 plain/缺失 PKCE 拒绝',async()=>{
 const env=makeEnv(),client=await registration(env);
 for(const change of [{client_id:'unknown'},{code_challenge_method:'plain'},{code_challenge:''},{redirect_uri:'https://evil.example/cb'},{scope:'openid'},{resource:'https://other.example/mcp'}]) {
  const query=new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',code_challenge:challenge,code_challenge_method:'S256',...change});
  assert.equal((await req(env,'/authorize?'+query)).status,400);
 }
});
test('没有匹配 Cookie 的授权 POST 被 CSRF 防护拒绝',async()=>{
 const env=makeEnv(),client=await registration(env);const query=new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',code_challenge:challenge,code_challenge_method:'S256'});
 const result=await req(env,'/authorize?'+query,'csrf=fake&password='+env.OAUTH_PASSWORD,{'Content-Type':'application/x-www-form-urlencoded'});assert.equal(result.status,400);
});
test('已签名但过期/错误 aud/iss/scope/version/iat 的 token 拒绝',async()=>{
 const env=makeEnv();const time=Math.floor(Date.now()/1000);
 for(const fields of [{exp:time-1},{exp:undefined},{aud:'https://elsewhere/mcp'},{iss:'https://elsewhere'},{scope:'admin'},{ver:2},{iat:time+3600},{sub:'other'}]) {
  const bearer=await access(env,fields);assert.equal((await req(env,'/mcp',{jsonrpc:'2.0',id:1,method:'ping'},{Authorization:'Bearer '+bearer})).status,401);
 }
 for(const bearer of ['a.b.c','not-jwt','...'])assert.equal((await req(env,'/mcp',{}, {Authorization:'Bearer '+bearer})).status,401);
});
test('HTTP discovery、初始化、通知、MCP 错误结果',async()=>{
 const env=makeEnv();const bearer=await access(env);const h={Authorization:'Bearer '+bearer};
 const unauthed=await req(env,'/mcp',{});assert.equal(unauthed.status,401);assert.match(unauthed.headers.get('WWW-Authenticate'),/oauth-protected-resource/);
 assert.deepEqual((await (await req(env,'/.well-known/oauth-authorization-server')).json()).code_challenge_methods_supported,['S256']);
 const init=await req(env,'/mcp',{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},h);const body=await init.json();assert.equal(body.result.serverInfo.version,'3.0.0');assert.equal(body.result.protocolVersion,'2025-06-18');
 assert.equal((await req(env,'/mcp',{jsonrpc:'2.0',method:'notifications/initialized'},h)).status,202);
 assert.equal((await req(env,'/mcp','not json',h)).status,400);
 assert.equal((await req(env,'/mcp',{}, {...h,'MCP-Protocol-Version':'nonsense'})).status,400);
 assert.equal((await req(env,'/mcp',undefined,h)).status,405);
 const refused=await (await req(env,'/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'delete_record',arguments:{Domain:'example.com',RecordId:11,Confirmed:true}}},h)).json();assert.equal(refused.result.isError,true);assert.match(refused.result.content[0].text,/只读/);
 assert.equal((await req(env,'/sse')).status,410);
});
test('错误 JSON-RPC 形状不会调用 API',async()=>{
 for(const msg of [null,[],{jsonrpc:'1.0',id:1,method:'ping'},{jsonrpc:'2.0',method:'ping'}])assert.equal((await handleMcp({},msg)).error.code,-32600);
 assert.equal((await handleMcp({},{jsonrpc:'2.0',id:1,method:'ping',params:[]})).error.code,-32602);
 assert.equal((await handleMcp({},{jsonrpc:'2.0',id:1,method:'not-real'})).error.code,-32601);
});
test('CORS 不反射未授权 Origin，过大请求拒绝',async()=>{
 const env=makeEnv();assert.equal((await req(env,'/mcp',{}, {Origin:'https://evil.example'})).status,403);
 assert.equal((await req(env,'/mcp','x'.repeat(256*1024+1))).status,413);
 const good=await req(env,'/health',undefined,{Origin:origin});assert.equal(good.headers.get('Access-Control-Allow-Origin'),origin);
});
test('授权状态过期，take 原子一次性消费，rate 严格限流',async()=>{
 const env=makeEnv();await state(env,'test','put',{value:{x:1},ttl:1});
 assert.deepEqual(await state(env,'test','get'),{x:1});const pair=await Promise.all([state(env,'test','take'),state(env,'test','take')]);assert.equal(pair.filter(Boolean).length,1);
 await state(env,'expiring','put',{value:123,ttl:1});const realNow=Date.now;try{Date.now=()=>realNow()+2000;assert.equal(await state(env,'expiring','get'),null);}finally{Date.now=realNow;}
 assert.equal(await state(env,'limit','rate',{ttl:60,limit:1}),true);assert.equal(await state(env,'limit','rate',{ttl:60,limit:1}),false);
});
test('DCR 限流有效',async()=>{const env=makeEnv();for(let n=0;n<20;n++)assert.equal((await req(env,'/register',{redirect_uris:[redirect]})).status,201);assert.equal((await req(env,'/register',{redirect_uris:[redirect]})).status,429);});

test('Workers 主入口只导出默认处理器与 Durable Object 类',async()=>{
 const entry=await import('../src/index.js');
 assert.deepEqual(Object.keys(entry).sort(),['OAuthState','default']);
});
