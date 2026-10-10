import test from 'node:test'
import assert from 'node:assert/strict'
import { spendingAuthorityHash } from '../../lib/organization-spending-authority.mjs'

// Digests captured from the accepted pre-refactor v1/v2/v3 serialization.
const original={organization_id:'org-original',owner_account_id:'owner-original',buyer_agent_id:'agent-original',team_id:null,cost_center:'REVIEWED',client_reference:'original-reference',name:'Original account',allowed_services_json:'[]',max_purchase_minor:105,max_daily_minor:210,max_monthly_minor:315,max_lifetime_minor:420,expires_at:new Date('2026-10-11T00:00:00.000Z')}
test('shared operator fingerprint preserves previously reviewed credit, L1 and Tempo serialization',()=>{
  assert.equal(spendingAuthorityHash({...original,version:1,payment_terms_json:null}),'a7ec987c4362a37caf001dbd7042fcff6c87a2f29365b7afe989fadffdf8270c')
  assert.equal(spendingAuthorityHash({...original,version:2,payment_terms_json:'{"payment":{"rail":"evm"}}'}),'7c9dcece08d917c4e8cfe23e3a608af892f56e069ab3c9f9521f892a7119e145')
  assert.equal(spendingAuthorityHash({...original,version:3,payment_terms_json:'{"payment":{"rail":"mpp"}}'}),'4e3ae4d0f24eb4f19837fa0d2010e2b41a4498cdb964d00981740ebdaa1ba5d6')
})
