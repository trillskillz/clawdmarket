import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let fixtureDirectory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let token: typeof import('@/lib/auth').generateJWT
let createService: typeof import('@/app/api/services/route').POST
let createOrder: typeof import('@/app/api/services/[id]/orders/route').POST
let cancelTrade: typeof import('@/app/api/trades/[id]/cancel/route').POST
let getService: typeof import('@/app/api/services/[id]/route').GET
let changeService: typeof import('@/app/api/services/[id]/route').PATCH
let listServices: typeof import('@/app/api/services/route').GET
let getWorkOrder: typeof import('@/app/api/trades/[id]/work-order/route').GET
let startWorkOrder: typeof import('@/app/api/trades/[id]/work-order/start/route').POST
let listTrades: typeof import('@/app/api/trades/route').GET
const sellerId = 'reusable-seller'
const buyerId = 'reusable-buyer'
const treasury = privateKeyToAccount(`0x${'77'.repeat(32)}`)

before(async () => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-reusable-services-'))
  process.env.TURSO_DATABASE_URL = `file:${join(fixtureDirectory, 'services.db')}`
  process.env.JWT_SECRET = 'reusable-service-tests-only'
  process.env.CHAT_ENCRYPTION_KEY = 'reusable-service-chat-key-32-bytes-minimum'
  process.env.TREASURY_ADDRESS = treasury.address
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'77'.repeat(32)}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{
    chainId: 8453, chainName: 'Test Base', address: `0x${'44'.repeat(20)}`,
    symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: 'https://rpc.example.invalid',
  }])
  delete process.env.MPP_SECRET_KEY
  delete process.env.MPP_SECRET_KEY_CURRENT
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  token = (await import('@/lib/auth')).generateJWT
  createService = (await import('@/app/api/services/route')).POST
  createOrder = (await import('@/app/api/services/[id]/orders/route')).POST
  cancelTrade = (await import('@/app/api/trades/[id]/cancel/route')).POST
  getService = (await import('@/app/api/services/[id]/route')).GET
  changeService = (await import('@/app/api/services/[id]/route')).PATCH
  listServices = (await import('@/app/api/services/route')).GET
  getWorkOrder = (await import('@/app/api/trades/[id]/work-order/route')).GET
  startWorkOrder = (await import('@/app/api/trades/[id]/work-order/start/route')).POST
  listTrades = (await import('@/app/api/trades/route')).GET
  await db.insert(schema.users).values([
    { id: sellerId, name: 'Reusable Seller', email: 'reusable-seller@test.invalid', password_hash: 'unused', role: 'human' },
    { id: buyerId, name: 'Reusable Buyer', email: 'reusable-buyer@test.invalid', password_hash: 'unused', role: 'human' },
    { id: 'reusable-outsider', name: 'Outsider', email: 'reusable-outsider@test.invalid', password_hash: 'unused', role: 'human' },
  ])
  await db.insert(schema.payout_addresses).values({ user_id: sellerId, address: treasury.address })
})

after(() => {
  db?.$client.close()
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true })
})

