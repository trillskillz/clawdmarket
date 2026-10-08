import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let record: typeof import('@/lib/capability-performance').recordCapabilityCompletion
let load: typeof import('@/lib/capability-performance').loadCapabilityPerformance

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-capability-performance-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'capability.db')}`
  process.env.CHAT_ENCRYPTION_KEY = 'capability-performance-test-chat-key'
  process.env.WEBHOOK_SECRET_KEY = 'capability-performance-test-webhook-key'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  ;({ recordCapabilityCompletion: record, loadCapabilityPerformance: load } = await import('@/lib/capability-performance'))
  await db.insert(schema.users).values([
    { id: 'performance-buyer', email: 'performance-buyer@test.invalid', name: 'Buyer', password_hash: 'unused', role: 'human' },
    { id: 'user_agent_performance-seller', email: 'performance-seller@test.invalid', name: 'Seller', password_hash: 'unused', role: 'agent' },
    { id: 'user_agent_reference-seller', email: 'reference-seller@test.invalid', name: 'Reference', password_hash: 'unused', role: 'agent' },
  ])
  for (const [id, description] of [['performance-seller', 'Independent provider'], ['reference-seller', '[clawdmarket-reference-fleet:v1] Managed example']]) {
    await db.insert(schema.agents).values({ id, name: id, description, capabilities: '["security"]', endpoint: 'https://example.invalid', owner_address: 'private@test.invalid', api_key: 'unused' })
  }
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function fixture(sellerAgentId: string, buyerId = 'performance-buyer', pending = false) {
  const sellerId = `user_agent_${sellerAgentId}`
  const [listing] = await db.insert(schema.listings).values({ seller_id: sellerId, category: 'code', title: 'Audit authentication', description: 'Audit authentication with structured findings.', price_bankr: 1, status: 'sold' }).returning()
  const [trade] = await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: buyerId, seller_id: sellerId, amount: 1, fee: 0.05, status: pending ? 'pending_release' : 'completed', payment_rail: 'ledger' }).returning()
  const [service] = await db.insert(schema.service_definitions).values({ id: crypto.randomUUID(), seller_id: sellerId, title: 'Audit authentication', description: 'Audit authentication with structured findings.', capabilities: '["security","code-review"]', price_minor: 100, status: 'active', active_orders: pending ? 1 : 0 }).returning()
  await db.insert(schema.service_orders).values({ id: crypto.randomUUID(), service_id: service.id, listing_id: listing.id, trade_id: trade.id, buyer_id: buyerId, client_reference: crypto.randomUUID(), objective: 'Audit the authentication implementation', price_minor: 100, payment_rail: 'ledger', state: pending ? 'verifying' : 'completed' })
  const [delivery] = await db.insert(schema.trade_deliveries).values({ trade_id: trade.id, submitter_id: sellerId, summary: 'Completed the review.', content_hash: crypto.randomUUID(), verification: '{}' }).returning()
  await db.insert(schema.verification_results).values({ id: crypto.randomUUID(), trade_id: trade.id, delivery_id: delivery.id, content_hash: delivery.content_hash, method: 'buyer_review', verifier: 'buyer', version: '1', status: 'passed', evidence_json: '{}' })
  return trade
}

test('accepted economically backed service work records canonical capability evidence once', async () => {
  const trade = await fixture('performance-seller')
  await db.transaction((tx) => record(tx, trade))
  assert.deepEqual(await load('performance-seller'), [])
  await db.insert(schema.transactions).values({ from_user_id: trade.buyer_id, to_user_id: trade.seller_id, amount: 1, type: 'escrow_lock', reference_id: trade.id })
  await db.transaction((tx) => record(tx, trade))
  await db.transaction((tx) => record(tx, trade))
  const rows = await db.select().from(schema.capability_performance_events).where(eq(schema.capability_performance_events.trade_id, trade.id))
  assert.deepEqual(rows.map((row) => row.capability_id).sort(), ['code-review', 'security-analysis'])
  const performance = await load('performance-seller')
  assert.equal(performance.some((row) => row.capability_id === 'code-generation'), false)
  assert.equal(performance.some((row) => row.capability_id === 'family:code'), false)
  assert.equal(performance[0].accepted_completion_count, 1)
  assert.equal(performance[0].confidence, 'low')
  assert.equal(performance[0].measured_quality_score, null)
})

test('reference and self-dealing trades cannot create capability evidence', async () => {
  const reference = await fixture('reference-seller')
  const selfDealing = await fixture('performance-seller', 'user_agent_performance-seller')
  for (const trade of [reference, selfDealing]) {
    await db.insert(schema.transactions).values({ amount: 1, type: 'escrow_lock', reference_id: trade.id })
    await db.transaction((tx) => record(tx, trade))
    assert.equal((await db.select().from(schema.capability_performance_events).where(eq(schema.capability_performance_events.trade_id, trade.id))).length, 0)
  }
})

test('reference trades and ratings do not inflate marketplace trust', async () => {
  const trade = await fixture('reference-seller')
  await db.insert(schema.transactions).values({ amount: 1, type: 'escrow_lock', reference_id: trade.id })
  await db.insert(schema.ratings).values({ trade_id: trade.id, rater_id: trade.buyer_id, rated_id: trade.seller_id, score: 5 })
  const { loadAgentTrust } = await import('@/lib/agent-trust')
  const trust = await loadAgentTrust({ id: 'reference-seller' })
  assert.equal(trust.components.completedTrades, 0)
  assert.equal(trust.components.totalTrades, 0)
  assert.equal(trust.components.ratingCount, 0)
  const { GET } = await import('@/app/api/agents/[id]/trust/route')
  const response = await GET(new NextRequest('http://localhost/api/agents/reference-seller/trust'), { params: Promise.resolve({ id: 'reference-seller' }) })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.evidence_status, 'unrated')
  assert.deepEqual(body.capability_performance, [])
})

test('authoritative completion records evidence atomically with ledger release', async () => {
  const trade = await fixture('performance-seller', 'performance-buyer', true)
  await db.insert(schema.wallets).values({ user_id: trade.buyer_id, balance: 0, escrow: 1 }).onConflictDoUpdate({ target: schema.wallets.user_id, set: { escrow: 1 } })
  await db.insert(schema.transactions).values({ amount: 1, type: 'escrow_lock', reference_id: trade.id })
  const { finalizeTradeCompletion } = await import('@/lib/trade-escrow')
  const completed = await finalizeTradeCompletion(trade, 'buyer_confirm')
  assert.equal(completed.status, 'completed')
  assert.equal((await db.select().from(schema.capability_performance_events).where(eq(schema.capability_performance_events.trade_id, trade.id))).length, 2)
  assert.equal((await db.select().from(schema.wallets).where(eq(schema.wallets.user_id, trade.buyer_id)))[0].escrow, 0)
})

test('malformed legacy capability metadata cannot block settlement', async () => {
  const trade = await fixture('performance-seller', 'performance-buyer', true)
  const [order] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, trade.id))
  await db.update(schema.service_definitions).set({ capabilities: '{broken' }).where(eq(schema.service_definitions.id, order.service_id))
  await db.insert(schema.wallets).values({ user_id: trade.buyer_id, balance: 0, escrow: 1 }).onConflictDoUpdate({ target: schema.wallets.user_id, set: { escrow: 1 } })
  await db.insert(schema.transactions).values({ amount: 1, type: 'escrow_lock', reference_id: trade.id })
  const { finalizeTradeCompletion } = await import('@/lib/trade-escrow')
  const completed = await finalizeTradeCompletion(trade, 'buyer_confirm')
  assert.equal(completed.status, 'completed')
  assert.equal((await db.select().from(schema.capability_performance_events).where(eq(schema.capability_performance_events.trade_id, trade.id))).length, 0)
})

async function provider(label: string) {
  const id = `evidence-${label}-${crypto.randomUUID()}`
  await db.insert(schema.users).values({ id: `user_agent_${id}`, email: `${id}@test.invalid`, name: label, password_hash: 'unused', role: 'agent' })
  await db.insert(schema.agents).values({ id, name: id, description: 'Authentication review provider', capabilities: '["security-analysis:verified"]', endpoint: 'https://example.invalid', owner_address: '', api_key: `unused-${id}`, status: 'active' })
  return id
}
async function backed(seller: string, buyer = 'performance-buyer') {
  const trade = await fixture(seller, buyer)
  await db.insert(schema.transactions).values({ amount: 1, type: 'escrow_lock', reference_id: trade.id })
  await db.transaction((tx) => record(tx, trade))
  return trade
}

test('public capability proof filters ignore claimed tags and recheck current funding and hash-bound buyer review', async () => {
  delete process.env.ANTHROPIC_API_KEY
  const seller = await provider('filter')
  const { GET: directory } = await import('@/app/api/agents/list/route')
  const { GET: search } = await import('@/app/api/agents/search/route')
  const filtered = () => directory(new NextRequest(`http://localhost/api/agents/list?verified=true&search=${seller}`))
  assert.equal((await (await filtered()).json()).total, 0)
  const trade = await backed(seller)
  assert.equal((await (await filtered()).json()).total, 1)
  const result = await search(new NextRequest(`http://localhost/api/agents/search?verified=true&q=${seller}`))
  assert.equal(result.status, 200)
  assert.equal((await result.json()).total, 1)
  await db.update(schema.verification_results).set({ content_hash: 'wrong-delivery' }).where(eq(schema.verification_results.trade_id, trade.id))
  assert.equal((await (await filtered()).json()).total, 0)
  assert.deepEqual(await load(seller), [])
  const [delivery] = await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, trade.id))
  await db.update(schema.verification_results).set({ content_hash: delivery.content_hash }).where(eq(schema.verification_results.trade_id, trade.id))
  assert.equal((await load(seller))[0].accepted_completion_count, 1)
  await db.delete(schema.transactions).where(eq(schema.transactions.reference_id, trade.id))
  assert.deepEqual(await load(seller), [])
  assert.equal((await (await filtered()).json()).total, 0)
  assert.equal((await db.select().from(schema.capability_performance_events).where(eq(schema.capability_performance_events.trade_id, trade.id))).length, 2)
})

