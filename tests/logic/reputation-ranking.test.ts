import test from 'node:test'
import assert from 'node:assert/strict'
import {projectReputation,unavailableReputation} from '../../lib/reputation-v2-model'
import {rankEligibleReputationCandidates,reputationSuggestions} from '../../lib/reputation-ranking'
import {reputationRequirementFailure} from '../../lib/provider-requirements'
const now=Date.parse('2026-10-11T12:00:00Z'),scope={kind:'provider_history' as const}
const evidence=(outcome:'accepted'|'provider_failure',count=1)=>projectReputation(Array.from({length:count},(_,i)=>({workId:String(i),group:String(i),outcome,at:now,incident:outcome==='provider_failure'?'upheld' as const:null})),scope,now)
test('all suggestion modes use stable ties and isolate missing evidence without granting execution authority',()=>{
 const candidates=[{id:'z',price:1,reputation:evidence('accepted',5)},{id:'a',price:1,reputation:evidence('accepted',5)},{id:'unknown',price:0.1,reputation:projectReputation([],scope,now)},{id:'unavailable',price:0.01,reputation:unavailableReputation(scope)}]
 for(const mode of ['best_supported_history','balanced_heuristic'] as const){const result=reputationSuggestions(candidates,mode);assert.deepEqual(result.suggested_ids,['a','z']);assert.deepEqual(result.unproven_ids,['unavailable','unknown']);assert.equal(result.execution_authority,false)}
 assert.deepEqual(reputationSuggestions(candidates,'lowest_eligible_price').suggested_ids,['unavailable','unknown','a','z'])
 assert.equal(reputationSuggestions([], 'best_supported_history').suggested_ids.length,0)
})
test('supported history can prefer a higher eligible price; its shadow estimate remains uncalibrated',()=>{
 const bad=evidence('provider_failure',5),good=evidence('accepted',5)
 assert.deepEqual(reputationSuggestions([{id:'cheap',price:0.1,reputation:bad},{id:'supported',price:10,reputation:good}],'best_supported_history').suggested_ids,['supported','cheap'])
 assert.equal(good.delivery.weighted_model_estimate?.calibrated,false)
})
test('explicit buyer requirements fail on unavailable evidence and enforce every required scope',()=>{
 const good=evidence('accepted',5),bad=evidence('provider_failure'),missing=unavailableReputation(scope)
 assert.ok(reputationRequirementFailure({minimum_reputation_buyer_groups:2},[good,bad]))
 assert.ok(reputationRequirementFailure({maximum_provider_fault_findings:0},[good,bad]))
 assert.ok(reputationRequirementFailure({maximum_provider_fault_findings:0},[missing]))
 assert.equal(reputationRequirementFailure({minimum_reputation_buyer_groups:2,maximum_provider_fault_findings:0},[good]),null)
 const pending=projectReputation([{workId:'open',group:'one',outcome:'pending',at:now,openCase:true}],scope,now)
 assert.ok(reputationRequirementFailure({no_unresolved_public_cases:true},[pending]))
 assert.equal(pending.delivery.provider_failures,0)
})

test('production ordering prefers supported history without treating unknown or unavailable history as failure',()=>{
 const candidates=[{id:'unknown-z',price:1,reputation:projectReputation([],scope,now)},
  {id:'supported',price:10,reputation:evidence('accepted',5)},
  {id:'unknown-a',price:1,reputation:projectReputation([],scope,now)},
  {id:'unavailable',price:0.01,reputation:unavailableReputation(scope)}]
 const ranked=rankEligibleReputationCandidates(candidates)
 assert.deepEqual(ranked.ordered_ids,['supported','unavailable','unknown-a','unknown-z'])
 assert.deepEqual(ranked.supported_ids,['supported'])
 assert.deepEqual(ranked.unproven_ids,['unavailable','unknown-a','unknown-z'])
 assert.equal(ranked.policy.status,'production');assert.equal(ranked.execution_authority,false)
 assert.equal(ranked.policy.representative_evidence_review,'pending')
 for(const candidate of candidates.slice(2))assert.equal(candidate.reputation.delivery.weighted_model_estimate,null)
 assert.deepEqual(rankEligibleReputationCandidates([...candidates].reverse()).ordered_ids,ranked.ordered_ids)
 assert.deepEqual(rankEligibleReputationCandidates([]).ordered_ids,[])
})

test('production support is lost when a required scope becomes unavailable; numeric price decides the separate unknown segment',()=>{
 const original={id:'original',price:10,reputation:evidence('accepted',5)}
 const cheaper={id:'cheaper',price:2,reputation:projectReputation([],scope,now)}
 assert.deepEqual(rankEligibleReputationCandidates([cheaper,original]).ordered_ids,['original','cheaper'])
 const unavailable={...original,reputation:unavailableReputation(scope)}
 const ranked=rankEligibleReputationCandidates([unavailable,cheaper])
 assert.deepEqual(ranked.ordered_ids,['cheaper','original']);assert.deepEqual(ranked.supported_ids,[])
 assert.deepEqual(ranked.unproven_ids,['cheaper','original'])
})
