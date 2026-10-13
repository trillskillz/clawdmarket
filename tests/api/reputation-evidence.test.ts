import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { execFileSync } from 'node:child_process'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string, db: typeof import('@/lib/db').db, s: typeof import('@/lib/schema')
let load: typeof import('@/lib/agent-trust').loadAgentTrust
const buyer = `rep-buyer-${crypto.randomUUID()}`
test('a failed local reputation read releases its native statement before financial writes resume', () => {
  const path = join(tmpdir(), `clawdmarket-workspace-test-reputation-lock-${crypto.randomUUID()}.db`)
  const code = `(async()=>{
    const assert=(await import('node:assert/strict')).default;
    const {db}=await import('./lib/db.ts'),imported=await import('./lib/schema.ts'),schema=imported.default??imported;
    await (await import('./tests/helpers/local-schema.ts')).createLocalTestSchema(db.$client,schema);
    const {loadReputationV2Records}=await import('./lib/reputation-v2.ts');
    const {createRequire}=await import('node:module'),require=createRequire(process.cwd()+'/package.json');
    const Database=createRequire(require.resolve('@libsql/client'))('libsql');
    const writer=new Database(process.env.TURSO_DATABASE_URL.slice(5));
    const requests=[{key:'locked',provider_id:'locked-provider',scope:{kind:'provider_history'}}];
    try {
      writer.exec('BEGIN EXCLUSIVE');
      const unavailable=await loadReputationV2Records(requests);
      assert.equal(unavailable.get('locked').projection_status,'unavailable');
      writer.exec('ROLLBACK');
      await db.transaction(async tx=>tx.insert(schema.users).values({id:'recovered',email:'recovered@test.invalid',password_hash:'unused',name:'Recovered'}));
      assert.equal((await db.select().from(schema.users)).length,1);
      assert.equal((await loadReputationV2Records(requests)).get('locked').projection_status,'current');
      console.log('native reputation lock recovered');
    } finally { if(writer.inTransaction)writer.exec('ROLLBACK');writer.close();db.$client.close(); }
  })().catch(error=>{console.error(error);process.exitCode=1})`
  try {
    const output = execFileSync(process.execPath, ['--conditions=react-server', '--import', 'tsx', '-e', code], {
      cwd: process.cwd(), env: { ...process.env, TURSO_DATABASE_URL: `file:${path}` }, timeout: 20_000, encoding: 'utf8', stdio: ['ignore','pipe','pipe'],
    })
    assert.match(output, /native reputation lock recovered/)
  } finally { rmSync(path, { force: true }) }
})
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-reputation-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'test.db')}`
  delete process.env.ANTHROPIC_API_KEY
  db = (await import('@/lib/db')).db; s = await import('@/lib/schema')
  // This suite mutates trigger protection after concurrent projection reads.
  await db.$client.execute('PRAGMA journal_mode=WAL')
  await createLocalTestSchema(db.$client, s)
  load = (await import('@/lib/agent-trust')).loadAgentTrust
  await db.insert(s.users).values({ id: buyer, name: 'Buyer', email: `${buyer}@test.invalid`, password_hash: 'unused', role: 'human' })
})
after(() => { db?.$client.close(); rmSync(directory, { recursive: true, force: true }) })
async function provider() {
  const id = `agent_${crypto.randomUUID()}`
  await db.insert(s.agents).values({ id, name: id, description: 'Reputation evidence fixture', capabilities: '["code-review"]', endpoint: '', owner_address: '', api_key: `unused-${id}` })
  await db.insert(s.users).values({ id: `user_agent_${id}`, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'agent' })
  return id
}
async function completed(seller: string, purchaser = buyer, rail: 'ledger' | 'credit' | 'evm' | 'mpp' = 'ledger') {
  const [listing] = await db.insert(s.listings).values({ seller_id: `user_agent_${seller}`, category: 'skills', title: 'Reputation fixture', description: 'Controlled local reputation fixture', price_bankr: 1, status: 'sold' }).returning()
  const [trade] = await db.insert(s.trades).values({ listing_id: listing.id, seller_id: listing.seller_id, buyer_id: purchaser, amount: 1, fee: 0.05, total_cost: 1.05, seller_amount: 1, payment_rail: rail, status: 'completed' }).returning()
  const [delivery] = await db.insert(s.trade_deliveries).values({ trade_id: trade.id, submitter_id: trade.seller_id, summary: 'Accepted local reputation fixture', content_hash: crypto.randomUUID(), verification: '{}' }).returning()
  await db.insert(s.verification_results).values({ id: crypto.randomUUID(), trade_id: trade.id, delivery_id: delivery.id, content_hash: delivery.content_hash, method: 'buyer_review', verifier: 'buyer', version: '1', status: 'passed', evidence_json: '{}' })
  if (rail === 'ledger') await db.insert(s.transactions).values([{ type: 'escrow_lock', from_user_id: purchaser, amount: 1, reference_id: trade.id }, { type: 'escrow_release', from_user_id: purchaser, to_user_id: trade.seller_id, amount: 1, reference_id: trade.id }])
  else if (rail === 'credit') await db.insert(s.credit_entries).values([
    { user_id: purchaser, reference: trade.id, kind: 'purchase', available_delta: -105, escrow_delta: 100 },
    { user_id: purchaser, reference: trade.id, kind: 'settlement', available_delta: 0, escrow_delta: -100 },
    { user_id: trade.seller_id, reference: trade.id, kind: 'sale', available_delta: 100, escrow_delta: 0 },
  ])
  else {
    const token = `0x${'11'.repeat(20)}`, chain = rail === 'mpp' ? 4217 : 8453
    await db.insert(s.payment_receipts).values({ route: `/api/trades/${trade.id}/fund/${rail}`, trade_id: trade.id, payment_rail: rail, amount: 1.05, currency: 'USD', usd_value_at_payment: 1.05, chain_id: chain, token_address: token, tx_hash: `0x${crypto.randomUUID().replaceAll('-', '').repeat(2)}` })
    await db.insert(s.settlement_transfers).values({ business_key: `${trade.id}:seller_payout`, trade_id: trade.id, kind: 'seller_payout', chain_id: chain, token_address: token, from_address: token, to_address: token, token_amount: '1000000', usd_amount: 1, status: 'confirmed', tx_hash: crypto.randomUUID(), confirmed_at: new Date() })
  }
  return trade
}
async function feedback(trade: typeof s.trades.$inferSelect, score = 5, time = new Date(Date.now() - 1000).toISOString()) {
  const [row] = await db.insert(s.ratings).values({ trade_id: trade.id, rated_id: trade.seller_id, rater_id: trade.buyer_id, score, created_at: time }).returning()
  return row
}
const snapshot = (id: string) => load({ id, created_at: new Date(Date.now() - 365 * 86400000), avg_rating: 5, rating_count: 999 })

test('v2 transactional observations are immutable, idempotent and roll back with the authoritative state', async()=>{
 const agent=await provider(),trade=await completed(agent)
 const before=(await db.select().from(s.reputation_events).where(eq(s.reputation_events.trade_id,trade.id))).length
 await db.update(s.trades).set({status:'completed'}).where(eq(s.trades.id,trade.id))
 assert.equal((await db.select().from(s.reputation_events).where(eq(s.reputation_events.trade_id,trade.id))).length,before)
 await assert.rejects(()=>db.transaction(async tx=>{await tx.update(s.trades).set({status:'disputed'}).where(eq(s.trades.id,trade.id));throw Error('abort-owned-test')}),/abort-owned-test/)
 assert.equal((await db.select().from(s.reputation_events).where(eq(s.reputation_events.trade_id,trade.id))).length,before)
 await assert.rejects(()=>db.delete(s.reputation_events).where(eq(s.reputation_events.trade_id,trade.id)))
 const view=await snapshot(agent);assert.equal(view.reputation_v2.projection_status,'current');assert.equal(view.reputation_v2.delivery.accepted,1)
})

test('transactional event clocks retain actual epoch-second terminal dates',async()=>{
 const agent=await provider(),trade=await completed(agent),completedAt=new Date(Date.now()-1000)
 await db.update(s.trades).set({completed_at:completedAt}).where(eq(s.trades.id,trade.id))
 const events=await db.select().from(s.reputation_events).where(eq(s.reputation_events.trade_id,trade.id))
 assert.ok(events.some(e=>e.event_kind==='trade_completed'&&e.occurred_at===Math.floor(completedAt.getTime()/1000)))
 const view=await snapshot(agent);assert.ok(view.reputation_v2.evidence_recorded_as_of);assert.equal(view.reputation_v2.freshness.dated_terminal_observations,1)
})

test('reputation v2 keeps earlier dissatisfaction, caps repeat work, invalidates refunds and hides private review bodies',async()=>{
 const agent=await provider(),first=await completed(agent),second=await completed(agent)
 for(const trade of [first,second])await db.update(s.trades).set({completed_at:new Date(Date.now()-1000)}).where(eq(s.trades.id,trade.id))
 const bad=await feedback(first,1);await db.update(s.ratings).set({comment:'private-review-body-do-not-publish'}).where(eq(s.ratings.id,bad.id));await feedback(second,5)
 let view=await snapshot(agent);assert.equal(view.reputation_v2.satisfaction.mean,3);assert.equal(view.reputation_v2.breadth.observed_buyer_groups,1);assert.equal(view.reputation_v2.breadth.decayed_group_weight,1)
 const feed=await (await import('@/lib/public-feedback')).publicFeedback(`user_agent_${agent}`,50)
 assert.equal(feed.ratings.length,2);assert.ok(!JSON.stringify(feed).includes('private-review-body'));assert.ok(!JSON.stringify(feed).includes(buyer))
 await db.insert(s.transactions).values({type:'escrow_refund',amount:1,to_user_id:buyer,reference_id:first.id})
 view=await snapshot(agent);assert.equal(view.reputation_v2.delivery.accepted,1);assert.equal(view.reputation_v2.delivery.unknown,1)
})

test('ownership transfers cannot launder known related-party work into public evidence',async()=>{
 const agent=await provider()
 await db.insert(s.agent_owners).values({agentId:agent,userId:buyer,establishedBy:'test'})
 const trade=await completed(agent);await feedback(trade)
 const other=`new-owner-${crypto.randomUUID()}`;await db.insert(s.users).values({id:other,name:other,email:`${other}@test.invalid`,password_hash:'unused'})
 await db.update(s.agent_owners).set({userId:other}).where(eq(s.agent_owners.agentId,agent))
 const view=await snapshot(agent);assert.equal(view.components.completedTrades,0);assert.equal(view.reputation_v2.delivery.accepted,0)
 assert.ok((await db.select().from(s.reputation_events).where(eq(s.reputation_events.trade_id,trade.id))).some(e=>e.historical_related))
})

test('only an attributable terminal finding is failure; open cases, goodwill and seller-favor decisions are neutral, appeals preserve facts',async()=>{
 const {appendReputationDecision,reputationDecisionInput}=await import('@/lib/reputation-adjudication')
 const agent=await provider(),trade=await completed(agent)
 await db.update(s.trades).set({status:'disputed',funded_at:new Date().toISOString(),completed_at:new Date()}).where(eq(s.trades.id,trade.id))
 let view=await snapshot(agent);assert.equal(view.reputation_v2.incidents.pending,1);assert.equal(view.reputation_v2.delivery.provider_failures,0)
 const body={version:1,client_reference:crypto.randomUUID(),responsibility:'provider',status:'upheld',reason:'provider_nonperformance',severity:'serious',supersedes_id:null}
 const finding=await db.transaction(tx=>appendReputationDecision(tx,trade.id,buyer,reputationDecisionInput.parse(body)))
 await db.update(s.trades).set({status:'resolved',resolution:'buyer',payout_status:'complete',completed_at:new Date()}).where(eq(s.trades.id,trade.id))
 await db.insert(s.transactions).values({type:'escrow_refund',amount:1,to_user_id:buyer,reference_id:trade.id})
 view=await snapshot(agent);assert.equal(view.reputation_v2.delivery.provider_failures,1);assert.equal(view.reputation_v2.delivery.accepted,0)
 const replay=await db.transaction(tx=>appendReputationDecision(tx,trade.id,buyer,reputationDecisionInput.parse(body)));assert.equal(replay.idempotent,true)
 await db.transaction(tx=>appendReputationDecision(tx,trade.id,buyer,reputationDecisionInput.parse({...body,client_reference:crypto.randomUUID(),status:'overturned',reason:'finding_overturned',supersedes_id:finding.decision.id})))
 view=await snapshot(agent);assert.equal(view.reputation_v2.delivery.provider_failures,0);assert.equal(view.reputation_v2.incidents.overturned,1)
 for(const reason of ['goodwill_refund','seller_favor']){
  const seller=await provider(),work=await completed(seller)
  await db.update(s.trades).set({status:'resolved',resolution:reason==='seller_favor'?'seller':'buyer',payout_status:'complete',completed_at:new Date()}).where(eq(s.trades.id,work.id))
  await db.transaction(tx=>appendReputationDecision(tx,work.id,buyer,reputationDecisionInput.parse({...body,client_reference:crypto.randomUUID(),responsibility:reason==='seller_favor'?'buyer':'unknown',status:'neutral',severity:'ordinary',reason})))
  assert.equal((await snapshot(seller)).reputation_v2.delivery.provider_failures,0)
 }
})

test('cached stars cannot alter search ordering across page boundaries',async()=>{
 const good=await provider(),imported=await provider(),tag=`search-v2-${crypto.randomUUID()}`
 await db.update(s.agents).set({name:tag+' A',description:tag,avg_rating:1,rating_count:0}).where(eq(s.agents.id,good))
 await db.update(s.agents).set({name:tag+' B',description:tag,avg_rating:5,rating_count:9999}).where(eq(s.agents.id,imported))
 await feedback(await completed(good),2)
 const get=(await import('@/app/api/agents/search/route')).GET
 const page=async(n:number)=>(await(await get(new NextRequest(`http://localhost/api/agents/search?q=${tag}&limit=1&page=${n}`))).json()).agents[0].id
 assert.equal(await page(1),good);assert.equal(await page(2),imported)
 await db.update(s.agents).set({avg_rating:500}).where(eq(s.agents.id,imported));assert.equal(await page(1),good)
})

