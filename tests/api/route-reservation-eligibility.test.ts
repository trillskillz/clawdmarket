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
let execute: typeof import('@/app/api/routes/[id]/execute/route').POST
const treasury = privateKeyToAccount(`0x${'99'.repeat(32)}`)
const policy = { required: true, methods: ['buyer_review', 'schema', 'source_urls'], minimum_sources: 3 }

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-route-reservation-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'routes.db')}`
  process.env.JWT_SECRET = 'route-reservation-tests-only'
  process.env.TREASURY_ADDRESS = treasury.address
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'99'.repeat(32)}`
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
  execute = (await import('@/app/api/routes/[id]/execute/route')).POST
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

async function fixture(maxAttempts = 2, deadline: number | null = 300) {
  const id = crypto.randomUUID()
  const buyerId = `eligibility-buyer-${id}`
  const sellerId = `eligibility-seller-${id}`
  const replacementSellerId = `eligibility-replacement-${id}`
  const [firstId, secondId] = [crypto.randomUUID(), crypto.randomUUID()]
  await db.insert(schema.users).values([buyerId, sellerId, replacementSellerId].map((userId) => ({
    id: userId, name: userId, email: `${userId}@test.invalid`, password_hash: 'unused', role: 'human' as const,
  })))
  await db.insert(schema.payout_addresses).values([sellerId, replacementSellerId].map((user_id) => ({ user_id, address: treasury.address })))
  for (const [serviceId, price] of [[firstId, 100], [secondId, 200]] as const) await db.insert(schema.service_definitions).values({
    id: serviceId, seller_id: sellerId, title: 'Eligibility fixture', description: 'Review code under saved requirements.',
    capabilities: '["code-review"]', price_minor: price, status: 'active', max_concurrency: 1,
    estimated_latency_seconds: deadline, output_schema: JSON.stringify({ type: 'object', properties: { result: { type: 'string' } } }),
    verification_policy: JSON.stringify(policy),
  })
  await db.insert(schema.buyer_spend_policies).values({ buyer_id: buyerId, owner_account_id: buyerId,
    policy_json: JSON.stringify({ approved_providers: [sellerId, replacementSellerId] }) })
  const { POST: plan } = await import('@/app/api/routes/plan/route')
  const response = await plan(request('/api/routes/plan', buyerId, {
    client_reference: `eligibility-plan-${id}`, objective: 'Review this code and return structured findings with sources',
    required_capabilities: ['code-review'], max_budget: { amount: '5.00', currency: 'USD' },
    verification: { ...policy, minimum_sources: 2 }, retry_policy: { max_attempts: maxAttempts },
    ...(deadline === null ? {} : { deadline_seconds: deadline }),
  }))
  assert.equal(response.status, 201)
  const route = (await response.json()).route
  assert.deepEqual(route.candidates.map((c: { service_id: string }) => c.service_id), [firstId, secondId])
  return { buyerId, sellerId, replacementSellerId, firstId, secondId, routeId: route.id as string }
}
type Fixture = Awaited<ReturnType<typeof fixture>>

function run(f: Fixture) {
  return execute(request(`/api/routes/${f.routeId}/execute`, f.buyerId), { params: Promise.resolve({ id: f.routeId }) })
}

async function assertReservation(f: Fixture, selected: string | null, failureCode: string) {
  const attempts = await db.select().from(schema.route_attempts).where(eq(schema.route_attempts.route_id, f.routeId)).orderBy(schema.route_attempts.attempt_number)
  assert.equal(attempts[0].state, 'ineligible')
  assert.equal(attempts[0].failure_code, failureCode)
  assert.equal(attempts[0].service_order_id, null)
  const orders = await db.select().from(schema.service_orders).where(eq(schema.service_orders.buyer_id, f.buyerId))
  const trades = await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyerId))
  const listings = await db.select().from(schema.listings).where(eq(schema.listings.seller_id, f.sellerId))
  assert.equal(orders.length, selected ? 1 : 0)
  assert.equal(trades.length, orders.length)
  assert.equal(listings.length, orders.length)
  if (selected) {
    assert.equal(orders[0].service_id, selected)
    assert.equal(attempts[1].state, 'reserved')
    assert.equal(attempts[1].service_order_id, orders[0].id)
    assert.equal(trades[0].status, 'pending')
    assert.equal(trades[0].seller_id, f.sellerId)
  }
  for (const id of [f.firstId, f.secondId]) {
    const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, id))
    assert.equal(service.active_orders, id === selected ? 1 : 0)
  }
  assert.equal((await db.select().from(schema.payment_receipts)).length, 0)
  assert.equal((await db.select().from(schema.settlement_transfers)).length, 0)
  assert.equal((await db.select().from(schema.transactions)).length, 0)
}

