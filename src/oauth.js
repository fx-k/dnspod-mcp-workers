/** OAuth 端点沿用上游路径；v3 收紧 PKCE、客户端/资源绑定和令牌校验。 */
import {state} from './oauth-state.js';
import {hmac,sha256,hex} from './tencent.js';
const enc = new TextEncoder();
const ACCESS_TTL = 3600;
const REFRESH_TTL = 30*86400;
const b64 = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/gu,'-').replace(/\//gu,'_').replace(/=+$/u,'');
const unb64 = text => {
  if (!/^[A-Za-z0-9_-]+$/u.test(text)) throw new Error('Invalid base64url');
  return Uint8Array.from(atob(text.replace(/-/gu,'+').replace(/_/gu,'/') + '='.repeat((4-text.length%4)%4)), c=>c.charCodeAt(0));
};
const now = () => Math.floor(Date.now()/1000);
const token = () => b64(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => hex(await sha256(value));
export const escapeHtml = value => String(value).replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class AuthError extends Error { constructor(error, description, status=400) { super(description); this.error=error; this.status=status; } }
const fail = (code,message,status) => { throw new AuthError(code,message,status); };
export const json = (data,status=200,headers={}) => Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
function configured(env) {
  if (!env.OAUTH_STATE || typeof env.OAUTH_PASSWORD !== 'string' || env.OAUTH_PASSWORD.length < 16 || typeof env.OAUTH_JWT_SECRET !== 'string' || env.OAUTH_JWT_SECRET.length < 32) fail('server_error','请配置 OAUTH_STATE、至少 16 字符的访问密码和至少 32 字符的独立 JWT 密钥',503);
}
export async function signJwt(payload,secret) {
  const data = b64(enc.encode(JSON.stringify({alg:'HS256',typ:'JWT'})))+'.'+b64(enc.encode(JSON.stringify(payload)));
  return data+'.'+b64(await hmac(secret,data));
}
export async function verifyAccess(request,env) {
  if (typeof env.OAUTH_JWT_SECRET !== 'string' || env.OAUTH_JWT_SECRET.length < 32) return null;
  const bearer = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/iu)?.[1];
  if (!bearer || bearer.length > 8192) return null;
  try {
    const parts = bearer.split('.');
    if (parts.length !== 3) return null;
    const header = JSON.parse(new TextDecoder().decode(unb64(parts[0])));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    const key = await crypto.subtle.importKey('raw',enc.encode(env.OAUTH_JWT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    if (!await crypto.subtle.verify('HMAC',key,unb64(parts[2]),enc.encode(parts[0]+'.'+parts[1]))) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64(parts[1])));
    const origin = new URL(request.url).origin;
    if (p.ver !== 3 || p.iss !== origin || p.aud !== origin+'/mcp' || p.sub !== 'owner' ||
        typeof p.client_id !== 'string' || !p.client_id || !Number.isFinite(p.exp) || p.exp <= now() ||
        !Number.isFinite(p.iat) || p.iat > now()+60 || p.scope !== 'mcp') return null;
    return p;
  } catch { return null; }
}
function validRedirect(value,env) {
  try {
    const u = new URL(value);
    if (u.hash || u.username || u.password || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname)))) return false;
    const allowed = String(env.OAUTH_ALLOWED_REDIRECT_URIS || '').split(/\r?\n|,/u).map(x=>x.trim()).filter(Boolean);
    return !allowed.length || allowed.includes(value);
  } catch { return false; }
}
function metadata(origin) {
  return {issuer:origin,authorization_response_iss_parameter_supported:true,authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/token',registration_endpoint:origin+'/register',
    response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],
    token_endpoint_auth_methods_supported:['none','client_secret_post','client_secret_basic'],scopes_supported:['mcp']};
}
function page(url,client,csrf,error='') {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>授权 DNSPod MCP</title><style>body{font:16px system-ui;max-width:560px;margin:10vh auto;padding:24px;line-height:1.7}input,button{font:inherit;padding:10px}code{overflow-wrap:anywhere}.error{color:#b00020}</style><h1>授权 DNSPod MCP</h1><p>客户端：${escapeHtml(client.client_name)}<br>返回地址：<code>${escapeHtml(url.searchParams.get('redirect_uri'))}</code></p><p>授权后客户端可以访问此 Worker 提供的 DNSPod 工具。写入范围仍受服务端设置和腾讯云 CAM 权限限制。请核对客户端与返回地址。</p><p class="error">${escapeHtml(error)}</p><form method="POST" action="${escapeHtml(url.pathname+url.search)}"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><label>访问密码 <input type="password" name="password" required autocomplete="current-password"></label><button>确认授权</button></form></html>`;
}
function callbackPage(target) {
  const safe = escapeHtml(target);
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=${safe}"><title>正在返回 ChatGPT</title><style>body{font:16px system-ui;max-width:560px;margin:10vh auto;padding:24px;line-height:1.7}a{display:inline-block;padding:10px 14px;border:1px solid #999;border-radius:8px;text-decoration:none;color:inherit}</style></head><body><h1>授权成功</h1><p>正在返回 ChatGPT…</p><p>如果没有自动跳转，请点击：</p><p><a href="${safe}" rel="noreferrer">继续返回 ChatGPT</a></p></body></html>`;
}
function html(text,status=200,headers={}) {
  return new Response(text,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer',
    'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",'X-Content-Type-Options':'nosniff',...headers}});
}
async function rate(request,env,kind,limit,seconds) {
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (!await state(env,`rate:${kind}:${ip}`,'rate',{limit,ttl:seconds})) fail('rate_limited','请求过于频繁，请稍后重试',429);
}
async function authParams(url,env) {
  const q = url.searchParams;
  if (q.get('response_type') !== 'code' || q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/u.test(q.get('code_challenge') || '')) fail('invalid_request','必须使用 authorization_code + PKCE S256');
  if (q.get('scope') && q.get('scope') !== 'mcp') fail('invalid_scope','仅支持 mcp scope');
  if (q.get('resource') && q.get('resource') !== url.origin+'/mcp') fail('invalid_target','resource 不匹配');
  const client = await state(env,'client:'+q.get('client_id'),'get');
  if (!client || !validRedirect(q.get('redirect_uri'),env) || !client.redirect_uris.includes(q.get('redirect_uri'))) fail('invalid_client','客户端未登记或 redirect_uri 不匹配');
  return client;
}
async function issue(env,origin,rec) {
  const access_token = await signJwt({ver:3,iss:origin,aud:origin+'/mcp',sub:'owner',client_id:rec.client_id,scope:'mcp',iat:now(),exp:now()+ACCESS_TTL},env.OAUTH_JWT_SECRET);
  const refresh_token = token();
  await state(env,'refresh:'+refresh_token,'put',{value:{client_id:rec.client_id,resource:origin+'/mcp'},ttl:REFRESH_TTL});
  return json({access_token,token_type:'Bearer',expires_in:ACCESS_TTL,refresh_token,scope:'mcp'});
}
export async function oauth(request,env) {
  const url = new URL(request.url); const path = url.pathname;
  if (path === '/.well-known/oauth-authorization-server') return json(metadata(url.origin));
  if (['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(path)) return json({resource:url.origin+'/mcp',authorization_servers:[url.origin],scopes_supported:['mcp'],bearer_methods_supported:['header']});
  if (!['/register','/authorize','/token'].includes(path)) return null;
  try {
    configured(env);
    if (path === '/register' && request.method === 'POST') {
      await rate(request,env,'register',20,3600);
      const body = await request.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_client_metadata','注册请求必须是对象');
      const method = body.token_endpoint_auth_method || 'none';
      if (!['none','client_secret_post','client_secret_basic'].includes(method)) fail('invalid_client_metadata','不支持的 token 认证方式');
      if (!Array.isArray(body.redirect_uris) || !body.redirect_uris.length || body.redirect_uris.length > 10 || body.redirect_uris.some(u=>!validRedirect(u,env))) fail('invalid_redirect_uri','redirect_uris 必须是允许的完整 HTTPS URL（本地 loopback 可用 HTTP）');
      const client_id = token(); const secret = method === 'none' ? null : token();
      const client = {client_id,client_name:String(body.client_name || 'MCP Client').slice(0,160),redirect_uris:body.redirect_uris,token_endpoint_auth_method:method,
        ...(secret ? {secretHash:await digest(secret)} : {})};
      await state(env,'client:'+client_id,'put',{value:client,ttl:90*86400});
      const {secretHash,...out}=client;
      return json({...out,...(secret ? {client_secret:secret,client_secret_expires_at:0} : {}),client_id_issued_at:now(),grant_types:['authorization_code','refresh_token'],response_types:['code']},201);
    }
    if (path === '/authorize' && ['GET','POST'].includes(request.method)) {
      const client = await authParams(url,env);
      if (request.method === 'GET') {
        await rate(request,env,'authorize-get',60,600);
        const csrf = token();
        await state(env,'csrf:'+csrf,'put',{value:{query:url.search},ttl:600});
        // 使用服务端保存的一次性同步令牌，不依赖 OAuth WebView 是否持久化 Cookie。
        return html(page(url,client,csrf));
      }
      await rate(request,env,'authorize-post',10,600);
      const form = await request.formData();
      const csrf = String(form.get('csrf') || '');
      if (!csrf) fail('invalid_request','授权页面缺少 CSRF 令牌，请重新打开授权页');
      const nonce = await state(env,'csrf:'+csrf,'get');
      if (!nonce || nonce.query !== url.search) fail('invalid_request','授权页面已失效，请重新打开');
      // 密码错误时不消耗 nonce，让用户可在同一授权页重试；正确密码后再原子 take。
      if (await digest(String(form.get('password') || '')) !== await digest(env.OAUTH_PASSWORD)) return html(page(url,client,csrf,'密码错误，请重试'),401);
      const consumed = await state(env,'csrf:'+csrf,'take');
      if (!consumed || consumed.query !== url.search) fail('invalid_request','授权页面已提交或失效，请重新打开');
      const code=token();
      await state(env,'code:'+code,'put',{ttl:600,value:{client_id:client.client_id,redirect_uri:url.searchParams.get('redirect_uri'),challenge:url.searchParams.get('code_challenge'),resource:url.origin+'/mcp'}});
      const redir = new URL(url.searchParams.get('redirect_uri'));
      redir.searchParams.set('code',code);
      if (url.searchParams.has('state')) redir.searchParams.set('state',url.searchParams.get('state'));
      // RFC 9207：ChatGPT/Codex 用 iss 绑定授权响应与已发现的 issuer，避免 AS mix-up。
      redir.searchParams.set('iss',url.origin);
      // ChatGPT 当前 OAuth WebView 在部分环境不会自动跟随授权 POST 的跨域 303。
      // 对官方稳定 callback 返回一个 no-store 成功页，用 meta refresh 自动导航，并保留手动继续链接。
      if (redir.origin === 'https://chatgpt.com' && redir.pathname === '/connector_platform_oauth_redirect') {
        return html(callbackPage(redir.href),200);
      }
      return new Response(null,{status:303,headers:{Location:redir.href,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
    }
    if (path === '/token' && request.method === 'POST') {
      await rate(request,env,'token',60,60);
      const contentType=request.headers.get('Content-Type') || '';
      const p = contentType.includes('application/json') ? await request.json() : Object.fromEntries(await request.formData());
      if (!p || typeof p !== 'object' || Array.isArray(p)) fail('invalid_request','令牌请求必须是对象');
      let basic;
      const ah=request.headers.get('Authorization');
      if (ah) {
        if (!ah.startsWith('Basic ')) fail('invalid_client','无效客户端认证',401);
        let decoded; try {decoded=atob(ah.slice(6));} catch {fail('invalid_client','无效 Basic 凭据',401);}
        const sep=decoded.indexOf(':');
        if (sep<0) fail('invalid_client','无效 Basic 凭据',401);
        basic={id:decodeURIComponent(decoded.slice(0,sep)),secret:decodeURIComponent(decoded.slice(sep+1))};
        if (p.client_id && p.client_id !== basic.id) fail('invalid_client','客户端身份冲突',401);
      }
      const id=basic?.id || p.client_id;
      const client=await state(env,'client:'+id,'get');
      if (!client) fail('invalid_client','客户端不存在',401);
      const method=client.token_endpoint_auth_method;
      if (method === 'client_secret_basic' && !basic || method === 'client_secret_post' && basic) fail('invalid_client','客户端认证方式不匹配',401);
      if (method !== 'none' && await digest(String(basic?.secret || p.client_secret || '')) !== client.secretHash) fail('invalid_client','客户端凭据不正确',401);
      if (p.resource && p.resource !== url.origin+'/mcp') fail('invalid_target','resource 不匹配');
      if (p.grant_type === 'authorization_code') {
        if (!/^[A-Za-z0-9._~-]{43,128}$/u.test(p.code_verifier || '')) fail('invalid_grant','必须提供 PKCE code_verifier');
        const rec=await state(env,'code:'+p.code,'get');
        if (!rec || rec.client_id !== id || rec.redirect_uri !== p.redirect_uri || rec.resource !== url.origin+'/mcp' || b64(await sha256(p.code_verifier)) !== rec.challenge) fail('invalid_grant','授权码、客户端、回调地址或 PKCE 不匹配');
        // 校验后仍需原子消费；并发兑换只能有一个成功。
        if (!await state(env,'code:'+p.code,'take')) fail('invalid_grant','授权码已使用');
        return await issue(env,url.origin,rec);
      }
      if (p.grant_type === 'refresh_token') {
        const rec=await state(env,'refresh:'+p.refresh_token,'get');
        if (!rec || rec.client_id !== id || rec.resource !== url.origin+'/mcp') fail('invalid_grant','刷新令牌不匹配或已失效');
        if (!await state(env,'refresh:'+p.refresh_token,'take')) fail('invalid_grant','刷新令牌已使用');
        return await issue(env,url.origin,rec);
      }
      fail('unsupported_grant_type','不支持的 grant_type');
    }
    return json({error:'method_not_allowed'},405);
  } catch (e) {
    if (e instanceof AuthError) return json({error:e.error,error_description:e.message},e.status);
    if (e instanceof SyntaxError) return json({error:'invalid_request',error_description:'请求内容不是有效 JSON'},400);
    return json({error:'server_error',error_description:'OAuth 服务暂不可用，请检查部署配置'},503);
  }
}