test('service/capability/mode scope cannot inherit an advertised bundle, unrelated capability or another frozen version',async()=>{
 const {loadReputationV2Map}=await import('@/lib/reputation-v2'),{captureServiceExecutionContract}=await import('@/lib/service-execution-contract')
 const agent=await provider(),work=await completed(agent)
 const [service]=await db.insert(s.service_definitions).values({id:crypto.randomUUID(),seller_id:work.seller_id,title:'Scoped fixture',description:'Owned fixture',capabilities:'["code-review","code-generation"]',input_schema:'{}',output_schema:'{}',price_minor:100,verification_policy:'{"required":true,"methods":["buyer_review"]}'}).returning()
 const [order]=await db.insert(s.service_orders).values({id:crypto.randomUUID(),service_id:service.id,listing_id:work.listing_id,trade_id:work.id,buyer_id:buyer,client_reference:crypto.randomUUID(),objective:'Review this exact requested component',input_json:'{}',price_minor:100,payment_rail:'ledger',state:'completed',execution_contract_json:captureServiceExecutionContract(service,['code-review','code-generation'])}).returning()
 const scope={kind:'service_capability_mode' as const,service_id:service.id,capability_id:'code-review',execution_mode:'contracted' as const}
 const unattributed=(await loadReputationV2Map([agent],scope)).get(agent)!
 assert.equal(unattributed.delivery.accepted,0);assert.equal(unattributed.scope_coverage.unattributed_work_units,1)
 await db.update(s.service_orders).set({execution_contract_json:captureServiceExecutionContract(service,['code-review','code-generation'],['code-review'])}).where(eq(s.service_orders.id,order.id))
 const observed=(await loadReputationV2Map([agent],scope)).get(agent)!
 assert.equal(observed.delivery.accepted,1);assert.equal(observed.service_versions.length,1)
 assert.equal((await loadReputationV2Map([agent],{...scope,capability_id:'code-generation'})).get(agent)!.delivery.accepted,0)
 assert.equal((await loadReputationV2Map([agent],{...scope,service_version:'0'.repeat(64)})).get(agent)!.delivery.accepted,0)
 assert.equal((await loadReputationV2Map([agent],{...scope,execution_mode:'instant'})).get(agent)!.delivery.accepted,0)
 const route=await import('@/app/api/agents/[id]/reputation/route'),context={params:Promise.resolve({id:agent})}
 assert.equal((await route.GET(new NextRequest(`http://localhost/api/agents/${agent}/reputation?capability_id=code-review`),context)).status,400)
 const response=await route.GET(new NextRequest(`http://localhost/api/agents/${agent}/reputation?service_id=${service.id}&capability_id=code-review&execution_mode=contracted`),context)
 assert.equal(response.status,200);assert.equal((await response.json()).reputation_v2.delivery.accepted,1)
})

