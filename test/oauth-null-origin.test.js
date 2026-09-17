import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import worker from '../src/index.js';
import {memoryNamespace} from './helpers.js';

const origin='https://mcp.example.test';
const redirect='https://client.example.test/callback';
const verifier='n'.repeat(64);
const challenge=createHash('sha256').update(verifier).digest('base64url');
const makeEnv=()=>({
  OAUTH_STATE:memoryNamespace(),
  OAUTH_PASSWORD:'test-only-password-12345',
  OAUTH_JWT_SECRET:'test-only-jwt-secret-never-use-in-production-12345',
  CORS_ALLOWED_ORIGINS:'https://chatgpt.com'
});

async function req(env,path,{method='GET',headers={},body}={}) {
  return worker.fetch(new Request(origin+path,{method,headers,...(body===undefined?{}:{body})}),env);
}

async function register(env) {
  const r=await req(env,'/register',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({client_name:'ChatGPT',redirect_uris:[redirect],token_endpoint_auth_method:'none'})
  });
  assert.equal(r.status,201);
  return r.json();
}

test('sandboxed OAuth form 可用 Origin:null 提交，但 null Origin 不能访问 MCP',async()=>{
  const env=makeEnv();
  const client=await register(env);
  const params=new URLSearchParams({
    client_id:client.client_id,
    redirect_uri:redirect,
    response_type:'code',
    code_challenge:challenge,
    code_challenge_method:'S256',
    scope:'mcp',
    state:'opaque-webview',
    resource:origin+'/mcp'
  });
  const path='/authorize?'+params;
  const page=await req(env,path);
  assert.equal(page.status,200);
  const text=await page.text();
  const csrf=text.match(/name="csrf" value="([^"]+)"/u)?.[1];
  assert.ok(csrf);

  const accepted=await req(env,path,{
    method:'POST',
    headers:{Origin:'null','Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({csrf,password:env.OAUTH_PASSWORD}).toString()
  });
  assert.equal(accepted.status,303);
  assert.equal(accepted.headers.get('Access-Control-Allow-Origin'),null);
  const callback=new URL(accepted.headers.get('Location'));
  assert.ok(callback.searchParams.get('code'));
  assert.equal(callback.searchParams.get('state'),'opaque-webview');
  assert.equal(callback.searchParams.get('iss'),origin);

  const blocked=await req(env,'/mcp',{
    method:'POST',
    headers:{Origin:'null','Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'ping'})
  });
  assert.equal(blocked.status,403);
  assert.deepEqual(await blocked.json(),{error:'origin_not_allowed',origin:'null'});
});
