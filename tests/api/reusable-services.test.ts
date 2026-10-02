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
let getServiceOrder: typeof import('@/app/api/service-orders/[id]/route').GET
let getRoute: typeof import('@/app/api/routes/[id]/route').GET
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
  getServiceOrder = (await import('@/app/api/service-orders/[id]/route')).GET
  getRoute = (await import('@/app/api/routes/[id]/route')).GET
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

function ownedRead(path: string, userId: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${token({ userId, email: `${userId}@test.invalid`, role: 'human' })}` },
  })
}

async function service(maxConcurrency = 1, inputSchema?: Record<string, unknown>) {
  const response = await createService(request('/api/services', sellerId, {
    title: 'Reusable code review', description: 'Review a code change and return findings with evidence.',
    capabilities: ['code-review'], pricing: { model: 'fixed', amount: '10.00', currency: 'USD' },
    max_concurrency: maxConcurrency, status: 'active', input_schema: inputSchema,
  }))
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  return (await response.json()).service
}

test('declared input is checked before order, trade, or capacity reservation', async () => {
  const offered = await service(1, { type: 'object', properties: { revision: { type: 'string' } }, required: ['revision'], additionalProperties: false })
  const reference = `invalid-input-${crypto.randomUUID()}`
  const invalid = await createOrder(request(`/api/services/${offered.id}/orders`, buyerId, {
    client_reference: reference, objective: 'Review the attached repository change', input: { revision: 123 },
  }), { params: Promise.resolve({ id: offered.id }) })
  assert.equal(invalid.status, 422)
  assert.equal((await invalid.json()).error_code, 'SERVICE_INPUT_INVALID')
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.service_id, offered.id))).length, 0)
  const [unchanged] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(unchanged.active_orders, 0)
  const accepted = await order(offered.id, reference)
  assert.equal(accepted.status, 201)
  const replay = await order(offered.id, reference)
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).order.id, (await accepted.json()).order.id)
})

test('unsupported stored input schema blocks purchase readiness and orders', async () => {
  const offered = await service()
  await db.update(schema.service_definitions).set({ input_schema: JSON.stringify({ $ref: 'https://example.invalid/schema' }) })
    .where(eq(schema.service_definitions.id, offered.id))
  const response = await getService(new NextRequest(`http://localhost/api/services/${offered.id}`), { params: Promise.resolve({ id: offered.id }) })
  assert.equal(response.status, 200)
  const readiness = (await response.json()).service.readiness
  assert.equal(readiness.input_ready, false)
  assert.equal(readiness.purchasable, false)
  assert.ok(readiness.blocking_reasons.includes('INPUT_SCHEMA_UNSUPPORTED'))
  const purchase = await order(offered.id, `bad-schema-${crypto.randomUUID()}`)
  assert.equal(purchase.status, 409)
  assert.equal((await purchase.json()).error_code, 'SERVICE_INPUT_SCHEMA_UNSUPPORTED')
  const [current] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(current.active_orders, 0)
})

test('unsupported provider protocol cannot be purchased', async () => {
  const offered = await service()
  await db.$client.execute({ sql: 'UPDATE service_definitions SET provider_protocol = ? WHERE id = ?', args: ['unsupported', offered.id] })
  const response = await getService(new NextRequest(`http://localhost/api/services/${offered.id}`), { params: Promise.resolve({ id: offered.id }) })
  const readiness = (await response.json()).service.readiness
  assert.equal(readiness.provider_protocol_ready, false)
  assert.ok(readiness.blocking_reasons.includes('PROVIDER_PROTOCOL_UNSUPPORTED'))
  const purchase = await order(offered.id, `unsupported-protocol-${crypto.randomUUID()}`)
  assert.equal(purchase.status, 409)
  assert.equal((await purchase.json()).error_code, 'PROVIDER_PROTOCOL_UNSUPPORTED')
})

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
  assert.equal(cancelled.headers.get('cache-control'), 'private, no-store')
  const cancelledBody = await cancelled.json()
  assert.equal(cancelledBody.trade.status, 'cancelled')
  assert.equal(cancelledBody.idempotent, false)
  assert.equal(cancelledBody.funds_state, 'payment_unknown')
  assert.equal(cancelledBody.payment_exposure.state, 'late_payment_possible')
  assert.equal(cancelledBody.payment_exposure.automatic_retry_allowed, false)
  const cancellationReplay = await cancelTrade(request(`/api/trades/${firstBody.trade.id}/cancel`, buyerId, {}),
    { params: Promise.resolve({ id: firstBody.trade.id }) })
  assert.equal(cancellationReplay.status, 200)
  assert.equal((await cancellationReplay.json()).idempotent, true)
  assert.equal((await cancelTrade(request(`/api/trades/${firstBody.trade.id}/cancel`, 'reusable-outsider', {}),
    { params: Promise.resolve({ id: firstBody.trade.id }) })).status, 403)
  await db.insert(schema.payment_receipts).values({ route: `/api/trades/${firstBody.trade.id}/fund/evm`,
    trade_id: firstBody.trade.id, payment_rail: 'evm', amount: 10.50, currency: 'USDC',
    tx_hash: `0x${'66'.repeat(32)}` })
  await db.update(schema.trades).set({ payout_status: 'processing' }).where(eq(schema.trades.id, firstBody.trade.id))
  const latePayment = await cancelTrade(request(`/api/trades/${firstBody.trade.id}/cancel`, buyerId, {}),
    { params: Promise.resolve({ id: firstBody.trade.id }) })
  assert.equal((await latePayment.json()).payment_exposure.state, 'refund_processing')
  await db.update(schema.trades).set({ payout_status: 'refunded' }).where(eq(schema.trades.id, firstBody.trade.id))
  const refundedReplay = await cancelTrade(request(`/api/trades/${firstBody.trade.id}/cancel`, buyerId, {}),
    { params: Promise.resolve({ id: firstBody.trade.id }) })
  assert.equal((await refundedReplay.json()).payment_exposure.state, 'refunded')
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

