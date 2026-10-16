import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { reviewedTaskFixture } from '../helpers/reviewed-task-fixture'

let directory:string,db:typeof import('@/lib/db').db,schema:typeof import('@/lib/schema'),jwt:typeof import('@/lib/auth').generateJWT
let collection:typeof import('@/app/api/organizations/[id]/task-authorizations/route'),item:typeof import('@/app/api/organizations/[id]/task-authorizations/[authorizationId]/route')
let approval:typeof import('@/app/api/organizations/[id]/task-authorizations/[authorizationId]/approval/route'),checkout:typeof import('@/app/api/organizations/[id]/task-authorizations/[authorizationId]/checkout/route')
const treasuryKey=`0x${'99'.repeat(32)}` as const,treasury=privateKeyToAccount(treasuryKey).address.toLowerCase(),token=`0x${'44'.repeat(20)}`
before(async()=>{
  directory=await mkdtemp(join(tmpdir(),'clawdmarket-workspace-test-task-authority-'))
  Object.assign(process.env,{TURSO_DATABASE_URL:`file:${join(directory,'authority.db')}`,TURSO_AUTH_TOKEN:'',JWT_SECRET:'task-authority-fixture-only',AGENT_API_KEY_PEPPER:'task-authority-pepper-fixture-only',TREASURY_ADDRESS:treasury,EVM_SETTLEMENT_PRIVATE_KEY:treasuryKey,
    MPP_RECIPIENT_ADDRESS:treasury,MPP_SECRET_KEY_CURRENT:'task-authority-mpp-fixture-only-secret',TEMPO_RPC_URL:'https://rpc.example.invalid',CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED:'true',CLAWDMARKET_ROUTE_EXECUTION_ENABLED:'true',CLAWDMARKET_REUSABLE_SERVICES_ENABLED:'true',
    EVM_ACCEPTED_TOKENS:JSON.stringify([{chainId:1,chainName:'Task authority fixture',address:token,symbol:'TEST',decimals:6,fixedUsdPrice:1,confirmations:1,rpcUrl:'https://rpc.example.invalid'}])})
  for(const name of ['VERCEL','VERCEL_ENV','CLAWDMARKET_NEW_PAYMENTS_PAUSED','DEV_WALLET_ADDRESS','DEV_FEE_WALLET_ADDRESS'])delete process.env[name]
  db=(await import('@/lib/db')).db;schema=await import('@/lib/schema');await createLocalTestSchema(db.$client,schema);jwt=(await import('@/lib/auth')).generateJWT
  collection=await import('@/app/api/organizations/[id]/task-authorizations/route');item=await import('@/app/api/organizations/[id]/task-authorizations/[authorizationId]/route')
  approval=await import('@/app/api/organizations/[id]/task-authorizations/[authorizationId]/approval/route');checkout=await import('@/app/api/organizations/[id]/task-authorizations/[authorizationId]/checkout/route')
})
after(async()=>{db?.$client.close();if(directory)await rm(directory,{recursive:true,force:true})})
const context=(id:string,authorizationId='')=>({params:Promise.resolve({id,authorizationId})})
const ownerToken=(actor:string)=>jwt({userId:actor,email:`${actor}@test.invalid`,role:'human'})
function request(path:string,actor:string,method='GET',body?:unknown){return bearer(path,ownerToken(actor),method,body)}
function bearer(path:string,key:string,method='GET',body?:unknown){return new NextRequest(`http://localhost${path}`,{method,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})}
function privateResponse(response:Response){assert.match(response.headers.get('cache-control')||'',/private.*no-store/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('vary')||'',/Authorization/)}
const fixture=(tempo=false,accountPoster=false)=>reviewedTaskFixture({db,schema},tempo,accountPoster)
type Fixture=Awaited<ReturnType<typeof fixture>>
async function propose(f:Fixture){const response=await collection.POST(request(f.prefix,f.owner,'POST',f.body),context(f.org));assert.equal(response.status,201,JSON.stringify(await response.clone().json()));privateResponse(response);return (await response.json()).authorization}
async function decide(f:Fixture,a:{id:string;authority_hash:string}){const body={version:f.body.version,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash,approve:true};const response=await approval.POST(request(`${f.prefix}/${a.id}/approval`,f.reviewer,'POST',body),context(f.org,a.id));assert.equal(response.status,201,JSON.stringify(await response.clone().json()));return body}

