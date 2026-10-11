import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let collection: typeof import('@/app/api/organizations/[id]/route-authorizations/route')
let item: typeof import('@/app/api/organizations/[id]/route-authorizations/[authorizationId]/route')
let approval: typeof import('@/app/api/organizations/[id]/route-authorizations/[authorizationId]/approval/route')
let execute: typeof import('@/app/api/routes/[id]/execute/route').POST
const treasuryKey = `0x${'99'.repeat(32)}` as const
const treasury = privateKeyToAccount(treasuryKey).address.toLowerCase()
const payer = privateKeyToAccount(`0x${'11'.repeat(32)}`).address.toLowerCase()
const token = `0x${'44'.repeat(20)}`
const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } }
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-organization-route-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'routes.db')}`, TURSO_AUTH_TOKEN: '',
    JWT_SECRET: 'organization-route-tests-only', TREASURY_ADDRESS: treasury, EVM_SETTLEMENT_PRIVATE_KEY: treasuryKey,
    CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true', CLAWDMARKET_REUSABLE_SERVICES_ENABLED: 'true',
    CLAWDMARKET_ROUTE_PLANNING_ENABLED: 'true', CLAWDMARKET_ROUTE_EXECUTION_ENABLED: 'true',
    EVM_ACCEPTED_TOKENS: JSON.stringify([{chainId:1,chainName:'Owned route L1 fixture',address:token,symbol:'USDC',decimals:6,fixedUsdPrice:1,confirmations:1,rpcUrl:'https://rpc.example.invalid'}]) })
  delete process.env.MPP_SECRET_KEY; delete process.env.MPP_SECRET_KEY_CURRENT
  db=(await import('@/lib/db')).db; schema=await import('@/lib/schema'); await createLocalTestSchema(db.$client,schema)
  jwt=(await import('@/lib/auth')).generateJWT
  collection=await import('@/app/api/organizations/[id]/route-authorizations/route')
  item=await import('@/app/api/organizations/[id]/route-authorizations/[authorizationId]/route')
  approval=await import('@/app/api/organizations/[id]/route-authorizations/[authorizationId]/approval/route')
  execute=(await import('@/app/api/routes/[id]/execute/route')).POST
})
after(async () => {db?.$client.close();if(directory)await rm(directory,{recursive:true,force:true})})
function request(path:string,actor:string,method:string,body?:unknown) {
  return new NextRequest(`http://localhost${path}`,{method,headers:{Authorization:`Bearer ${jwt({userId:actor,email:`${actor}@test.invalid`,role:'human'})}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
}
async function fixture() {
  const id=crypto.randomUUID(),agent=crypto.randomUUID(),owner=`owner-${id}`,reviewer=`reviewer-${id}`,other=`other-${id}`,seller=`seller-${id}`,buyer=`user_agent_${agent}`,service=crypto.randomUUID(),team=crypto.randomUUID(),now=new Date()
  await db.insert(schema.users).values([owner,reviewer,other,seller,buyer].map(id=>({id,name:id,email:`${id}@test.invalid`,password_hash:'unused'})))
  await db.insert(schema.agents).values({id:agent,name:'Reviewed route buyer',description:'Owned route fixture',capabilities:'["code-review"]',endpoint:'https://example.invalid',owner_address:'',api_key:'unused'})
  await db.insert(schema.agent_owners).values({agentId:agent,userId:owner,establishedBy:'test'})
  await db.insert(schema.organizations).values({id,owner_account_id:owner,client_reference:id,name:'Reviewed route organization',created_at:now,updated_at:now})
  await db.insert(schema.organization_teams).values({id:team,organization_id:id,slug:'review',name:'Review department',created_at:now,updated_at:now})
  await db.insert(schema.organization_agent_assignments).values({agent_id:agent,organization_id:id,team_id:team,cost_center:'REVIEW',assigned_at:now,updated_at:now})
  const memberships=await import('@/lib/organization-membership')
  for(const account of [reviewer,other]) {
    const invited=await memberships.createOrganizationInvitation(id,owner,account,crypto.randomUUID());assert.equal(invited.kind,'ok')
    if(invited.kind!=='ok')throw Error('Invitation failed')
    assert.equal((await memberships.acceptOrganizationInvitation(invited.invitation_id!,account)).kind,'ok')
  }
  const purchasing=await import('@/lib/organization-purchasing')
  const role=await purchasing.grantPurchasingRole(id,owner,purchasing.purchasingRoleInput.parse({version:1,client_reference:crypto.randomUUID(),account_id:reviewer,team_id:team,role:'approver',max_purchase:'2.00',expires_at:new Date(Date.now()+3600_000).toISOString()}))
  await db.insert(schema.payout_addresses).values({user_id:seller,address:treasury})
  await db.insert(schema.service_definitions).values({id:service,seller_id:seller,title:'Reviewed route review',description:'Return structured findings from private code.',capabilities:'["code-review"]',price_minor:100,status:'active',provider_protocol:'leased_v1',estimated_latency_seconds:30,max_concurrency:5,output_schema:'{"type":"object","required":["result"],"properties":{"result":{"type":"string"}}}',verification_policy:JSON.stringify(policy)})
  await db.insert(schema.buyer_spend_policies).values({buyer_id:buyer,owner_account_id:owner,policy_json:'{"approval_required_above":50,"max_per_execution":200}',version:1,created_at:now,updated_at:now})
  const plan=(await import('@/app/api/routes/plan/route')).POST
  const r=await plan(request('/api/routes/plan',buyer,'POST',{client_reference:crypto.randomUUID(),objective:'Review the exact private code with an approved provider',required_capabilities:['code-review'],input:{secret:'original-private-route'},max_budget:{amount:'2.00',currency:'USD'},verification:policy,provider_requirements:{approved_providers:[seller]},payment_policy:{allowed_rails:['evm']}}))
  assert.equal(r.status,201,JSON.stringify(await r.clone().json()));const route=(await r.json()).route;assert.equal(route.candidates.length,1)
  const body={version:1,client_reference:crypto.randomUUID(),route_id:route.id,reviewer_role_id:role.role.id,max_daily:'2.00',max_monthly:'2.00',max_lifetime:'2.00',max_lifetime_gas_cost_wei:'100000000000000',mandate:{version:1,client_reference:crypto.randomUUID(),max_aggregate:'2.00',max_per_execution:'2.00',max_retry_budget:'0.00',max_attempts:1,approved_providers:[seller],max_latency_seconds:60,private_data:'selected_provider_only',expires_at:new Date(Date.now()+600_000).toISOString(),payment:{rail:'evm',chain_id:1,token_address:token,payer_address:payer,treasury_address:treasury,minimum_token_reserve_units:'1000000',minimum_native_reserve_wei:'1000000000000',max_gas_cost_wei:'100000000000000'}}}
  return {id,agent,owner,reviewer,other,seller,buyer,service,team,body,routeId:route.id as string,roleId:role.role.id,prefix:`/api/organizations/${id}/route-authorizations`}
}
type Fixture=Awaited<ReturnType<typeof fixture>>
const ctx=(f:Fixture,authorizationId?:string)=>({params:Promise.resolve({id:f.id,authorizationId:authorizationId!})})
async function propose(f:Fixture) {
  const r=await collection.POST(request(f.prefix,f.owner,'POST',f.body),ctx(f));assert.equal(r.status,201,JSON.stringify(await r.clone().json()));return(await r.json()).authorization
}
async function approve(f:Fixture,a:Awaited<ReturnType<typeof propose>>) {
  const body={version:1,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash,approve:true}
  const r=await approval.POST(request(`${f.prefix}/${a.id}/approval`,f.reviewer,'POST',body),ctx(f,a.id));assert.equal(r.status,201,JSON.stringify(await r.clone().json()));return body
}
const run=(f:Fixture,mandateId:string)=>execute(request(`/api/routes/${f.routeId}/execute`,f.buyer,'POST',{mandate_id:mandateId}),{params:Promise.resolve({id:f.routeId})})
test('owner proposal is inert until the selected independent reviewer approves the original hash; races consume exactly once',async()=>{
  const f=await fixture(),a=await propose(f)
  assert.equal(a.state,'pending');assert.equal(a.mandate.terms.max_aggregate,'2.00')
  const pending=await run(f,a.mandate.id);assert.equal(pending.status,409);assert.equal((await pending.json()).error_code,'ORGANIZATION_ROUTE_APPROVAL_REQUIRED')
  const owner=await approval.POST(request(`${f.prefix}/${a.id}/approval`,f.owner,'POST',{version:1,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash,approve:true}),ctx(f,a.id));assert.equal(owner.status,403)
  await approve(f,a)
  const races=await Promise.all([run(f,a.mandate.id),run(f,a.mandate.id)])
  assert.deepEqual(races.map(r=>r.status).sort(),[200,201])
  const [one,two]=await Promise.all(races.map(r=>r.json()));assert.equal(one.order.id,two.order.id)
  const uses=await db.select().from(schema.organization_route_uses).where(eq(schema.organization_route_uses.authorization_id,a.id));assert.equal(uses.length,1);assert.equal(uses[0].amount_minor,105)
  const [service]=await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id,f.service));assert.equal(service.active_orders,1)
})
test('private inspection rejects other members, buyer credentials and anonymous callers; cookie mutations require CSRF',async()=>{
  const f=await fixture(),a=await propose(f)
  for(const actor of [f.other,f.buyer]) {const r=await item.GET(request(`${f.prefix}/${a.id}`,actor,'GET'),ctx(f,a.id));assert.ok([401,404].includes(r.status));assert.ok(!(await r.text()).includes('original-private-route'))}
  const r=await item.GET(request(`${f.prefix}/${a.id}`,f.reviewer,'GET'),ctx(f,a.id));assert.equal(r.status,200);assert.match(r.headers.get('cache-control')!,/private.*no-store/)
  const cookie=new NextRequest('http://localhost'+f.prefix,{method:'POST',headers:{Cookie:`auth-token=${jwt({userId:f.owner,email:`${f.owner}@test.invalid`,role:'human'})}`,'Content-Type':'application/json'},body:JSON.stringify(f.body)})
  assert.equal((await collection.POST(cookie,ctx(f))).status,403)
})
test('original proposal and decision references recover without new authority and cannot be substituted or reopen revocation',async()=>{
  const f=await fixture(),a=await propose(f),decision=await approve(f,a)
  assert.equal((await collection.POST(request(f.prefix,f.owner,'POST',f.body),ctx(f))).status,200)
  const changed=await collection.POST(request(f.prefix,f.owner,'POST',{...f.body,max_lifetime:'3.00'}),ctx(f));assert.equal((await changed.json()).error_code,'ORGANIZATION_ROUTE_REFERENCE_CONFLICT')
  const revoked=await item.DELETE(request(`${f.prefix}/${a.id}`,f.reviewer,'DELETE'),ctx(f,a.id));assert.equal(revoked.status,200)
  const replay=await approval.POST(request(`${f.prefix}/${a.id}/approval`,f.reviewer,'POST',decision),ctx(f,a.id));assert.equal(replay.status,200);assert.equal((await replay.json()).authorization.state,'revoked')
  const r=await run(f,a.mandate.id);assert.equal((await r.json()).error_code,'ORGANIZATION_ROUTE_APPROVAL_REQUIRED')
})
test('route input, candidate contract, membership and department changes fail closed before any economic commitment',async()=>{
  for(const mutation of ['input','service','membership','department']as const){
    const f=await fixture(),a=await propose(f);await approve(f,a)
    if(mutation==='input')await db.update(schema.route_plans).set({input_json:'{"secret":"changed-private-route"}'}).where(eq(schema.route_plans.id,f.routeId))
    if(mutation==='service')await db.update(schema.service_definitions).set({output_schema:'{"type":"string"}'}).where(eq(schema.service_definitions.id,f.service))
    if(mutation==='membership')await db.update(schema.organization_memberships).set({status:'revoked'}).where(eq(schema.organization_memberships.account_id,f.reviewer))
    if(mutation==='department')await db.update(schema.organization_teams).set({status:'archived'}).where(eq(schema.organization_teams.id,f.team))
    const r=await run(f,a.mandate.id);assert.ok(r.status>=400,mutation)
    assert.equal((await db.select().from(schema.organization_route_uses).where(eq(schema.organization_route_uses.authorization_id,a.id))).length,0,mutation)
    const [service]=await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id,f.service));assert.equal(service.active_orders,0,mutation)
  }
})