test('immutable payment observations normalize ISO dates and historical private work cannot become public on visibility change',async()=>{
 const agent=await provider(),work=await completed(agent,buyer,'mpp')
 const [payment]=await db.select().from(s.payment_receipts).where(eq(s.payment_receipts.trade_id,work.id))
 const [event]=await db.select().from(s.reputation_events).where(and(eq(s.reputation_events.trade_id,work.id),eq(s.reputation_events.source_type,'payment')))
 assert.ok(Math.abs(event.occurred_at!*1000-Date.parse(String(payment.created_at)))<1000)
 const hidden=await provider();await db.update(s.agents).set({visibility:'private'}).where(eq(s.agents.id,hidden))
 await completed(hidden);await db.update(s.agents).set({visibility:'public'}).where(eq(s.agents.id,hidden))
 assert.equal((await snapshot(hidden)).reputation_v2.delivery.accepted,0)
})

test('private decision endpoint enforces moderator and original-seller authority, concurrent replay and append-only appeals',async()=>{
 const {generateJWT}=await import('@/lib/auth'),route=await import('@/app/api/trades/[id]/reputation/route')
 const agent=await provider(),work=await completed(agent);await db.update(s.trades).set({status:'disputed',funded_at:new Date().toISOString()}).where(eq(s.trades.id,work.id))
 const context={params:Promise.resolve({id:work.id})},url=`http://localhost/api/trades/${work.id}/reputation`
 const adminToken=generateJWT({userId:buyer,email:`${buyer}@test.invalid`,role:'human'}),sellerToken=generateJWT({userId:work.seller_id,email:`${agent}@test.invalid`,role:'agent'})
 const request=(method:string,body:unknown,token=adminToken)=>new NextRequest(url,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
 const decision={version:1,client_reference:crypto.randomUUID(),responsibility:'provider',status:'upheld',reason:'provider_nonperformance',severity:'serious',supersedes_id:null}
 assert.equal((await route.GET(new NextRequest(url),context)).status,401)
 assert.equal((await route.POST(request('POST',decision,sellerToken),context)).status,403)
 const oldAdmin=process.env.ADMIN_USER_IDS;process.env.ADMIN_USER_IDS=buyer
 try{
  const concurrent=await Promise.all([route.POST(request('POST',decision),context),route.POST(request('POST',decision),context)])
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,201])
  const finding=(await concurrent[0].json()).decision
  const appeal={version:1,client_reference:crypto.randomUUID(),finding_id:finding.id}
  assert.equal((await route.PATCH(request('PATCH',appeal),context)).status,404)
  assert.equal((await route.PATCH(request('PATCH',appeal,sellerToken),context)).status,201)
  assert.equal((await route.PATCH(request('PATCH',appeal,sellerToken),context)).status,200)
  assert.equal((await route.POST(request('POST',{...decision,client_reference:crypto.randomUUID()}),context)).status,409)
  const history=await (await route.GET(new NextRequest(url,{headers:{Authorization:`Bearer ${sellerToken}`}}),context)).json()
  assert.equal(history.decisions.length,2);assert.equal(history.permissions.can_append_decision,false)
  const [unchanged]=await db.select().from(s.trades).where(eq(s.trades.id,work.id));assert.equal(unchanged.status,'disputed');assert.equal(unchanged.resolution,null)
 }finally{if(oldAdmin===undefined)delete process.env.ADMIN_USER_IDS;else process.env.ADMIN_USER_IDS=oldAdmin}
})

