import { projectReputation,type ReputationObservation } from '../lib/reputation-v2-model'
import { reputationSuggestions } from '../lib/reputation-ranking'
import { screenReputationGraph } from '../lib/reputation-screening'
const now=Date.parse('2026-10-11T12:00:00Z'),scope={kind:'service_capability_mode' as const,service_id:'controlled-service',capability_id:'code-review',execution_mode:'contracted' as const}
function observations(count:number,groups:number,failures=0):ReputationObservation[]{return Array.from({length:count},(_,i)=>({workId:`fixture-work-${i}`,group:`fixture-customer-${i%groups}`,outcome:i<failures?'provider_failure':'accepted',at:now,rating:i<failures?null:5,incident:i<failures?'upheld':null,valueMinor:100}))}
const scenarios=[
 {id:'established-diverse',price:10,facts:observations(20,20,2)},
 {id:'new-cheap',price:0.01,facts:[]},
 {id:'repeat-customer-20-jobs',price:1,facts:observations(20,1)},
 {id:'one-perfect-review',price:1,facts:observations(1,1)},
 {id:'adverse-only',price:0.50,facts:observations(4,4,4)},
 {id:'difficult-work-mixed',price:5,facts:observations(6,6,2)},
 {id:'platform-outage-unknown',price:0.10,facts:[{workId:'outage',group:'fixture-outage-buyer',outcome:'unknown' as const,at:now}]},
 {id:'stale-established',price:2,facts:observations(20,20).map(o=>({...o,at:now-180*86400000}))},
]
const candidates=scenarios.map(s=>({id:s.id,price:s.price,reputation:projectReputation(s.facts,scope,now)}))
// Pinned router components, for controlled equal capability/capacity/verification
// claims with unknown claimed latency, a $100 ceiling and no operational penalties.
const legacy=candidates.map(c=>({...c,score:0.4+0.25*(1-c.price/100)+0.15*0.5+0.1+0.05+0.05*Math.min(c.reputation.breadth.observed_buyer_groups,5)/5})).sort((a,b)=>b.score-a.score||a.price-b.price||a.id.localeCompare(b.id))
const comparisons=['lowest_eligible_price','best_supported_history','balanced_heuristic'].map(mode=>reputationSuggestions(candidates,mode as 'lowest_eligible_price'|'best_supported_history'|'balanced_heuristic'))
console.log(JSON.stringify({kind:'controlled_adversarial_fixture_comparison',representative_production_outcomes:false,production_observation_gate_met:false,
 baseline:'pinned_router_formula_on_controlled_equal_hard_gate_candidates; no_paid_execution',baseline_ids:legacy.map(c=>c.id),comparisons,
 comparison_metrics:comparisons.map(comparison=>({mode:comparison.mode,changed_positions:comparison.suggested_ids.filter((id,index)=>legacy[index]?.id!==id).length,established_in_top_three:comparison.suggested_ids.slice(0,3).filter(id=>candidates.find(c=>c.id===id)?.reputation.evidence_status==='established').length,new_provider_rank:comparison.suggested_ids.indexOf('new-cheap')<0?null:comparison.suggested_ids.indexOf('new-cheap')+1,new_provider_in_unproven_suggestions:comparison.unproven_ids.includes('new-cheap')})),
 candidates:candidates.map(c=>({id:c.id,price:c.price,record:c.reputation})),
 interpretation:['Best supported history moves the diverse established record above the cheap new provider.','Repeat-customer twenty-job confidence equals one observed relationship; raw counts remain visible.','Outage and new-provider unknowns remain separate suggestions, never reliability zero.','Stale evidence decays; serious findings require explicit remediation.','No task difficulty, independence, prices or model probabilities are calibrated by these fixtures.'],
 longer_ring:screenReputationGraph(Array.from({length:6},(_,i)=>({from:`fixture-${i}`,to:`fixture-${(i+1)%6}`,tradeId:`ring-${i}`,occurredAt:now}))),
},null,2))
