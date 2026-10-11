import test from 'node:test'
import assert from 'node:assert/strict'
import {projectReputation,lowerBetaQuantile,type ReputationObservation} from '../../lib/reputation-v2-model'
const now=Date.parse('2026-10-11T12:00:00Z'),scope={kind:'provider_history' as const}
const fact=(id:string,changes:Partial<ReputationObservation>={}):ReputationObservation=>({workId:id,group:'repeat-customer',outcome:'accepted',at:now,...changes})
test('zero terminal evidence has null performance; adverse-only and unknown history stay distinct from new providers',()=>{
 const empty=projectReputation([],scope,now);assert.equal(empty.evidence_status,'new');assert.equal(empty.delivery.raw_rate,null);assert.equal(empty.delivery.weighted_model_estimate,null)
 const adverse=projectReputation([fact('failure',{outcome:'provider_failure',incident:'upheld'})],scope,now);assert.equal(adverse.evidence_status,'limited');assert.equal(adverse.delivery.provider_failures,1);assert.equal(adverse.incidents.adjudicated,1)
 const unknown=projectReputation([fact('unknown',{outcome:'unknown'})],scope,now);assert.equal(unknown.evidence_status,'limited');assert.equal(unknown.delivery.weighted_model_estimate,null)
})
test('twenty repeat-customer outcomes cannot multiply confidence; successes and failures share the same cap',()=>{
 const successes=projectReputation(Array.from({length:20},(_,i)=>fact(String(i))),scope,now),failures=projectReputation(Array.from({length:20},(_,i)=>fact(String(i),{outcome:'provider_failure',incident:'upheld'})),scope,now)
 assert.equal(successes.breadth.decayed_group_weight,1);assert.equal(failures.breadth.decayed_group_weight,1);assert.equal(successes.delivery.accepted,20);assert.equal(failures.incidents.adjudicated,20)
 const mixed=projectReputation([fact('one'),fact('two',{outcome:'provider_failure'})],scope,now);assert.equal(mixed.delivery.weighted_model_estimate!.mean,0.5);assert.equal(mixed.breadth.observed_buyer_groups,1)
})
test('a new perfect review cannot erase eligible dissatisfaction; missing feedback does not infer satisfaction',()=>{
 const r=projectReputation([fact('bad',{rating:1}),fact('good',{rating:5}),fact('unreviewed')],scope,now)
 assert.equal(r.satisfaction.mean,3);assert.equal(r.satisfaction.eligible_review_count,2);assert.equal(r.satisfaction.reviewed_job_coverage,0.666667)
 assert.equal(projectReputation([fact('missing')],scope,now).satisfaction.mean,null)
})
test('failed first-pass checks and operational observations do not duplicate a terminal outcome or turn a pending payout into failure',()=>{
 const r=projectReputation([fact('job',{firstPassFailure:true,methods:['schema','buyer_review']}),fact('pending',{outcome:'pending',openCase:true}),fact('unknown',{outcome:'unknown'})],scope,now)
 assert.equal(r.delivery.accepted,1);assert.equal(r.delivery.provider_failures,0);assert.equal(r.first_pass.jobs_with_failed_check,1);assert.equal(r.incidents.pending,1);assert.equal(r.delivery.pending,1);assert.equal(r.delivery.unknown,1)
 assert.equal(r.verification.schema,1);assert.equal(r.limitations.semantic_quality,'unmeasured')
})
test('age and money buy no evidence weight; stale work decays without becoming misconduct',()=>{
 const current=projectReputation([fact('one',{valueMinor:1})],scope,now),costly=projectReputation([fact('one',{valueMinor:10000000})],scope,now)
 assert.deepEqual(current.delivery,costly.delivery)
 const stale=projectReputation([fact('old',{at:now-180*86400000})],scope,now);assert.equal(stale.stale,true);assert.equal(stale.breadth.decayed_group_weight,0.25);assert.equal(stale.incidents.adjudicated,0)
})
test('deadline and latency coverage excludes unsupported clocks and never starts at unpaid reservation',()=>{
 const r=projectReputation([fact('timely',{committedAt:now-10000,deliveryAt:now-1000,deadlineAt:now}),fact('unknown',{deliveryAt:now}),fact('invalid',{committedAt:now,deliveryAt:now-1,deadlineAt:now+1000})],scope,now)
 assert.equal(r.deadlines.eligible,1);assert.equal(r.deadlines.on_time,1);assert.equal(r.deadlines.unknown,2);assert.equal(r.deadlines.p50_seconds,null);assert.equal(r.deadlines.p95_seconds,null)
})
test('documented internal quantile is deterministic and symmetric; public no-history has no prior disguised as performance',()=>{
 assert.equal(lowerBetaQuantile(1,1),0.1);assert.ok(lowerBetaQuantile(10,1)>lowerBetaQuantile(1,10))
 assert.equal(projectReputation([],scope,now).delivery.weighted_model_estimate,null)
})

test('serious findings remain explicit after statistical decay and version continuity never creates new provider identity',()=>{
 const r=projectReputation([fact('old',{at:now-1000*86400000,outcome:'provider_failure',incident:'appealed',seriousIncident:true,serviceVersion:'old-service',agentVersion:1,operatorPeriod:'old-operator'}),fact('new',{serviceVersion:'new-service',agentVersion:2,operatorPeriod:'new-operator'})],scope,now)
 assert.equal(r.incidents.serious_unremediated,1);assert.equal(r.incidents.appealed,1);assert.equal(r.delivery.provider_failures,1)
 assert.equal(r.service_versions.length,2);assert.equal(r.software_versions.length,2);assert.equal(r.scope_coverage.known_operator_periods,2)
})

test('model labels, denominator coverage and meaningful latency samples remain explicit for established, difficult and pending work',()=>{
 const diverse=Array.from({length:20},(_,i)=>fact(String(i),{group:`observed-group-${i}`,committedAt:now-100000,deliveryAt:now-100000+(i+1)*1000,deadlineAt:now-80000}))
 const r=projectReputation([...diverse,fact('pending',{outcome:'pending'}),fact('unknown',{outcome:'unknown'})],scope,now)
 assert.equal(r.evidence_status,'established');assert.equal(r.delivery.raw_rate,1);assert.equal(r.delivery.pending,1);assert.equal(r.delivery.unknown,1);assert.equal(r.deadlines.p50_seconds,10);assert.equal(r.deadlines.p95_seconds,19)
 const difficult=projectReputation([...diverse.map(o=>({...o,outcome:'provider_failure' as const})),fact('correction',{firstPassFailure:true})],scope,now)
 assert.equal(difficult.delivery.provider_failures,20);assert.equal(difficult.first_pass.jobs_with_failed_check,1);assert.equal(difficult.limitations.calibrated,false)
})