test('background longer-ring screening persists an idempotent private review queue and never changes money or fault findings',async()=>{
 const ring:string[]=[];for(let i=0;i<6;i++)ring.push(await provider())
 for(let i=0;i<ring.length;i++)await completed(ring[(i+1)%ring.length],`user_agent_${ring[i]}`)
 const {runReputationScreening,appendScreeningReview}=await import('@/lib/reputation-screening-store')
 const first=await runReputationScreening(),second=await runReputationScreening();assert.equal(second.idempotent,true);assert.equal(second.run.id,first.run.id)
 const queued=await db.select().from(s.reputation_screening_cases).where(eq(s.reputation_screening_cases.kind,'longer_ring'));assert.ok(queued.length>0)
 const body={client_reference:crypto.randomUUID(),status:'appealed' as const,supersedes_id:null}
 const review=await appendScreeningReview(buyer,queued[0].id,body);assert.equal(review.idempotent,false)
 assert.equal((await appendScreeningReview(buyer,queued[0].id,body)).idempotent,true)
 const changed=await db.select().from(s.reputation_adjudications).where(eq(s.reputation_adjudications.trade_id,JSON.parse(queued[0].trade_ids_json)[0]));assert.equal(changed.length,0)
})

test('cached stars and account age alone cannot establish reputation evidence or confidence', async () => {
  const agent = await provider(), view = await snapshot(agent)
  assert.equal(view.components.ratingCount, 0); assert.equal(view.components.completedTrades, 0)
  assert.equal(view.confidence, 'low'); assert.equal(view.evidencePoints, 0)
  assert.equal(view.evidence.measured_quality_score, null); assert.equal(view.evidence.buyer_independence, 'not_verified')
})

