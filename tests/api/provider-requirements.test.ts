import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { createClient } from '@libsql/client'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import type { ProviderRequirements } from '@/lib/provider-requirements'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let token: typeof import('@/lib/auth').generateJWT
let createOrder: typeof import('@/app/api/services/[id]/orders/route').POST
let funding: typeof import('@/lib/trade-funding')
const treasury = privateKeyToAccount(`0x${'88'.repeat(32)}`)
const tokenAddress = `0x${'44'.repeat(20)}`

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-provider-evidence-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'evidence.db')}`
  process.env.JWT_SECRET = 'provider-evidence-tests-only'
  process.env.CHAT_ENCRYPTION_KEY = 'provider-evidence-tests-only'
  process.env.TREASURY_ADDRESS = treasury.address
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'88'.repeat(32)}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Test Base', address: tokenAddress,
    symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: 'https://rpc.example.invalid' }])
  process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED = 'true'
  process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED = 'true'
  process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED = 'true'
  delete process.env.MPP_SECRET_KEY
  delete process.env.MPP_SECRET_KEY_CURRENT
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  token = (await import('@/lib/auth')).generateJWT
  createOrder = (await import('@/app/api/services/[id]/orders/route')).POST
  funding = await import('@/lib/trade-funding')
})
after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

function request(path: string, userId: string, body?: unknown, method = 'POST') {
  return new NextRequest(`http://localhost${path}`, { method,
    headers: { Authorization: `Bearer ${token({ userId, email: `${userId}@test.invalid`, role: 'human' })}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
const context = (id: string) => ({ params: Promise.resolve({ id }) })
async function fixture(protocol: 'manual' | 'leased_v1' = 'manual') {
  const id = crypto.randomUUID(), agentId = `evidence-${id}`, sellerId = `user_agent_${agentId}`, buyerId = `buyer-${id}`, pastBuyer = `past-buyer-${id}`
  await db.insert(schema.users).values([sellerId, buyerId, pastBuyer].map((userId) => ({ id: userId, name: userId,
    email: `${userId}@test.invalid`, password_hash: 'unused', role: 'human' as const })))
  await db.insert(schema.agents).values({ id: agentId, name: 'Provider', description: 'Provider test fixture', capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: `key-${id}`, status: 'active', visibility: 'public' })
  await db.insert(schema.payout_addresses).values({ user_id: sellerId, address: treasury.address })
  await db.insert(schema.service_definitions).values({ id, seller_id: sellerId, title: 'Evidence fixture', description: 'Review code with a saved contract.',
    capabilities: '["code-review"]', price_minor: 100, estimated_latency_seconds: 120, max_concurrency: 3, status: 'active', provider_protocol: protocol,
    output_schema: JSON.stringify({ type: 'object', properties: { result: { type: 'string' } }, required: ['result'] }),
    verification_policy: JSON.stringify({ required: true, methods: ['buyer_review', 'schema'] }) })
  return { id, agentId, sellerId, buyerId, pastBuyer }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function setPolicy(f: Fixture, policy: Record<string, unknown>) {
  await db.insert(schema.buyer_spend_policies).values({ buyer_id: f.buyerId, owner_account_id: f.buyerId, policy_json: JSON.stringify(policy) })
    .onConflictDoUpdate({ target: schema.buyer_spend_policies.buyer_id, set: { policy_json: JSON.stringify(policy) } })
}
function order(f: Fixture, requirements: ProviderRequirements = {}, reference = `order-${crypto.randomUUID()}`) {
  return createOrder(request(`/api/services/${f.id}/orders`, f.buyerId, { client_reference: reference,
    objective: 'Review this code for correctness', payment_rail: 'evm', provider_requirements: requirements }), context(f.id))
}
async function checkout(f: Fixture, requirements: ProviderRequirements = {}) {
  const response = await order(f, requirements)
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  const result = await response.json()
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, result.trade.id))
  const [saved] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, result.order.id))
  return { trade, order: saved }
}
async function completion(f: Fixture, buyerId = f.pastBuyer) {
  const [listing] = await db.insert(schema.listings).values({ seller_id: f.sellerId, category: 'skills', title: 'Historical review', description: 'Accepted historical review', price_bankr: 1, status: 'sold' }).returning()
  const [trade] = await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: buyerId, seller_id: f.sellerId, amount: 1, fee: 0.05, total_cost: 1.05, status: 'completed', payment_rail: 'ledger' }).returning()
  await db.insert(schema.service_orders).values({ id: crypto.randomUUID(), service_id: f.id, listing_id: listing.id, trade_id: trade.id, buyer_id: buyerId,
    client_reference: crypto.randomUUID(), objective: 'Review historical code', price_minor: 100, payment_rail: 'ledger', state: 'completed' })
  const [delivery] = await db.insert(schema.trade_deliveries).values({ trade_id: trade.id, submitter_id: f.sellerId, summary: 'Historical code review.', content_hash: crypto.randomUUID(), verification: '{}' }).returning()
  await db.insert(schema.verification_results).values({ id: crypto.randomUUID(), trade_id: trade.id, delivery_id: delivery.id, content_hash: delivery.content_hash,
    method: 'buyer_review', verifier: 'buyer', version: '1', status: 'passed', evidence_json: '{}' })
  await db.insert(schema.transactions).values({ type: 'escrow_lock', amount: 1, reference_id: trade.id })
  const { recordCapabilityCompletion } = await import('@/lib/capability-performance')
  await db.transaction((tx) => recordCapabilityCompletion(tx, trade))
  return trade
}
async function plan(f: Fixture, requirements: ProviderRequirements = {}) {
  const { planRoute, routePlanInput } = await import('@/lib/route-planning')
  return planRoute(routePlanInput.parse({ client_reference: `plan-${crypto.randomUUID()}`, objective: 'Review this code for correctness', required_capabilities: ['code-review'],
    max_budget: { amount: '2.00', currency: 'USD' }, provider_requirements: requirements }), f.buyerId)
}
function proof(trade: typeof schema.trades.$inferSelect, rail: 'evm' | 'mpp' = 'evm') {
  return { trade, rail, txHash: `0x${crypto.randomUUID().replaceAll('-', '').repeat(2)}`, externalId: crypto.randomUUID(), payerAddress: `0x${'11'.repeat(20)}`,
    tokenAddress, chainId: 8453, tokenSymbol: 'USDC', tokenDecimals: 6, tokenAmount: 1_050_000n, tokenUsdPrice: 1, usdValue: 1.05 }
}

test('claim-only providers require explicit approval or backed evidence, with no economic side effects on rejection', async () => {
  const f = await fixture()
  const claimed = (await plan(f)).candidates.find((c) => c.service_id === f.id)!
  assert.equal(claimed.eligibility.confidence, 'unmeasured')
  assert.equal(claimed.eligibility.buyer_independence, 'not_verified')
  for (const [requirements, code] of [[{ minimum_accepted_completions: 1 }, 'PROVIDER_EVIDENCE_REQUIRED'], [{ minimum_distinct_buyers: 1 }, 'PROVIDER_EVIDENCE_REQUIRED'], [{ approved_providers: ['someone-else'] }, 'PROVIDER_NOT_APPROVED']] as const) {
    assert.equal((await plan(f, requirements as ProviderRequirements)).candidates.some((c) => c.service_id === f.id), false)
    const response = await order(f, requirements as ProviderRequirements)
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error_code, code)
  }
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyerId))).length, 0)
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.id)))[0].active_orders, 0)
  assert.equal((await order(f, { approved_providers: [f.agentId] })).status, 201)
})

test('backed thresholds use every required capability and distinct buyer accounts rather than repeated orders', async () => {
  const f = await fixture()
  await completion(f); await completion(f)
  const requirements = { minimum_accepted_completions: 2, minimum_distinct_buyers: 2 }
  assert.equal((await plan(f, requirements)).candidates.some((c) => c.service_id === f.id), false)
  assert.equal((await order(f, requirements)).status, 409)
  await completion(f, f.buyerId)
  const candidate = (await plan(f, requirements)).candidates.find((c) => c.service_id === f.id)!
  assert.equal(candidate.eligibility.confidence, 'backed_completion_observed')
  assert.deepEqual(candidate.capability_evidence, [{ capability_id: 'code-review', accepted_completion_count: 3, distinct_buyer_count: 2, measured_quality_score: null }])
  const c = await checkout(f, requirements)
  assert.equal((await funding.recordExternalTradeFunding(proof(c.trade))).status, 'escrow_held')
  await db.update(schema.service_definitions).set({ capabilities: '["code-review","translation"]' }).where(eq(schema.service_definitions.id, f.id))
  assert.equal((await order(f, { minimum_accepted_completions: 1 })).status, 409, 'New claims lack observations')
})

test('saved buyer requirements intersect the request and cannot be relaxed', async () => {
  const f = await fixture()
  await setPolicy(f, { provider_requirements: { minimum_distinct_buyers: 1 } })
  assert.equal((await order(f, { approved_providers: [f.sellerId] })).status, 409)
  await completion(f)
  assert.equal((await order(f, { approved_providers: ['other'] })).status, 409)
  assert.equal((await order(f)).status, 201)
})

test('current ownership links and missing economic proof remove historical eligibility', async () => {
  const f = await fixture(), historical = await completion(f)
  assert.equal((await plan(f, { minimum_accepted_completions: 1 })).candidates.some((c) => c.service_id === f.id), true)
  await db.insert(schema.agent_owners).values({ agentId: f.agentId, userId: f.pastBuyer, establishedBy: 'test' })
  assert.equal((await order(f, { minimum_accepted_completions: 1 })).status, 409)
  await db.delete(schema.agent_owners).where(eq(schema.agent_owners.agentId, f.agentId))
  await db.delete(schema.transactions).where(eq(schema.transactions.reference_id, historical.id))
  assert.equal((await plan(f, { minimum_accepted_completions: 1 })).candidates.some((c) => c.service_id === f.id), false)
})

test('reservation sees evidence invalidated by another connection immediately before its transaction', async () => {
  const f = await fixture(); await completion(f)
  const worker = createClient({ url: process.env.TURSO_DATABASE_URL! }), original = db.transaction.bind(db)
  let changed = false
  Reflect.set(db, 'transaction', async (callback: Parameters<typeof db.transaction>[0]) => {
    if (!changed) { changed = true; await worker.execute({ sql: 'INSERT INTO agent_owners (agent_id, user_id, established_by, established_at, updated_at) VALUES (?, ?, ?, ?, ?)', args: [f.agentId, f.pastBuyer, 'test', 1, 1] }) }
    return original(callback)
  })
  try {
    const response = await order(f, { minimum_accepted_completions: 1 })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error_code, 'PROVIDER_EVIDENCE_REQUIRED')
    assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.id)))[0].active_orders, 0)
  } finally { Reflect.set(db, 'transaction', original); worker.close() }
})

test('exact checkout replay survives tightened policy but changed requirements conflict and new payment is blocked', async () => {
  const f = await fixture(), reference = `replay-${crypto.randomUUID()}`
  const first = await order(f, {}, reference), body = await first.json()
  assert.equal(first.status, 201)
  await setPolicy(f, { provider_requirements: { minimum_accepted_completions: 1 } })
  const replay = await order(f, {}, reference)
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).trade.id, body.trade.id)
  assert.equal((await order(f, { approved_providers: [f.sellerId] }, reference)).status, 409)
  const intent = await import('@/app/api/trades/[id]/fund/evm/intent/route')
  const response = await intent.POST(request('/intent', f.buyerId, { chain_id: 8453, token_address: tokenAddress, payer_address: treasury.address }), context(body.trade.id))
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'PROVIDER_ELIGIBILITY_CHANGED')
  const recovered = await intent.POST(request('/intent', f.buyerId, { chain_id: 8453, token_address: tokenAddress, payer_address: treasury.address, recovery_tx_hash: `0x${'ab'.repeat(32)}` }), context(body.trade.id))
  assert.equal(recovered.status, 200)
  assert.equal((await recovered.json()).created, false)
})

test('intent reads eligibility inside its transaction and an existing intent only returns recovery, never another send', async () => {
  const f = await fixture(), c = await checkout(f)
  const intent = await import('@/app/api/trades/[id]/fund/evm/intent/route')
  const worker = createClient({ url: process.env.TURSO_DATABASE_URL! }), original = db.transaction.bind(db)
  Reflect.set(db, 'transaction', async (callback: Parameters<typeof db.transaction>[0]) => {
    await worker.execute({ sql: 'INSERT INTO buyer_spend_policies (buyer_id, owner_account_id, policy_json, version, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1)', args: [f.buyerId, f.buyerId, JSON.stringify({ blocked_providers: [f.sellerId] })] })
    return original(callback)
  })
  const body = { chain_id: 8453, token_address: tokenAddress, payer_address: treasury.address }
  try { assert.equal((await intent.POST(request('/intent', f.buyerId, body), context(c.trade.id))).status, 409) }
  finally { Reflect.set(db, 'transaction', original); worker.close() }
  await setPolicy(f, {})
  assert.equal((await intent.POST(request('/intent', f.buyerId, body), context(c.trade.id))).status, 201)
  await setPolicy(f, { blocked_providers: [f.sellerId] })
  const replay = await intent.POST(request('/intent', f.buyerId, body), context(c.trade.id))
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).created, false)
})

test('a verified payment after evidence invalidation commits proof and cancellation, releases capacity and never dispatches', async () => {
  for (const rail of ['evm', 'mpp'] as const) {
    const f = await fixture('leased_v1'); await completion(f)
    const c = await checkout(f, { minimum_accepted_completions: 1 })
    if (rail === 'mpp') { await db.update(schema.trades).set({ payment_rail: rail }).where(eq(schema.trades.id, c.trade.id)); await db.update(schema.service_orders).set({ payment_rail: rail }).where(eq(schema.service_orders.id, c.order.id)); c.trade.payment_rail = rail }
    await db.insert(schema.agent_owners).values({ agentId: f.agentId, userId: f.pastBuyer, establishedBy: 'test' })
    const input = proof(c.trade, rail)
    await assert.rejects(funding.recordExternalTradeFunding(input), (error: any) => error.code === 'PROVIDER_ELIGIBILITY_CHANGED')
    const [cancelled] = await db.select().from(schema.trades).where(eq(schema.trades.id, c.trade.id))
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.payout_status, 'processing')
    assert.equal(cancelled.fee_tx_hash, input.txHash)
    const receipts = await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, c.trade.id))
    assert.equal(receipts.length, 1); assert.equal(receipts[0].tx_hash, input.txHash)
    assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, c.order.id)))[0].state, 'cancelled')
    assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.id)))[0].active_orders, 0)
    assert.equal((await db.select().from(schema.service_execution_attempts).where(eq(schema.service_execution_attempts.order_id, c.order.id))).length, 0)
    assert.equal((await funding.recordCancelledExternalFunding({ ...input, trade: cancelled })).id, cancelled.id)
    await assert.rejects(funding.recordCancelledExternalFunding({ ...input, trade: cancelled, externalId: 'different' }), (error: any) => error.code === 'PAYMENT_PROOF_REUSED')
    const { refundCancelledExternalTrade } = await import('@/lib/external-settlement')
    // Use the real durable refund queue without touching a network or signing a transaction.
    // MPP uses its own configured recipient; the EVM half verifies this shared refund contract.
    if (rail === 'evm') {
      const refund = await refundCancelledExternalTrade(cancelled, { process: false })
      assert.equal(refund.transfers[0].kind, 'buyer_refund'); assert.equal(refund.transfers[0].token_amount, '1050000')
      assert.equal((await refundCancelledExternalTrade(cancelled, { process: false })).transfers[0].id, refund.transfers[0].id)
    }
  }
})

test('a reused proof rolls back eligibility cancellation and capacity release', async () => {
  const first = await fixture(), a = await checkout(first), input = proof(a.trade)
  await funding.recordExternalTradeFunding(input)
  const second = await fixture(), b = await checkout(second)
  await setPolicy(second, { blocked_providers: [second.sellerId] })
  await assert.rejects(funding.recordExternalTradeFunding({ ...input, trade: b.trade }), (error: any) => error.code === 'PAYMENT_PROOF_REUSED')
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.id, b.trade.id)))[0].status, 'pending')
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, second.id)))[0].active_orders, 1)
})

test('funding accepts the already counted budget and rejects edited contracts, identity and malformed saved requirements', async () => {
  const allowed = await fixture(), c = await checkout(allowed)
  await setPolicy(allowed, { max_daily: 105, max_monthly: 105 })
  assert.equal((await funding.recordExternalTradeFunding(proof(c.trade))).status, 'escrow_held')
  for (const mutation of ['protocol', 'schema', 'identity', 'capability', 'snapshot', 'requirements', 'policy', 'payout', 'visibility'] as const) {
    const f = await fixture(), pending = await checkout(f)
    if (mutation === 'protocol') await db.update(schema.service_definitions).set({ provider_protocol: 'leased_v1' }).where(eq(schema.service_definitions.id, f.id))
    if (mutation === 'schema') await db.update(schema.service_definitions).set({ output_schema: '{}' }).where(eq(schema.service_definitions.id, f.id))
    if (mutation === 'identity') await db.update(schema.service_definitions).set({ seller_id: f.pastBuyer }).where(eq(schema.service_definitions.id, f.id))
    if (mutation === 'capability') await db.update(schema.service_definitions).set({ capabilities: '["translation"]' }).where(eq(schema.service_definitions.id, f.id))
    if (mutation === 'snapshot') await db.update(schema.service_orders).set({ execution_contract_json: '{}' }).where(eq(schema.service_orders.id, pending.order.id))
    if (mutation === 'requirements') await db.update(schema.service_orders).set({ provider_requirements_json: '{bad' }).where(eq(schema.service_orders.id, pending.order.id))
    if (mutation === 'payout') await db.delete(schema.payout_addresses).where(eq(schema.payout_addresses.user_id, f.sellerId))
    if (mutation === 'visibility') await db.update(schema.agents).set({ visibility: 'private' }).where(eq(schema.agents.id, f.agentId))
    if (mutation === 'policy') await setPolicy(f, { max_daily: 100 })
    await assert.rejects(funding.recordExternalTradeFunding(proof(pending.trade)), (error: any) => error.code === 'PROVIDER_ELIGIBILITY_CHANGED', mutation)
  }
})

test('post-funding service edits cannot change work, leased protocol, delivery verification or credited capabilities', async () => {
  const f = await fixture('leased_v1'), c = await checkout(f)
  await funding.recordExternalTradeFunding(proof(c.trade))
  await db.update(schema.service_definitions).set({ capabilities: '["translation"]', provider_protocol: 'manual', output_schema: '{}', verification_policy: '{bad', title: 'Edited title' }).where(eq(schema.service_definitions.id, f.id))
  const { GET } = await import('@/app/api/trades/[id]/work-order/route')
  const response = await GET(request('/work-order', f.sellerId, undefined, 'GET'), context(c.trade.id))
  assert.equal(response.status, 200)
  const work = (await response.json()).work_order
  assert.equal(work.provider_protocol, 'leased_v1'); assert.equal(work.service_title, 'Evidence fixture')
  assert.equal(work.contract_source, 'checkout_snapshot'); assert.deepEqual(work.capabilities, ['code-review'])
  const { POST: action } = await import('@/app/api/trades/[id]/work-order/attempt/route')
  assert.equal((await action(request('/attempt', f.sellerId, { action: 'accept', attempt_id: work.execution_attempt.id }), context(c.trade.id))).status, 201)
  const { submitTradeDelivery } = await import('@/lib/trade-delivery')
  await assert.rejects(submitTradeDelivery(c.trade.id, f.sellerId, { summary: 'Review is finished.', execution_attempt_id: work.execution_attempt.id, artifact: { wrong: true } }), (error: any) => error.status === 422)
  await submitTradeDelivery(c.trade.id, f.sellerId, { summary: 'Review is finished.', execution_attempt_id: work.execution_attempt.id, artifact: { result: 'Reviewed' } })
  const [delivery] = await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, c.trade.id))
  await db.update(schema.verification_results).set({ status: 'passed' }).where(eq(schema.verification_results.delivery_id, delivery.id))
  await db.update(schema.trades).set({ status: 'completed' }).where(eq(schema.trades.id, c.trade.id))
  await db.insert(schema.settlement_transfers).values({ business_key: `${c.trade.id}:seller_payout`, trade_id: c.trade.id, kind: 'seller_payout', chain_id: 8453, token_address: tokenAddress,
    from_address: treasury.address, to_address: treasury.address, token_amount: '1000000', usd_amount: 1, status: 'confirmed', tx_hash: `0x${'fa'.repeat(32)}` })
  const { recordCapabilityCompletion } = await import('@/lib/capability-performance')
  await db.transaction((tx) => recordCapabilityCompletion(tx, c.trade))
  const events = await db.select().from(schema.capability_performance_events).where(eq(schema.capability_performance_events.trade_id, c.trade.id))
  assert.deepEqual(events.map((e) => e.capability_id), ['code-review'])
})

test('saved route execution rechecks evidence and freezes only its requested capabilities', async () => {
  const f = await fixture(); await completion(f)
  await db.update(schema.service_definitions).set({ capabilities: '["code-review","translation"]' }).where(eq(schema.service_definitions.id, f.id))
  const { POST: makePlan } = await import('@/app/api/routes/plan/route')
  const { POST: execute } = await import('@/app/api/routes/[id]/execute/route')
  const body = { client_reference: `saved-evidence-${crypto.randomUUID()}`, objective: 'Review this code for correctness', required_capabilities: ['code-review'],
    max_budget: { amount: '2.00', currency: 'USD' }, provider_requirements: { approved_providers: [f.sellerId], minimum_accepted_completions: 1 } }
  const response = await makePlan(request('/plan', f.buyerId, body))
  assert.equal(response.status, 201)
  const saved = (await response.json()).route
  assert.equal(saved.candidates.length, 1)
  const reserved = await execute(request('/execute', f.buyerId), context(saved.id))
  assert.equal(reserved.status, 201)
  const result = await reserved.json()
  assert.deepEqual(JSON.parse(result.order.execution_contract.capabilities), ['code-review'])
  assert.deepEqual(result.order.provider_requirements, body.provider_requirements)
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, result.trade.id))
  assert.equal((await funding.recordExternalTradeFunding(proof(trade))).status, 'escrow_held')

  const g = await fixture(); await completion(g)
  const planned = await makePlan(request('/plan', g.buyerId, { ...body, client_reference: `stale-evidence-${crypto.randomUUID()}`, provider_requirements: { approved_providers: [g.sellerId], minimum_accepted_completions: 1 } }))
  const stale = (await planned.json()).route
  await db.insert(schema.agent_owners).values({ agentId: g.agentId, userId: g.pastBuyer, establishedBy: 'test' })
  const rejected = await execute(request('/execute', g.buyerId), context(stale.id))
  assert.equal(rejected.status, 409)
  assert.equal((await rejected.json()).error_code, 'PROVIDER_EVIDENCE_REQUIRED')
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.buyer_id, g.buyerId))).length, 0)
})

test('funding reads policy committed by another connection immediately before its transaction', async () => {
  const f = await fixture(), c = await checkout(f)
  const worker = createClient({ url: process.env.TURSO_DATABASE_URL! }), original = db.transaction.bind(db)
  let changed = false
  Reflect.set(db, 'transaction', async (callback: Parameters<typeof db.transaction>[0]) => {
    if (!changed) {
      changed = true
      await worker.execute({ sql: 'INSERT INTO buyer_spend_policies (buyer_id, owner_account_id, policy_json, version, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 1)', args: [f.buyerId, f.buyerId, JSON.stringify({ provider_requirements: { minimum_accepted_completions: 1 } })] })
    }
    return original(callback)
  })
  try { await assert.rejects(funding.recordExternalTradeFunding(proof(c.trade)), (error: any) => error.code === 'PROVIDER_ELIGIBILITY_CHANGED') }
  finally { Reflect.set(db, 'transaction', original); worker.close() }
  assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, c.trade.id))).length, 1)
})

test('malformed saved snapshots never fall back to editable work terms; legacy orders explicitly retain their old behavior', async () => {
  const f = await fixture(), c = await checkout(f)
  await funding.recordExternalTradeFunding(proof(c.trade))
  const { GET } = await import('@/app/api/trades/[id]/work-order/route')
  await db.update(schema.service_orders).set({ execution_contract_json: '{}' }).where(eq(schema.service_orders.id, c.order.id))
  assert.equal((await GET(request('/work', f.sellerId, undefined, 'GET'), context(c.trade.id))).status, 500)
  await db.update(schema.service_orders).set({ execution_contract_json: null }).where(eq(schema.service_orders.id, c.order.id))
  const legacy = await GET(request('/work', f.sellerId, undefined, 'GET'), context(c.trade.id))
  assert.equal(legacy.status, 200)
  assert.equal((await legacy.json()).work_order.contract_source, 'legacy_current_definition')
})


test('an unpaid MPP request rejects changed provider requirements before issuing a challenge', async () => {
  const f = await fixture(), c = await checkout(f)
  await db.update(schema.trades).set({ payment_rail: 'mpp' }).where(eq(schema.trades.id, c.trade.id))
  await db.update(schema.service_orders).set({ payment_rail: 'mpp' }).where(eq(schema.service_orders.id, c.order.id))
  await setPolicy(f, { provider_requirements: { minimum_distinct_buyers: 1 } })
  const { POST } = await import('@/app/api/trades/[id]/fund/mpp/route')
  const response = await POST(request('/fund/mpp', f.buyerId), context(c.trade.id))
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'PROVIDER_ELIGIBILITY_CHANGED')
  assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, c.trade.id))).length, 0)
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.id, c.trade.id)))[0].status, 'pending')
})