function request(path: string, userId: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token({ userId, email: `${userId}@test.invalid`, role: 'human' })}` },
    body: JSON.stringify(body),
  })
}

async function service(maxConcurrency = 1) {
  const response = await createService(request('/api/services', sellerId, {
    title: 'Reusable code review', description: 'Review a code change and return findings with evidence.',
    capabilities: ['code-review'], pricing: { model: 'fixed', amount: '10.00', currency: 'USD' },
    max_concurrency: maxConcurrency, status: 'active',
  }))
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  return (await response.json()).service
}

async function order(serviceId: string, reference: string) {
  return createOrder(request(`/api/services/${serviceId}/orders`, buyerId, { client_reference: reference, objective: 'Review the attached repository change', input: { revision: 'abc123' } }), { params: Promise.resolve({ id: serviceId }) })
}

test('a reusable definition creates independent orders and releases capacity on cancellation', async () => {
  const offered = await service()
  const first = await order(offered.id, `first-${crypto.randomUUID()}`)
  assert.equal(first.status, 201, JSON.stringify(await first.clone().json()))
  const firstBody = await first.json()
  assert.deepEqual(firstBody.order.input, { revision: 'abc123' })
  assert.equal('input_json' in firstBody.order, false)
  assert.equal(firstBody.trade.payment_rail, 'evm')
  assert.equal(firstBody.order.price_minor, 1000)
  assert.equal((await order(offered.id, `blocked-${crypto.randomUUID()}`)).status, 409)
  const cancelled = await cancelTrade(request(`/api/trades/${firstBody.trade.id}/cancel`, buyerId, {}), { params: Promise.resolve({ id: firstBody.trade.id }) })
  assert.equal(cancelled.status, 200)
  const [released] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, firstBody.order.id))
  assert.equal(released.state, 'cancelled')
  assert.ok(released.capacity_released_at)
  const [oldListing] = await db.select().from(schema.listings).where(eq(schema.listings.id, firstBody.order.listing_id))
  assert.equal(oldListing.status, 'sold')
  const second = await order(offered.id, `second-${crypto.randomUUID()}`)
  assert.equal(second.status, 201)
  const secondBody = await second.json()
  assert.notEqual(firstBody.trade.id, secondBody.trade.id)
  const [current] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(current.status, 'active')
  assert.equal(current.active_orders, 1)
})

test('concurrent reservations cannot exceed configured capacity and a repeated reference is idempotent', async () => {
  const offered = await service(1)
  const referenceA = `concurrent-a-${crypto.randomUUID()}`
  const referenceB = `concurrent-b-${crypto.randomUUID()}`
  const results = await Promise.all([order(offered.id, referenceA), order(offered.id, referenceB)])
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409])
  const winner = await results.find((result) => result.status === 201)!.json()
  const repeated = await order(offered.id, winner.order.client_reference)
  assert.equal(repeated.status, 200)
  assert.equal((await repeated.json()).trade.id, winner.trade.id)
  const [current] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(current.active_orders, 1)
})

test('service orders enforce server totals, ownership, and current availability', async () => {
  const offered = await service()
  const insufficient = await createOrder(request(`/api/services/${offered.id}/orders`, buyerId, {
    client_reference: `budget-${crypto.randomUUID()}`, objective: 'Review the attached repository change', max_total: '10.00',
  }), { params: Promise.resolve({ id: offered.id }) })
  assert.equal(insufficient.status, 409)
  assert.equal((await insufficient.json()).error_code, 'BUDGET_EXCEEDED')
  const [unchanged] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(unchanged.active_orders, 0)

  const unauthorizedChange = await changeService(request(`/api/services/${offered.id}`, buyerId, { status: 'paused' }), { params: Promise.resolve({ id: offered.id }) })
  assert.equal(unauthorizedChange.status, 404)
  const changed = await changeService(request(`/api/services/${offered.id}`, sellerId, { status: 'paused' }), { params: Promise.resolve({ id: offered.id }) })
  assert.equal(changed.status, 200)
  assert.equal((await changed.json()).service.status, 'paused')
  assert.equal((await order(offered.id, `paused-${crypto.randomUUID()}`)).status, 409)
  const publicRead = await getService(new NextRequest(`http://localhost/api/services/${offered.id}`), { params: Promise.resolve({ id: offered.id }) })
  assert.equal(publicRead.status, 404)
})

test('service orders reject a stale fixed-price snapshot before capacity reservation', async () => {
  const offered = await service()
  const response = await createOrder(request(`/api/services/${offered.id}/orders`, buyerId, {
    client_reference: `stale-price-${crypto.randomUUID()}`, objective: 'Review the attached repository change',
    expected_price: '9.00',
  }), { params: Promise.resolve({ id: offered.id }) })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error_code, 'SERVICE_PRICE_CHANGED')
  const [current] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(current.active_orders, 0)
})