test('concurrent cancellation returns a saved trade and releases one capacity slot', async () => {
  const offered = await service()
  const created = await order(offered.id, `cancel-race-${crypto.randomUUID()}`)
  assert.equal(created.status, 201)
  const { trade } = await created.json()
  const path = `/api/trades/${trade.id}/cancel`
  const params = { params: Promise.resolve({ id: trade.id as string }) }
  const outcomes = await Promise.all([cancelTrade(request(path, buyerId, {}), params),
    cancelTrade(request(path, buyerId, {}), params)])
  assert.deepEqual(outcomes.map((response) => response.status), [200, 200])
  const bodies = await Promise.all(outcomes.map((response) => response.json()))
  assert.equal(bodies.every((body) => body.trade?.status === 'cancelled'), true)
  assert.deepEqual(bodies.map((body) => body.idempotent).sort(), [false, true])
  const [definition] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(definition.active_orders, 0)
})

test('an unpaid legacy ledger trade has no external late-payment exposure', async () => {
  const [listing] = await db.insert(schema.listings).values({ seller_id: sellerId, category: 'code',
    title: 'Legacy code review', description: 'An unpaid legacy listing.', price_bankr: 10,
    status: 'sold' }).returning()
  const [trade] = await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: buyerId,
    seller_id: sellerId, amount: 10, fee: 0.5, payment_rail: 'ledger', status: 'pending' }).returning()
  const response = await cancelTrade(request(`/api/trades/${trade.id}/cancel`, buyerId, {}),
    { params: Promise.resolve({ id: trade.id }) })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.funds_state, 'no_funds_moved')
  assert.equal(body.payment_exposure, null)
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, listing.id)))[0].status, 'active')
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
    required_capabilities: '["code-review"]', max_budget_minor: 1050, deadline_seconds: 600,
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
  assert.equal(currentWorkOrder.execution_timing.deadline_seconds, 600)
  assert.equal(currentWorkOrder.execution_timing.awaiting_delivery, true)
  assert.equal(currentWorkOrder.start, null)
  const { inspectOwnedRoute } = await import('@/lib/route-inspection')
  const buyerRoute = await inspectOwnedRoute(route.id, buyerId)
  assert.equal(buyerRoute?.execution_timing?.due_at, currentWorkOrder.execution_timing.due_at)
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

