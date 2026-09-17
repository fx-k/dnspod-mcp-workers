import {OAuthState} from '../src/oauth-state.js';
export function memoryNamespace() {
  const objects=new Map();
  return {objects,idFromName:name=>name,get(name) {
    if (!objects.has(name)) {
      const data=new Map();let tail=Promise.resolve();
      const storage={
        async get(k){return structuredClone(data.get(k));},
        async put(k,v){data.set(k,structuredClone(v));},
        async delete(k){return data.delete(k);},
        async deleteAll(){data.clear();},async setAlarm(at){storage.alarmAt=at;},
        transaction(fn){const next=tail.then(()=>fn(storage));tail=next.catch(()=>{});return next;}
      };
      const instance=new OAuthState({storage});
      objects.set(name,{data,storage,instance,fetch:(url,options)=>instance.fetch(new Request(url,options))});
    }
    return objects.get(name);
  }};
}
export const DOMAIN='example.com';
export const writeEnv={DNSPOD_READ_ONLY:'false',DNSPOD_ALLOW_DESTRUCTIVE:'true',DNSPOD_WRITE_DOMAINS:DOMAIN};
export const baseRecord={Id:11,SubDomain:'www',RecordType:'A',RecordLine:'电信',RecordLineId:'10=0',Value:'192.0.2.10',TTL:900,MX:0,Weight:0,Enabled:0,Remark:'old',DomainId:100};
export function cloud(overrides={}) {
  const calls=[];
  const api=async (env,action,payload)=>{
    calls.push({action,payload:structuredClone(payload)});
    if (overrides[action]) return overrides[action](payload);
    if(action==='DescribeDomain')return {DomainInfo:{Domain:DOMAIN,DomainId:100,Grade:'DP_FREE'}};
    if(action==='DescribeRecord')return {RecordInfo:{...baseRecord,Id:payload.RecordId}};
    if(action==='CheckSnapshotRollback')return {Total:1,Failed:0,Timeout:null,FailedRecordList:[]};
    if(action==='CreateSnapshot')return {RequestId:'test-request'};
    if(action==='RollbackSnapshot')return {TaskId:123,RequestId:'test-request'};
    if(['CreateRecordBatch','ModifyRecordBatchV3','DeleteRecordBatch'].includes(action))return {JobId:99,RequestId:'test-request'};
    return {RequestId:'test-request'};
  };
  return {api,calls,last:()=>calls.at(-1)};
}