test('all reputation rails require current exact backing and retain the original financial records', async () => {
  for (const rail of ['ledger', 'credit', 'evm', 'mpp'] as const) {
    const agent = await provider(), trade = await completed(agent, buyer, rail)
    await feedback(trade)
    assert.equal((await snapshot(agent)).components.ratingCount, 1, rail)
    if (rail === 'ledger') await db.delete(s.transactions).where(eq(s.transactions.reference_id, trade.id))
    if (rail === 'credit') await db.update(s.credit_entries).set({ escrow_delta: -99 }).where(and(eq(s.credit_entries.reference, trade.id), eq(s.credit_entries.kind, 'settlement')))
    if (rail === 'evm') await db.update(s.settlement_transfers).set({ chain_id: 1 }).where(eq(s.settlement_transfers.trade_id, trade.id))
    if (rail === 'mpp') await db.update(s.payment_receipts).set({ usd_value_at_payment: 1 }).where(eq(s.payment_receipts.trade_id, trade.id))
    const view = await snapshot(agent)
    assert.equal(view.components.completedTrades, 0); assert.equal(view.components.ratingCount, 0)
    assert.equal((await db.select().from(s.trades).where(eq(s.trades.id, trade.id)))[0].status, 'completed')
  }
})

test('feedback must belong to the actual buyer and seller with an accepted exact delivery hash and valid score/date', async () => {
  for (const reason of ['buyer', 'seller', 'score', 'date', 'review']) {
    const agent = await provider(), trade = await completed(agent), rating = await feedback(trade)
    if (reason === 'buyer') await db.update(s.ratings).set({ rater_id: 'unrelated-account' }).where(eq(s.ratings.id, rating.id))
    if (reason === 'seller') await db.update(s.ratings).set({ rated_id: `user_agent_${await provider()}` }).where(eq(s.ratings.id, rating.id))
    if (reason === 'score') await db.update(s.ratings).set({ score: 6 }).where(eq(s.ratings.id, rating.id))
    if (reason === 'date') await db.update(s.ratings).set({ created_at: '2999-01-01T00:00:00.000Z' }).where(eq(s.ratings.id, rating.id))
    if (reason === 'review') await db.update(s.verification_results).set({ content_hash: 'wrong-delivery' }).where(eq(s.verification_results.trade_id, trade.id))
    assert.equal((await snapshot(agent)).components.ratingCount, 0, reason)
  }
})