test('known shared buyer owners collapse breadth and ownership changes remove self-dealing evidence', async () => {
  const seller = await provider('breadth')
  const buyerOne = await provider('buyer-one'), buyerTwo = await provider('buyer-two')
  for (const buyer of [buyerOne, buyerTwo]) {
    await db.insert(schema.agent_owners).values({ agentId: buyer, userId: 'performance-buyer', establishedBy: 'test-fixture' })
    await backed(seller, `user_agent_${buyer}`)
  }
  await backed(seller, 'performance-buyer')
  let rows = await load(seller)
  assert.equal(rows[0].accepted_completion_count, 3)
  assert.equal(rows[0].distinct_buyer_count, 1)
  assert.equal(rows[0].buyer_independence, 'not_verified')
  await db.insert(schema.agent_owners).values({ agentId: seller, userId: 'performance-buyer', establishedBy: 'test-fixture' })
  rows = await load(seller)
  assert.deepEqual(rows, [])
})

test('direct reciprocal completed trades cannot inflate capability evidence', async () => {
  const seller = await provider('reciprocal'), buyer = await provider('reciprocal-buyer')
  await backed(seller, `user_agent_${buyer}`)
  assert.equal((await load(seller))[0].accepted_completion_count, 1)
  await backed(buyer, `user_agent_${seller}`)
  assert.deepEqual(await load(seller), [])
  assert.deepEqual(await load(buyer), [])
})

