import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../src/index.js';
import {memoryNamespace} from './helpers.js';

const origin='https://mcp.example.test';
const redirect='https://chatgpt.com/connector_platform_oauth_redirect';
const verifier='w'.repeat(64);
const challenge=createHash('sha256').update(verifier).digest('base64url');
const makeEnv=()=>({OAUTH_STATE:memoryNamespace(),OAUTH_PASSWORD:'test-only-password-12345',OAUTH_JWT_SECRET:'test-only-jwt-secret-never-use-in-production-12345'});
const req=(env,path,body,headers={},method)=>worker.fetch(new Request(origin+path,{method:method || (body===undefined?'GET':'POST'),headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})}),env);

test('ChatGPT WebView 授权成功页不依赖 Cookie，并可继续完成 token exchange',async()=>{
  const env=makeEnv();
  const registered=await req(env,'/register',{client_name:'ChatGPT test',redirect_uris:[redirect],token_endpoint_auth_method:'none'});
  assert.equal(registered.status,201);
  const client=await registered.json();
  const state='oauth_s_test_state';
  const params=new URLSearchParams({response_type:'code',client_id:client.client_id,redirect_uri:redirect,scope:'mcp',code_challenge:challenge,code_challenge_method:'S256',resource:origin+'/mcp',state});
  const path='/authorize?'+params;
  const page=await req(env,path);
  assert.equal(page.status,200);
  const pageText=await page.text();
  const csrf=pageText.match(/name="csrf" value="([^"]+)"/u)?.[1];
  assert.ok(csrf);

  // 故意不带 Cookie，模拟 ChatGPT OAuth WebView。
  const accepted=await req(env,path,new URLSearchParams({csrf,password:env.OAUTH_PASSWORD}).toString(),{'Content-Type':'application/x-www-form-urlencoded'});
  assert.equal(accepted.status,200);
  assert.equal(accepted.headers.get('Referrer-Policy'),'no-referrer');
  assert.equal(accepted.headers.get('Cache-Control'),'no-store');
  const body=await accepted.text();
  assert.match(body,/正在返回 ChatGPT/u);
  assert.match(body,/http-equiv="refresh"/u);
  const href=body.match(/<a href="([^"]+)"/u)?.[1]?.replaceAll('&amp;','&');
  assert.ok(href);
  const target=new URL(href);
  assert.equal(target.origin,'https://chatgpt.com');
  assert.equal(target.pathname,'/connector_platform_oauth_redirect');
  assert.equal(target.searchParams.get('state'),state);
  assert.equal(target.searchParams.get('iss'),origin);
  const code=target.searchParams.get('code');
  assert.ok(code);

  const token=await req(env,'/token',{grant_type:'authorization_code',client_id:client.client_id,redirect_uri:redirect,code,code_verifier:verifier,resource:origin+'/mcp'});
  assert.equal(token.status,200);
  const tokens=await token.json();
  assert.equal(tokens.token_type,'Bearer');
  assert.ok(tokens.access_token);

  // 同一个成功授权页不能再次提交，nonce 仍是一次性的。
  const replay=await req(env,path,new URLSearchParams({csrf,password:env.OAUTH_PASSWORD}).toString(),{'Content-Type':'application/x-www-form-urlencoded'});
  assert.equal(replay.status,400);
});
