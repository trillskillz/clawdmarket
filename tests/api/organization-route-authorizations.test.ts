import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
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
  const routeRequest={client_reference:crypto.randomUUID(),objective:'Review the exact private code with an approved provider',required_capabilities:['code-review'],input:{secret:'original-private-route'},max_budget:{amount:'2.00',currency:'USD'},verification:policy,provider_requirements:{approved_providers:[seller]},payment_policy:{allowed_rails:['evm']}}
  const r=await plan(request('/api/routes/plan',buyer,'POST',routeRequest))
  assert.equal(r.status,201,JSON.stringify(await r.clone().json()));const route=(await r.json()).route;assert.equal(route.candidates.length,0,'ordinary planning cannot bypass the approval threshold')
  const body={version:1,client_reference:crypto.randomUUID(),agent_id:agent,route_request:{...routeRequest,client_reference:crypto.randomUUID()},reviewer_role_id:role.role.id,max_daily:'2.00',max_monthly:'2.00',max_lifetime:'2.00',max_lifetime_gas_cost_wei:'100000000000000',mandate:{version:1,client_reference:crypto.randomUUID(),max_aggregate:'2.00',max_per_execution:'2.00',max_retry_budget:'0.00',max_attempts:1,approved_providers:[seller],max_latency_seconds:60,private_data:'selected_provider_only',expires_at:new Date(Date.now()+600_000).toISOString(),payment:{rail:'evm',chain_id:1,token_address:token,payer_address:payer,treasury_address:treasury,minimum_token_reserve_units:'1000000',minimum_native_reserve_wei:'1000000000000',max_gas_cost_wei:'100000000000000'}}}
  return {id,agent,owner,reviewer,other,seller,buyer,service,team,body,routeId:route.id as string,roleId:role.role.id,prefix:`/api/organizations/${id}/route-authorizations`}
}
type Fixture=Awaited<ReturnType<typeof fixture>>
const ctx=(f:Fixture,authorizationId?:string)=>({params:Promise.resolve({id:f.id,authorizationId:authorizationId!})})
async function propose(f:Fixture) {
  const r=await collection.POST(request(f.prefix,f.owner,'POST',f.body),ctx(f));assert.equal(r.status,201,JSON.stringify(await r.clone().json()));const a=(await r.json()).authorization;f.routeId=a.route_id;return a
}
async function approve(f:Fixture,a:Awaited<ReturnType<typeof propose>>) {
  const body={version:1,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash,approve:true}
  const r=await approval.POST(request(`${f.prefix}/${a.id}/approval`,f.reviewer,'POST',body),ctx(f,a.id));assert.equal(r.status,201,JSON.stringify(await r.clone().json()));return body
}
const run=(f:Fixture,mandateId:string)=>execute(request(`/api/routes/${f.routeId}/execute`,f.buyer,'POST',{mandate_id:mandateId}),{params:Promise.resolve({id:f.routeId})})
test('owner proposal is inert until the selected independent reviewer approves the original hash; races consume exactly once',async()=>{
  const f=await fixture(),a=await propose(f)
  assert.equal(a.state,'pending');assert.equal(a.mandate.terms.max_aggregate,'2.00')
  assert.equal(a.route.candidates[0].eligibility.requirements_satisfied,false)
  assert.equal(a.route.candidates[0].eligibility.approval_required,true)
  assert.equal(a.route.candidates[0].reputation_ranking.policy_version,'reputation-v2-ranking-1')
  const pending=await run(f,a.mandate.id);assert.equal(pending.status,409);assert.equal((await pending.json()).error_code,'ORGANIZATION_ROUTE_APPROVAL_REQUIRED')
  const owner=await approval.POST(request(`${f.prefix}/${a.id}/approval`,f.owner,'POST',{version:1,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash,approve:true}),ctx(f,a.id));assert.equal(owner.status,403)
  await approve(f,a)
  const races=await Promise.all([run(f,a.mandate.id),run(f,a.mandate.id)])
  assert.deepEqual(races.map(r=>r.status).sort(),[200,201])
  const [one,two]=await Promise.all(races.map(r=>r.json()));assert.equal(one.order.id,two.order.id)
  const uses=await db.select().from(schema.organization_route_uses).where(eq(schema.organization_route_uses.authorization_id,a.id));assert.equal(uses.length,1);assert.equal(uses[0].amount_minor,105)
  const [service]=await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id,f.service));assert.equal(service.active_orders,1)
})
test('different reviewed grants race under shared gross, gas and department ceilings without duplicate exposure',async()=>{
  for(const limit of ['gross','gas','department'] as const){
    const f=await fixture(),second={...f,body:structuredClone(f.body)}
    for(const candidate of [f,second]) {
      candidate.body.max_daily=limit==='gross'?'2.00':'4.00'
      candidate.body.max_monthly=candidate.body.max_daily;candidate.body.max_lifetime=candidate.body.max_daily
      candidate.body.max_lifetime_gas_cost_wei=limit==='gas'?'100000000000000':'200000000000000'
    }
    second.body.client_reference=crypto.randomUUID();second.body.route_request.client_reference=crypto.randomUUID();second.body.mandate.client_reference=crypto.randomUUID()
    const one=await propose(f),two=await propose(second);await approve(f,one);await approve(second,two)
    if(limit==='department') {
      const now=new Date()
      await db.insert(schema.organization_team_budgets).values({team_id:f.team,organization_id:f.id,max_daily_minor:200,max_monthly_minor:200,version:1,created_at:now,updated_at:now})
    }
    const results=await Promise.all([run(f,one.mandate.id),run(second,two.mandate.id)])
    assert.equal(results.filter(result=>result.status===201).length,1,limit)
    assert.equal(results.filter(result=>result.status>=400).length,1,limit)
    const stored=await db.select().from(schema.organization_route_uses)
    assert.equal(stored.filter(use=>[one.id,two.id].includes(use.authorization_id)).length,1,limit)
    const [service]=await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id,f.service));assert.equal(service.active_orders,1,limit)
    const loser=results[0].status>=400?one:two
    assert.equal((await db.select().from(schema.route_funding_steps).where(eq(schema.route_funding_steps.route_id,loser.route_id))).length,0,limit)
    assert.equal((await db.select().from(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.id,loser.mandate.id)))[0].reserved_minor,0,limit)
  }
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
    if(mutation==='input'){
      const inspection=await item.GET(request(`${f.prefix}/${a.id}`,f.reviewer,'GET'),ctx(f,a.id))
      assert.equal(inspection.status,409);assert.equal((await inspection.json()).error_code,'ORGANIZATION_ROUTE_SCOPE_CHANGED')
    }
    const r=await run(f,a.mandate.id);assert.ok(r.status>=400,mutation)
    assert.equal((await db.select().from(schema.organization_route_uses).where(eq(schema.organization_route_uses.authorization_id,a.id))).length,0,mutation)
    const [service]=await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id,f.service));assert.equal(service.active_orders,0,mutation)
  }
})