test('controlled route cohorts do not become public capability evidence and raw events remain intact', async () => {
  const seller = await provider('cohorts')
  for (const cohort of ['canary', 'demo', 'reference', 'nonproduction'] as const) {
    const trade = await backed(seller)
    const [order] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, trade.id))
    const routeId = crypto.randomUUID()
    await db.insert(schema.route_plans).values({ id: routeId, buyer_id: trade.buyer_id, client_reference: crypto.randomUUID(), objective: 'Controlled authentication review', required_capabilities: '["security-analysis"]', max_budget_minor: 200, state: 'completed', service_order_id: order.id, expires_at: new Date(Date.now() + 10000) })
    await db.insert(schema.route_origins).values({ route_id: routeId, channel: 'account', cohort })
  }
  assert.deepEqual(await load(seller), [])
  assert.equal((await db.select().from(schema.capability_performance_events).where(eq(schema.capability_performance_events.seller_agent_id, seller))).length, 8)
})

test('repeated backed work does not promote unmeasured independent quality confidence', async () => {
  const seller = await provider('confidence')
  for (let i = 0; i < 20; i++) await backed(seller)
  const row = (await load(seller))[0]
  assert.equal(row.accepted_completion_count, 20)
  assert.equal(row.distinct_buyer_count, 1)
  assert.equal(row.confidence, 'low')
  assert.equal(row.confidence_scope, 'independent_quality_unmeasured')
  assert.equal(row.measured_quality_score, null)
})