test('managed reference agents cannot publish paid reusable services', async () => {
  const agentId = `reference-${crypto.randomUUID()}`
  const userId = `user_agent_${agentId}`
  const { REFERENCE_FLEET_MARKER } = await import('@/lib/reference-fleet-manifest')
  await db.insert(schema.users).values({ id: userId, name: 'Reference', email: `${agentId}@test.invalid`, password_hash: 'unused', role: 'agent' })
  await db.insert(schema.agents).values({ id: agentId, name: 'Reference', description: REFERENCE_FLEET_MARKER,
    capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused' })
  const response = await createService(request('/api/services', userId, {
    title: 'Managed reference review', description: 'Review a code change and return findings with evidence.',
    capabilities: ['code-review'], pricing: { model: 'fixed', amount: '10.00', currency: 'USD' }, status: 'active',
  }))
  assert.equal(response.status, 409)
  assert.equal((await response.json()).error_code, 'REFERENCE_FLEET_PAID_SERVICES_LOCKED')
})

test('public service DTO contains structured pricing and readiness without private owner fields', async () => {
  const offered = await service(2)
  const response = await listServices(new NextRequest('http://localhost/api/services?capability=code-review'))
  assert.equal(response.status, 200)
  const publicService = (await response.json()).services.find((item: { id: string }) => item.id === offered.id)
  assert.ok(publicService)
  assert.deepEqual(publicService.capabilities, ['code-review'])
  assert.deepEqual(publicService.pricing, { model: 'fixed', amount: '10.00', currency: 'USD' })
  assert.equal(publicService.readiness.capacity_available, true)
  assert.equal(publicService.readiness.purchasable, true)
  assert.equal(JSON.stringify(publicService).includes('reusable-seller@test.invalid'), false)
  assert.equal('seller_id' in publicService, false)
})

test('party work order is durable, private, and seller-readable only after funding', async () => {
  const offered = await service()
  const created = await order(offered.id, `pull-dispatch-${crypto.randomUUID()}`)
  assert.equal(created.status, 201)
  const { trade, order: savedOrder } = await created.json()
  const path = `/api/trades/${trade.id}/work-order`
  const params = { params: Promise.resolve({ id: trade.id as string }) }
  const read = (userId?: string) => getWorkOrder(new NextRequest(`http://localhost${path}`, {
    headers: userId ? { Authorization: `Bearer ${token({ userId, email: `${userId}@test.invalid`, role: 'human' })}` } : {},
  }), params)
  assert.equal((await read()).status, 401)
  assert.equal((await read('reusable-outsider')).status, 404)
  const premature = await read(sellerId)
  assert.equal(premature.status, 409)
  assert.equal(JSON.stringify(await premature.json()).includes('abc123'), false)
  const buyerView = await read(buyerId)
  assert.equal(buyerView.status, 200)
  assert.deepEqual((await buyerView.json()).work_order.input, { revision: 'abc123' })
  const { advanceServiceOrder } = await import('@/lib/service-order-state')
  await db.transaction(async (tx) => {
    await tx.update(schema.trades).set({ status: 'escrow_held', funded_at: new Date().toISOString() })
      .where(eq(schema.trades.id, trade.id))
    await advanceServiceOrder(tx, trade.id, 'funded')
  })
  const funded = await read(sellerId)
  assert.equal(funded.status, 200)
  assert.equal(funded.headers.get('cache-control'), 'private, no-store')
  const body = await funded.json()
  assert.equal(body.work_order.id, savedOrder.id)
  assert.deepEqual(body.work_order.input, { revision: 'abc123' })
  assert.deepEqual(body.work_order.capabilities, ['code-review'])
  assert.deepEqual(body.work_order.delivery, { method: 'POST', url: `/api/trades/${trade.id}/delivery` })
  assert.equal(JSON.stringify(body).includes('reusable-buyer@test.invalid'), false)
  assert.equal('buyer_id' in body.work_order, false)
  const listed = await listTrades(new NextRequest('http://localhost/api/trades?limit=100', {
    headers: { Authorization: `Bearer ${token({ userId: sellerId, email: `${sellerId}@test.invalid`, role: 'human' })}` },
  }))
  assert.equal(listed.status, 200)
  const item = (await listed.json()).trades.find((candidate: { id: string }) => candidate.id === trade.id)
  assert.equal(item.service_order_id, savedOrder.id)
  assert.equal(item.work_order_url, path)
})

test('seller starts funded execution once and delivery still advances the linked route', async () => {
  const offered = await service()
  const created = await order(offered.id, `execution-start-${crypto.randomUUID()}`)
  assert.equal(created.status, 201)
  const { trade, order: savedOrder } = await created.json()
  const path = `/api/trades/${trade.id}/work-order/start`
  const params = { params: Promise.resolve({ id: trade.id as string }) }
  const start = (userId?: string) => startWorkOrder(new NextRequest(`http://localhost${path}`, {
    method: 'POST', headers: userId ? { Authorization: `Bearer ${token({ userId, email: `${userId}@test.invalid`, role: 'human' })}` } : {},
  }), params)
  assert.equal((await start()).status, 401)
  assert.equal((await start(buyerId)).status, 404)
  assert.equal((await start('reusable-outsider')).status, 404)
  assert.equal((await start(sellerId)).status, 409)
  assert.equal((await startWorkOrder(new NextRequest(`http://localhost${path}`, {
    method: 'POST', headers: { Cookie: `auth-token=${token({ userId: sellerId, email: `${sellerId}@test.invalid`, role: 'human' })}` },
  }), params)).status, 403)
  const [unfunded] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, savedOrder.id))
  assert.equal(unfunded.state, 'awaiting_funding')
  assert.equal(unfunded.execution_started_at, null)
  await db.insert(schema.route_plans).values({ id: crypto.randomUUID(), buyer_id: buyerId,
    client_reference: `execution-route-${crypto.randomUUID()}`, objective: 'Review a funded repository change',
    required_capabilities: '["code-review"]', max_budget_minor: 1050,
    state: 'funded', service_order_id: savedOrder.id, expires_at: new Date(Date.now() + 300_000) })
  const { advanceServiceOrder } = await import('@/lib/service-order-state')
  await db.transaction(async (tx) => {
    await tx.update(schema.trades).set({ status: 'escrow_held', funded_at: new Date().toISOString() })
      .where(eq(schema.trades.id, trade.id))
    await advanceServiceOrder(tx, trade.id, 'funded')
  })
  const ready = await getWorkOrder(new NextRequest(`http://localhost/api/trades/${trade.id}/work-order`, {
    headers: { Authorization: `Bearer ${token({ userId: sellerId, email: `${sellerId}@test.invalid`, role: 'human' })}` },
  }), params)
  assert.deepEqual((await ready.json()).work_order.start, { method: 'POST', url: path })
  const responses = await Promise.all([start(sellerId), start(sellerId)])
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201])
  const bodies = await Promise.all(responses.map((response) => response.json()))
  assert.equal(bodies[0].order.execution_started_at, bodies[1].order.execution_started_at)
  const [started] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, savedOrder.id))
  assert.equal(started.state, 'executing')
  assert.ok(started.execution_started_at)
  const [route] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.service_order_id, savedOrder.id))
  assert.equal(route.state, 'executing')
  const [stillEscrowed] = await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id))
  assert.equal(stillEscrowed.status, 'escrow_held')
  assert.equal(stillEscrowed.total_cost, trade.total_cost)
  const workOrder = await getWorkOrder(new NextRequest(`http://localhost/api/trades/${trade.id}/work-order`, {
    headers: { Authorization: `Bearer ${token({ userId: sellerId, email: `${sellerId}@test.invalid`, role: 'human' })}` },
  }), params)
  const currentWorkOrder = (await workOrder.json()).work_order
  assert.equal(currentWorkOrder.execution_started_at, started.execution_started_at?.toISOString())
  assert.equal(currentWorkOrder.start, null)
  const { POST: deliver } = await import('@/app/api/trades/[id]/delivery/route')
  const delivered = await deliver(request(`/api/trades/${trade.id}/delivery`, sellerId,
    { summary: 'The code review is complete with actionable findings.' }), params)
  assert.equal(delivered.status, 201, JSON.stringify(await delivered.clone().json()))
  const [afterDelivery] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, savedOrder.id))
  const [routeAfterDelivery] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, route.id))
  assert.equal(afterDelivery.state, 'verifying')
  assert.equal(afterDelivery.execution_started_at?.toISOString(), started.execution_started_at?.toISOString())
  assert.equal(routeAfterDelivery.state, 'awaiting_buyer')
  const replay = await start(sellerId)
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).idempotent, true)
})

test('operator reconciliation releases a terminal order left by an older worker exactly once', async () => {
  const offered = await service()
  const result = await order(offered.id, `legacy-worker-${crypto.randomUUID()}`)
  assert.equal(result.status, 201)
  const { trade } = await result.json()
  await db.update(schema.trades).set({ status: 'cancelled' }).where(eq(schema.trades.id, trade.id))
  const { reconcileTerminalServiceOrders } = await import('@/lib/service-order-state')
  assert.equal(await reconcileTerminalServiceOrders(), 1)
  assert.equal(await reconcileTerminalServiceOrders(), 0)
  const [definition] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(definition.active_orders, 0)
})