test('leased provider attempt requires acceptance and correlates delivery', async () => {
  const createdService = await createService(request('/api/services', sellerId, {
    title: 'Leased code review', description: 'Review a code change through the leased provider protocol.',
    capabilities: ['code-review'], pricing: { model: 'fixed', amount: '10.00', currency: 'USD' },
    status: 'active', provider_protocol: 'leased_v1',
  }))
  assert.equal(createdService.status, 201)
  const offered = (await createdService.json()).service
  const created = await order(offered.id, `leased-attempt-${crypto.randomUUID()}`)
  assert.equal(created.status, 201)
  const { trade, order: savedOrder } = await created.json()
  const webhookId = `leased-work-hook-${crypto.randomUUID()}`
  await db.insert(schema.webhooks).values({ id: webhookId, agent_id: sellerId,
    url: 'https://provider.example.invalid/leased-work', secret_hash: 'test-hash',
    events: JSON.stringify(['work_order.ready']), active: 1 })
  const { advanceServiceOrder } = await import('@/lib/service-order-state')
  const { queueFundedWorkOrder } = await import('@/lib/service-order-dispatch')
  await db.transaction(async (tx) => {
    await tx.update(schema.trades).set({ status: 'escrow_held', funded_at: new Date().toISOString() })
      .where(eq(schema.trades.id, trade.id))
    await advanceServiceOrder(tx, trade.id, 'funded')
    await queueFundedWorkOrder(tx, trade.id, sellerId)
  })
  const [attempt] = await db.select().from(schema.service_execution_attempts)
    .where(eq(schema.service_execution_attempts.order_id, savedOrder.id))
  assert.equal(attempt.state, 'queued')
  const [notice] = await db.select().from(schema.webhook_deliveries)
    .where(eq(schema.webhook_deliveries.webhook_id, webhookId))
  assert.equal(JSON.parse(notice.payload).data.execution_attempt_id, attempt.id)
  assert.equal(JSON.stringify(notice.payload).includes('abc123'), false)
  await db.update(schema.webhooks).set({ active: 0 }).where(eq(schema.webhooks.id, webhookId))
  const params = { params: Promise.resolve({ id: trade.id as string }) }
  const workOrder = await getWorkOrder(new NextRequest(`http://localhost/api/trades/${trade.id}/work-order`, {
    headers: { Authorization: `Bearer ${token({ userId: sellerId, email: `${sellerId}@test.invalid`, role: 'human' })}` },
  }), params)
  const sellerView = (await workOrder.json()).work_order
  assert.equal(sellerView.execution_attempt.id, attempt.id)
  assert.equal(sellerView.provider_protocol, 'leased_v1')
  assert.equal(sellerView.start, null)
  assert.deepEqual(sellerView.attempt_action, { method: 'POST', url: `/api/trades/${trade.id}/work-order/attempt` })
  const path = `/api/trades/${trade.id}/work-order/attempt`
  const action = (userId: string, attemptId: string, operation: string) => import('@/app/api/trades/[id]/work-order/attempt/route')
    .then(({ POST }) => POST(request(path, userId, { attempt_id: attemptId, action: operation }), params))
  assert.equal((await action(buyerId, attempt.id, 'accept')).status, 404)
  assert.equal((await action(sellerId, crypto.randomUUID(), 'accept')).status, 404)
  const { POST: deliver } = await import('@/app/api/trades/[id]/delivery/route')
  const deliveryPath = `/api/trades/${trade.id}/delivery`
  const summary = 'Completed the leased code review with actionable findings.'
  assert.equal((await deliver(request(deliveryPath, sellerId, { summary, execution_attempt_id: attempt.id }), params)).status, 409)
  assert.equal((await startWorkOrder(request(`/api/trades/${trade.id}/work-order/start`, sellerId, {}), params)).status, 409)
  // If the order transition fails after the attempt write, the transaction rolls back both.
  await db.update(schema.service_orders).set({ execution_started_at: new Date() })
    .where(eq(schema.service_orders.id, savedOrder.id))
  assert.equal((await action(sellerId, attempt.id, 'accept')).status, 409)
  const [rolledBack] = await db.select().from(schema.service_execution_attempts)
    .where(eq(schema.service_execution_attempts.id, attempt.id))
  assert.equal(rolledBack.state, 'queued')
  await db.update(schema.service_orders).set({ execution_started_at: null })
    .where(eq(schema.service_orders.id, savedOrder.id))
  const accepted = await Promise.all([action(sellerId, attempt.id, 'accept'), action(sellerId, attempt.id, 'accept')])
  assert.deepEqual(accepted.map((response) => response.status).sort(), [200, 201])
  const heartbeat = await action(sellerId, attempt.id, 'heartbeat')
  assert.equal(heartbeat.status, 201, JSON.stringify(await heartbeat.clone().json()))
  assert.equal((await deliver(request(deliveryPath, sellerId,
    { summary, execution_attempt_id: crypto.randomUUID() }), params)).status, 409)
  const delivered = await deliver(request(deliveryPath, sellerId,
    { summary, execution_attempt_id: attempt.id }), params)
  assert.equal(delivered.status, 201, JSON.stringify(await delivered.clone().json()))
  const [finished] = await db.select().from(schema.service_execution_attempts)
    .where(eq(schema.service_execution_attempts.id, attempt.id))
  assert.equal(finished.state, 'delivered')
  assert.ok(finished.completed_at)
  assert.equal((await action(sellerId, attempt.id, 'heartbeat')).status, 409)
  const replay = await deliver(request(deliveryPath, sellerId,
    { summary, execution_attempt_id: attempt.id }), params)
  assert.equal(replay.status, 200)
})