for(const tempo of [false,true])test(`reviewed ${tempo?'Tempo':'L1'} task APIs preserve independent owner/reviewer authority and deny read/private scope`,async()=>{
  const f=await fixture(tempo,tempo),a=await propose(f),path=`${f.prefix}/${a.id}`,ctx=context(f.org,a.id)
  assert.equal(a.terms.task.poster_agent_id,tempo?f.buyer:f.buyerAgent);assert.equal(a.buyer_id,f.buyer);assert.equal(a.terms.explicit_acceptance,true)
  assert.equal((await db.select().from(schema.organization_task_uses).where(eq(schema.organization_task_uses.authorization_id,a.id))).length,0)
  for(const actor of [f.owner,f.reviewer]){const response=await item.GET(request(path,actor),ctx);assert.equal(response.status,200);privateResponse(response);const inspected=(await response.json()).authorization;assert.equal(inspected.terms.workspace.requirements.acceptance_criteria[0],'PRIVATE_ORIGINAL_REQUIREMENTS');assert.equal(inspected.viewer_role,actor===f.owner?'owner':'reviewer')}
  for(const actor of [f.other,f.buyer,f.seller]){const response=await item.GET(request(path,actor),ctx);assert.ok([401,404].includes(response.status));privateResponse(response);assert.doesNotMatch(await response.text(),/PRIVATE_ORIGINAL/)}
  for(const actor of [f.reviewer,f.other,f.buyer]){const response=await collection.GET(request(f.prefix+`?client_reference=${f.body.client_reference}`,actor),context(f.org));assert.ok([401,404].includes(response.status));assert.doesNotMatch(await response.text(),/PRIVATE_ORIGINAL/)}
  const decision={version:f.body.version,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash,approve:true}
  const owner=await approval.POST(request(path+'/approval',f.owner,'POST',decision),ctx);assert.equal(owner.status,403)
  const pending=await checkout.POST(request(path+'/checkout',f.buyer,'POST',{version:f.body.version,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash}),ctx);assert.equal(pending.status,409)
  const named=await import('@/lib/agent-named-credentials'),read=await named.createNamedAgentCredential({agentId:f.buyerAgent,name:'Task read-only fixture',scopes:['agent:read'],actorCredentialId:null}),payment=await named.createNamedAgentCredential({agentId:f.buyerAgent,name:'Task payment fixture',scopes:['payments:write'],actorCredentialId:null})
  assert.equal(read.kind,'created');assert.equal(payment.kind,'created');if(read.kind!=='created'||payment.kind!=='created')throw Error('Credential fixture unavailable')
  for(const method of ['GET','POST']as const){const response:Response=await checkout[method](bearer(path+'/checkout',read.api_key,method,method==='POST'?{version:f.body.version,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash}:undefined),ctx);assert.equal(response.status,401);privateResponse(response);assert.doesNotMatch(await response.text(),/payer_address|PRIVATE_ORIGINAL/)}
  const scoped=await checkout.GET(bearer(path+'/checkout',payment.api_key),ctx);assert.equal(scoped.status,200);assert.equal((await scoped.json()).trade,null)
  const account=await (await import('@/lib/organization-service-accounts')).createOrganizationServiceAccount(f.org,f.owner,{client_reference:crypto.randomUUID(),name:'Read-only organization fixture',lifetime_days:1});assert.equal(account.kind,'ok');if(account.kind!=='ok'||!account.api_key)throw Error('Organization read fixture unavailable')
  for(const endpoint of [path,path+'/checkout']){const response:Response=endpoint.endsWith('/checkout')?await checkout.GET(bearer(endpoint,account.api_key),ctx):await item.GET(bearer(endpoint,account.api_key),ctx);assert.equal(response.status,401);assert.doesNotMatch(await response.text(),/PRIVATE_ORIGINAL|payer_address/)}
  await decide(f,a);assert.equal((await checkout.GET(request(path+'/checkout',f.owner),ctx)).status,404)
  const granted=await checkout.POST(bearer(path+'/checkout',payment.api_key,'POST',{version:f.body.version,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash}),ctx);assert.equal(granted.status,201,JSON.stringify(await granted.clone().json()));privateResponse(granted)
  const original=await granted.json();assert.equal(original.trade.buyer_id,f.buyer);assert.equal(original.trade.seller_id,f.seller);assert.equal(original.payment_authority.kind,tempo?'organization_task_v2':'organization_task_v1')
  assert.equal((await db.select().from(schema.organization_task_uses).where(eq(schema.organization_task_uses.authorization_id,a.id))).length,1)
})

