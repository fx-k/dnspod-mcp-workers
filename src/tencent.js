/** TC3 签名逻辑改编自 zfx-t/dnspod-mcp-workers (MIT)。不接受任意域名或 Action。 */
const enc = new TextEncoder();
export const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha256(text) { return crypto.subtle.digest('SHA-256', enc.encode(text)); }
export async function hmac(key, text) {
  const k = await crypto.subtle.importKey('raw', typeof key === 'string' ? enc.encode(key) : key,
    {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, enc.encode(text));
}
// 空字符串有业务含义（例如清空 Remark）；只移除 undefined，不吞掉 0 / false / ""。
export function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, v]) => v !== undefined).map(([k, v]) => [k, clean(v)]));
  return value;
}
export class TencentError extends Error {
  constructor(code, message, requestId) { super(message); this.name = 'TencentError'; this.code = code; this.requestId = requestId; }
}
export async function signedRequest(env, action, payload, now = Date.now()) {
  if (!env.TENCENTCLOUD_SECRET_ID || !env.TENCENTCLOUD_SECRET_KEY) throw new TencentError('ConfigurationError', '缺少腾讯云服务端凭据');
  const host = 'dnspod.tencentcloudapi.com';
  const timestamp = Math.floor(now / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const body = JSON.stringify(clean(payload));
  const signed = 'content-type;host;x-tc-action';
  const headers = `content-type:application/json; charset=utf-8\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`;
  const canonical = ['POST', '/', '', headers, signed, hex(await sha256(body))].join('\n');
  const scope = `${date}/dnspod/tc3_request`;
  const toSign = ['TC3-HMAC-SHA256', timestamp, scope, hex(await sha256(canonical))].join('\n');
  const key = await hmac(await hmac(await hmac('TC3' + env.TENCENTCLOUD_SECRET_KEY, date), 'dnspod'), 'tc3_request');
  const signature = hex(await hmac(key, toSign));
  const result = {method:'POST', headers:{
    'Content-Type':'application/json; charset=utf-8',
    'X-TC-Action':action, 'X-TC-Timestamp':String(timestamp), 'X-TC-Version':'2021-03-23',
    Authorization:`TC3-HMAC-SHA256 Credential=${env.TENCENTCLOUD_SECRET_ID}/${scope}, SignedHeaders=${signed}, Signature=${signature}`
  }, body};
  if (env.TENCENTCLOUD_REGION) result.headers['X-TC-Region'] = env.TENCENTCLOUD_REGION;
  if (env.TENCENTCLOUD_TOKEN) result.headers['X-TC-Token'] = env.TENCENTCLOUD_TOKEN;
  return result;
}
export async function tencentRequest(env, action, payload = {}) {
  const request = await signedRequest(env, action, payload);
  let response;
  try { response = await fetch('https://dnspod.tencentcloudapi.com/', {...request, signal:AbortSignal.timeout(12000)}); }
  catch { throw new TencentError('NetworkError', '腾讯云请求超时或网络失败；写操作结果未知，先查询核实，不要盲目重试'); }
  let data;
  try { data = await response.json(); } catch { throw new TencentError('InvalidResponse', `腾讯云返回非 JSON 响应（HTTP ${response.status}）`); }
  const out = data?.Response;
  if (out?.Error) throw new TencentError(out.Error.Code, out.Error.Message, out.RequestId);
  if (!response.ok || !out || typeof out !== 'object' || Array.isArray(out)) throw new TencentError('InvalidResponse', `腾讯云响应异常（HTTP ${response.status}）`, out?.RequestId);
  return out;
}