test('expired provider lease preserves escrow and capacity without dispatching another attempt', async () => {
  const offered = await service()
  await db.update(schema.service_definitions).set({ provider_protocol: 'leased_v1' })
    .where(eq(schema.service_definitions.id, offered.id))
  const created = await order(offered.id, `lease-silence-${crypto.randomUUID()}`)
  assert.equal(created.status, 201)
  const { trade, order: savedOrder } = await created.json()
  const routeId = crypto.randomUUID()
  await db.insert(schema.route_plans).values({ id: routeId, buyer_id: buyerId,
    client_reference: `lease-route-${routeId}`, objective: 'Review a funded repository change',
    required_capabilities: '["code-review"]', max_budget_minor: 1050, deadline_seconds: 600,
    state: 'funded', service_order_id: savedOrder.id, expires_at: new Date(Date.now() + 300_000) })
  const routeParams = { params: Promise.resolve({ id: routeId }) }
  const orderParams = { params: Promise.resolve({ id: savedOrder.id as string }) }
  const buyerRoute = () => getRoute(ownedRead(`/api/routes/${routeId}`, buyerId), routeParams)
  const buyerOrder = () => getServiceOrder(ownedRead(`/api/service-orders/${savedOrder.id}`, buyerId), orderParams)
  assert.equal((await getRoute(ownedRead(`/api/routes/${routeId}`, 'reusable-outsider'), routeParams)).status, 404)
  assert.equal((await getServiceOrder(ownedRead(`/api/service-orders/${savedOrder.id}`, 'reusable-outsider'), orderParams)).status, 404)
  const { advanceServiceOrder } = await import('@/lib/service-order-state')
  const { queueFundedWorkOrder } = await import('@/lib/service-order-dispatch')
  await db.transaction(async (tx) => {
    await tx.update(schema.trades).set({ status: 'escrow_held', funded_at: new Date().toISOString() })
      .where(eq(schema.trades.id, trade.id))
    await advanceServiceOrder(tx, trade.id, 'funded')
  })
  const missing = await buyerRoute()
  assert.equal(missing.status, 200)
  assert.deepEqual((await missing.json()).provider_execution, {
    attempt_id: null, state: 'missing', accepted_at: null, heartbeat_at: null,
    lease_expires_at: null, completed_at: null, lease_overdue: false,
    attention_required: true, attention_reason: 'attempt_missing',
    reconciliation: { state: 'dispute_available', action: { method: 'POST', url: `/api/trades/${trade.id}/dispute` } },
    automatic_retry_allowed: false,
  })
  await db.transaction(async (tx) => {
    await queueFundedWorkOrder(tx, trade.id, sellerId)
    await queueFundedWorkOrder(tx, trade.id, sellerId)
  })
  const [attempt] = await db.select().from(schema.service_execution_attempts)
    .where(eq(schema.service_execution_attempts.order_id, savedOrder.id))
  assert.equal((await (await buyerOrder()).json()).provider_execution.state, 'queued')
  const { changeServiceExecutionAttempt, expireServiceExecutionAttempts } = await import('@/lib/service-execution-attempt')
  await changeServiceExecutionAttempt(trade.id, sellerId, attempt.id, 'accept')
  await db.update(schema.trades).set({ funded_at: new Date(Date.now() - 11 * 60_000).toISOString() })
    .where(eq(schema.trades.id, trade.id))
  const deadlineRoute = (await (await buyerRoute()).json())
  assert.equal(deadlineRoute.execution_timing.delivery_overdue, true)
  assert.equal(deadlineRoute.provider_execution.attention_reason, 'delivery_deadline_overdue')
  assert.equal(deadlineRoute.provider_execution.automatic_retry_allowed, false)
  const deadlineOrder = (await (await buyerOrder()).json())
  assert.equal(deadlineOrder.execution_timing.delivery_overdue, true)
  assert.equal(deadlineOrder.provider_execution.attention_reason, 'delivery_deadline_overdue')
  const sellerWork = await getWorkOrder(ownedRead(`/api/trades/${trade.id}/work-order`, sellerId),
    { params: Promise.resolve({ id: trade.id as string }) })
  assert.equal((await sellerWork.json()).work_order.provider_execution.attention_reason, 'delivery_deadline_overdue')
  await db.update(schema.trades).set({ funded_at: new Date().toISOString() })
    .where(eq(schema.trades.id, trade.id))
  await db.update(schema.service_execution_attempts).set({ lease_expires_at: new Date(Date.now() - 1_000) })
    .where(eq(schema.service_execution_attempts.id, attempt.id))
  const overdue = (await (await buyerRoute()).json()).provider_execution
  assert.equal(overdue.state, 'accepted')
  assert.equal(overdue.lease_overdue, true)
  assert.equal(overdue.attention_reason, 'lease_expired')
  await assert.rejects(changeServiceExecutionAttempt(trade.id, sellerId, attempt.id, 'accept'),
    (error: any) => error.code === 'WORK_ATTEMPT_LEASE_EXPIRED')
  const fundedCancellation = await cancelTrade(request(`/api/trades/${trade.id}/cancel`, buyerId, {}),
    { params: Promise.resolve({ id: trade.id }) })
  assert.equal(fundedCancellation.status, 409)
  assert.equal((await fundedCancellation.json()).payment_exposure.state, 'funded')
  assert.equal(await expireServiceExecutionAttempts(), 1)
  assert.equal(await expireServiceExecutionAttempts(), 0)
  const [expired] = await db.select().from(schema.service_execution_attempts)
    .where(eq(schema.service_execution_attempts.id, attempt.id))
  assert.equal(expired.state, 'expired')
  const expiredRoute = await buyerRoute()
  assert.equal(expiredRoute.headers.get('cache-control'), 'no-store')
  const routeSnapshot = await expiredRoute.json()
  assert.equal(routeSnapshot.provider_execution.state, 'expired')
  assert.equal(routeSnapshot.provider_execution.attention_required, true)
  assert.equal(routeSnapshot.provider_execution.attention_reason, 'lease_expired')
  assert.deepEqual(routeSnapshot.provider_execution.reconciliation,
    { state: 'dispute_available', action: { method: 'POST', url: `/api/trades/${trade.id}/dispute` } })
  assert.equal(routeSnapshot.provider_execution.automatic_retry_allowed, false)
  assert.equal(routeSnapshot.payment_exposure.state, 'funded')
  const orderSnapshot = await buyerOrder()
  assert.equal(orderSnapshot.headers.get('cache-control'), 'no-store')
  assert.equal((await orderSnapshot.json()).provider_execution.attention_reason, 'lease_expired')
  const [orderAfter] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, savedOrder.id))
  const [tradeAfter] = await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id))
  const [definition] = await db.select().from(schema.service_definitions)
    .where(eq(schema.service_definitions.id, offered.id))
  assert.equal(orderAfter.state, 'executing')
  assert.equal(tradeAfter.status, 'escrow_held')
  assert.equal(definition.active_orders, 1)
  assert.equal((await db.select().from(schema.service_execution_attempts)
    .where(eq(schema.service_execution_attempts.order_id, savedOrder.id))).length, 1)
  await assert.rejects(changeServiceExecutionAttempt(trade.id, sellerId, attempt.id, 'heartbeat'),
    (error: any) => error.code === 'WORK_ATTEMPT_LEASE_EXPIRED')
  const { POST: dispute } = await import('@/app/api/trades/[id]/dispute/route')
  const disputePath = `/api/trades/${trade.id}/dispute`
  assert.equal((await dispute(request(disputePath, 'reusable-outsider', { reason: 'Provider lease expired' }),
    { params: Promise.resolve({ id: trade.id }) })).status, 403)
  const frozen = await dispute(request(disputePath, buyerId, { reason: 'Provider lease expired before delivery' }),
    { params: Promise.resolve({ id: trade.id }) })
  assert.equal(frozen.status, 200)
  const [disputedOrder] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, savedOrder.id))
  const [disputedRoute] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, routeId))
  const [disputedTrade] = await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id))
  const [heldCapacity] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(disputedOrder.state, 'disputed')
  assert.equal(disputedRoute.state, 'disputed')
  assert.equal(disputedTrade.status, 'disputed')
  assert.equal(heldCapacity.active_orders, 1)
  assert.equal(disputedOrder.capacity_released_at, null)
  const frozenSnapshot = await buyerRoute()
  assert.equal((await frozenSnapshot.json()).provider_execution.reconciliation.state, 'dispute_open')
  assert.equal((await dispute(request(disputePath, buyerId, { reason: 'Replayed dispute' }),
    { params: Promise.resolve({ id: trade.id }) })).status, 400)
})

