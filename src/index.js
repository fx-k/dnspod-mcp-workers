/** DNSPod MCP v3，基于 zfx-t/dnspod-mcp-workers (MIT) 演进。 */
import {TOOLS,VERSION,policy} from './tools.js';
import {oauth,verifyAccess,json,escapeHtml} from './oauth.js';
import {handleMcp,protocols,err} from './mcp.js';
// Workers 主入口仅导出处理器及 Durable Object 类，不导出普通常量或测试函数。
export {OAuthState} from './oauth-state.js';
async function bounded(request) {
  const maximum=256*1024;
  if (Number(request.headers.get('Content-Length')) > maximum) throw new Error('Request too large');
  if (!request.body) return request;
  const reader=request.body.getReader(); const chunks=[]; let count=0;
  while (true) {const {value,done}=await reader.read(); if(done) break; count+=value.byteLength;
    if(count>maximum) {await reader.cancel(); throw new Error('Request too large');} chunks.push(value);}
  const bytes=new Uint8Array(count);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return new Request(request.url,{method:request.method,headers:request.headers,body:bytes});
}
export default {
  async fetch(initial,env) {
    const url=new URL(initial.url);const path=url.pathname;
    const origin=initial.headers.get('Origin');
    const allowed=[url.origin,...String(env.CORS_ALLOWED_ORIGINS || '').split(',').map(x=>x.trim()).filter(Boolean)];
    if(origin && !allowed.includes(origin)) return json({error:'origin_not_allowed'},403);
    const cors=origin ? {'Access-Control-Allow-Origin':origin,Vary:'Origin','Access-Control-Allow-Headers':'Authorization,Content-Type,Accept,MCP-Protocol-Version','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Expose-Headers':'WWW-Authenticate'} : {};
    if(initial.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
    let request=initial;
    if(initial.method === 'POST') {try {request=await bounded(initial);} catch {return json({error:'request_too_large'},413,cors);}}
    const authResponse=await oauth(request,env);
    if(authResponse) {const out=new Response(authResponse.body,authResponse);for(const [k,v]of Object.entries(cors))out.headers.set(k,v);return out;}
    if(path === '/health') return json({ok:true,version:VERSION,toolCount:TOOLS.length,policy:policy(env),oauthConfigured:!!env.OAUTH_STATE && !!env.OAUTH_PASSWORD && !!env.OAUTH_JWT_SECRET,
      note:'存活检查不代表腾讯云凭据、CAM 权限或真实 DNS 调用已通过'},200,cors);
    if(path === '/') return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>DNSPod MCP v3</title><h1>DNSPod MCP v${VERSION}</h1><p>${TOOLS.length} 个工具；默认只读。ChatGPT Remote MCP 地址：</p><pre>${escapeHtml(url.origin)}/mcp</pre><p>接入后完成 OAuth 授权。新增写操作前请确认服务端开关和域名白名单。</p><ul>${TOOLS.map(t=>`<li><code>${t.name}</code> — ${escapeHtml(t.title)}</li>`).join('')}</ul></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'}});
    if(['/sse','/message'].includes(path)) return json({error:'legacy_transport_removed',message:'v3 使用标准无状态 Streamable HTTP，请连接 /mcp'},410,cors);
    if(path !== '/mcp') return json({error:'not_found'},404,cors);
    if(!await verifyAccess(request,env)) return json({error:'invalid_token'},401,{
      ...cors,'WWW-Authenticate':`Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`});
    if(request.method !== 'POST') return json({error:'method_not_allowed'},405,{...cors,Allow:'POST'});
    const version=request.headers.get('MCP-Protocol-Version');
    if(version && !protocols.includes(version)) return json({error:'unsupported_protocol_version'},400,cors);
    let msg;try {msg=await request.json();} catch {return json(err(null,-32700,'Parse error'),400,cors);}
    const result=await handleMcp(env,msg);
    return result === null ? new Response(null,{status:202,headers:cors}) : json(result,200,cors);
  }
};
