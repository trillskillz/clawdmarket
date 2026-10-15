import assert from 'node:assert/strict'
import { privateKeyToAccount } from 'viem/accounts'

export type ListingFixtureSource={db:typeof import('@/lib/db').db;schema:typeof import('@/lib/schema')}
const treasuryKey=`0x${'99'.repeat(32)}` as const,treasury=privateKeyToAccount(treasuryKey).address.toLowerCase(),token=`0x${'44'.repeat(20)}`,tempoToken='0x20c0000000000000000000000000000000000000'
export async function reviewedListingFixture(source:ListingFixtureSource,tempo=false,registeredIds=true){
  const {db,schema}=source
  const agentId=()=>registeredIds?`agent_${crypto.randomUUID()}`:crypto.randomUUID()
  const org=crypto.randomUUID(),buyerAgent=agentId(),providerAgent=agentId(),listingId=crypto.randomUUID(),team=crypto.randomUUID(),now=new Date()
  const owner=`owner-${org}`,reviewer=`reviewer-${org}`,other=`viewer-${org}`,buyer=`user_agent_${buyerAgent}`,seller=`user_agent_${providerAgent}`
  await db.insert(schema.users).values([owner,reviewer,other,buyer,seller].map(id=>({id,name:id,email:`${id}@test.invalid`,password_hash:'unused'})))
  await db.insert(schema.agents).values([buyerAgent,providerAgent].map(id=>({id,name:'Original listing participant',description:'Disposable listing authority fixture',capabilities:'["code-review"]',endpoint:'https://example.invalid',owner_address:'',api_key:'unused'})))
  await db.insert(schema.agent_owners).values({agentId:buyerAgent,userId:owner,establishedBy:'fixture'})
  await db.insert(schema.organizations).values({id:org,owner_account_id:owner,client_reference:org,name:'Listing authority fixture',created_at:now,updated_at:now})
  await db.insert(schema.organization_teams).values({id:team,organization_id:org,slug:'review',name:'Review',created_at:now,updated_at:now})
  await db.insert(schema.organization_agent_assignments).values({agent_id:buyerAgent,organization_id:org,team_id:team,cost_center:'TASK',assigned_at:now,updated_at:now})
  const membership=await import('@/lib/organization-membership'),purchasing=await import('@/lib/organization-purchasing')
  for(const actor of [reviewer,other]){const invite=await membership.createOrganizationInvitation(org,owner,actor,crypto.randomUUID());assert.equal(invite.kind,'ok');assert.equal((await membership.acceptOrganizationInvitation(invite.invitation_id!,actor)).kind,'ok')}
  const role=await purchasing.grantPurchasingRole(org,owner,purchasing.purchasingRoleInput.parse({version:1,client_reference:crypto.randomUUID(),account_id:reviewer,team_id:team,role:'approver',max_purchase:'10.00',expires_at:new Date(Date.now()+3600000).toISOString()}))
  await db.insert(schema.payout_addresses).values({user_id:seller,address:treasury})
  const [listing]=await db.insert(schema.listings).values({id:listingId,seller_id:seller,category:'code',title:'Original fixed-price listing',description:'PRIVATE_FROZEN_LISTING_REQUIREMENTS',price_bankr:1,status:'active'}).returning()
  await db.insert(schema.buyer_spend_policies).values({buyer_id:buyer,owner_account_id:owner,policy_json:'{"approval_required_above":50,"max_per_execution":500}',version:1,created_at:now,updated_at:now})
  const body={version:tempo?2:1,client_reference:crypto.randomUUID(),listing_id:listingId,buyer_agent_id:buyerAgent,delivery:{output_format:'json',acceptance_criteria:[],required_json_keys:['result'],minimum_sources:0},reviewer_role_id:role.role.id,expected_total:'1.05',max_daily:'10.00',max_monthly:'10.00',max_lifetime:'10.00',max_lifetime_chain_fee_units:tempo?'50000':'1000000000000000',expires_at:new Date(Date.now()+600000).toISOString(),expected_token_decimals:6,expected_token_usd_price:1,
    payment:tempo?{rail:'mpp',chain_id:4217,token_address:tempoToken,payer_address:`0x${'11'.repeat(20)}`,treasury_address:treasury,minimum_token_reserve_units:'1000000',fee_token_address:tempoToken,minimum_fee_token_reserve_units:'1000000',max_fee_token_cost_units:'5000'}:{rail:'evm',chain_id:1,token_address:token,payer_address:`0x${'11'.repeat(20)}`,treasury_address:treasury,minimum_token_reserve_units:'1000000',minimum_native_reserve_wei:'1000000',max_gas_cost_wei:'100000000000000'}}
  const prefix=`/api/organizations/${org}/listing-authorizations`
  return {org,owner,reviewer,other,buyer,seller,buyerAgent,providerAgent,team,listing,body,prefix,roleId:role.role.id}
}
