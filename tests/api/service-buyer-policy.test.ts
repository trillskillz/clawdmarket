import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { createClient } from '@libsql/client'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let token: typeof import('@/lib/auth').generateJWT
let createOrder: typeof import('@/app/api/services/[id]/orders/route').POST
let buyerPolicy: typeof import('@/lib/buyer-spend-policy')
type PolicyInput = Parameters<typeof import('@/lib/buyer-spend-policy').buyerSpendPolicyInput.parse>[0]
const treasury = privateKeyToAccount(`0x${'88'.repeat(32)}`)

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-service-policy-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'policy.db')}`
  process.env.JWT_SECRET = 'service-buyer-policy-tests-only'
  process.env.TREASURY_ADDRESS = treasury.address
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'88'.repeat(32)}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Test Base', address: `0x${'44'.repeat(20)}`,
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
  buyerPolicy = await import('@/lib/buyer-spend-policy')
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function request(path: string, userId: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method: 'POST',
    headers: { Authorization: `Bearer ${token({ userId, email: `${userId}@test.invalid`, role: 'human' })}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function fixture(prefix = 'account-buyer') {
  const id = crypto.randomUUID()
  const buyerId = `${prefix}-${id}`
  const sellerId = `policy-seller-${id}`
  await db.insert(schema.users).values([buyerId, sellerId].map((userId) => ({
    id: userId, name: userId, email: `${userId}@test.invalid`, password_hash: 'unused', role: 'human' as const,
  })))
  await db.insert(schema.payout_addresses).values({ user_id: sellerId, address: treasury.address })
  await db.insert(schema.wallets).values({ user_id: buyerId, balance: 10, escrow: 0 })
  await db.insert(schema.service_definitions).values({ id, seller_id: sellerId, title: 'Policy fixture',
    description: 'Review a repository under a saved buyer policy.', capabilities: '["code-review"]',
    price_minor: 100, estimated_latency_seconds: 120, max_concurrency: 2, status: 'active' })
  return { id, buyerId, sellerId }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

async function setPolicy(f: Fixture, input: PolicyInput) {
  const policy_json = JSON.stringify(buyerPolicy.buyerSpendPolicyInput.parse(input))
  await db.insert(schema.buyer_spend_policies).values({ buyer_id: f.buyerId, owner_account_id: f.buyerId, policy_json, version: 1 })
    .onConflictDoUpdate({ target: schema.buyer_spend_policies.buyer_id, set: { policy_json, version: 2 } })
}

function order(f: Fixture, reference = `policy-order-${crypto.randomUUID()}`, serviceId = f.id) {
  return createOrder(request(`/api/services/${serviceId}/orders`, f.buyerId, {
    client_reference: reference, objective: 'Review this repository for correctness', payment_rail: 'evm',
  }), { params: Promise.resolve({ id: serviceId }) })
}

async function snapshot(f: Fixture) {
  return {
    services: await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.seller_id, f.sellerId)),
    listings: await db.select().from(schema.listings).where(eq(schema.listings.seller_id, f.sellerId)),
    orders: await db.select().from(schema.service_orders).where(eq(schema.service_orders.buyer_id, f.buyerId)),
    trades: await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyerId)),
    wallet: await db.select().from(schema.wallets).where(eq(schema.wallets.user_id, f.buyerId)),
    receipts: await db.select().from(schema.payment_receipts),
    transfers: await db.select().from(schema.settlement_transfers),
    transactions: await db.select().from(schema.transactions),
  }
}

test('account buyer policies reject provider, capability, rail, verification, approval, and spend violations atomically', async () => {
  const f = await fixture()
  const before = await snapshot(f)
  for (const [policy, code] of [
    [{ max_per_execution: '1.04' }, 'BUYER_PER_EXECUTION_LIMIT'],
    [{ approval_required_above: '1.00' }, 'BUYER_APPROVAL_REQUIRED'],
    [{ max_daily: '1.04' }, 'BUYER_DAILY_LIMIT'],
    [{ max_monthly: '1.04' }, 'BUYER_MONTHLY_LIMIT'],
    [{ approved_providers: ['another-seller'] }, 'BUYER_PROVIDER_BLOCKED'],
    [{ blocked_providers: [f.sellerId] }, 'BUYER_PROVIDER_BLOCKED'],
    [{ allowed_capabilities: ['translation'] }, 'BUYER_CAPABILITY_BLOCKED'],
    [{ blocked_capabilities: ['code-review'] }, 'BUYER_CAPABILITY_BLOCKED'],
    [{ approved_payment_rails: ['mpp'] }, 'BUYER_PAYMENT_RAIL_BLOCKED'],
    [{ required_verification_methods: ['schema'] }, 'BUYER_VERIFICATION_REQUIRED'],
  ] as const) {
    await setPolicy(f, policy)
    const response = await order(f)
    assert.equal(response.status, 409, code)
    const body = await response.json()
    assert.equal(body.error_code, code)
    assert.equal(body.state, 'no_funds_moved')
    assert.equal(body.retryable, false)
    assert.deepEqual(await snapshot(f), before)
  }
})

