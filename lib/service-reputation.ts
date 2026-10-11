import 'server-only'
import { loadReputationV2Records } from './reputation-v2'
import type { ReputationV2 } from './reputation-v2-model'
import type { service_definitions } from './schema'
/** One batched read for service/canonical-leaf/mode records; private work is suppressed. */
export async function serviceReputationMap(services:(typeof service_definitions.$inferSelect)[]){
 const requests=services.filter(s=>s.visibility==='public').flatMap(service=>{
  let caps:string[]=[];try{caps=JSON.parse(service.capabilities)}catch{return []}
  return caps.map(capability=>({key:`${service.id}:${capability}`,provider_id:service.seller_id.replace(/^user_agent_/,''),
   scope:{kind:'service_capability_mode' as const,service_id:service.id,capability_id:capability,execution_mode:'contracted' as const}}))
 })
 const records=await loadReputationV2Records(requests)
 return new Map(services.map(service=>[service.id,requests.filter(r=>r.scope.service_id===service.id).map(r=>records.get(r.key)!).filter(Boolean)] as [string,ReputationV2[]]))
}