test('dispute interrupts a live provider lease without recording a provider failure', async () => {
  const offered = await service()
  await db.update(schema.service_definitions).set({ provider_protocol: 'leased_v1' })
    .where(eq(schema.service_definitions.id, offered.id))
  const created = await order(offered.id, `disputed-lease-${crypto.randomUUID()}`)
  assert.equal(created.status, 201)
  const { trade, order: savedOrder } = await created.json()
  const { advanceServiceOrder } = await import('@/lib/service-order-state')
  const { queueFundedWorkOrder } = await import('@/lib/service-order-dispatch')
  const { changeServiceExecutionAttempt, expireServiceExecutionAttempts } = await import('@/lib/service-execution-attempt')
  await db.transaction(async (tx) => {
    await tx.update(schema.trades).set({ status: 'escrow_held', funded_at: new Date().toISOString() })
      .where(eq(schema.trades.id, trade.id))
    await advanceServiceOrder(tx, trade.id, 'funded')
    await queueFundedWorkOrder(tx, trade.id, sellerId)
  })
  const [attempt] = await db.select().from(schema.service_execution_attempts)
    .where(eq(schema.service_execution_attempts.order_id, savedOrder.id))
  await changeServiceExecutionAttempt(trade.id, sellerId, attempt.id, 'accept')
  const { POST: dispute } = await import('@/app/api/trades/[id]/dispute/route')
  const path = `/api/trades/${trade.id}/dispute`
  assert.equal((await dispute(request(path, buyerId, { reason: 'Work cannot continue' }),
    { params: Promise.resolve({ id: trade.id }) })).status, 200)
  const [stopped] = await db.select().from(schema.service_execution_attempts)
    .where(eq(schema.service_execution_attempts.id, attempt.id))
  assert.equal(stopped.state, 'interrupted')
  assert.ok(stopped.completed_at)
  await db.update(schema.service_execution_attempts).set({ lease_expires_at: new Date(Date.now() - 1_000) })
    .where(eq(schema.service_execution_attempts.id, attempt.id))
  assert.equal(await expireServiceExecutionAttempts(), 0)
  const [afterCron] = await db.select().from(schema.service_execution_attempts)
    .where(eq(schema.service_execution_attempts.id, attempt.id))
  assert.equal(afterCron.state, 'interrupted')
  const snapshot = await getServiceOrder(ownedRead(`/api/service-orders/${savedOrder.id}`, buyerId),
    { params: Promise.resolve({ id: savedOrder.id as string }) })
  assert.equal(snapshot.status, 200)
  assert.deepEqual((await snapshot.json()).provider_execution.reconciliation, { state: 'dispute_open', action: null })
  const [definition] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(definition.active_orders, 1)
  await assert.rejects(changeServiceExecutionAttempt(trade.id, sellerId, attempt.id, 'heartbeat'),
    (error: any) => error.code === 'WORK_ORDER_NOT_FUNDED')
})

