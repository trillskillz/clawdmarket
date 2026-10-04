import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let core: typeof import('@/lib/instant-execution'), credit: typeof import('@/lib/account-credit')
let jwt: typeof import('@/lib/auth').generateJWT
let createService: typeof import('@/app/api/instant/services/route').POST
let sessions: typeof import('@/app/api/instant/services/[id]/sessions/route').POST
let calls: typeof import('@/app/api/instant/sessions/[id]/calls/route').POST
let readCall: typeof import('@/app/api/instant/calls/[id]/route').GET
let claim: typeof import('@/app/api/instant/calls/[id]/claim/route').POST
let result: typeof import('@/app/api/instant/calls/[id]/result/route').POST
const tokenAddress = `0x${'44'.repeat(20)}`, treasury = privateKeyToAccount(`0x${'22'.repeat(32)}`).address.toLowerCase()
const lease = 'instant-test-worker-token-32-characters-minimum'
const objectSchema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }
before(async () => {
 directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-instant-'))
 Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory,'instant.db')}`, TURSO_AUTH_TOKEN: '', JWT_SECRET: 'instant-tests-only', WEBHOOK_SECRET_KEY: 'instant-test-secret', CHAT_ENCRYPTION_KEY: 'instant-test-secret', TREASURY_ADDRESS: treasury, EVM_SETTLEMENT_PRIVATE_KEY: `0x${'22'.repeat(32)}`,
 EVM_ACCEPTED_TOKENS: JSON.stringify([{ chainId: 8453, chainName: 'Base fixture', address: tokenAddress, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: 'https://rpc.example.invalid' }]) })
 delete process.env.DEV_WALLET_ADDRESS; delete process.env.DEV_FEE_WALLET_ADDRESS; delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED; delete process.env.CLAWDMARKET_ROUTE_EXECUTION_PAUSED
 db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
 core = await import('@/lib/instant-execution'); credit = await import('@/lib/account-credit'); jwt = (await import('@/lib/auth')).generateJWT
 createService = (await import('@/app/api/instant/services/route')).POST
 sessions = (await import('@/app/api/instant/services/[id]/sessions/route')).POST
 calls = (await import('@/app/api/instant/sessions/[id]/calls/route')).POST
 readCall = (await import('@/app/api/instant/calls/[id]/route')).GET
 claim = (await import('@/app/api/instant/calls/[id]/claim/route')).POST
 result = (await import('@/app/api/instant/calls/[id]/result/route')).POST
})
after(() => { db?.$client.close(); if (directory) rmSync(directory,{ recursive:true, force:true }) })
async function user(minor = 0) {
 const id = crypto.randomUUID(); await db.insert(schema.users).values({ id, name:id, email:`${id}@test.invalid`, password_hash:'unused', role:'human' })
 if (minor) {
  // Pre-existing confirmed-deposit fixture. Incoming chain proofs are exercised by account-credit.test.ts.
  const depositId=crypto.randomUUID(), txHash=`0x${crypto.randomUUID().replaceAll('-','').repeat(2)}`, payer=`0x${'66'.repeat(20)}`
  await db.transaction(async tx => {
   await tx.insert(schema.credit_deposits).values({ id:depositId,user_id:id,client_reference:depositId,amount_minor:minor,payer,treasury,token:tokenAddress,chain_id:8453,tx_hash:txHash,payer_signature:'fixture-authoritative-proof',state:'confirmed',expires_at:new Date() })
   await tx.insert(schema.payment_receipts).values({route:'/api/wallet/deposits',payment_rail:'evm',amount:minor/100,currency:'USDC',tx_hash:txHash,payer_address:payer,token_address:tokenAddress,chain_id:8453,token_decimals:6,token_amount:String(minor*10000),external_id:depositId})
   await credit.changeCredit(tx,id,depositId,'deposit',minor,0)
  })
 }
 return id
}
function principal(userId: string) { return { userId, agentId:null, kind:'account' as const, usesCookieAuth:false } }
function request(path: string, userId: string, body?: unknown) { return new NextRequest(`http://localhost${path}`, { method:body===undefined?'GET':'POST',headers:{authorization:`Bearer ${jwt({userId,email:`${userId}@test.invalid`,role:'human'})}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}) }) }
const params=(id:string)=>({params:Promise.resolve({id})})
async function fixture(budget=10, concurrency=2, buyerMinor=100) {
 const seller=await user(),buyer=await user(buyerMinor)
 const response=await createService(request('/api/instant/services',seller,{title:'Instant deterministic transformation',capabilities:['code-review'],input_schema:objectSchema,output_schema:objectSchema,unit_price_minor:2,max_concurrency:concurrency,deadline_seconds:60}))
 assert.equal(response.status,201,JSON.stringify(await response.clone().json())); const service=(await response.json()).service
 const input={client_reference:crypto.randomUUID(),budget_minor:budget,expected_unit_price_minor:2,expires_in_seconds:3600,acceptance:'schema_v1' as const,payment_rail:'credit' as const}
 const session=(await core.openInstantSession(principal(buyer),service.id,input)).session
 return {seller,buyer,service,session,input}
}
async function call(f:Awaited<ReturnType<typeof fixture>>,ref=crypto.randomUUID()) { return (await core.createInstantCall(principal(f.buyer),f.session.id,{client_reference:ref,input:{text:'hello'}})).call }
async function health() { return (await import('@/lib/credit-health.mjs')).inspectCreditHealth(db.$client) }
async function settle(f:Awaited<ReturnType<typeof fixture>>,id:string) { await core.claimInstantCall(f.seller,id,lease); return core.completeInstantCall(f.seller,id,{outcome:'completed',lease_token:lease,output:{text:'done'}}) }

