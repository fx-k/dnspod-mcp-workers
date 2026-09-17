/**
 * 每个随机 OAuth 键一个 Durable Object。SQLite 后端提供事务，授权码/刷新令牌原子消费。
 * 不对公网暴露；只能经 OAUTH_STATE binding 调用。过期数据用 alarm 清理。
 */
export class OAuthState {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const {op,value,ttl,limit} = await request.json();
    const now = Date.now();
    let expiresAt;
    const result = await this.ctx.storage.transaction(async tx => {
      const old = await tx.get('item');
      const valid = old && old.expiresAt > now;
      if (op === 'get') return valid ? old.value : null;
      if (op === 'take') { await tx.delete('item'); return valid ? old.value : null; }
      if (op === 'put') {
        if (!Number.isInteger(ttl) || ttl < 1 || ttl > 90*86400) throw new Error('Invalid TTL');
        expiresAt = now + ttl*1000;
        await tx.put('item',{value,expiresAt});
        return true;
      }
      if (op === 'rate') {
        const count = valid ? old.value + 1 : 1;
        expiresAt = valid ? old.expiresAt : now + ttl*1000;
        await tx.put('item',{value:count,expiresAt});
        return count <= limit;
      }
      throw new Error('Unknown storage operation');
    });
    if (expiresAt) await this.ctx.storage.setAlarm(expiresAt);
    return Response.json(result);
  }
  async alarm() {
    const item = await this.ctx.storage.get('item');
    if (item && item.expiresAt > Date.now()) await this.ctx.storage.setAlarm(item.expiresAt);
    else await this.ctx.storage.deleteAll();
  }
}
export async function state(env, key, op, options={}) {
  if (!env.OAUTH_STATE) throw new Error('Missing OAUTH_STATE Durable Object binding');
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));
  const name = [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
  const stub = env.OAUTH_STATE.get(env.OAUTH_STATE.idFromName(name));
  const response = await stub.fetch('https://oauth-state/',{method:'POST',body:JSON.stringify({op,...options})});
  if (!response.ok) throw new Error('OAuth state unavailable');
  return response.json();
}