test('dispute records an overdue lease as expired before the observer runs', async () => {
  const offered = await service()
  await db.update(schema.service_definitions).set({ provider_protocol: 'leased_v1' })
    .where(eq(schema.service_definitions.id, offered.id))
  const created = await order(offered.id, `overdue-dispute-${crypto.randomUUID()}`)
  assert.equal(created.status, 201)
  const { trade, order: savedOrder } = await created.json()
  const { advanceServiceOrder } = await import('@/lib/service-order-state')
  const { queueFundedWorkOrder } = await import('@/lib/service-order-dispatch')
  const { changeServiceExecutionAttempt, expireServiceExecutionAttempts } = await import('@/lib/service-execution-attempt')
  await db.transaction(async (tx) => {
    await tx.update(schema.trades).set({ status: 'escrow_held', funded_at: new Date().toISOString() })
      .where(eq(schema.trades.id, trade.id))
    await advanceServiceOrder(tx, trade.id, 'funded')
    await queueFundedWorkOrder(tx, trade.id, sellerId)
  })
  const [attempt] = await db.select().from(schema.service_execution_attempts)
    .where(eq(schema.service_execution_attempts.order_id, savedOrder.id))
  await changeServiceExecutionAttempt(trade.id, sellerId, attempt.id, 'accept')
  await db.update(schema.service_execution_attempts).set({ lease_expires_at: new Date(Date.now() - 1_000) })
    .where(eq(schema.service_execution_attempts.id, attempt.id))
  const { POST: dispute } = await import('@/app/api/trades/[id]/dispute/route')
  assert.equal((await dispute(request(`/api/trades/${trade.id}/dispute`, buyerId, { reason: 'Lease elapsed' }),
    { params: Promise.resolve({ id: trade.id }) })).status, 200)
  const [expired] = await db.select().from(schema.service_execution_attempts)
    .where(eq(schema.service_execution_attempts.id, attempt.id))
  assert.equal(expired.state, 'expired')
  assert.equal(await expireServiceExecutionAttempts(), 0)
})