test('repeated purchases and current owner aliases contribute one latest feedback vote and cannot multiply positive weight', async () => {
  const agent = await provider(), first = await completed(agent)
  await feedback(first, 5, '2020-01-01T00:00:00.000Z')
  const original = await snapshot(agent)
  for (let i = 0; i < 20; i++) await feedback(await completed(agent), 5, '2020-01-01T00:00:00.000Z')
  const repeated = await snapshot(agent)
  assert.equal(repeated.trustScore, original.trustScore); assert.equal(repeated.evidencePoints, original.evidencePoints)
  assert.equal(repeated.components.completedTrades, 21); assert.equal(repeated.components.ratingCount, 1)
  const alias = await provider()
  await db.insert(s.agent_owners).values({ agentId: alias, userId: buyer, establishedBy: 'test' })
  await feedback(await completed(agent, `user_agent_${alias}`), 1)
  const grouped = await snapshot(agent)
  assert.equal(grouped.components.distinctBuyerCount, 1); assert.equal(grouped.components.ratingCount, 1)
  assert.equal(grouped.components.averageRating, 1); assert.deepEqual(grouped.components.ratingDistribution, [1, 0, 0, 0, 0])
  assert.equal(grouped.confidence, 'low')
  for (const identity of [buyer, alias]) assert.equal(JSON.stringify(grouped).includes(identity), false)
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import { createClient } from '@libsql/client';
    const client = createClient({ url: process.env.TURSO_DATABASE_URL });
    await client.execute({ sql: 'DELETE FROM agent_owners WHERE agent_id = ?', args: [process.argv[1]] });
    client.close();
  `, alias], { env: { ...process.env }, timeout: 10000 })
  const transferred = await snapshot(agent)
  assert.equal(transferred.components.distinctBuyerCount, 2); assert.equal(transferred.components.ratingCount, 2)
})

test('manual accepted trade cycles are bounded, unrelated work survives and adverse outcomes remain visible', async () => {
  for (const length of [2, 3, 4, 5]) {
    const parties: string[] = []
    for (let i = 0; i < length; i++) parties.push(await provider())
    for (let i = 0; i < length; i++) await feedback(await completed(parties[(i + 1) % length], `user_agent_${parties[i]}`))
    assert.equal((await snapshot(parties[0])).components.completedTrades, length === 5 ? 1 : 0)
  }
  const a = await provider(), b = await provider(), c = await provider()
  await completed(b, `user_agent_${a}`); await completed(c, `user_agent_${b}`); await completed(a, `user_agent_${c}`)
  await feedback(await completed(b), 4)
  const adverse = await completed(b)
  await db.update(s.trades).set({ status: 'disputed' }).where(eq(s.trades.id, adverse.id))
  const view = await snapshot(b)
  assert.equal(view.components.completedTrades, 1); assert.equal(view.components.disputedTrades, 0); assert.equal(view.components.openCases, 1)
  assert.equal(view.components.ratingCount, 1); assert.doesNotMatch(view.drivers.join(' '), /penalty/)
})

test('current owner, reference cohort, service state and refund contradictions cannot establish positive reputation', async () => {
  for (const reason of ['self', 'owner', 'reference', 'order', 'rail', 'cohort', 'refund', 'external-refund', 'release']) {
    const agent = await provider(), purchaser = reason === 'self' ? `user_agent_${agent}` : buyer
    const trade = await completed(agent, purchaser, reason === 'external-refund' ? 'mpp' : 'ledger')
    await feedback(trade)
    if (reason === 'owner') await db.insert(s.agent_owners).values({ agentId: agent, userId: buyer, establishedBy: 'test' })
    if (reason === 'reference') await db.update(s.agents).set({ description: '[clawdmarket-reference-fleet:v1]' }).where(eq(s.agents.id, agent))
    if (['order', 'rail', 'cohort'].includes(reason)) {
      const [service] = await db.insert(s.service_definitions).values({ id: crypto.randomUUID(), seller_id: trade.seller_id, title: 'Controlled reputation service', description: 'Local test', capabilities: '["code-review"]', price_minor: 100 }).returning()
      const [order] = await db.insert(s.service_orders).values({ id: crypto.randomUUID(), service_id: service.id, listing_id: trade.listing_id, trade_id: trade.id, buyer_id: purchaser, client_reference: crypto.randomUUID(), objective: 'Local test', price_minor: 100, state: reason === 'order' ? 'resolved' : 'completed', payment_rail: reason === 'rail' ? 'credit' : 'ledger' }).returning()
      if (reason === 'cohort') {
        const route = crypto.randomUUID()
        await db.insert(s.route_plans).values({ id: route, buyer_id: purchaser, client_reference: crypto.randomUUID(), objective: 'Local test', required_capabilities: '[]', max_budget_minor: 200, service_order_id: order.id, expires_at: new Date() })
        await db.insert(s.route_origins).values({ route_id: route, channel: 'account', cohort: 'demo' })
      }
    }
    if (reason === 'refund') await db.insert(s.transactions).values({ type: 'escrow_refund', amount: 0.5, to_user_id: purchaser, reference_id: trade.id })
    if (reason === 'external-refund') await db.insert(s.settlement_transfers).values({ business_key: `${trade.id}:buyer_refund`, trade_id: trade.id, kind: 'buyer_refund', chain_id: 4217, token_address: 'token', from_address: 'from', to_address: 'to', token_amount: '100', usd_amount: 0.5, status: 'submitted', tx_hash: 'refund-hash' })
    if (reason === 'release') await db.update(s.transactions).set({ to_user_id: purchaser }).where(and(eq(s.transactions.reference_id, trade.id), eq(s.transactions.type, 'escrow_release')))
    const view = await snapshot(agent)
    assert.equal(view.components.ratingCount, 0, reason); assert.equal(view.components.completedTrades, 0, reason)
    assert.equal((await db.select().from(s.trades).where(eq(s.trades.id, trade.id)))[0].status, 'completed')
  }
})

test('manual reputation search honors the 256-state bound and indexed outgoing buyers', async () => {
  const { backedReputationTradeSql } = await import('@/lib/reputation-evidence-sql')
  const root = await provider()
  await feedback(await completed(root))
  const first = await provider()
  for (let i = 0; i < 3; i++) await completed(first, `user_agent_${root}`)
  for (let i = 1; i < 255; i++) await completed(await provider(), `user_agent_${root}`)
  assert.equal((await snapshot(root)).components.ratingCount, 1, 'seed and 255 distinct successors fit')
  await completed(await provider(), `user_agent_${root}`)
  assert.equal((await snapshot(root)).components.ratingCount, 0, 'exhaustion conservatively excludes proof')
  const plan = await db.$client.execute(`EXPLAIN QUERY PLAN SELECT t.id FROM trades t WHERE ${backedReputationTradeSql('t')}`)
  assert.ok(plan.rows.some((row) => String(row.detail).includes('cycle_trade USING INDEX trades_buyer_status_idx')))
})

test('directory, profile, trust, live marketplace sorting and first-render catalog share eligible buyer feedback', async () => {
  const good = await provider(), fake = await provider(), tag = `rep-sort-${crypto.randomUUID()}`
  const goodTrade = await completed(good); await feedback(goodTrade, 4)
  const fakeTrade = await completed(fake); await feedback(fakeTrade, 5)
  await db.delete(s.transactions).where(eq(s.transactions.reference_id, fakeTrade.id))
  for (const id of [good, fake]) await db.insert(s.listings).values({ seller_id: `user_agent_${id}`, category: 'skills', title: tag, description: tag, price_bankr: 1, status: 'active' })
  const { GET: directory } = await import('@/app/api/agents/list/route'), { GET: search } = await import('@/app/api/agents/search/route')
  const { GET: profile } = await import('@/app/api/agents/[id]/route'), { GET: trust } = await import('@/app/api/agents/[id]/trust/route')
  const { GET: marketplace } = await import('@/app/api/listings/route'), { getPublicCatalogSnapshot } = await import('@/lib/public-catalog-snapshot')
  for (const id of [good, fake]) {
    const expected = id === good ? 1 : 0, params = { params: Promise.resolve({ id }) }
    const listed = await directory(new NextRequest(`http://localhost/api/agents/list?search=${id}`)).then((r) => r.json())
    const searched = await search(new NextRequest(`http://localhost/api/agents/search?q=${id}`)).then((r) => r.json())
    assert.equal(listed.agents[0].rating_count, expected); assert.equal(searched.agents[0].rating_count, expected)
    const profiled = await profile(new NextRequest(`http://localhost/api/agents/${id}`), params).then((r) => r.json())
    assert.equal(profiled.rating_count, expected); assert.equal(profiled.ratings.length, expected)
    assert.equal(profiled.total_volume, expected)
    const view = await trust(new NextRequest(`http://localhost/api/agents/${id}/trust`), params).then((r) => r.json())
    assert.equal(view.components.ratingCount, expected); assert.equal(view.evidence.measured_quality_score, null)
  }
  for (const sort of ['recommended', 'trust_desc']) {
    const result = await marketplace(new NextRequest(`http://localhost/api/listings?search=${tag}&sort=${sort}&limit=1`)).then((r) => r.json())
    assert.equal(result.total, 2); assert.equal(result.listings[0].agent_id, good)
    assert.equal(result.listings[0].seller_rating_count, 1)
  }
  const firstRender = await getPublicCatalogSnapshot(100)
  assert.equal(firstRender.listings.find((item: { agent_id: string }) => item.agent_id === fake)?.seller_rating_count, 0)
  assert.equal(firstRender.listings.find((item: { agent_id: string }) => item.agent_id === good)?.seller_rating_count, 1)
})