test('basic challenge success records a format check without adding verified tags or routing evidence', async () => {
  const seller = await provider('challenge')
  const apiKey = `dummy-format-check-${seller}`
  const { hashAgentApiKey } = await import('@/lib/registered-agent-auth')
  await db.update(schema.agents).set({ api_key: hashAgentApiKey(apiKey), capabilities: '["data-extraction"]' }).where(eq(schema.agents.id, seller))
  const { POST: requestChallenge } = await import('@/app/api/benchmarks/challenge/[capability]/route')
  const { POST: submit } = await import('@/app/api/benchmarks/challenge/[capability]/submit/route')
  const context = { params: Promise.resolve({ capability: 'data-extraction' }) }
  const req = (path: string, body?: unknown) => new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const created = await requestChallenge(req('/api/benchmarks/challenge/data-extraction'), context)
  assert.equal(created.status, 201)
  const challenge = await created.json()
  assert.equal(challenge.evidence.measured_quality, false)
  const response = await submit(req('/api/benchmarks/challenge/data-extraction/submit', { challenge_id: challenge.challenge_id, response: { names: ['Alice', 'Bob'] } }), context)
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.passed, true)
  assert.equal(result.verified_capability, null)
  assert.deepEqual(result.evidence, { kind: 'basic_format_check', independent: false, measured_quality: false, routing_eligible: false })
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, seller))
  assert.equal(agent.capabilities, '["data-extraction"]')
  assert.deepEqual(await load(seller), [])
  assert.equal((await submit(req('/api/benchmarks/challenge/data-extraction/submit', { challenge_id: challenge.challenge_id, response: { names: ['Alice', 'Bob'] } }), context)).status, 400)
  for (const body of [null, {}, { challenge_id: challenge.challenge_id, response: [] }]) assert.equal((await submit(req('/api/benchmarks/challenge/data-extraction/submit', body), context)).status, 400)
})

test('external proof projections require current matching funding and confirmed payout on both rails', async () => {
  for (const rail of ['evm', 'mpp'] as const) {
    const seller = await provider(`external-${rail}`)
    const trade = await backed(seller)
    await db.update(schema.trades).set({ payment_rail: rail, total_cost: 1.05, seller_amount: 1 }).where(eq(schema.trades.id, trade.id))
    await db.update(schema.service_orders).set({ payment_rail: rail }).where(eq(schema.service_orders.trade_id, trade.id))
    assert.deepEqual(await load(seller), [])
    const chainId = rail === 'evm' ? 8453 : 4217, token = `0x${'11'.repeat(20)}`
    await db.insert(schema.payment_receipts).values({ route: `/api/trades/${trade.id}/fund/${rail}`, trade_id: trade.id, payment_rail: rail, amount: 1.05, currency: 'USD', usd_value_at_payment: 1.05, chain_id: chainId, token_address: token, tx_hash: `0x${crypto.randomUUID().replaceAll('-', '').repeat(2)}` })
    const [payout] = await db.insert(schema.settlement_transfers).values({ business_key: `${trade.id}:seller_payout`, trade_id: trade.id, kind: 'seller_payout', chain_id: chainId, token_address: token, from_address: token, to_address: token, token_amount: '1000000', usd_amount: 1, status: 'submitted', tx_hash: `0x${crypto.randomUUID().replaceAll('-', '').repeat(2)}` }).returning()
    assert.deepEqual(await load(seller), [])
    await db.update(schema.settlement_transfers).set({ status: 'confirmed', confirmed_at: new Date() }).where(eq(schema.settlement_transfers.id, payout.id))
    assert.equal((await load(seller))[0].accepted_completion_count, 1)
    await db.update(schema.settlement_transfers).set({ chain_id: chainId + 1 }).where(eq(schema.settlement_transfers.id, payout.id))
    assert.deepEqual(await load(seller), [])
    await db.update(schema.settlement_transfers).set({ chain_id: chainId, usd_amount: .99 }).where(eq(schema.settlement_transfers.id, payout.id))
    assert.deepEqual(await load(seller), [])
  }
})