test('task proposal and original decision replay survive revocation without changing frozen identities',async()=>{
  const f=await fixture(),a=await propose(f),ctx=context(f.org,a.id),path=`${f.prefix}/${a.id}`
  const lookup=await collection.GET(request(`${f.prefix}?client_reference=${f.body.client_reference}`,f.owner),context(f.org));assert.equal(lookup.status,200);assert.equal((await lookup.json()).authorization.id,a.id)
  const replay=await collection.POST(request(f.prefix,f.owner,'POST',f.body),context(f.org));assert.equal(replay.status,200);assert.equal((await replay.json()).authorization.id,a.id)
  const conflict=await collection.POST(request(f.prefix,f.owner,'POST',{...f.body,expected_total:'1.06'}),context(f.org));assert.equal(conflict.status,409)
  const decision=await decide(f,a),revoked=await item.DELETE(request(path,f.owner,'DELETE'),ctx);assert.equal(revoked.status,200)
  const exact=await approval.POST(request(path+'/approval',f.reviewer,'POST',decision),ctx);assert.equal(exact.status,200);assert.equal((await exact.json()).authorization.state,'revoked')
  const changed=await approval.POST(request(path+'/approval',f.reviewer,'POST',{...decision,client_reference:crypto.randomUUID()}),ctx);assert.equal(changed.status,409)
  const read=await item.GET(request(path,f.owner),ctx);assert.equal((await read.json()).authorization.terms.task.id,f.task)
})

test('task cookie mutations remain CSRF protected despite an invalid bearer and bounded bodies fail closed',async()=>{
  const f=await fixture(),token=ownerToken(f.owner)
  const bad=new NextRequest('http://localhost'+f.prefix,{method:'POST',headers:{Authorization:'Bearer invalid',Cookie:`auth-token=${token}`,'Content-Type':'application/json'},body:JSON.stringify(f.body)})
  assert.equal((await collection.POST(bad,context(f.org))).status,403)
  const csrf='task-cookie-fixture',valid=new NextRequest('http://localhost'+f.prefix,{method:'POST',headers:{Authorization:'Bearer invalid',Cookie:`auth-token=${token}; csrf-token=${csrf}`,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:JSON.stringify(f.body)})
  const saved=await collection.POST(valid,context(f.org));assert.equal(saved.status,201,JSON.stringify(await saved.clone().json()));const a=(await saved.json()).authorization
  const invalid=await approval.POST(request(`${f.prefix}/${a.id}/approval`,f.reviewer,'POST',{version:1,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash,approve:true,foreign_scope:'forbidden'}),context(f.org,a.id));assert.equal(invalid.status,400)
  const large=await collection.POST(request(f.prefix,f.owner,'POST',{...f.body,extra:'x'.repeat(17000)}),context(f.org));assert.equal(large.status,413);privateResponse(large)
  assert.equal((await db.select().from(schema.organization_task_authorizations).where(eq(schema.organization_task_authorizations.organization_id,f.org))).length,1)
})

test('task review loses private reviewer inspection when its original explicit role is revoked',async()=>{
  const f=await fixture(),a=await propose(f);await db.update(schema.organization_purchasing_roles).set({state:'revoked'}).where(eq(schema.organization_purchasing_roles.id,f.roleId))
  const response=await item.GET(request(`${f.prefix}/${a.id}`,f.reviewer),context(f.org,a.id));assert.ok(response.status>=400);assert.doesNotMatch(await response.text(),/PRIVATE_ORIGINAL/)
  assert.equal((await item.GET(request(`${f.prefix}/${a.id}`,f.owner),context(f.org,a.id))).status,200)
})

test('task checkout maps current buyer, agent and department limits to private conflicts with atomic rollback',async()=>{
  for(const restriction of ['buyer','agent','department']as const){
    const f=await fixture(),a=await propose(f);await decide(f,a)
    if(restriction==='buyer')await db.update(schema.buyer_spend_policies).set({policy_json:'{"max_daily":100}'}).where(eq(schema.buyer_spend_policies.buyer_id,f.buyer))
    if(restriction==='agent')process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD='1.00'
    if(restriction==='department'){
      const budget=await import('@/lib/organization-budgets'),team=await import('@/lib/organization-team-budgets')
      await team.updateTeamBudget(f.org,f.team,f.owner,budget.organizationBudgetInput.parse({expected_version:0,max_per_execution:'1.00',max_daily:'10.00',max_monthly:'10.00'}))
    }
    try{
      const response=await checkout.POST(request(`${f.prefix}/${a.id}/checkout`,f.buyer,'POST',{version:f.body.version,client_reference:crypto.randomUUID(),authority_hash:a.authority_hash}),context(f.org,a.id))
      assert.equal(response.status,409,restriction+JSON.stringify(await response.clone().json()));privateResponse(response)
      const body=await response.json();assert.equal(body.state,'no_funds_moved');assert.equal(body.retryable,false)
      assert.match(body.error_code,restriction==='buyer'?/BUYER_DAILY_LIMIT/:restriction==='agent'?/AGENT.*TRADE.*LIMIT/:/TEAM_PER_EXECUTION_LIMIT/)
      assert.equal((await db.select().from(schema.organization_task_uses).where(eq(schema.organization_task_uses.authorization_id,a.id))).length,0)
      assert.equal((await db.select().from(schema.task_workspaces).where(eq(schema.task_workspaces.task_id,f.task)))[0].trade_id,null)
      assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id,f.buyer))).length,0)
    }finally{if(restriction==='agent')delete process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD}
  }
})