test('replayed work notice is suppressed after provider decline without changing funds', async () => {
  const offered = await service()
  await db.update(schema.service_definitions).set({ provider_protocol: 'leased_v1' })
    .where(eq(schema.service_definitions.id, offered.id))
  const created = await order(offered.id, `stale-notice-${crypto.randomUUID()}`)
  assert.equal(created.status, 201)
  const { trade, order: savedOrder } = await created.json()
  const webhookId = `stale-work-hook-${crypto.randomUUID()}`
  await db.insert(schema.webhooks).values({ id: webhookId, agent_id: sellerId,
    url: 'https://provider.example.invalid/stale-work', secret_hash: 'test-hash',
    events: JSON.stringify(['work_order.ready']), active: 1 })
  const { advanceServiceOrder } = await import('@/lib/service-order-state')
  const { queueFundedWorkOrder } = await import('@/lib/service-order-dispatch')
  await db.transaction(async (tx) => {
    await tx.update(schema.trades).set({ status: 'escrow_held', funded_at: new Date().toISOString() })
      .where(eq(schema.trades.id, trade.id))
    await advanceServiceOrder(tx, trade.id, 'funded')
    await queueFundedWorkOrder(tx, trade.id, sellerId)
  })

  // A new connection sees the same queued ID, as a restarted worker would.
  const { createClient } = await import('@libsql/client')
  const reopened = createClient({ url: process.env.TURSO_DATABASE_URL! })
  const persisted = await reopened.execute({
    sql: 'SELECT a.id AS attempt_id, d.id AS delivery_id FROM service_execution_attempts a JOIN service_orders o ON o.id = a.order_id JOIN webhook_deliveries d ON d.id = ? WHERE o.id = ?',
    args: [`work-order-ready:${savedOrder.id}:${webhookId}`, savedOrder.id],
  })
  reopened.close()
  assert.equal(persisted.rows.length, 1)
  const attemptId = String(persisted.rows[0].attempt_id)
  const deliveryId = String(persisted.rows[0].delivery_id)
  await db.transaction(async (tx) => { await queueFundedWorkOrder(tx, trade.id, sellerId) })
  assert.equal((await db.select().from(schema.webhook_deliveries).where(eq(schema.webhook_deliveries.webhook_id, webhookId))).length, 1)

  const { changeServiceExecutionAttempt } = await import('@/lib/service-execution-attempt')
  await changeServiceExecutionAttempt(trade.id, sellerId, attemptId, 'decline')
  const declinedOrder = await getServiceOrder(ownedRead(`/api/service-orders/${savedOrder.id}`, buyerId),
    { params: Promise.resolve({ id: savedOrder.id }) })
  assert.equal((await declinedOrder.json()).provider_execution.attention_reason, 'provider_declined')
  const replayWebhookId = `late-work-hook-${crypto.randomUUID()}`
  await db.insert(schema.webhooks).values({ id: replayWebhookId, agent_id: sellerId,
    url: 'https://provider.example.invalid/late-work', secret_hash: 'test-hash',
    events: JSON.stringify(['work_order.ready']), active: 1 })
  await db.transaction(async (tx) => { assert.equal(await queueFundedWorkOrder(tx, trade.id, sellerId), 0) })
  assert.equal((await db.select().from(schema.webhook_deliveries).where(eq(schema.webhook_deliveries.webhook_id, replayWebhookId))).length, 0)
  const { attemptWebhookDelivery, inspectWebhookDeliveryHealth } = await import('@/lib/webhook-delivery')
  // Recover an abandoned claim after its worker lease has elapsed.
  await db.update(schema.webhook_deliveries).set({ locked_at: new Date(Date.now() - 3 * 60_000) })
    .where(eq(schema.webhook_deliveries.id, deliveryId))
  assert.equal(await attemptWebhookDelivery(deliveryId), 'suppressed')
  assert.equal(await attemptWebhookDelivery(deliveryId), 'skipped')
  const [notice] = await db.select().from(schema.webhook_deliveries).where(eq(schema.webhook_deliveries.id, deliveryId))
  assert.equal(notice.attempts, 0)
  assert.equal(notice.success, 0)
  assert.ok(notice.suppressed_at)
  const { GET: deliveryHistory } = await import('@/app/api/webhooks/deliveries/route')
  const history = await deliveryHistory(new NextRequest('http://localhost/api/webhooks/deliveries', {
    headers: { Authorization: `Bearer ${token({ userId: sellerId, email: `${sellerId}@test.invalid`, role: 'human' })}` },
  }))
  assert.equal(history.status, 200)
  assert.equal((await history.json()).deliveries.find((row: { id: string }) => row.id === deliveryId)?.status, 'suppressed')
  const health = await inspectWebhookDeliveryHealth()
  assert.equal(health.failed_count, 0)
  const [orderAfter] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, savedOrder.id))
  const [tradeAfter] = await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id))
  assert.equal(orderAfter.state, 'funded')
  assert.equal(tradeAfter.status, 'escrow_held')
})

test('terminal work order suppresses its pending notice after resolution', async () => {
  const offered = await service()
  await db.update(schema.service_definitions).set({ provider_protocol: 'leased_v1' })
    .where(eq(schema.service_definitions.id, offered.id))
  const created = await order(offered.id, `terminal-notice-${crypto.randomUUID()}`)
  assert.equal(created.status, 201)
  const { trade, order: savedOrder } = await created.json()
  const webhookId = `terminal-work-hook-${crypto.randomUUID()}`
  await db.insert(schema.webhooks).values({ id: webhookId, agent_id: sellerId,
    url: 'https://provider.example.invalid/terminal-work', secret_hash: 'test-hash',
    events: JSON.stringify(['work_order.ready']), active: 1 })
  const { advanceServiceOrder } = await import('@/lib/service-order-state')
  const { queueFundedWorkOrder } = await import('@/lib/service-order-dispatch')
  await db.transaction(async (tx) => {
    await tx.update(schema.trades).set({ status: 'escrow_held', funded_at: new Date().toISOString() })
      .where(eq(schema.trades.id, trade.id))
    await advanceServiceOrder(tx, trade.id, 'funded')
    await queueFundedWorkOrder(tx, trade.id, sellerId)
    await tx.update(schema.trades).set({ status: 'resolved' }).where(eq(schema.trades.id, trade.id))
    await advanceServiceOrder(tx, trade.id, 'resolved')
  })
  const deliveryId = `work-order-ready:${savedOrder.id}:${webhookId}`
  const { attemptWebhookDelivery } = await import('@/lib/webhook-delivery')
  assert.equal(await attemptWebhookDelivery(deliveryId), 'suppressed')
  const [notice] = await db.select().from(schema.webhook_deliveries).where(eq(schema.webhook_deliveries.id, deliveryId))
  assert.equal(notice.success, 0)
  assert.equal(notice.attempts, 0)
  const [interrupted] = await db.select().from(schema.service_execution_attempts)
    .where(eq(schema.service_execution_attempts.order_id, savedOrder.id))
  assert.equal(interrupted.state, 'interrupted')
  const [definition] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(definition.active_orders, 0)
})

