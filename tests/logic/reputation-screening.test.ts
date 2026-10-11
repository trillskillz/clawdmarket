import test from 'node:test'
import assert from 'node:assert/strict'
import {screenReputationGraph,REPUTATION_SCREENING_POLICY as p} from '../../lib/reputation-screening'
const ring=(n:number)=>Array.from({length:n},(_,i)=>({from:String(i),to:String((i+1)%n),tradeId:String(i),occurredAt:null}))
test('longer rings queue review, while ordinary reciprocal business is not accused of fraud',()=>{
 const long=screenReputationGraph(ring(6));assert.ok(long.concerns.some(c=>c.kind==='longer_ring'));assert.equal(long.policy.action,'queue_review_only')
 const reciprocal=screenReputationGraph(ring(2));assert.equal(reciprocal.concerns[0].kind,'reciprocal_business');assert.match(reciprocal.concerns[0].interpretation,/not_fraud/)
})
test('search bounds and unresolved longer rings are explicit, never an upheld abuse finding',()=>{
 assert.equal(screenReputationGraph(ring(p.max_depth+1)).status,'analysis_incomplete')
 const many=screenReputationGraph(Array.from({length:p.max_edges+1},(_,i)=>({from:'payer',to:`provider-${i}`,tradeId:String(i),occurredAt:null})))
 assert.equal(many.edges_examined,p.max_edges);assert.equal(many.status,'analysis_incomplete');assert.equal(many.buyer_independence,'not_verified')
})