test('private health reports coverage and missing immutable capture protection without exposing parties',async()=>{
 const {generateJWT}=await import('@/lib/auth'),{GET}=await import('@/app/api/admin/reputation/health/route')
 const url='http://localhost/api/admin/reputation/health',oldAdmin=process.env.ADMIN_USER_IDS
 const token=generateJWT({userId:buyer,email:`${buyer}@test.invalid`,role:'human'})
 const request=()=>new NextRequest(url,{headers:{Authorization:`Bearer ${token}`}})
 try{
  delete process.env.ADMIN_USER_IDS
  assert.equal((await GET(new NextRequest(url))).status,401)
  assert.equal((await GET(request())).status,403)
  process.env.ADMIN_USER_IDS=buyer
  const response=await GET(request()),report=await response.json()
  assert.equal(response.status,200);assert.equal(report.immutable_triggers,10);assert.equal(report.default_ranking_changed,true)
  assert.equal(report.publication_gate,'authorized_after_release_checks');assert.equal(report.ranking_promotion_gate,'explicit_user_override_2026-10-12')
  assert.ok(Number(report.evidence.observed_events)>0);assert.ok(Number(report.evidence.legacy_unknown_dates)>=0)
  assert.ok(response.headers.get('Cache-Control')?.includes('private'))
  assert.ok(!JSON.stringify(report).includes(buyer));assert.equal(report.calibrated,false)
  const trigger=await db.$client.execute("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='reputation_events_immutable_update'")
  await db.$client.execute('DROP TRIGGER reputation_events_immutable_update')
  try{const unhealthy=await GET(request());assert.equal(unhealthy.status,503);assert.equal((await unhealthy.json()).healthy,false)}finally{await db.$client.execute(String(trigger.rows[0].sql))}
 }finally{if(oldAdmin===undefined)delete process.env.ADMIN_USER_IDS;else process.env.ADMIN_USER_IDS=oldAdmin}
})