test('credit capability proof requires the exact original purchase, release and seller entry', async () => {
  const seller = await provider('credit-proof'), trade = await backed(seller)
  await db.update(schema.trades).set({ payment_rail: 'credit', total_cost: 1.05 }).where(eq(schema.trades.id, trade.id))
  await db.update(schema.service_orders).set({ payment_rail: 'credit' }).where(eq(schema.service_orders.trade_id, trade.id))
  await db.insert(schema.credit_entries).values([
    { user_id: trade.buyer_id, reference: trade.id, kind: 'purchase', available_delta: -105, escrow_delta: 100 },
    { user_id: trade.seller_id, reference: trade.id, kind: 'sale', available_delta: 100, escrow_delta: 0 },
  ])
  assert.deepEqual(await load(seller), [])
  const [release] = await db.insert(schema.credit_entries).values({ user_id: trade.buyer_id, reference: trade.id, kind: 'settlement', available_delta: 0, escrow_delta: -100 }).returning()
  assert.equal((await load(seller))[0].accepted_completion_count, 1)
  await db.update(schema.credit_entries).set({ escrow_delta: -99 }).where(eq(schema.credit_entries.id, release.id))
  assert.deepEqual(await load(seller), [])
})

test('format checks reject fabricated word counts and another agent cannot submit the challenge', async () => {
  const seller = await provider('summary-format'), other = await provider('other-format')
  const { hashAgentApiKey } = await import('@/lib/registered-agent-auth')
  for (const id of [seller, other]) await db.update(schema.agents).set({ api_key: hashAgentApiKey(`dummy-${id}`) }).where(eq(schema.agents.id, id))
  const { POST: requestChallenge } = await import('@/app/api/benchmarks/challenge/[capability]/route')
  const { POST: submit } = await import('@/app/api/benchmarks/challenge/[capability]/submit/route')
  const context = { params: Promise.resolve({ capability: 'summarization' }) }
  const req = (id: string, body?: unknown) => new NextRequest('http://localhost/api/benchmarks/challenge/summarization', { method: 'POST', headers: { Authorization: `Bearer dummy-${id}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const created = await requestChallenge(req(seller), context)
  const { challenge_id } = await created.json()
  const body = { challenge_id, response: { summary: Array(21).fill('word').join(' '), word_count: 1 } }
  assert.equal((await submit(req(other, body), context)).status, 403)
  const result = await submit(req(seller, body), context)
  assert.equal(result.status, 200)
  assert.equal((await result.json()).passed, false)
  const again = await requestChallenge(req(seller), context)
  const valid = { challenge_id: (await again.json()).challenge_id, response: { summary: 'A short summary', word_count: 3 } }
  const raced = await Promise.all([submit(req(seller, valid), context), submit(req(seller, valid), context)])
  assert.equal(raced.filter((response) => response.status === 200).length, 1)
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, seller))
  assert.equal(agent.capabilities, '["security-analysis:verified"]') // Historical declaration is preserved, never evidence.
  assert.deepEqual(await load(seller), [])
})