test('concurrent session replay funds once; changed authority conflicts; no contracted checkout is created',async()=>{
 const f=await fixture(); const responses=await Promise.all([core.openInstantSession(principal(f.buyer),f.service.id,f.input),core.openInstantSession(principal(f.buyer),f.service.id,f.input)])
 assert.deepEqual(responses.map(r=>r.idempotent),[true,true]);assert.equal(responses[0].session.id,f.session.id)
 assert.equal((await credit.creditBalance(f.buyer)).available_minor,90);assert.equal((await credit.creditBalance(f.buyer)).escrow_minor,0)
 assert.equal((await db.select().from(schema.trades)).length,0);assert.equal((await db.select().from(schema.service_orders)).length,0)
 await assert.rejects(core.openInstantSession(principal(f.buyer),f.service.id,{...f.input,budget_minor:12}),/IDEMPOTENCY_CONFLICT/)
 assert.equal((await health()).healthy,true)
})
test('historical wallet money and insufficient deposited credit cannot fund sessions',async()=>{
 const f=await fixture();const poor=await user();await db.insert(schema.wallets).values({user_id:poor,balance:1000000,escrow:0})
 await assert.rejects(core.openInstantSession(principal(poor),f.service.id,{...f.input,client_reference:crypto.randomUUID()}),/Insufficient deposited/)
 assert.equal((await db.select().from(schema.instant_sessions).where(eq(schema.instant_sessions.buyer_id,poor))).length,0)
})
test('duplicate call acceptance reserves one unit and conflicting input is rejected',async()=>{
 const f=await fixture();const ref=crypto.randomUUID(),input={client_reference:ref,input:{text:'hello'}}
 const [a,b]=await Promise.all([core.createInstantCall(principal(f.buyer),f.session.id,input),core.createInstantCall(principal(f.buyer),f.session.id,input)])
 assert.equal(a.call.id,b.call.id);assert.equal(a.idempotent,false);assert.equal(b.idempotent,true)
 assert.equal((await core.readInstantSession(f.buyer,f.session.id)).held_minor,2)
 await assert.rejects(core.createInstantCall(principal(f.buyer),f.session.id,{...input,input:{text:'changed'}}),/IDEMPOTENCY_CONFLICT/)
 assert.equal((await health()).healthy,true)
})
test('input, output, seller and lease are checked before one atomic charge and receipt',async()=>{
 const f=await fixture(); await assert.rejects(core.createInstantCall(principal(f.buyer),f.session.id,{client_reference:crypto.randomUUID(),input:{text:12}}),/INSTANT_INPUT_INVALID/)
 const c=await call(f);const stranger=await user()
 await assert.rejects(core.claimInstantCall(stranger,c.id,lease),/INSTANT_CALL_NOT_FOUND/)
 await assert.rejects(core.completeInstantCall(f.seller,c.id,{outcome:'completed',lease_token:lease,output:{text:'done'}}),/LEASE_REJECTED/)
 await core.claimInstantCall(f.seller,c.id,lease)
 await assert.rejects(core.claimInstantCall(f.seller,c.id,'another-long-worker-token-32-characters'),/LEASE_CONFLICT/)
 await assert.rejects(core.completeInstantCall(f.seller,c.id,{outcome:'completed',lease_token:lease,output:{text:12}}),/INSTANT_OUTPUT_INVALID/)
 assert.equal((await credit.creditBalance(f.seller)).available_minor,0)
 const command={outcome:'completed' as const,lease_token:lease,output:{text:'done'}}
 const results=await Promise.all([core.completeInstantCall(f.seller,c.id,command),core.completeInstantCall(f.seller,c.id,command)])
 assert.deepEqual(results.map(r=>r.idempotent),[false,true]);assert.deepEqual(results[0].call.receipt,results[1].call.receipt)
 assert.equal(results[0].call.receipt.units,1);assert.equal(results[0].call.receipt.amount_minor,2)
 assert.equal((await credit.creditBalance(f.seller)).available_minor,2)
 const session=await core.readInstantSession(f.buyer,f.session.id);assert.equal(session.spent_minor,2);assert.equal(session.balance_minor,8);assert.equal(session.held_minor,0)
 assert.equal((await db.select().from(schema.credit_entries).where(eq(schema.credit_entries.reference,c.id))).length,1)
 await assert.rejects(core.completeInstantCall(f.seller,c.id,{...command,output:{text:'changed'}}),/IDEMPOTENCY_CONFLICT/)
 assert.equal((await health()).healthy,true)
})
test('committed receipt and duplicate billing survive a new application process',async()=>{
 const f=await fixture(),c=await call(f);await settle(f,c.id)
 const command=`import { completeInstantCall } from './lib/instant-execution.ts'; import { db } from './lib/db.ts'; const r=await completeInstantCall(${JSON.stringify(f.seller)},${JSON.stringify(c.id)},{outcome:'completed',lease_token:${JSON.stringify(lease)},output:{text:'done'}}); console.log(JSON.stringify({idempotent:r.idempotent,receipt:r.call.receipt}));db.$client.close()`
 const child=spawnSync(process.execPath,['--conditions=react-server','--import','tsx','--input-type=module','-e',command],{cwd:process.cwd(),env:process.env,encoding:'utf8',timeout:20000})
 assert.equal(child.status,0,child.stderr);const recovered=JSON.parse(child.stdout.trim());assert.equal(recovered.idempotent,true);assert.equal(recovered.receipt.call_id,c.id)
 assert.equal((await credit.creditBalance(f.seller)).available_minor,2)
})
test('provider failure releases budget and duplicate failed calls never redispatch or bill',async()=>{
 const f=await fixture(2,1),ref=crypto.randomUUID(),c=await call(f,ref);await core.claimInstantCall(f.seller,c.id,lease)
 const failed=await core.completeInstantCall(f.seller,c.id,{outcome:'failed',lease_token:lease});assert.equal(failed.call.state,'failed');assert.equal(failed.call.receipt,null)
 const replay=await call(f,ref);assert.equal(replay.id,c.id);assert.equal(replay.state,'failed')
 const replacement=await call(f);await settle(f,replacement.id)
 await assert.rejects(call(f),/SESSION_BUDGET_EXHAUSTED/);assert.equal((await credit.creditBalance(f.seller)).available_minor,2)
 assert.equal((await health()).healthy,true)
})
test('capacity is bounded across buyer sessions and cannot be bypassed with duplicate requests',async()=>{
 const f=await fixture(10,1);const second=(await core.openInstantSession(principal(f.buyer),f.service.id,{...f.input,client_reference:crypto.randomUUID()})).session
 const c=await call(f)
 await assert.rejects(core.createInstantCall(principal(f.buyer),second.id,{client_reference:crypto.randomUUID(),input:{text:'hello'}}),/CAPACITY_FULL/)
 await settle(f,c.id);assert.equal((await core.createInstantCall(principal(f.buyer),second.id,{client_reference:crypto.randomUUID(),input:{text:'hello'}})).call.state,'pending')
})
test('closing cancels unclaimed calls and refunds remaining credit once',async()=>{
 const f=await fixture(),c=await call(f);const [a,b]=await Promise.all([core.readInstantSession(f.buyer,f.session.id,true),core.readInstantSession(f.buyer,f.session.id,true)])
 assert.equal(a.status,'closed');assert.equal(b.refunded_minor,10);assert.equal((await credit.creditBalance(f.buyer)).available_minor,100)
 assert.equal((await core.readInstantCall(f.buyer,c.id)).failure_code,'SESSION_CLOSED')
 await assert.rejects(call(f),/INSTANT_SESSION_CLOSED/);assert.equal((await health()).healthy,true)
})
test('closing keeps claimed authority bounded; recovery settles during payment/routing holds and returns unused budget',async()=>{
 const f=await fixture(),c=await call(f);await core.claimInstantCall(f.seller,c.id,lease)
 assert.equal((await core.readInstantSession(f.buyer,f.session.id,true)).status,'closing')
 process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED='true';process.env.CLAWDMARKET_ROUTE_EXECUTION_PAUSED='true'
 try {
  const replay=await core.createInstantCall(principal(f.buyer),f.session.id,{client_reference:c.client_reference,input:{text:'hello'}});assert.equal(replay.call.id,c.id)
  assert.equal((await core.completeInstantCall(f.seller,c.id,{outcome:'completed',lease_token:lease,output:{text:'done'}})).call.state,'completed')
  const closed=await core.readInstantSession(f.buyer,f.session.id);assert.equal(closed.status,'closed');assert.equal(closed.refunded_minor,8)
  assert.equal((await credit.creditBalance(f.buyer)).available_minor,98)
 }finally{delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED;delete process.env.CLAWDMARKET_ROUTE_EXECUTION_PAUSED}
 assert.equal((await health()).healthy,true)
})
test('expired claimed work cannot charge or execute again; expiry reconciles budget and sessions',async()=>{
 const f=await fixture(),c=await call(f);await core.claimInstantCall(f.seller,c.id,lease)
 await db.update(schema.instant_calls).set({deadline_at:new Date(0)}).where(eq(schema.instant_calls.id,c.id))
 await db.update(schema.instant_sessions).set({expires_at:new Date(0)}).where(eq(schema.instant_sessions.id,f.session.id))
 const late=await core.completeInstantCall(f.seller,c.id,{outcome:'completed',lease_token:lease,output:{text:'late'}})
 assert.equal(late.call.failure_code,'CALL_DEADLINE_EXCEEDED');assert.equal(late.call.receipt,null);assert.equal((await credit.creditBalance(f.seller)).available_minor,0)
 assert.equal((await core.readInstantSession(f.buyer,f.session.id)).refunded_minor,10)
 await core.reconcileInstantSessions();assert.equal((await health()).healthy,true)
})
test('session contract freezes provider pricing and schemas despite later definition edits',async()=>{
 const f=await fixture();await db.update(schema.instant_services).set({unit_price_minor:100,output_schema:JSON.stringify({type:'object',properties:{count:{type:'integer'}},required:['count']})}).where(eq(schema.instant_services.id,f.service.id))
 const c=await call(f);const completed=await settle(f,c.id);assert.equal(completed.call.receipt.amount_minor,2)
 await assert.rejects(core.openInstantSession(principal(f.buyer),f.service.id,{...f.input,client_reference:crypto.randomUUID()}),/PRICE_OR_BUDGET_MISMATCH/)
})
test('policy budgets count instant authority in ordinary purchases and across UTC windows; changed verification blocks new calls',async()=>{
 const f=await fixture();const policies=await import('@/lib/buyer-spend-policy')
 await db.insert(schema.buyer_spend_policies).values({buyer_id:f.buyer,owner_account_id:f.buyer,policy_json:JSON.stringify({max_daily:10}),version:1})
 const usage=await policies.buyerPolicyUsage(f.buyer);assert.equal(usage.reserved_or_spent_today_minor,10)
 await assert.rejects(db.transaction(tx=>policies.enforceBuyerSpendPolicy(tx,f.buyer,{totalMinor:1,paymentRail:'credit'})),/daily reservation limit/)
 await db.update(schema.instant_sessions).set({created_at:new Date(0)}).where(eq(schema.instant_sessions.id,f.session.id));assert.equal((await policies.buyerPolicyUsage(f.buyer)).reserved_or_spent_today_minor,10)
 await db.update(schema.buyer_spend_policies).set({policy_json:JSON.stringify({required_verification_methods:['buyer_review']})}).where(eq(schema.buyer_spend_policies.buyer_id,f.buyer))
 await assert.rejects(call(f),/Buyer policy blocks/)
})
test('private APIs hide other buyers, receipts and lease digests; cookie writes and oversized payloads are rejected',async()=>{
 const f=await fixture(),c=await call(f),stranger=await user()
 assert.equal((await readCall(request(`/api/instant/calls/${c.id}`,stranger),params(c.id))).status,404)
 const own=await readCall(request(`/api/instant/calls/${c.id}`,f.buyer),params(c.id));assert.equal(own.headers.get('cache-control'),'private, no-store');assert.equal('lease_token_hash' in (await own.json()).call,false)
 const cookie=new NextRequest(`http://localhost/api/instant/sessions/${f.session.id}/calls`,{method:'POST',headers:{cookie:`auth-token=${jwt({userId:f.buyer,email:'test@test.invalid',role:'human'})}`,authorization:'Bearer invalid','Content-Type':'application/json'},body:JSON.stringify({client_reference:crypto.randomUUID(),input:{text:'hello'}})})
 assert.equal((await calls(cookie,params(f.session.id))).status,403)
 assert.equal((await calls(request(`/api/instant/sessions/${f.session.id}/calls`,f.buyer,{client_reference:crypto.randomUUID(),input:{text:'a'.repeat(13000)}}),params(f.session.id))).status,413)
 const started=await claim(request(`/api/instant/calls/${c.id}/claim`,f.seller,{lease_token:lease}),params(c.id));assert.equal(started.status,200)
 assert.equal((await result(request(`/api/instant/calls/${c.id}/result`,f.seller,{outcome:'completed',lease_token:lease,output:{text:'done'}}),params(c.id))).status,200)
})
test('credential scope grants read access without instant spending authorization',async()=>{
 const auth=await import('@/lib/registered-agent-auth');const f=await fixture();const agentId=crypto.randomUUID(),key='clawd_instant_scoped_dummy_key'
 await db.insert(schema.agents).values({id:agentId,name:'Instant scope fixture',description:'Fixture agent',capabilities:'["code-review"]',endpoint:'https://example.invalid',owner_address:`0x${'77'.repeat(20)}`,status:'active',visibility:'public',api_key:auth.hashAgentApiKey('instant-unused-primary')})
 await db.insert(schema.agent_credentials).values({id:crypto.randomUUID(),agentId:agentId,name:'Read only',keyHash:auth.hashAgentApiKey(key),keyPrefix:key.slice(0,12),scopes:'["agent:read"]',createdByType:'account',createdById:f.buyer})
 const req=new NextRequest(`http://localhost/api/instant/services/${f.service.id}/sessions`,{method:'POST',headers:{'x-agent-api-key':key,'Content-Type':'application/json'},body:JSON.stringify(f.input)})
 assert.equal((await sessions(req,params(f.service.id))).status,401)
 const scopes=await import('@/lib/agent-credential-scopes');assert.equal(scopes.requiredAgentCredentialScope(req),'payments:write')
})
test('database and environment financial holds prevent new budgets and calls but preserve exact replay',async()=>{
 const f=await fixture();process.env.CLAWDMARKET_ROUTE_EXECUTION_PAUSED='true'
 try{await assert.rejects(call(f),/ROUTE_EXECUTION_PAUSED/);assert.equal((await core.openInstantSession(principal(f.buyer),f.service.id,f.input)).idempotent,true)}finally{delete process.env.CLAWDMARKET_ROUTE_EXECUTION_PAUSED}
 await db.insert(schema.payment_controls).values({key:'new_payments',paused:1})
 try{await assert.rejects(core.openInstantSession(principal(f.buyer),f.service.id,{...f.input,client_reference:crypto.randomUUID()}),/NEW_PAYMENTS_PAUSED/)}finally{await db.delete(schema.payment_controls).where(eq(schema.payment_controls.key,'new_payments'))}
})
test('credit health detects corrupt session balances, receipts and orphan instant entries',async()=>{
 const f=await fixture(),c=await call(f);await settle(f,c.id);assert.equal((await health()).healthy,true)
 const [saved]=await db.select().from(schema.instant_calls).where(eq(schema.instant_calls.id,c.id))
 await db.update(schema.instant_calls).set({receipt_json:'{broken'}).where(eq(schema.instant_calls.id,c.id));assert.equal((await health()).healthy,false)
 await db.update(schema.instant_calls).set({receipt_json:saved.receipt_json}).where(eq(schema.instant_calls.id,c.id))
 await db.update(schema.instant_sessions).set({held_minor:1}).where(eq(schema.instant_sessions.id,f.session.id));assert.equal((await health()).instant_session_anomalies,1)
 await db.update(schema.instant_sessions).set({held_minor:0}).where(eq(schema.instant_sessions.id,f.session.id))
 await db.insert(schema.credit_entries).values({user_id:f.seller,reference:'orphan-instant',kind:'instant_sale',available_delta:0,escrow_delta:0});assert.equal((await health()).instant_entry_anomalies,1)
 await db.delete(schema.credit_entries).where(eq(schema.credit_entries.reference,'orphan-instant'));assert.equal((await health()).healthy,true)
})