test('an allowed account reservation includes fees and replays the same checkout after its policy tightens', async () => {
  const f = await fixture('user_wallet_test')
  await setPolicy(f, { max_per_execution: '1.05', max_daily: '1.05', max_monthly: '1.05', approval_required_above: '1.05',
    approved_providers: [f.sellerId], allowed_capabilities: ['code-review'], approved_payment_rails: ['evm'], required_verification_methods: ['buyer_review'] })
  const reference = `policy-replay-${crypto.randomUUID()}`
  const response = await order(f, reference)
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  const original = await response.json()
  assert.equal(original.trade.total_cost, 1.05)
  assert.equal(original.trade.status, 'pending')
  assert.equal(original.order.state, 'awaiting_funding')
  assert.deepEqual(await buyerPolicy.buyerPolicyUsage(f.buyerId), { reserved_or_spent_today_minor: 105, reserved_or_spent_month_minor: 105 })
  const saved = await snapshot(f)
  await setPolicy(f, { max_per_execution: '0.00', blocked_providers: [f.sellerId] })
  const replay = await order(f, reference)
  assert.equal(replay.status, 200)
  const body = await replay.json()
  assert.equal(body.idempotent, true)
  assert.equal(body.order.id, original.order.id)
  assert.equal(body.trade.id, original.trade.id)
  assert.deepEqual(body.checkout, original.checkout)
  assert.equal((await order(f)).status, 409)
  assert.deepEqual(await snapshot(f), saved)
})

test('concurrent reservations at different services cannot exceed an account daily or monthly ceiling', async () => {
  for (const [field, code] of [['max_daily', 'BUYER_DAILY_LIMIT'], ['max_monthly', 'BUYER_MONTHLY_LIMIT']] as const) {
    const f = await fixture()
    const secondId = crypto.randomUUID()
    await db.insert(schema.service_definitions).values({ id: secondId, seller_id: f.sellerId, title: 'Second policy fixture',
      description: 'Another independent capacity slot.', capabilities: '["code-review"]', price_minor: 100, status: 'active' })
    await setPolicy(f, { [field]: '1.05' })
    const responses = await Promise.all([order(f), order(f, `policy-second-${crypto.randomUUID()}`, secondId)])
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409])
    assert.equal((await responses.find((r) => r.status === 409)!.json()).error_code, code)
    const saved = await snapshot(f)
    assert.equal(saved.orders.length, 1)
    assert.equal(saved.trades.length, 1)
    assert.equal(saved.listings.length, 1)
    assert.equal(saved.services.reduce((sum, s) => sum + s.active_orders, 0), 1)
    assert.equal(saved.wallet[0].balance, 10)
    assert.equal(saved.wallet[0].escrow, 0)
    assert.equal((await buyerPolicy.buyerPolicyUsage(f.buyerId)).reserved_or_spent_today_minor, 105)
  }
})

test('an account reservation sees policy committed by another connection after service validation', async () => {
  const f = await fixture()
  await setPolicy(f, { max_per_execution: '2.00' })
  const before = await snapshot(f)
  const otherWorker = createClient({ url: process.env.TURSO_DATABASE_URL! })
  const originalTransaction = db.transaction.bind(db)
  let changed = false
  Reflect.set(db, 'transaction', async (callback: Parameters<typeof db.transaction>[0]) => {
    if (!changed) {
      changed = true
      await otherWorker.execute({ sql: 'UPDATE buyer_spend_policies SET policy_json = ?, version = version + 1 WHERE buyer_id = ?',
        args: [JSON.stringify(buyerPolicy.buyerSpendPolicyInput.parse({ blocked_providers: [f.sellerId] })), f.buyerId] })
    }
    return originalTransaction(callback)
  })
  try {
    const response = await order(f)
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error_code, 'BUYER_PROVIDER_BLOCKED')
    assert.equal(changed, true)
    assert.deepEqual(await snapshot(f), before)
  } finally { Reflect.set(db, 'transaction', originalTransaction); otherWorker.close() }
})

