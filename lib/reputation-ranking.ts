import type {ReputationV2} from './reputation-v2-model'
export const REPUTATION_RANKING_POLICY={version:'reputation-v2-ranking-1',default:'best_supported_history',status:'production',observation_gate:'explicit_user_override_2026-10-12',representative_evidence_review:'pending',unknown:'separate_unproven_candidates; eligible_price_then_stable_id',exploration:'explicit_discovery_only; no_execution_authority',balanced_formula:'0.8 * minimum_required_leaf_lower_quantile + 0.2 / (1 + total_usd_price)',price:'current_quoted_total; not_observed_quality',latency:'excluded_from_v2_model; claims_remain_separate'} as const
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
 return{mode,policy:REPUTATION_RANKING_POLICY,suggested_ids:ordered.map(c=>c.id),unproven_ids:unproven.map(c=>c.id),reason_codes:['hard_gates_preserved','uncalibrated_model_estimate','stable_id_ties'],execution_authority:false}
}

/** Order an already hard-gated snapshot. Unknown evidence never becomes a zero
 * estimate or removes an otherwise eligible provider. Financial checks and the
 * buyer's saved minimums remain the responsibility of the canonical caller. */
export function rankEligibleReputationCandidates(candidates:Candidate[]) {
 const supported=reputationSuggestions(candidates,REPUTATION_RANKING_POLICY.default)
 const unproven=new Set(supported.unproven_ids)
 const unknown=candidates.filter(candidate=>unproven.has(candidate.id))
  .sort((a,b)=>a.price-b.price||a.id.localeCompare(b.id))
 return{policy:REPUTATION_RANKING_POLICY,mode:REPUTATION_RANKING_POLICY.default,
  ordered_ids:[...supported.suggested_ids,...unknown.map(candidate=>candidate.id)],
  supported_ids:supported.suggested_ids,unproven_ids:unknown.map(candidate=>candidate.id),
  capability_aggregation:'least_supported_required_leaf',
  reason_codes:['hard_gates_preserved','uncalibrated_model_estimate','unproven_separate_from_supported','stable_id_ties'],
  default_ranking_changed:true,execution_authority:false}
}