test('agent sessions honor agent ceilings and fail closed on organization assignment or unsupported provider policy',async()=>{
 const f=await fixture(), auth=await import('@/lib/registered-agent-auth'), agentId=crypto.randomUUID(), synthetic=`user_agent_${agentId}`
 await db.insert(schema.agents).values({id:agentId,name:'Instant spending agent',description:'Fixture agent',capabilities:'["code-review"]',endpoint:'https://example.invalid',owner_address:`0x${'77'.repeat(20)}`,status:'active',visibility:'public',api_key:auth.hashAgentApiKey('instant-spending-fixture')})
 await db.insert(schema.users).values({id:synthetic,name:'Instant spending agent',email:`${agentId}@test.invalid`,password_hash:'unused',role:'agent'})
 await db.insert(schema.agent_owners).values({agentId,userId:f.buyer,establishedBy:'fixture'})
 await credit.fundOwnedAgent(f.buyer,agentId,20,'saved-instant-agent-funding')
 const actor={...principal(synthetic),agentId}, authority={...f.input,client_reference:crypto.randomUUID()}
 const previous=process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD;process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD='0.05'
 try{await assert.rejects(core.openInstantSession(actor,f.service.id,authority),/per-trade limit/)}finally{if(previous===undefined)delete process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD;else process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD=previous}
 const session=(await core.openInstantSession(actor,f.service.id,authority)).session
 assert.equal((await (await import('@/lib/agent-spend-policy')).getAgentSpendSnapshot(agentId,synthetic)).reserved_or_spent_today,0.10)
 const organization=crypto.randomUUID();await db.insert(schema.organizations).values({id:organization,owner_account_id:f.buyer,client_reference:crypto.randomUUID(),name:'Instant policy fixture',created_at:new Date(),updated_at:new Date()})
 await db.insert(schema.organization_agent_assignments).values({agent_id:agentId,organization_id:organization,cost_center:'instant-fixture',assigned_at:new Date(),updated_at:new Date()})
 await assert.rejects(core.createInstantCall(actor,session.id,{client_reference:crypto.randomUUID(),input:{text:'hello'}}),/INSTANT_ORGANIZATION_UNSUPPORTED/)
 await assert.rejects(core.openInstantSession(actor,f.service.id,{...authority,client_reference:crypto.randomUUID()}),/INSTANT_ORGANIZATION_UNSUPPORTED/)
 await db.insert(schema.buyer_spend_policies).values({buyer_id:f.buyer,owner_account_id:f.buyer,policy_json:JSON.stringify({provider_requirements:{minimum_accepted_completions:1}}),version:1})
 await assert.rejects(core.openInstantSession(principal(f.buyer),f.service.id,{...f.input,client_reference:crypto.randomUUID()}),/INSTANT_PROVIDER_REQUIREMENTS_UNSUPPORTED/)
 assert.equal((await credit.instantCreditBalance(synthetic)).prepaid_minor,10)
 assert.equal((await health()).healthy,true)
})
test('production instant funding defaults closed in a fresh application process',async()=>{
 const f=await fixture()
 const command=`import { openInstantSession } from './lib/instant-execution.ts';import { db } from './lib/db.ts';try{await openInstantSession(${JSON.stringify(principal(f.buyer))},${JSON.stringify(f.service.id)},${JSON.stringify({...f.input,client_reference:crypto.randomUUID()})});process.exitCode=1}catch(e){console.log(e.code)}finally{db.$client.close()}`
 const child=spawnSync(process.execPath,['--conditions=react-server','--import','tsx','--input-type=module','-e',command],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',CLAWDMARKET_INSTANT_EXECUTION_ENABLED:'false'},encoding:'utf8',timeout:20000})
 assert.equal(child.status,0,child.stderr);assert.equal(child.stdout.trim(),'INSTANT_EXECUTION_DISABLED')
})
