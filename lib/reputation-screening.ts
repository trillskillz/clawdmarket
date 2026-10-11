/** Bounded asynchronous screening only; a graph cycle is not a fraud finding. */
export const REPUTATION_SCREENING_POLICY={version:1,max_edges:5000,max_principals:500,max_depth:12,max_states:4096,action:'queue_review_only',shared_infrastructure:'not_ownership_evidence'} as const
export type ScreeningEdge={from:string;to:string;tradeId:string;occurredAt:number|null;newAccount?:boolean;related?:boolean}
export function screenReputationGraph(input:ScreeningEdge[]) {
 const p=REPUTATION_SCREENING_POLICY,edges=input.slice(0,p.max_edges),adj=new Map<string,ScreeningEdge[]>()
 for(const edge of edges)adj.set(edge.from,[...(adj.get(edge.from)??[]),edge])
 const principals=[...new Set(edges.flatMap(e=>[e.from,e.to]))].sort(),concerns:{kind:string;trade_ids:string[];interpretation:string}[]=[],seen=new Set<string>()
 let exhausted=input.length>p.max_edges||principals.length>p.max_principals,states=0
 for(const start of principals.slice(0,p.max_principals)){
  if(states>=p.max_states){exhausted=true;break}
  const queue:{node:string;path:ScreeningEdge[];visited:Set<string>}[]=[{node:start,path:[],visited:new Set([start])}]
  let explored=0
  while(queue.length&&explored<p.max_states&&states<p.max_states){
   const step=queue.shift()!;explored++;states++
   for(const edge of adj.get(step.node)??[]){
    const path=[...step.path,edge]
    if(edge.to===start&&path.length>=2){
     const ids=path.map(e=>e.tradeId).sort(),key=ids.join('|')
     if(!seen.has(key)&&concerns.length<1000){seen.add(key);concerns.push({kind:path.length>4?'longer_ring':'reciprocal_business',trade_ids:ids,interpretation:'screening_signal; not_fraud; authorized_review_required'})}else if(concerns.length>=1000)exhausted=true
     continue
    }
    if(path.length>=p.max_depth){if((adj.get(edge.to)??[]).some(next=>!step.visited.has(next.to)||next.to===start))exhausted=true;continue}
    if(!step.visited.has(edge.to)){if(queue.length<p.max_states)queue.push({node:edge.to,path,visited:new Set([...step.visited,edge.to])});else exhausted=true}
   }
  }
  if(queue.length)exhausted=true
 }
 const repeat=new Map<string,ScreeningEdge[]>();for(const edge of edges){const key=edge.from+'\0'+edge.to;repeat.set(key,[...(repeat.get(key)??[]),edge])}
 for(const pair of repeat.values())if(pair.length>=20)concerns.push({kind:'repeat_relationship_concentration',trade_ids:pair.map(e=>e.tradeId),interpretation:'legitimate_repeat_customers_possible; one_group_statistical_cap; review_only'})
 for(const pair of repeat.values())if(pair.some(e=>e.related)&&pair.length>=2)concerns.push({kind:'repeated_known_related_party_work',trade_ids:pair.map(e=>e.tradeId),interpretation:'known_affiliation; review_only; existing_exclusion_unchanged'})
 const recentNew=edges.filter(e=>e.newAccount&&e.occurredAt!==null).sort((a,b)=>a.occurredAt!-b.occurredAt!)
 for(let i=0;i<recentNew.length;i++){const cluster=recentNew.slice(i).filter(e=>e.occurredAt!-recentNew[i].occurredAt!<=3*86400000);if(new Set(cluster.map(e=>e.from)).size>=5){concerns.push({kind:'rapid_new_account_cluster',trade_ids:cluster.map(e=>e.tradeId),interpretation:'account_timing_signal; control_unknown; review_only'});break}}
 return{policy:p,status:exhausted?'analysis_incomplete':'bounded_analysis_complete',longer_cycles_beyond_max_depth:'unresolved',buyer_independence:'not_verified',edges_examined:edges.length,principals_examined:Math.min(principals.length,p.max_principals),states_examined:states,concerns}
}