test('provider changes after preflight are rejected at reservation and can fall back before checkout', async () => {
  for (const [field, value] of [
    ['capabilities', '["translation"]'], ['capabilities', '{broken'],
    ['estimated_latency_seconds', 301], ['estimated_latency_seconds', null],
    ['verification_policy', JSON.stringify({ required: true, methods: ['buyer_review', 'source_urls'], minimum_sources: 3 })],
    ['verification_policy', JSON.stringify({ ...policy, minimum_sources: 1 })], ['seller_id', 'replacement'],
  ] as const) {
    const f = await fixture()
    const worker = createClient({ url: process.env.TURSO_DATABASE_URL! })
    const originalExecute = db.$client.execute.bind(db.$client)
    let changed = false
    Reflect.set(db.$client, 'execute', async (...args: Parameters<typeof db.$client.execute>) => {
      const result = await originalExecute(...args)
      const statement = args[0] as string | { sql: string; args?: unknown[] }
      const query = typeof statement === 'string' ? statement : statement.sql
      if (!changed && query.startsWith('select') && query.includes('from "service_definitions"')
        && typeof statement !== 'string' && statement.args?.includes(f.firstId)) {
        changed = true
        await worker.execute({ sql: `UPDATE service_definitions SET ${field} = ? WHERE id = ?`,
          args: [field === 'seller_id' ? f.replacementSellerId : value, f.firstId] })
      }
      return result
    })
    let response: Response
    try { response = await run(f) }
    finally { Reflect.set(db.$client, 'execute', originalExecute); worker.close() }
    assert.equal(changed, true)
    assert.equal(response.status, 201, `${field}: ${JSON.stringify(await response.clone().json())}`)
    assert.equal((await response.json()).order.service_id, f.secondId)
    await assertReservation(f, f.secondId, 'ROUTE_STALE_PROVIDER')
  }
})

test('the capacity write binds provider identity, capabilities, and both nullable latency transitions', async () => {
  for (const [field, value, deadline] of [
    ['seller_id', 'replacement', 300], ['capabilities', '["translation"]', 300],
    ['estimated_latency_seconds', null, 300], ['estimated_latency_seconds', 120, null],
  ] as const) {
    const f = await fixture(2, deadline)
    const originalTransaction = db.transaction.bind(db)
    const worker = createClient({ url: process.env.TURSO_DATABASE_URL! })
    let changed = false
    Reflect.set(db, 'transaction', async (callback: Parameters<typeof db.transaction>[0]) => {
      if (!changed) {
        changed = true
        await worker.execute({ sql: `UPDATE service_definitions SET ${field} = ? WHERE id = ?`,
          args: [field === 'seller_id' ? f.replacementSellerId : value, f.firstId] })
      }
      return originalTransaction(callback)
    })
    let response: Response
    try { response = await run(f) }
    finally { Reflect.set(db, 'transaction', originalTransaction); worker.close() }
    assert.equal(changed, true)
    assert.equal(response.status, 201, `${field}: ${JSON.stringify(await response.clone().json())}`)
    await assertReservation(f, f.secondId, 'SERVICE_CAPACITY_OR_PRICE_CHANGED')
  }
})

test('one permitted attempt rejects changed transactional requirements without economic writes', async () => {
  const f = await fixture(1)
  const originalTransaction = db.transaction.bind(db)
  let changed = false
  Reflect.set(db, 'transaction', async (callback: Parameters<typeof db.transaction>[0]) => {
    if (!changed) {
      changed = true
      await db.update(schema.route_plans).set({ required_capabilities: '["translation"]' }).where(eq(schema.route_plans.id, f.routeId))
    }
    return originalTransaction(callback)
  })
  let response: Response
  try { response = await run(f) }
  finally { Reflect.set(db, 'transaction', originalTransaction) }
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error_code, 'ROUTE_STALE_PROVIDER')
  await assertReservation(f, null, 'ROUTE_STALE_PROVIDER')
  const [route] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, f.routeId))
  assert.equal(route.state, 'failed')
  assert.equal(route.service_order_id, null)
})

test('concurrent fallback creates one checkout and replay survives provider contract changes', async () => {
  const f = await fixture()
  await db.update(schema.service_definitions).set({ capabilities: '{broken' }).where(eq(schema.service_definitions.id, f.firstId))
  const responses = await Promise.all([run(f), run(f)])
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201])
  const bodies = await Promise.all(responses.map((response) => response.json()))
  assert.equal(bodies[0].order.id, bodies[1].order.id)
  await assertReservation(f, f.secondId, 'ROUTE_STALE_PROVIDER')
  await db.update(schema.service_definitions).set({ seller_id: f.replacementSellerId, capabilities: '[]',
    estimated_latency_seconds: null, verification_policy: '{broken' }).where(eq(schema.service_definitions.id, f.secondId))
  const replay = await run(f)
  assert.equal(replay.status, 200)
  const saved = await replay.json()
  assert.equal(saved.order.id, bodies[0].order.id)
  assert.equal(saved.trade.id, bodies[0].trade.id)
  assert.equal(saved.trade.seller_id, f.sellerId)
  assert.equal(saved.funds_state, 'payment_unknown')
  assert.equal(saved.attempts.length, 2)
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.buyer_id, f.buyerId))).length, 1)
})