test('private review defers only approval and atomically refuses every other buyer restriction',async()=>{
  for(const policy of [
    {max_per_execution:100}, {approved_providers:['another-provider']}, {blocked_providers:true},
    {approved_payment_rails:['mpp']}, {allowed_capabilities:['translation']}, {blocked_capabilities:['code-review']},
    {required_verification_methods:['source_urls']}, {provider_requirements:{minimum_accepted_completions:1}},
  ]) {
    const f=await fixture()
    const extra={...policy,...(policy.blocked_providers?{blocked_providers:[f.seller]}:{})}
    await db.update(schema.buyer_spend_policies).set({policy_json:JSON.stringify({approval_required_above:50,...extra})}).where(eq(schema.buyer_spend_policies.buyer_id,f.buyer))
    const r=await collection.POST(request(f.prefix,f.owner,'POST',f.body),ctx(f))
    assert.equal(r.status,409,JSON.stringify(extra))
    assert.equal((await r.json()).error_code,'ORGANIZATION_ROUTE_CANDIDATES_INVALID')
    assert.equal((await db.select().from(schema.route_plans).where(eq(schema.route_plans.client_reference,f.body.route_request.client_reference))).length,0)
    assert.equal((await db.select().from(schema.organization_route_authorizations).where(eq(schema.organization_route_authorizations.organization_id,f.id))).length,0)
  }
})