test('a reviewer owning the accepted provider cannot independently authorize its task purchase',async()=>{
  const f=await fixture();await db.insert(schema.agent_owners).values({agentId:f.providerAgent,userId:f.reviewer,establishedBy:'fixture'})
  const response=await collection.POST(request(f.prefix,f.owner,'POST',f.body),context(f.org));assert.equal(response.status,403)
  assert.equal((await db.select().from(schema.organization_task_authorizations).where(eq(schema.organization_task_authorizations.organization_id,f.org))).length,0)
  assert.equal((await db.select().from(schema.task_workspaces).where(eq(schema.task_workspaces.task_id,f.task)))[0].trade_id,null)
})

for (const tempo of [false, true]) test(`${tempo ? 'Tempo' : 'L1'} approved task checkout rejects changed owner, bid, provider, requirements, quote, department and reviewer atomically`, async () => {
  for (const mutation of ['owner', 'bid', 'provider', 'requirements', 'quote', 'department', 'reviewer']) {
    const f = await fixture(tempo), a = await propose(f)
    await decide(f, a)
    if (mutation === 'owner') await db.update(schema.organizations).set({ owner_account_id: f.other }).where(eq(schema.organizations.id, f.org))
    if (mutation === 'bid') await db.update(schema.bids).set({ message: 'Changed the originally accepted proposal' }).where(eq(schema.bids.id, f.bid))
    if (mutation === 'provider') await db.update(schema.tasks).set({ assignedAgentId: f.buyerAgent }).where(eq(schema.tasks.id, f.task))
    if (mutation === 'requirements') await db.update(schema.task_workspaces).set({ required_json_keys: '["changed_output"]' }).where(eq(schema.task_workspaces.task_id, f.task))
    if (mutation === 'quote') await db.update(schema.task_workspaces).set({ agreed_price: 2 }).where(eq(schema.task_workspaces.task_id, f.task))
    if (mutation === 'department') await db.update(schema.organization_agent_assignments).set({ cost_center: 'CHANGED' }).where(eq(schema.organization_agent_assignments.agent_id, f.buyerAgent))
    if (mutation === 'reviewer') await (await import('@/lib/organization-purchasing')).revokePurchasingRole(f.org, f.owner, f.roleId)
    const response = await checkout.POST(request(`${f.prefix}/${a.id}/checkout`, f.buyer, 'POST', {
      version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash,
    }), context(f.org, a.id))
    assert.equal(response.status, mutation === 'reviewer' ? 403 : 409, `${mutation}: ${JSON.stringify(await response.clone().json())}`)
    assert.equal((await db.select().from(schema.organization_task_uses).where(eq(schema.organization_task_uses.authorization_id, a.id))).length, 0)
    assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))).length, 0)
    const [workspace] = await db.select().from(schema.task_workspaces).where(eq(schema.task_workspaces.task_id, f.task))
    assert.equal(workspace.trade_id, null)
  }
})
