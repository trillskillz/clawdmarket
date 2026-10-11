import type {ReputationV2} from './reputation-v2-model'
export const REPUTATION_RANKING_POLICY={version:'reputation-v2-shadow-1',default:'legacy_order_unchanged',unknown:'separate_unproven_suggestions',exploration:'explicit_discovery_only; no_execution_authority',balanced_formula:'0.8 * minimum_required_leaf_lower_quantile + 0.2 / (1 + total_usd_price)',price:'current_quoted_total; not_observed_quality',latency:'excluded_from_v2_model; claims_remain_separate'} as const
type Candidate={id:string;price:number;reputation:ReputationV2}
/** Suggestions only; callers must retain every existing authorization/hard gate. */
export function reputationSuggestions(candidates:Candidate[],mode:'lowest_eligible_price'|'best_supported_history'|'balanced_heuristic'){
 const proven=candidates.filter(c=>c.reputation.projection_status==='current'&&c.reputation.delivery.weighted_model_estimate!==null)
 const unproven=candidates.filter(c=>!proven.includes(c)).sort((a,b)=>a.id.localeCompare(b.id))
 const estimate=(c:Candidate)=>c.reputation.delivery.weighted_model_estimate!.lower_quantile
 const ordered=mode==='lowest_eligible_price'?[...candidates].sort((a,b)=>a.price-b.price||a.id.localeCompare(b.id)):[...proven].sort((a,b)=>{
  const score=(c:Candidate)=>mode==='best_supported_history'?estimate(c):estimate(c)*0.8+(1/(1+c.price))*0.2
  return score(b)-score(a)||a.price-b.price||a.id.localeCompare(b.id)
 })
 return{mode,policy:REPUTATION_RANKING_POLICY,suggested_ids:ordered.map(c=>c.id),unproven_ids:unproven.map(c=>c.id),reason_codes:['hard_gates_preserved','uncalibrated_shadow_estimate','stable_id_ties'],execution_authority:false}
}