test('only the current linked organization owner can propose; failed reviewer validation rolls back the private plan',async()=>{
  const f=await fixture()
  for(const actor of [f.other,f.reviewer,f.buyer]) {
    const r=await collection.POST(request(f.prefix,actor,'POST',f.body),ctx(f));assert.ok([401,404].includes(r.status))
    assert.doesNotMatch(await r.text(),/original-private-route/)
  }
  await db.update(schema.organization_purchasing_roles).set({state:'revoked'}).where(eq(schema.organization_purchasing_roles.id,f.roleId))
  const r=await collection.POST(request(f.prefix,f.owner,'POST',f.body),ctx(f));assert.ok(r.status>=400)
  assert.equal((await db.select().from(schema.route_plans).where(eq(schema.route_plans.client_reference,f.body.route_request.client_reference))).length,0)
  assert.equal((await db.select().from(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.client_reference,f.body.mandate.client_reference))).length,0)
})

test('independent proposal and decision processes recover one frozen authority and cannot duplicate economic consumption',async()=>{
  const f=await fixture(),runFile=promisify(execFile)
  const code=`(async()=>{const d=await import('./lib/organization-route-authorizations.ts'),a=JSON.parse(process.argv[1]);
    const r=a.operation==='propose'?await d.proposeOrganizationRoute(a.org,a.actor,d.organizationRouteInput.parse(a.body)):await d.approveOrganizationRoute(a.org,a.id,a.actor,d.organizationRouteDecision.parse(a.body));
    console.log(JSON.stringify(r));(await import('./lib/db.ts')).db.$client.close()})().catch(e=>{console.error(e);process.exitCode=1})`
  const race=async(args:unknown)=>Promise.all(Array.from({length:3},async()=>JSON.parse((await runFile(process.execPath,['--conditions=react-server','--import','tsx','-e',code,JSON.stringify(args)],{cwd:process.cwd(),env:process.env,timeout:30000})).stdout)))
  const proposals=await race({operation:'propose',org:f.id,actor:f.owner,body:f.body})
  assert.equal(new Set(proposals.map(p=>p.authorization.id)).size,1)
  assert.equal(new Set(proposals.map(p=>p.authorization.route_id)).size,1)
  const a=proposals[0].authorization;f.routeId=a.route_id
  const decisions=await race({operation:'approve',org:f.id,id:a.id,actor:f.reviewer,body:{version:1,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash,approve:true}})
  assert.equal(new Set(decisions.map(p=>p.authorization.authority_hash)).size,1)
  const results=await Promise.all([run(f,a.mandate.id),run(f,a.mandate.id)])
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201])
  assert.equal((await db.select().from(schema.organization_route_uses).where(eq(schema.organization_route_uses.authorization_id,a.id))).length,1)
})

