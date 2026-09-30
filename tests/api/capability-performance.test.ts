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