test('a reservation retry includes buyer exposure committed by another worker after rollback', async () => {
  const f = await fixture()
  await setPolicy(f, { max_daily: '1.05' })
  const [listing] = await db.insert(schema.listings).values({ seller_id: f.sellerId, category: 'skills', title: 'Other worker checkout',
    description: 'An independent checkout for the same buyer.', price_bankr: 1, status: 'sold' }).returning()
  const otherWorker = createClient({ url: process.env.TURSO_DATABASE_URL! })
  const originalTransaction = db.transaction.bind(db)
  const reference = `retried-policy-${crypto.randomUUID()}`
  const competingTradeId = crypto.randomUUID()
  let transactions = 0
  Reflect.set(db, 'transaction', async (callback: Parameters<typeof db.transaction>[0]) => {
    transactions += 1
    if (transactions !== 1) return originalTransaction(callback)
    try {
      return await originalTransaction(async (tx) => {
        await callback(tx)
        throw Object.assign(new Error('SQLITE_BUSY: injected rollback'), { code: 'SQLITE_BUSY' })
      })
    } catch (error) {
      await otherWorker.execute({ sql: `INSERT INTO trades (id, listing_id, buyer_id, seller_id, amount, fee, total_cost, payment_rail, status, created_at)
        VALUES (?, ?, ?, ?, 1, 0.05, 1.05, 'evm', 'pending', ?)`,
      args: [competingTradeId, listing.id, f.buyerId, f.sellerId, Math.floor(Date.now() / 1000)] })
      throw error
    }
  })
  try {
    const response = await order(f, reference)
    assert.equal(response.status, 409, JSON.stringify(await response.clone().json()))
    assert.equal((await response.json()).error_code, 'BUYER_DAILY_LIMIT')
    assert.equal(transactions, 2)
    const saved = await snapshot(f)
    assert.equal(saved.services[0].active_orders, 0)
    assert.equal(saved.orders.length, 0)
    assert.equal(saved.listings.length, 1)
    assert.equal(saved.trades.length, 1)
    assert.equal(saved.trades[0].id, competingTradeId)
    assert.equal(saved.wallet[0].balance, 10)
    assert.equal(saved.wallet[0].escrow, 0)
    assert.equal((await buyerPolicy.buyerPolicyUsage(f.buyerId)).reserved_or_spent_today_minor, 105)
  } finally { Reflect.set(db, 'transaction', originalTransaction); otherWorker.close() }
})

test('account route execution rechecks a saved policy and can recover the same plan after a permitted update', async () => {
  const f = await fixture()
  await setPolicy(f, { approved_providers: [f.sellerId], max_per_execution: '2.00' })
  const { POST: plan } = await import('@/app/api/routes/plan/route')
  const { POST: execute } = await import('@/app/api/routes/[id]/execute/route')
  const planned = await plan(request('/api/routes/plan', f.buyerId, {
    client_reference: `account-plan-${crypto.randomUUID()}`, objective: 'Review this repository for correctness',
    required_capabilities: ['code-review'], max_budget: { amount: '2.00', currency: 'USD' },
  }))
  assert.equal(planned.status, 201)
  const route = (await planned.json()).route
  assert.equal(route.candidates[0].service_id, f.id)
  const run = () => execute(request(`/api/routes/${route.id}/execute`, f.buyerId), { params: Promise.resolve({ id: route.id }) })
  const before = await snapshot(f)
  await setPolicy(f, { approved_providers: [f.sellerId], max_per_execution: '1.04' })
  const blocked = await run()
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json()).error_code, 'BUYER_PER_EXECUTION_LIMIT')
  assert.deepEqual(await snapshot(f), before)
  await setPolicy(f, { approved_providers: [f.sellerId], max_per_execution: '1.05' })
  const accepted = await run()
  assert.equal(accepted.status, 201, JSON.stringify(await accepted.clone().json()))
  const original = await accepted.json()
  await setPolicy(f, { blocked_providers: [f.sellerId] })
  const replay = await run()
  assert.equal(replay.status, 200)
  const body = await replay.json()
  assert.equal(body.order.id, original.order.id)
  assert.equal(body.trade.id, original.trade.id)
  assert.equal((await snapshot(f)).orders.length, 1)
})

test('cancelled account checkout keeps its budget exposure and an account without a policy stays compatible', async () => {
  const f = await fixture()
  const created = await order(f)
  assert.equal(created.status, 201)
  const original = await created.json()
  await setPolicy(f, { max_daily: '1.05' })
  const { POST: cancel } = await import('@/app/api/trades/[id]/cancel/route')
  const cancelled = await cancel(request(`/api/trades/${original.trade.id}/cancel`, f.buyerId, {}), { params: Promise.resolve({ id: original.trade.id }) })
  assert.equal(cancelled.status, 200)
  const before = await snapshot(f)
  assert.equal(before.services[0].active_orders, 0)
  const blocked = await order(f)
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json()).error_code, 'BUYER_DAILY_LIMIT')
  assert.deepEqual(await snapshot(f), before)
  assert.equal((await buyerPolicy.buyerPolicyUsage(f.buyerId)).reserved_or_spent_today_minor, 105)
})