test('SIGKILL before and after original proposal, approval and economic commits preserves exact recovery and atomic rollback',async()=>{
  for(const operation of ['propose','approve','reserve']as const)for(const boundary of ['before','after']as const){
    const f=await fixture();let a:Awaited<ReturnType<typeof propose>>|undefined
    if(operation!=='propose')a=await propose(f)
    if(operation==='reserve'){
      await approve(f,a!)
      await db.update(schema.route_plans).set({state:'reserving'}).where(eq(schema.route_plans.id,f.routeId))
      await (await import('@/lib/route-attempts')).beginRouteAttempt(f.routeId,1,f.service)
    }
    const body=operation==='propose'?f.body:{version:1,client_reference:crypto.randomUUID(),authority_hash:a!.authority_hash,approve:true}
    const marker=join(directory,`${operation}-${boundary}-${f.id}.marker`)
    const args={operation,boundary,f,a,body}
    const code=`(async()=>{const a=JSON.parse(process.argv[1]),{writeFile}=await import('node:fs/promises');const stop=async()=>{await writeFile(process.argv[2],'reached');await new Promise(()=>{})};
      const {db}=await import('./lib/db.ts'),schema=await import('./lib/schema.ts'),{eq}=await import('drizzle-orm');
      if(a.boundary==='before'){const proto=Object.getPrototypeOf(db.session),original=proto.transaction;proto.transaction=function(fn,c){return original.call(this,async tx=>{const r=await fn(tx);
        if(a.operation!=='reserve'||(await tx.select().from(schema.organization_route_uses).where(eq(schema.organization_route_uses.authorization_id,a.a.id))).length)await stop();return r},c)}}
      const d=await import('./lib/organization-route-authorizations.ts');
      if(a.operation==='propose')await d.proposeOrganizationRoute(a.f.id,a.f.owner,d.organizationRouteInput.parse(a.body));
      else if(a.operation==='approve')await d.approveOrganizationRoute(a.f.id,a.a.id,a.f.reviewer,d.organizationRouteDecision.parse(a.body));
      else {const {reserveServiceOrder}=await import('./lib/service-order-reservation.ts'),{serviceOrderInput}=await import('./lib/service-definitions.ts');await reserveServiceOrder({serviceId:a.f.service,principal:{userId:a.f.buyer,agentId:a.f.agent,kind:'registered-agent',usesCookieAuth:false},routeId:a.f.routeId,attemptNumber:1,externalOnly:true,expectedSellerId:a.f.seller,mandateId:a.a.mandate.id,request:serviceOrderInput.parse({client_reference:'route:'+a.f.routeId+':attempt:1',objective:a.a.route.objective,input:a.a.route.input,payment_rail:'evm',max_total:'2.00',expected_price:'1.00',provider_requirements:a.a.route.provider_requirements})})}
      await stop()})().catch(e=>{console.error(e);process.exitCode=1})`
    const child=spawn(process.execPath,['--conditions=react-server','--import','tsx','-e',code,JSON.stringify(args),marker],{cwd:process.cwd(),env:process.env,stdio:['ignore','ignore','pipe']})
    let errors='';child.stderr.on('data',chunk=>{errors+=chunk});const exited=new Promise<void>((done,reject)=>{child.once('exit',()=>done());child.once('error',reject)})
    try{
      let reached=false;for(let wait=0;wait<150;wait++){try{await readFile(marker);reached=true;break}catch{}if(child.exitCode!==null)throw Error(errors);await new Promise(done=>setTimeout(done,100))}
      assert.equal(reached,true,errors);child.kill('SIGKILL');await exited
      const grants=await db.select().from(schema.organization_route_authorizations).where(eq(schema.organization_route_authorizations.organization_id,f.id))
      if(operation==='propose')assert.equal(grants.length,boundary==='before'?0:1)
      if(operation==='approve')assert.equal(grants[0].state,boundary==='before'?'pending':'approved')
      if(operation==='reserve'){
        assert.equal((await db.select().from(schema.organization_route_uses).where(eq(schema.organization_route_uses.authorization_id,a!.id))).length,boundary==='before'?0:1)
        assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id,f.service)))[0].active_orders,boundary==='before'?0:1)
      }
      const recovered=await collection.POST(request(f.prefix,f.owner,'POST',f.body),ctx(f));assert.ok([200,201].includes(recovered.status),await recovered.clone().text())
      const original=(await recovered.json()).authorization;f.routeId=original.route_id
      if(grants.length)assert.equal(original.id,grants[0].id)
      const decision=operation==='approve'?body:{version:1,client_reference:grants[0]?.decision_reference??crypto.randomUUID(),authority_hash:original.authority_hash,approve:true}
      const approved=await approval.POST(request(`${f.prefix}/${original.id}/approval`,f.reviewer,'POST',decision),ctx(f,original.id));assert.ok([200,201].includes(approved.status),await approved.clone().text())
      const reserved=await run(f,original.mandate.id);assert.ok([200,201].includes(reserved.status),await reserved.clone().text())
      assert.equal((await db.select().from(schema.organization_route_uses).where(eq(schema.organization_route_uses.authorization_id,original.id))).length,1)
    }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited}
  }
})