test('promotion assessment reports real coverage gaps without creating work, moving funds or exposing source identities',async()=>{
 const {inspectReputationPromotion}=await import('@/lib/reputation-promotion-audit')
 const counts=async()=>((await db.$client.execute('SELECT (SELECT COUNT(*) FROM trades) AS trades,(SELECT COUNT(*) FROM transactions) AS transactions,(SELECT COUNT(*) FROM reputation_events) AS events')).rows[0])
 const before=await counts(),report=await inspectReputationPromotion()
 assert.deepEqual(await counts(),before);assert.equal(report.promotion_ready,false)
 assert.equal(report.rollout_status,'production');assert.equal(report.observation_gate,'explicit_user_override_2026-10-12')
 assert.equal(report.execution_authority,false);assert.equal(report.default_ranking_changed,true)
 assert.ok(report.blockers.includes('representative_outcome_and_exclusion_review_required'))
 assert.equal(report.measurement_limits.calibrated,false);assert.equal(report.measurement_limits.buyer_independence,'not_verified')
 assert.ok(!JSON.stringify(report).includes(buyer));assert.ok(!JSON.stringify(report).includes('private-review-body'))
 assert.equal('evidence' in report.health,false);assert.equal('screening' in report.health,false)
 assert.ok(!JSON.stringify(report).includes('private_observations_suppressed'))
})

test('received rating webhooks preserve metadata fields while withholding review bodies and buyer identities',async()=>{
 const agent=await provider(),trade=await completed(agent)
 await db.update(s.trades).set({completed_at:new Date(),rating_window_expires_at:new Date(Date.now()+86400000).toISOString()}).where(eq(s.trades.id,trade.id))
 const {createWebhookSecret,hashSecret}=await import('@/lib/webhook-delivery'),id=crypto.randomUUID()
 await db.insert(s.webhooks).values({id,agent_id:trade.seller_id,url:'http://127.0.0.1/blocked-local-fixture',secret_hash:await hashSecret(createWebhookSecret(id)),events:'["rating.received"]'})
 const {generateJWT}=await import('@/lib/auth'),{POST}=await import('@/app/api/ratings/route'),comment='private sensitive review fixture'
 const token=generateJWT({userId:buyer,email:`${buyer}@test.invalid`,role:'human'})
 const response=await POST(new NextRequest('http://localhost/api/ratings',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({trade_id:trade.id,score:2,comment})}))
 assert.equal(response.status,201)
 const [delivery]=await db.select().from(s.webhook_deliveries).where(eq(s.webhook_deliveries.webhook_id,id)),payload=JSON.parse(delivery.payload)
 assert.equal(payload.data.review,null);assert.equal(payload.data.from_agent_id,null);assert.equal(payload.data.score,2);assert.equal(payload.data.raw_review_body_included,false)
 assert.ok(!delivery.payload.includes(comment));assert.ok(!delivery.payload.includes(buyer))
 assert.equal((await db.select().from(s.ratings).where(eq(s.ratings.trade_id,trade.id)))[0].comment,comment)
})


test('current administrative bans remove stale positive votes and known-owner aliases without changing settlement',async()=>{
 const agent=await provider(),work=await completed(agent);await feedback(work)
 assert.equal((await snapshot(agent)).reputation_v2.delivery.accepted,1)
 await db.insert(s.banned_users).values({user_id:buyer,reason:'Controlled local moderation fixture',created_at:Date.now()})
 try{const view=await snapshot(agent);assert.equal(view.components.ratingCount,0);assert.equal(view.reputation_v2.delivery.accepted,0);assert.equal(view.reputation_v2.delivery.provider_failures,0)}finally{await db.delete(s.banned_users).where(eq(s.banned_users.user_id,buyer))}
 assert.equal((await snapshot(agent)).reputation_v2.delivery.accepted,1)
 const alias=await provider();await db.insert(s.agent_owners).values({agentId:alias,userId:buyer,establishedBy:'test'})
 const aliased=await completed(agent,`user_agent_${alias}`)
 await db.insert(s.banned_users).values({user_id:buyer,reason:'Controlled owner moderation fixture',created_at:Date.now()})
 try{assert.equal((await snapshot(agent)).reputation_v2.delivery.accepted,0)}finally{await db.delete(s.banned_users).where(eq(s.banned_users.user_id,buyer))}
 assert.equal((await db.select().from(s.trades).where(eq(s.trades.id,aliased.id)))[0].status,'completed')
})
