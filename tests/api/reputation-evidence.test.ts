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
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-reputation-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'test.db')}`
  delete process.env.ANTHROPIC_API_KEY
  db = (await import('@/lib/db')).db; s = await import('@/lib/schema')
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
  assert.equal(view.components.completedTrades, 1); assert.equal(view.components.disputedTrades, 1)
  assert.equal(view.components.ratingCount, 1); assert.match(view.drivers.join(' '), /dispute/)
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