test('verified funding atomically queues one private provider work notice per subscribed webhook', async () => {
  const offered = await service()
  const created = await order(offered.id, `dispatch-outbox-${crypto.randomUUID()}`)
  assert.equal(created.status, 201)
  const { trade } = await created.json()
  const [pending] = await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id))
  const webhookId = `work-order-hook-${crypto.randomUUID()}`
  await db.insert(schema.webhooks).values({ id: webhookId, agent_id: sellerId,
    url: 'https://provider.example.invalid/work', secret_hash: 'test-hash',
    events: JSON.stringify(['work_order.ready']), active: 1 })
  const { recordExternalTradeFunding } = await import('@/lib/trade-funding')
  const funding = { trade: pending, rail: 'evm' as const, txHash: `0x${'ab'.repeat(32)}`,
    externalId: `proof-${crypto.randomUUID()}`, payerAddress: `0x${'11'.repeat(20)}`,
    tokenAddress: `0x${'44'.repeat(20)}`, chainId: 8453, tokenSymbol: 'USDC',
    tokenDecimals: 6, tokenAmount: BigInt(10_500_000), tokenUsdPrice: 1, usdValue: 10.5 }
  assert.equal((await db.select().from(schema.webhook_deliveries).where(eq(schema.webhook_deliveries.webhook_id, webhookId))).length, 0)
  const funded = await recordExternalTradeFunding(funding)
  assert.equal(funded.status, 'escrow_held')
  const replay = await recordExternalTradeFunding({ ...funding, trade: funded })
  assert.equal(replay.id, funded.id)
  const notices = await db.select().from(schema.webhook_deliveries).where(eq(schema.webhook_deliveries.webhook_id, webhookId))
  assert.equal(notices.length, 1)
  assert.equal(notices[0].attempts, 0)
  const payload = JSON.parse(notices[0].payload)
  assert.equal(payload.delivery_id, notices[0].id)
  assert.equal(payload.event, 'work_order.ready')
  assert.deepEqual(payload.data, { trade_id: trade.id, work_order_url: `/api/trades/${trade.id}/work-order` })
  assert.equal(JSON.stringify(payload).includes('abc123'), false)
  assert.equal(JSON.stringify(payload).includes('reusable-buyer@test.invalid'), false)
})

test('a verified payment racing cancellation enters cancelled-trade reconciliation', async () => {
  const offered = await service()
  const created = await order(offered.id, `late-proof-race-${crypto.randomUUID()}`)
  assert.equal(created.status, 201)
  const { trade, order: savedOrder } = await created.json()
  const [stalePending] = await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id))
  const { recordExternalTradeFunding, recordCancelledExternalFunding } = await import('@/lib/trade-funding')
  const funding = { trade: stalePending, rail: 'evm' as const, txHash: `0x${'ac'.repeat(32)}`,
    externalId: `late-proof-${crypto.randomUUID()}`, payerAddress: `0x${'11'.repeat(20)}`,
    tokenAddress: `0x${'44'.repeat(20)}`, chainId: 8453, tokenSymbol: 'USDC',
    tokenDecimals: 6, tokenAmount: BigInt(10_500_000), tokenUsdPrice: 1, usdValue: 10.5 }
  const cancelled = await cancelTrade(request(`/api/trades/${trade.id}/cancel`, buyerId, {}),
    { params: Promise.resolve({ id: trade.id }) })
  assert.equal(cancelled.status, 200)
  await assert.rejects(recordExternalTradeFunding(funding),
    (error: any) => error.code === 'TRADE_NOT_AWAITING_PAYMENT')
  const [cancelledTrade] = await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id))
  const recorded = await Promise.all([
    recordCancelledExternalFunding({ ...funding, trade: cancelledTrade }),
    recordCancelledExternalFunding({ ...funding, trade: cancelledTrade }),
  ])
  assert.deepEqual(recorded.map((row) => row.status), ['cancelled', 'cancelled'])
  assert.deepEqual(recorded.map((row) => row.payout_status), ['processing', 'processing'])
  const receipts = await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, trade.id))
  assert.equal(receipts.length, 1)
  const [receipt] = receipts
  assert.equal(receipt.tx_hash, funding.txHash)
  await assert.rejects(recordCancelledExternalFunding({ ...funding, trade: cancelledTrade, txHash: `0x${'ad'.repeat(32)}` }),
    (error: any) => error.code === 'PAYMENT_PROOF_REUSED')
  await db.update(schema.trades).set({ payout_status: 'refunded' }).where(eq(schema.trades.id, trade.id))
  const replay = await recordCancelledExternalFunding({ ...funding, trade: cancelledTrade })
  assert.equal(replay.payout_status, 'refunded')
  const [cancelledOrder] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, savedOrder.id))
  const [definition] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(cancelledOrder.state, 'cancelled')
  assert.equal(definition.active_orders, 0)
  assert.equal((await db.select().from(schema.service_execution_attempts)
    .where(eq(schema.service_execution_attempts.order_id, savedOrder.id))).length, 0)
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
