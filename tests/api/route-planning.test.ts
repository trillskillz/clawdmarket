import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let generateJWT: typeof import('@/lib/auth').generateJWT
let createService: typeof import('@/app/api/services/route').POST
let planRoute: typeof import('@/app/api/routes/plan/route').POST
let getRoute: typeof import('@/app/api/routes/[id]/route').GET
let cancelRoute: typeof import('@/app/api/routes/[id]/route').DELETE
let executeRoute: typeof import('@/app/api/routes/[id]/execute/route').POST
const treasury = privateKeyToAccount(`0x${'66'.repeat(32)}`)

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-route-plan-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'routes.db')}`
  process.env.JWT_SECRET = 'route-planning-tests-only'
  process.env.TREASURY_ADDRESS = treasury.address
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'66'.repeat(32)}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Test Base', address: `0x${'44'.repeat(20)}`, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: 'https://rpc.example.invalid' }])
  delete process.env.MPP_SECRET_KEY
  delete process.env.MPP_SECRET_KEY_CURRENT
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  generateJWT = (await import('@/lib/auth')).generateJWT
  createService = (await import('@/app/api/services/route')).POST
  planRoute = (await import('@/app/api/routes/plan/route')).POST
  getRoute = (await import('@/app/api/routes/[id]/route')).GET
  cancelRoute = (await import('@/app/api/routes/[id]/route')).DELETE
  executeRoute = (await import('@/app/api/routes/[id]/execute/route')).POST
  await db.insert(schema.users).values([
    { id: 'route-seller', name: 'Route Seller', email: 'route-seller@test.invalid', password_hash: 'unused', role: 'human' },
    { id: 'route-buyer', name: 'Route Buyer', email: 'route-buyer@test.invalid', password_hash: 'unused', role: 'human' },
    { id: 'other-buyer', name: 'Other Buyer', email: 'other-buyer@test.invalid', password_hash: 'unused', role: 'human' },
  ])
  await db.insert(schema.payout_addresses).values({ user_id: 'route-seller', address: treasury.address })
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function request(path: string, userId: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${generateJWT({ userId, email: `${userId}@test.invalid`, role: 'human' })}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function service(price: string, inputSchema?: Record<string, unknown>) {
  const result = await createService(request('/api/services', 'route-seller', 'POST', {
    title: 'Security code review', description: 'Audit an API repository and report authentication vulnerabilities.',
    capabilities: ['security', 'code-review'], pricing: { model: 'fixed', amount: price, currency: 'USD' },
    estimated_latency_seconds: 120, max_concurrency: 2, status: 'active', input_schema: inputSchema,
  }))
  assert.equal(result.status, 201)
  return (await result.json()).service
}

test('planning excludes incompatible inputs and execution rechecks a changed schema', async () => {
  const offered = await service('1.00', { type: 'object', properties: { revision: { type: 'string' } }, required: ['revision'], additionalProperties: false })
  const incompatible = await planRoute(request('/api/routes/plan', 'other-buyer', 'POST', {
    client_reference: `wrong-input-${crypto.randomUUID()}`, objective: 'Audit this repository for authentication vulnerabilities',
    required_capabilities: ['security-analysis', 'code-review'], input: { revision: 123 },
    max_budget: { amount: '20.00', currency: 'USD' }, deadline_seconds: 600,
  }))
  assert.equal((await incompatible.json()).route.candidates.some((item: { service_id: string }) => item.service_id === offered.id), false)
  const planned = await planRoute(request('/api/routes/plan', 'other-buyer', 'POST', {
    client_reference: `schema-change-${crypto.randomUUID()}`, objective: 'Audit this repository for authentication vulnerabilities',
    required_capabilities: ['security-analysis', 'code-review'], input: { revision: 'abc123' },
    max_budget: { amount: '20.00', currency: 'USD' }, deadline_seconds: 600,
  }))
  const route = (await planned.json()).route
  assert.equal(route.candidates.some((item: { service_id: string }) => item.service_id === offered.id), true)
  await db.update(schema.service_definitions).set({ input_schema: JSON.stringify({ type: 'object', properties: { revision: { type: 'integer' } }, required: ['revision'] }) })
    .where(eq(schema.service_definitions.id, offered.id))
  const execution = await executeRoute(request(`/api/routes/${route.id}/execute`, 'other-buyer', 'POST'), { params: Promise.resolve({ id: route.id }) })
  assert.equal(execution.status, 409)
  assert.equal((await execution.json()).error_code, 'SERVICE_INPUT_INVALID')
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.service_id, offered.id))).length, 0)
})

function plan(reference: string, amount = '20.00') {
  return planRoute(request('/api/routes/plan', 'route-buyer', 'POST', {
    client_reference: reference, objective: 'Audit this repository for authentication vulnerabilities',
    required_capabilities: ['security-analysis', 'code-review'], input: { revision: 'abc123' },
    max_budget: { amount, currency: 'USD' }, deadline_seconds: 600,
  }))
}

test('planning normalizes capabilities, ranks affordable ready services, and moves no money', async () => {
  const expensive = await service('10.00')
  const cheaper = await service('5.00')
  const reference = `plan-${crypto.randomUUID()}`
  const response = await plan(reference)
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  const body = await response.json()
  assert.deepEqual(body.route.required_capabilities, ['security-analysis', 'code-review'])
  assert.equal(body.route.candidates.length, 2)
  assert.equal(body.route.candidates[0].service_id, cheaper.id)
  assert.equal(body.route.candidates[1].service_id, expensive.id)
  assert.equal(body.route.candidates[0].pricing.estimated_total, '5.25')
  assert.equal(body.route.candidates[0].evidence_level, 'claimed_only')
  assert.equal(body.planning.funds_moved, false)
  assert.equal((await db.select().from(schema.trades)).length, 0)
  assert.equal((await db.select().from(schema.service_orders)).length, 0)
  const repeated = await plan(reference)
  assert.equal(repeated.status, 200)
  assert.equal((await repeated.json()).route.id, body.route.id)
  const hidden = await getRoute(request(`/api/routes/${body.route.id}`, 'other-buyer', 'GET'), { params: Promise.resolve({ id: body.route.id }) })
  assert.equal(hidden.status, 404)
  const owned = await getRoute(request(`/api/routes/${body.route.id}`, 'route-buyer', 'GET'), { params: Promise.resolve({ id: body.route.id }) })
  assert.equal((await owned.json()).payment_exposure, null)
  const cancelled = await cancelRoute(request(`/api/routes/${body.route.id}`, 'route-buyer', 'DELETE'), { params: Promise.resolve({ id: body.route.id }) })
  assert.equal(cancelled.status, 200)
  assert.equal((await cancelled.json()).route.state, 'cancelled')
})

test('planning filters candidates by server total and returns an honest empty plan', async () => {
  const response = await plan(`budget-plan-${crypto.randomUUID()}`, '1.00')
  assert.equal(response.status, 201)
  const body = await response.json()
  assert.deepEqual(body.route.candidates, [])
  assert.equal(body.planning.candidate_count, 0)
})

test('planning enforces declared deadline and rejects a changed idempotent request', async () => {
  const reference = `deadline-plan-${crypto.randomUUID()}`
  const response = await planRoute(request('/api/routes/plan', 'route-buyer', 'POST', {
    client_reference: reference, objective: 'Audit this repository for authentication vulnerabilities',
    required_capabilities: ['security', 'code-review'], max_budget: { amount: '20.00', currency: 'USD' },
    deadline_seconds: 60,
  }))
  assert.equal(response.status, 201)
  assert.deepEqual((await response.json()).route.candidates, [])
  const changed = await plan(reference)
  assert.equal(changed.status, 409)
  assert.equal((await changed.json()).error_code, 'IDEMPOTENCY_CONFLICT')
})

test('production canary flags admit only the configured buyer and seller', async () => {
  let canaryServiceId: string | undefined
  let canaryRouteId: string | undefined
  const original = {
    nodeEnv: process.env.NODE_ENV,
    buyer: process.env.CLAWDMARKET_ROUTE_CANARY_BUYER_ID,
    seller: process.env.CLAWDMARKET_ROUTE_CANARY_SELLER_ID,
    services: process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED,
    planning: process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED,
    execution: process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED,
  }
  try {
    Reflect.set(process.env, 'NODE_ENV', 'production')
    process.env.CLAWDMARKET_ROUTE_CANARY_BUYER_ID = 'other-buyer'
    process.env.CLAWDMARKET_ROUTE_CANARY_SELLER_ID = 'route-seller'
    delete process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED
    delete process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED
    delete process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED
    const { reusableServiceWritesEnabled, reusableServiceSellerWritesEnabled, reusableServiceBuyerOrdersEnabled,
      routePlanningEnabled, routeExecutionEnabled } = await import('@/lib/routing-feature-flags')
    assert.equal(reusableServiceWritesEnabled(), false)
    assert.equal(routePlanningEnabled(), false)
    assert.equal(routeExecutionEnabled(), false)
    assert.equal(reusableServiceSellerWritesEnabled('route-seller'), true)
    assert.equal(reusableServiceSellerWritesEnabled('other-buyer'), false)
    assert.equal(reusableServiceBuyerOrdersEnabled('other-buyer'), true)
    assert.equal(reusableServiceBuyerOrdersEnabled('route-seller'), false)
    assert.equal(routePlanningEnabled('other-buyer'), true)
    assert.equal(routeExecutionEnabled('other-buyer'), true)
    assert.equal(routePlanningEnabled('route-buyer'), false)
    const offered = await service('0.10')
    canaryServiceId = offered.id
    assert.equal(offered.readiness.purchasable, true)
    const deniedService = await createService(request('/api/services', 'route-buyer', 'POST', {
      title: 'Unscoped service', description: 'This provider is outside the production route canary.',
      capabilities: ['code-review'], pricing: { model: 'fixed', amount: '0.10', currency: 'USD' }, status: 'active',
    }))
    assert.equal(deniedService.status, 503)
    const deniedPlan = await planRoute(request('/api/routes/plan', 'route-buyer', 'POST', {
      client_reference: `unscoped-${crypto.randomUUID()}`, objective: 'Review this code for authentication issues',
      required_capabilities: ['code-review'], max_budget: { amount: '0.11', currency: 'USD' },
    }))
    assert.equal(deniedPlan.status, 503)
    const planned = await planRoute(request('/api/routes/plan', 'other-buyer', 'POST', {
      client_reference: `scoped-${crypto.randomUUID()}`, objective: 'Review this code for authentication issues',
      required_capabilities: ['code-review'], max_budget: { amount: '0.11', currency: 'USD' },
      payment_policy: { allowed_rails: ['evm'] },
    }))
    assert.equal(planned.status, 201)
    const route = (await planned.json()).route
    canaryRouteId = route.id
    assert.equal(route.candidates.some((candidate: { service_id: string }) => candidate.service_id === offered.id), true)
    const executed = await executeRoute(request(`/api/routes/${route.id}/execute`, 'other-buyer', 'POST'),
      { params: Promise.resolve({ id: route.id }) })
    assert.equal(executed.status, 201, JSON.stringify(await executed.clone().json()))
    assert.equal((await executed.json()).trade.status, 'pending')
  } finally {
    if (canaryRouteId) await cancelRoute(request(`/api/routes/${canaryRouteId}`, 'other-buyer', 'DELETE'),
      { params: Promise.resolve({ id: canaryRouteId }) })
    if (canaryServiceId) await db.update(schema.service_definitions).set({ status: 'archived' })
      .where(eq(schema.service_definitions.id, canaryServiceId))
    for (const [name, value] of Object.entries({ NODE_ENV: original.nodeEnv,
      CLAWDMARKET_ROUTE_CANARY_BUYER_ID: original.buyer, CLAWDMARKET_ROUTE_CANARY_SELLER_ID: original.seller,
      CLAWDMARKET_REUSABLE_SERVICES_ENABLED: original.services, CLAWDMARKET_ROUTE_PLANNING_ENABLED: original.planning,
      CLAWDMARKET_ROUTE_EXECUTION_ENABLED: original.execution })) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
})

test('execution reserves an unpaid order once and cancellation releases capacity', async () => {
  const offered = await service('4.00')
  const planned = await plan(`execute-${crypto.randomUUID()}`)
  const route = (await planned.json()).route
  assert.equal(route.candidates[0].service_id, offered.id)
  const path = `/api/routes/${route.id}/execute`
  const execute = () => executeRoute(request(path, 'route-buyer', 'POST'), { params: Promise.resolve({ id: route.id }) })
  const first = await execute()
  assert.equal(first.status, 201, JSON.stringify(await first.clone().json()))
  const body = await first.json()
  assert.equal(body.route.state, 'awaiting_funding')
  assert.equal(body.funds_state, 'payment_unknown')
  assert.equal(body.payment_exposure.state, 'checkout_open')
  assert.equal(body.payment_exposure.automatic_retry_allowed, false)
  assert.equal(body.trade.status, 'pending')
  assert.equal(body.trade.payment_rail, 'evm')
  assert.equal(body.checkout.rail, 'evm')
  const repeated = await execute()
  assert.equal(repeated.status, 200)
  assert.equal((await repeated.json()).order.id, body.order.id)
  await db.insert(schema.evm_payment_intents).values({
    trade_id: body.trade.id, buyer_id: 'route-buyer', origin: 'http://localhost', payer_address: treasury.address,
    chain_id: 8453, token_address: `0x${'44'.repeat(20)}`, treasury_address: treasury.address,
    token_amount: '4200000', token_decimals: 6, token_symbol: 'USDC', token_usd_price: 1,
    amount_usd: body.trade.total_cost, expires_at: body.trade.payment_due_at,
  })
  const inFlight = await getRoute(request(`/api/routes/${route.id}`, 'route-buyer', 'GET'), { params: Promise.resolve({ id: route.id }) })
  assert.equal((await inFlight.json()).payment_exposure.state, 'payment_in_flight_possible')
  const [reserved] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(reserved.active_orders, 1)
  const cancelled = await cancelRoute(request(`/api/routes/${route.id}`, 'route-buyer', 'DELETE'), { params: Promise.resolve({ id: route.id }) })
  assert.equal(cancelled.status, 200)
  const cancellation = await cancelled.json()
  assert.equal(cancellation.route.state, 'cancelled')
  assert.equal(cancellation.funds_state, 'payment_unknown')
  assert.equal(cancellation.payment_exposure.automatic_retry_allowed, false)
  assert.equal((await getRoute(request(`/api/routes/${route.id}`, 'route-buyer', 'GET'), { params: Promise.resolve({ id: route.id }) }).then((response) => response.json())).payment_exposure.state, 'late_payment_possible')
  await db.insert(schema.payment_receipts).values({ route: `/api/trades/${body.trade.id}/fund/evm`, trade_id: body.trade.id,
    payment_rail: 'evm', amount: body.trade.total_cost, currency: 'USDC', external_id: `late-${crypto.randomUUID()}` })
  await db.update(schema.trades).set({ payout_status: 'processing' }).where(eq(schema.trades.id, body.trade.id))
  const processing = await getRoute(request(`/api/routes/${route.id}`, 'route-buyer', 'GET'), { params: Promise.resolve({ id: route.id }) })
  assert.equal((await processing.json()).payment_exposure.state, 'refund_processing')
  await db.update(schema.trades).set({ payout_status: 'refunded' }).where(eq(schema.trades.id, body.trade.id))
  const refunded = await getRoute(request(`/api/routes/${route.id}`, 'route-buyer', 'GET'), { params: Promise.resolve({ id: route.id }) })
  assert.equal((await refunded.json()).payment_exposure.state, 'refunded')
  const cancelledAgain = await cancelRoute(request(`/api/routes/${route.id}`, 'route-buyer', 'DELETE'), { params: Promise.resolve({ id: route.id }) })
  assert.equal((await cancelledAgain.json()).payment_exposure.state, 'refunded')
  const [released] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(released.active_orders, 0)
  assert.equal((await execute()).status, 200)
})

test('route execution rejects stale price and expired plans without creating orders', async () => {
  const offered = await service('3.00')
  const planned = await plan(`stale-${crypto.randomUUID()}`)
  const route = (await planned.json()).route
  assert.equal(route.candidates[0].service_id, offered.id)
  await db.update(schema.service_definitions).set({ price_minor: 900 }).where(eq(schema.service_definitions.id, offered.id))
  const changed = await executeRoute(request(`/api/routes/${route.id}/execute`, 'route-buyer', 'POST'), { params: Promise.resolve({ id: route.id }) })
  assert.equal(changed.status, 409)
  assert.equal((await changed.json()).error_code, 'ROUTE_STALE_PROVIDER')
  const [failed] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, route.id))
  assert.equal(failed.state, 'failed')
  assert.equal(failed.service_order_id, null)
  const later = await plan(`expired-${crypto.randomUUID()}`)
  const laterRoute = (await later.json()).route
  await db.update(schema.route_plans).set({ expires_at: new Date(Date.now() - 1_000) }).where(eq(schema.route_plans.id, laterRoute.id))
  const expired = await executeRoute(request(`/api/routes/${laterRoute.id}/execute`, 'route-buyer', 'POST'), { params: Promise.resolve({ id: laterRoute.id }) })
  assert.equal(expired.status, 410)
  assert.equal((await expired.json()).error_code, 'ROUTE_PLAN_EXPIRED')
})

test('route execution enforces buyer ownership and cannot use a ledger-only plan', async () => {
  const offered = await service('2.00')
  const planned = await plan(`owner-${crypto.randomUUID()}`)
  const route = (await planned.json()).route
  assert.equal(route.candidates[0].service_id, offered.id)
  const forbidden = await executeRoute(request(`/api/routes/${route.id}/execute`, 'other-buyer', 'POST'), { params: Promise.resolve({ id: route.id }) })
  assert.equal(forbidden.status, 404)
  const ledgerOnly = await planRoute(request('/api/routes/plan', 'route-buyer', 'POST', {
    client_reference: `ledger-only-${crypto.randomUUID()}`, objective: 'Audit this repository for authentication vulnerabilities',
    required_capabilities: ['security-analysis', 'code-review'], max_budget: { amount: '20.00', currency: 'USD' },
    payment_policy: { allowed_rails: ['ledger'] },
  }))
  assert.deepEqual((await ledgerOnly.json()).route.candidates, [])
})

test('concurrent route execution links one order and follows authoritative trade transitions', async () => {
  const offered = await service('1.00')
  const planned = await plan(`race-${crypto.randomUUID()}`)
  const route = (await planned.json()).route
  assert.equal(route.candidates[0].service_id, offered.id)
  const execute = () => executeRoute(request(`/api/routes/${route.id}/execute`, 'route-buyer', 'POST'), { params: Promise.resolve({ id: route.id }) })
  const responses = await Promise.all([execute(), execute()])
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201])
  const bodies = await Promise.all(responses.map((response) => response.json()))
  assert.equal(bodies[0].order.id, bodies[1].order.id)
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.client_reference, `route:${route.id}:attempt:1`))).length, 1)
  const { advanceServiceOrder } = await import('@/lib/service-order-state')
  await db.transaction(async (tx) => {
    await tx.update(schema.trades).set({ status: 'escrow_held' }).where(eq(schema.trades.id, bodies[0].trade.id))
    await advanceServiceOrder(tx, bodies[0].trade.id, 'funded')
  })
  const [funded] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, route.id))
  assert.equal(funded.state, 'funded')
  const cancellation = await cancelRoute(request(`/api/routes/${route.id}`, 'route-buyer', 'DELETE'), { params: Promise.resolve({ id: route.id }) })
  assert.equal(cancellation.status, 409)
  const rejected = await cancellation.json()
  assert.equal(rejected.error_code, 'ROUTE_FUNDS_ALREADY_COMMITTED')
  assert.equal(rejected.state, 'see_trade')
})

test('capacity consumed after planning fails the route without a second reservation', async () => {
  const offered = await service('0.50')
  const planned = await plan(`capacity-${crypto.randomUUID()}`)
  const route = (await planned.json()).route
  assert.equal(route.candidates[0].service_id, offered.id)
  const createOrder = (await import('@/app/api/services/[id]/orders/route')).POST
  for (let slot = 0; slot < 2; slot += 1) {
    const occupied = await createOrder(request(`/api/services/${offered.id}/orders`, 'other-buyer', 'POST', {
      client_reference: `occupy-${slot}-${crypto.randomUUID()}`, objective: 'Review this repository for a separate buyer', payment_rail: 'evm',
    }), { params: Promise.resolve({ id: offered.id }) })
    assert.equal(occupied.status, 201)
  }
  const execution = await executeRoute(request(`/api/routes/${route.id}/execute`, 'route-buyer', 'POST'), { params: Promise.resolve({ id: route.id }) })
  assert.equal(execution.status, 409)
  assert.equal((await execution.json()).error_code, 'SERVICE_CAPACITY_OR_PRICE_CHANGED')
  const [failed] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, route.id))
  assert.equal(failed.state, 'failed')
  assert.equal(failed.service_order_id, null)
  const [definition] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
  assert.equal(definition.active_orders, 2)
})

test('planning and execution require the provider to support requested verification', async () => {
  const offeredId = crypto.randomUUID()
  await db.insert(schema.service_definitions).values({
    id: offeredId, seller_id: 'route-seller', title: 'Structured security review',
    description: 'Return structured security findings for a repository.',
    capabilities: '["security-analysis","code-review"]', price_minor: 20, estimated_latency_seconds: 120,
    status: 'active', output_schema: JSON.stringify({ type: 'object', properties: { findings: { type: 'array' } }, required: ['findings'] }),
    verification_policy: JSON.stringify({ required: true, methods: ['buyer_review', 'schema'] }),
  })
  const planned = await planRoute(request('/api/routes/plan', 'other-buyer', 'POST', {
    client_reference: `verified-plan-${crypto.randomUUID()}`, objective: 'Audit this repository for authentication vulnerabilities',
    required_capabilities: ['security-analysis', 'code-review'], max_budget: { amount: '20.00', currency: 'USD' },
    verification: { required: true, methods: ['buyer_review', 'schema'] },
  }))
  assert.equal(planned.status, 201)
  const route = (await planned.json()).route
  assert.deepEqual(route.candidates.map((candidate: { service_id: string }) => candidate.service_id), [offeredId])
  assert.deepEqual(route.candidates[0].verification_methods, ['buyer_review', 'schema'])
  const executed = await executeRoute(request(`/api/routes/${route.id}/execute`, 'other-buyer', 'POST'), { params: Promise.resolve({ id: route.id }) })
  assert.equal(executed.status, 201)
  assert.equal((await executed.json()).funds_state, 'payment_unknown')
})

test('buyer policy filters planning and is rechecked before unpaid route reservation', async () => {
  const policyBuyer = 'user_agent_route-policy-buyer'
  await db.insert(schema.users).values({ id: policyBuyer, name: 'Policy buyer', email: 'route-policy-buyer@test.invalid', password_hash: 'unused', role: 'agent' })
  const serviceId = crypto.randomUUID()
  await db.insert(schema.service_definitions).values({ id: serviceId, seller_id: 'route-seller', title: 'Policy checked review',
    description: 'Review a repository under a buyer-owned spending policy.', capabilities: '["security-analysis","code-review"]',
    price_minor: 20, status: 'active', estimated_latency_seconds: 120 })
  const policyBase = { max_per_execution: 100, max_daily: 1000, approved_payment_rails: ['evm'],
    allowed_capabilities: ['security-analysis', 'code-review'] }
  await db.insert(schema.buyer_spend_policies).values({ buyer_id: policyBuyer, owner_account_id: 'other-buyer',
    policy_json: JSON.stringify({ ...policyBase, approved_providers: ['another-seller'] }) })
  const excluded = await planRoute(request('/api/routes/plan', policyBuyer, 'POST', {
    client_reference: `policy-excluded-${crypto.randomUUID()}`, objective: 'Audit this repository for authentication vulnerabilities',
    required_capabilities: ['security-analysis', 'code-review'], max_budget: { amount: '20.00', currency: 'USD' },
  }))
  assert.equal(excluded.status, 201)
  assert.deepEqual((await excluded.json()).route.candidates, [])
  await db.update(schema.buyer_spend_policies).set({ policy_json: JSON.stringify({ ...policyBase, approved_providers: ['route-seller'] }) })
    .where(eq(schema.buyer_spend_policies.buyer_id, policyBuyer))
  const allowed = await planRoute(request('/api/routes/plan', policyBuyer, 'POST', {
    client_reference: `policy-allowed-${crypto.randomUUID()}`, objective: 'Audit this repository for authentication vulnerabilities',
    required_capabilities: ['security-analysis', 'code-review'], max_budget: { amount: '20.00', currency: 'USD' },
  }))
  assert.equal(allowed.status, 201)
  const planned = (await allowed.json()).route
  assert.equal(planned.candidates[0].service_id, serviceId)
  await db.update(schema.buyer_spend_policies).set({ policy_json: JSON.stringify({ ...policyBase, max_per_execution: 0, approved_providers: ['route-seller'] }) })
    .where(eq(schema.buyer_spend_policies.buyer_id, policyBuyer))
  const blocked = await executeRoute(request(`/api/routes/${planned.id}/execute`, policyBuyer, 'POST'), { params: Promise.resolve({ id: planned.id }) })
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json()).error_code, 'BUYER_PER_EXECUTION_LIMIT')
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.client_reference, `route:${planned.id}:attempt:1`))).length, 0)
})

test('an invalidated verification contract falls back before checkout and records one economic reservation', async () => {
  const buyerId = `fallback-buyer-${crypto.randomUUID()}`
  await db.insert(schema.users).values({ id: buyerId, name: 'Fallback Buyer', email: `${buyerId}@test.invalid`, password_hash: 'unused', role: 'human' })
  const [firstId, secondId] = [crypto.randomUUID(), crypto.randomUUID()]
  for (const [id, price] of [[firstId, 20], [secondId, 40]] as const) {
    await db.insert(schema.service_definitions).values({ id, seller_id: 'route-seller', title: 'Translation fallback',
      description: 'Translate a document under an unpaid fallback plan.', capabilities: '["translation"]',
      price_minor: price, status: 'active', max_concurrency: 1, estimated_latency_seconds: 120 })
  }
  const planned = await planRoute(request('/api/routes/plan', buyerId, 'POST', {
    client_reference: `fallback-${crypto.randomUUID()}`, objective: 'Translate this document into a target language',
    required_capabilities: ['translation'], max_budget: { amount: '2.00', currency: 'USD' },
    retry_policy: { max_attempts: 2 },
  }))
  assert.equal(planned.status, 201)
  const route = (await planned.json()).route
  assert.deepEqual(route.candidates.map((item: { service_id: string }) => item.service_id), [firstId, secondId])
  await db.update(schema.service_definitions).set({ verification_policy: '{broken' }).where(eq(schema.service_definitions.id, firstId))
  const execute = () => executeRoute(request(`/api/routes/${route.id}/execute`, buyerId, 'POST'), { params: Promise.resolve({ id: route.id }) })
  const responses = await Promise.all([execute(), execute()])
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201])
  const bodies = await Promise.all(responses.map((response) => response.json()))
  assert.equal(bodies[0].order.id, bodies[1].order.id)
  assert.equal(bodies[0].order.service_id, secondId)
  assert.equal(bodies[0].funds_state, 'payment_unknown')
  const attempts = await db.select().from(schema.route_attempts).where(eq(schema.route_attempts.route_id, route.id)).orderBy(schema.route_attempts.attempt_number)
  assert.deepEqual(attempts.map((attempt) => `${attempt.attempt_number}:${attempt.state}`), ['1:ineligible', '2:reserved'])
  assert.equal(attempts[0].failure_code, 'ROUTE_STALE_PROVIDER')
  assert.equal(attempts[1].service_order_id, bodies[0].order.id)
  const inspected = await getRoute(request(`/api/routes/${route.id}`, buyerId, 'GET'), { params: Promise.resolve({ id: route.id }) })
  assert.equal(inspected.status, 200)
  assert.deepEqual((await inspected.json()).attempts.map((attempt: { state: string }) => attempt.state), ['ineligible', 'reserved'])
  const hidden = await getRoute(request(`/api/routes/${route.id}`, 'other-buyer', 'GET'), { params: Promise.resolve({ id: route.id }) })
  assert.equal(hidden.status, 404)
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.client_reference, `route:${route.id}:attempt:1`))).length, 0)
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, firstId)))[0].active_orders, 0)
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, secondId)))[0].active_orders, 1)
})

test('max_attempts one does not reserve a fallback and a checking attempt resumes safely', async () => {
  const buyerId = `single-attempt-buyer-${crypto.randomUUID()}`
  await db.insert(schema.users).values({ id: buyerId, name: 'Single Buyer', email: `${buyerId}@test.invalid`, password_hash: 'unused', role: 'human' })
  const firstId = crypto.randomUUID()
  const secondId = crypto.randomUUID()
  for (const [id, price] of [[firstId, 20], [secondId, 40]] as const) {
    await db.insert(schema.service_definitions).values({ id, seller_id: 'route-seller', title: 'Research fallback',
      description: 'Research an academic source under a bounded route.', capabilities: '["academic-research"]',
      price_minor: price, status: 'active', estimated_latency_seconds: 120 })
  }
  const planned = await planRoute(request('/api/routes/plan', buyerId, 'POST', {
    client_reference: `single-attempt-${crypto.randomUUID()}`, objective: 'Research the academic source for this request',
    required_capabilities: ['academic-research'], max_budget: { amount: '2.00', currency: 'USD' },
    retry_policy: { max_attempts: 1 },
  }))
  const route = (await planned.json()).route
  await db.insert(schema.route_attempts).values({ id: crypto.randomUUID(), route_id: route.id, attempt_number: 1, service_id: firstId, state: 'checking' })
  await db.update(schema.service_definitions).set({ status: 'paused' }).where(eq(schema.service_definitions.id, firstId))
  const result = await executeRoute(request(`/api/routes/${route.id}/execute`, buyerId, 'POST'), { params: Promise.resolve({ id: route.id }) })
  assert.equal(result.status, 409)
  assert.equal((await result.json()).error_code, 'ROUTE_STALE_PROVIDER')
  assert.equal((await db.select().from(schema.route_attempts).where(eq(schema.route_attempts.route_id, route.id))).length, 1)
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.service_id, secondId))).length, 0)
})

test('planning separates provider claims from backed completion evidence without claiming measured quality', async () => {
  const agentId = `evidence-seller-${crypto.randomUUID()}`
  const buyerId = `evidence-buyer-${crypto.randomUUID()}`
  const sellerId = `user_agent_${agentId}`
  const serviceId = crypto.randomUUID()
  await db.insert(schema.users).values({ id: buyerId, name: 'Evidence buyer', email: `${buyerId}@test.invalid`,
    password_hash: 'unused', role: 'human' })
  await db.insert(schema.users).values({ id: sellerId, name: 'Evidence seller', email: `${agentId}@test.invalid`,
    password_hash: 'unused', role: 'agent' })
  await db.insert(schema.agents).values({ id: agentId, name: 'Evidence seller', description: 'Independent provider',
    capabilities: '["translation"]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused' })
  await db.insert(schema.payout_addresses).values({ user_id: sellerId, address: treasury.address })
  await db.insert(schema.service_definitions).values({ id: serviceId, seller_id: sellerId,
    title: 'Document translation', description: 'Translate a document with a saved deliverable.',
    capabilities: '["translation"]', price_minor: 100, status: 'active', estimated_latency_seconds: 120 })
  const { planRoute: computePlan, routePlanInput } = await import('@/lib/route-planning')
  const planFor = async () => {
    const input = routePlanInput.parse({
      client_reference: `evidence-plan-${crypto.randomUUID()}`, objective: 'Translate this document for review',
      required_capabilities: ['translation'], max_budget: { amount: '2.00', currency: 'USD' },
    })
    return (await computePlan(input, buyerId)).candidates.find((candidate) => candidate.service_id === serviceId)!
  }
  const claimed = await planFor()
  assert.equal(claimed.evidence_level, 'claimed_only')
  assert.equal(claimed.score_components.backed_execution, 0)
  assert.deepEqual(claimed.capability_evidence, [{ capability_id: 'translation', accepted_completion_count: 0,
    distinct_buyer_count: 0, measured_quality_score: null }])

  const [listing] = await db.insert(schema.listings).values({ seller_id: sellerId, category: 'code',
    title: 'Historical translation', description: 'Completed translated document.', price_bankr: 1, status: 'sold' }).returning()
  const [trade] = await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: 'other-buyer',
    seller_id: sellerId, amount: 1, fee: 0.05, status: 'completed', payment_rail: 'ledger' }).returning()
  await db.insert(schema.service_orders).values({ id: crypto.randomUUID(), service_id: serviceId,
    listing_id: listing.id, trade_id: trade.id, buyer_id: 'other-buyer', client_reference: crypto.randomUUID(),
    objective: 'Translate a historical document', price_minor: 100, payment_rail: 'ledger', state: 'completed' })
  const [delivery] = await db.insert(schema.trade_deliveries).values({ trade_id: trade.id, submitter_id: sellerId,
    summary: 'Translated the document.', content_hash: crypto.randomUUID(), verification: '{}' }).returning()
  await db.insert(schema.verification_results).values({ id: crypto.randomUUID(), trade_id: trade.id,
    delivery_id: delivery.id, content_hash: delivery.content_hash, method: 'buyer_review', verifier: 'buyer',
    version: '1', status: 'passed', evidence_json: '{}' })
  await db.insert(schema.transactions).values({ amount: 1, type: 'escrow_lock', reference_id: trade.id })
  const { recordCapabilityCompletion } = await import('@/lib/capability-performance')
  await db.transaction((tx) => recordCapabilityCompletion(tx, trade))
  const observed = await planFor()
  assert.equal(observed.evidence_level, 'backed_completion_observed')
  assert.deepEqual(observed.capability_evidence, [{ capability_id: 'translation', accepted_completion_count: 1,
    distinct_buyer_count: 1, measured_quality_score: null }])
  assert.equal(observed.score_components.backed_execution, 0.2)
  assert.ok(observed.score > claimed.score)
  assert.ok(observed.explanation.some((item: string) => /quality remains unmeasured/.test(item)))

  const recordAnotherCompletion = async (completionBuyer: string) => {
    const [anotherListing] = await db.insert(schema.listings).values({ seller_id: sellerId, category: 'code',
      title: 'Another translation', description: 'Another completed translation.', price_bankr: 1,
      status: 'sold' }).returning()
    const [anotherTrade] = await db.insert(schema.trades).values({ listing_id: anotherListing.id,
      buyer_id: completionBuyer, seller_id: sellerId, amount: 1, fee: 0.05, status: 'completed',
      payment_rail: 'ledger' }).returning()
    await db.insert(schema.service_orders).values({ id: crypto.randomUUID(), service_id: serviceId,
      listing_id: anotherListing.id, trade_id: anotherTrade.id, buyer_id: completionBuyer,
      client_reference: crypto.randomUUID(), objective: 'Translate another completed document',
      price_minor: 100, payment_rail: 'ledger', state: 'completed' })
    const [anotherDelivery] = await db.insert(schema.trade_deliveries).values({ trade_id: anotherTrade.id,
      submitter_id: sellerId, summary: 'Translated the next document.', content_hash: crypto.randomUUID(),
      verification: '{}' }).returning()
    await db.insert(schema.verification_results).values({ id: crypto.randomUUID(), trade_id: anotherTrade.id,
      delivery_id: anotherDelivery.id, content_hash: anotherDelivery.content_hash,
      method: 'buyer_review', verifier: 'buyer', version: '1', status: 'passed', evidence_json: '{}' })
    await db.insert(schema.transactions).values({ amount: 1, type: 'escrow_lock', reference_id: anotherTrade.id })
    await db.transaction((tx) => recordCapabilityCompletion(tx, anotherTrade))
  }
  await recordAnotherCompletion('other-buyer')
  const repeatBuyer = await planFor()
  assert.equal(repeatBuyer.capability_evidence[0].accepted_completion_count, 2)
  assert.equal(repeatBuyer.capability_evidence[0].distinct_buyer_count, 1)
  assert.equal(repeatBuyer.score_components.backed_execution, observed.score_components.backed_execution)

  const secondBuyerId = `second-evidence-buyer-${crypto.randomUUID()}`
  await db.insert(schema.users).values({ id: secondBuyerId, name: 'Second buyer',
    email: `${secondBuyerId}@test.invalid`, password_hash: 'unused', role: 'human' })
  await recordAnotherCompletion(secondBuyerId)
  const broaderEvidence = await planFor()
  assert.equal(broaderEvidence.capability_evidence[0].accepted_completion_count, 3)
  assert.equal(broaderEvidence.capability_evidence[0].distinct_buyer_count, 2)
  assert.equal(broaderEvidence.score_components.backed_execution, 0.4)
  const relatedBuyerAgentId = `related-evidence-buyer-${crypto.randomUUID()}`
  const relatedBuyerId = `user_agent_${relatedBuyerAgentId}`
  await db.insert(schema.users).values({ id: relatedBuyerId, name: 'Related agent buyer',
    email: `${relatedBuyerAgentId}@test.invalid`, password_hash: 'unused', role: 'agent' })
  await db.insert(schema.agents).values({ id: relatedBuyerAgentId, name: 'Related buyer',
    description: 'Buyer agent', capabilities: '[]', endpoint: 'https://example.invalid',
    owner_address: '', api_key: 'unused' })
  await recordAnotherCompletion(relatedBuyerId)
  const beforeOwnerLinks = await planFor()
  assert.equal(beforeOwnerLinks.capability_evidence[0].distinct_buyer_count, 3)
  await db.insert(schema.agent_owners).values({ agentId: relatedBuyerAgentId, userId: 'other-buyer',
    establishedBy: 'test' })
  await db.insert(schema.agent_owners).values({ agentId, userId: 'other-buyer', establishedBy: 'test' })
  const ownerLinked = await planFor()
  assert.equal(ownerLinked.capability_evidence[0].accepted_completion_count, 1)
  assert.equal(ownerLinked.capability_evidence[0].distinct_buyer_count, 1)
  assert.equal(ownerLinked.score_components.backed_execution, 0.2)
  await db.delete(schema.agent_owners).where(eq(schema.agent_owners.agentId, agentId))
  const postOwnershipBaseline = await planFor()

  const recordFailure = async (state: 'declined' | 'expired', funded: boolean, createdAt: Date, buyer = 'other-buyer') => {
    const [failedListing] = await db.insert(schema.listings).values({ seller_id: sellerId, category: 'code',
      title: 'Provider failure fixture', description: 'Historical provider attempt.', price_bankr: 1, status: 'sold' }).returning()
    const [failedTrade] = await db.insert(schema.trades).values({ listing_id: failedListing.id, buyer_id: buyer,
      seller_id: sellerId, amount: 1, fee: 0.05, status: funded ? 'escrow_held' : 'pending',
      funded_at: funded ? createdAt.toISOString() : null, payment_rail: 'evm' }).returning()
    const orderId = crypto.randomUUID()
    await db.insert(schema.service_orders).values({ id: orderId, service_id: serviceId,
      listing_id: failedListing.id, trade_id: failedTrade.id, buyer_id: buyer,
      client_reference: crypto.randomUUID(), objective: 'Attempt the requested translation',
      price_minor: 100, payment_rail: 'evm', state: funded ? 'funded' : 'awaiting_funding' })
    await db.insert(schema.service_execution_attempts).values({ id: crypto.randomUUID(), order_id: orderId,
      state, created_at: createdAt, completed_at: createdAt })
  }
  await recordFailure('declined', true, new Date())
  await recordFailure('expired', true, new Date())
  await recordFailure('expired', true, new Date(Date.now() - 100 * 24 * 3600_000))
  await recordFailure('declined', false, new Date())
  await recordFailure('declined', true, new Date(), sellerId)
  const penalized = await planFor()
  assert.deepEqual(penalized.provider_failures, { provider_declines_90d: 1, lease_expiries_90d: 1,
    uncorrected_verification_failures_90d: 0, buyer_refund_resolutions_90d: 0 })
  assert.equal(penalized.score_components.provider_failure_penalty, 0.4)
  assert.ok(penalized.score < postOwnershipBaseline.score)
  assert.equal(penalized.evidence_level, 'backed_completion_observed')
  assert.match(penalized.explanation.at(-1) ?? '', /penalty is capped/)

  const [rejectedListing] = await db.insert(schema.listings).values({ seller_id: sellerId, category: 'code',
    title: 'Rejected translation', description: 'Translation awaiting a corrected submission.', price_bankr: 1,
    status: 'sold' }).returning()
  const [rejectedTrade] = await db.insert(schema.trades).values({ listing_id: rejectedListing.id,
    buyer_id: 'other-buyer', seller_id: sellerId, amount: 1, fee: 0.05, status: 'escrow_held',
    funded_at: new Date().toISOString(), payment_rail: 'evm' }).returning()
  await db.insert(schema.service_orders).values({ id: crypto.randomUUID(), service_id: serviceId,
    listing_id: rejectedListing.id, trade_id: rejectedTrade.id, buyer_id: 'other-buyer',
    client_reference: crypto.randomUUID(), objective: 'Translate a document with valid output',
    price_minor: 100, payment_rail: 'evm', state: 'funded' })
  const rejectedHash = crypto.randomUUID()
  await db.insert(schema.verification_results).values(['schema', 'source_urls'].map((method) => ({
    id: crypto.randomUUID(), trade_id: rejectedTrade.id, content_hash: rejectedHash,
    method, verifier: 'clawdmarket-deterministic-v1', version: '1', status: 'failed' as const,
    failure: 'invalid_output', evidence_json: '{}',
  })))
  const awaitingCorrection = await planFor()
  assert.equal(awaitingCorrection.provider_failures.uncorrected_verification_failures_90d, 1)
  assert.equal(awaitingCorrection.score_components.provider_failure_penalty, 0.6)
  assert.ok(awaitingCorrection.score < penalized.score)

  await db.transaction(async (tx) => {
    await tx.insert(schema.trade_deliveries).values({ trade_id: rejectedTrade.id, submitter_id: sellerId,
      summary: 'Corrected the translation and supplied the required artifact.',
      content_hash: crypto.randomUUID(), verification: '{}' })
    await tx.update(schema.trades).set({ status: 'pending_release' }).where(eq(schema.trades.id, rejectedTrade.id))
  })
  const corrected = await planFor()
  assert.equal(corrected.provider_failures.uncorrected_verification_failures_90d, 0)
  assert.equal(corrected.score_components.provider_failure_penalty, 0.4)
  assert.equal(corrected.score, penalized.score)

  const [refundListing] = await db.insert(schema.listings).values({ seller_id: sellerId, category: 'code',
    title: 'Refunded translation', description: 'A disputed funded service order.', price_bankr: 1, status: 'sold' }).returning()
  const [refundTrade] = await db.insert(schema.trades).values({ listing_id: refundListing.id,
    buyer_id: 'other-buyer', seller_id: sellerId, amount: 1, fee: 0.05, status: 'disputed',
    funded_at: new Date().toISOString(), payment_rail: 'evm' }).returning()
  const refundOrderId = crypto.randomUUID()
  await db.insert(schema.service_orders).values({ id: refundOrderId, service_id: serviceId,
    listing_id: refundListing.id, trade_id: refundTrade.id, buyer_id: 'other-buyer',
    client_reference: crypto.randomUUID(), objective: 'Translate a disputed document',
    price_minor: 100, payment_rail: 'evm', state: 'disputed' })
  await db.insert(schema.service_execution_attempts).values({ id: crypto.randomUUID(), order_id: refundOrderId,
    state: 'expired', created_at: new Date(), completed_at: new Date() })
  const openDispute = await planFor()
  assert.equal(openDispute.provider_failures.buyer_refund_resolutions_90d, 0)
  assert.equal(openDispute.provider_failures.lease_expiries_90d, 2)
  await db.update(schema.trades).set({ status: 'resolved', resolution: 'buyer',
    payout_status: 'processing', completed_at: new Date() }).where(eq(schema.trades.id, refundTrade.id))
  const processing = await planFor()
  assert.equal(processing.provider_failures.buyer_refund_resolutions_90d, 0)
  assert.equal(processing.provider_failures.lease_expiries_90d, 2)
  await db.update(schema.trades).set({ payout_status: 'complete' }).where(eq(schema.trades.id, refundTrade.id))
  const missingDistribution = await planFor()
  assert.equal(missingDistribution.provider_failures.buyer_refund_resolutions_90d, 0)
  assert.equal(missingDistribution.provider_failures.lease_expiries_90d, 2)
  await db.insert(schema.transactions).values({ amount: 1, type: 'escrow_refund', reference_id: refundTrade.id })
  await db.insert(schema.settlement_transfers).values({ business_key: `refund:${refundTrade.id}`,
    trade_id: refundTrade.id, kind: 'buyer_refund', chain_id: 8453, token_address: `0x${'44'.repeat(20)}`,
    from_address: treasury.address, to_address: treasury.address, token_amount: '1000000', usd_amount: 1,
    status: 'confirmed', tx_hash: `0x${'77'.repeat(32)}`, confirmed_at: new Date() })
  const refunded = await planFor()
  assert.equal(refunded.provider_failures.buyer_refund_resolutions_90d, 1)
  assert.equal(refunded.provider_failures.lease_expiries_90d, 1)
  assert.equal(refunded.score_components.provider_failure_penalty, 0.6)

  const [ledgerListing] = await db.insert(schema.listings).values({ seller_id: sellerId, category: 'code',
    title: 'Ledger refund', description: 'A funded service order refunded to its buyer.', price_bankr: 1,
    status: 'sold' }).returning()
  const [ledgerTrade] = await db.insert(schema.trades).values({ listing_id: ledgerListing.id,
    buyer_id: 'other-buyer', seller_id: sellerId, amount: 1, fee: 0.05, status: 'resolved',
    resolution: 'buyer', payout_status: 'complete', completed_at: new Date(),
    funded_at: new Date().toISOString(), payment_rail: 'ledger' }).returning()
  await db.insert(schema.service_orders).values({ id: crypto.randomUUID(), service_id: serviceId,
    listing_id: ledgerListing.id, trade_id: ledgerTrade.id, buyer_id: 'other-buyer',
    client_reference: crypto.randomUUID(), objective: 'Translate a ledger-funded document',
    price_minor: 100, payment_rail: 'ledger', state: 'resolved' })
  await db.insert(schema.transactions).values([{ amount: 1, type: 'escrow_lock', reference_id: ledgerTrade.id },
    { amount: 1, type: 'escrow_refund', reference_id: ledgerTrade.id }])
  const ledgerRefunded = await planFor()
  assert.equal(ledgerRefunded.provider_failures.buyer_refund_resolutions_90d, 2)
  assert.equal(ledgerRefunded.score_components.provider_failure_penalty, 0.8)
  await db.update(schema.trades).set({ resolution: 'split' }).where(eq(schema.trades.id, ledgerTrade.id))
  const splitResolution = await planFor()
  assert.equal(splitResolution.provider_failures.buyer_refund_resolutions_90d, 1)

  const [relatedListing] = await db.insert(schema.listings).values({ seller_id: sellerId, category: 'code',
    title: 'Uncorrected related work', description: 'A funded service order with failed verification.',
    price_bankr: 1, status: 'sold' }).returning()
  const [relatedTrade] = await db.insert(schema.trades).values({ listing_id: relatedListing.id,
    buyer_id: 'other-buyer', seller_id: sellerId, amount: 1, fee: 0.05, status: 'escrow_held',
    funded_at: new Date().toISOString(), payment_rail: 'evm' }).returning()
  await db.insert(schema.service_orders).values({ id: crypto.randomUUID(), service_id: serviceId,
    listing_id: relatedListing.id, trade_id: relatedTrade.id, buyer_id: 'other-buyer',
    client_reference: crypto.randomUUID(), objective: 'Translate another funded document',
    price_minor: 100, payment_rail: 'evm', state: 'funded' })
  await db.insert(schema.verification_results).values({ id: crypto.randomUUID(), trade_id: relatedTrade.id,
    content_hash: crypto.randomUUID(), method: 'schema', verifier: 'clawdmarket-deterministic-v1',
    version: '1', status: 'failed', failure: 'invalid_output', evidence_json: '{}' })
  await recordFailure('declined', true, new Date(), relatedBuyerId)
  const beforeRelatedOwner = await planFor()
  assert.equal(beforeRelatedOwner.provider_failures.uncorrected_verification_failures_90d, 1)
  assert.equal(beforeRelatedOwner.provider_failures.provider_declines_90d, 2)
  await db.insert(schema.agent_owners).values({ agentId, userId: 'other-buyer', establishedBy: 'test' })
  const relatedOwner = await planFor()
  assert.deepEqual(relatedOwner.provider_failures, { provider_declines_90d: 0, lease_expiries_90d: 0,
    uncorrected_verification_failures_90d: 0, buyer_refund_resolutions_90d: 0 })
  await db.delete(schema.agent_owners).where(eq(schema.agent_owners.agentId, agentId))
  const ownershipChanged = await planFor()
  assert.deepEqual(ownershipChanged.provider_failures, beforeRelatedOwner.provider_failures)
})

test('planning skips unsupported contracts and saved routes recheck them before checkout', async () => {
  const cases = [
    { field: 'execution_mode', value: 'instant' },
    { field: 'provider_protocol', value: 'unsupported' },
    { field: 'verification_policy', value: '{broken' },
    { field: 'verification_policy', value: JSON.stringify({ required: true, methods: ['buyer_review', 'schema'] }) },
    { field: 'output_schema', value: '{broken' },
  ]
  for (const item of cases) {
    const buyerId = `contract-buyer-${crypto.randomUUID()}`
    await db.insert(schema.users).values({ id: buyerId, name: 'Contract Buyer', email: `${buyerId}@test.invalid`, password_hash: 'unused', role: 'human' })
    const createPlan = (reference: string) => planRoute(request('/api/routes/plan', buyerId, 'POST', {
      client_reference: reference, objective: 'Audit this repository for authentication vulnerabilities',
      required_capabilities: ['security-analysis', 'code-review'], input: { revision: 'abc123' },
      max_budget: { amount: '20.00', currency: 'USD' }, deadline_seconds: 600,
    }))
    const offered = await service('0.01')
    try {
      const planned = await createPlan(`contract-change-${crypto.randomUUID()}`)
      assert.equal(planned.status, 201)
      const route = (await planned.json()).route
      assert.equal(route.candidates[0].service_id, offered.id)
      await db.$client.execute({ sql: `UPDATE service_definitions SET ${item.field} = ? WHERE id = ?`, args: [item.value, offered.id] })
      const filtered = await createPlan(`unsupported-contract-${crypto.randomUUID()}`)
      assert.equal(filtered.status, 201, `${item.field}: ${item.value}`)
      assert.equal((await filtered.json()).route.candidates.some((candidate: { service_id: string }) => candidate.service_id === offered.id), false)
      const beforeCounts = { listings: (await db.select().from(schema.listings)).length, trades: (await db.select().from(schema.trades)).length }
      const execution = await executeRoute(request(`/api/routes/${route.id}/execute`, buyerId, 'POST'), { params: Promise.resolve({ id: route.id }) })
      assert.equal(execution.status, 409)
      const body = await execution.json()
      assert.equal(body.error_code, 'ROUTE_STALE_PROVIDER')
      assert.equal(body.state, 'no_funds_moved')
      assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.service_id, offered.id))).length, 0)
      assert.equal((await db.select().from(schema.listings)).length, beforeCounts.listings)
      assert.equal((await db.select().from(schema.trades)).length, beforeCounts.trades)
      const [current] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id))
      assert.equal(current.active_orders, 0)
      const inspected = await getRoute(request(`/api/routes/${route.id}`, buyerId, 'GET'), { params: Promise.resolve({ id: route.id }) })
      const snapshot = await inspected.json()
      assert.equal(snapshot.route.state, 'failed')
      assert.equal(snapshot.attempts[0].state, 'ineligible')
      assert.equal(snapshot.attempts[0].failure_code, 'ROUTE_STALE_PROVIDER')
    } finally {
      await db.update(schema.service_definitions).set({ status: 'archived' }).where(eq(schema.service_definitions.id, offered.id))
    }
  }
})

test('structured verification terms filter planning and changed agreed rules block checkout', async () => {
  const offered = await service('1.00')
  const verification = { required: true, methods: ['buyer_review', 'assertions', 'source_evidence'],
    assertions: { version: 1, rules: [{ id: 'status', field: 'status', op: 'equals', value: 'complete' }] },
    source_evidence: { version: 1, minimum_sources: 2, max_age_days: 7, require_claim_links: true } }
  await db.update(schema.service_definitions).set({ verification_policy: JSON.stringify(verification) }).where(eq(schema.service_definitions.id, offered.id))
  const makePlan = (policy: unknown) => planRoute(request('/api/routes/plan', 'other-buyer', 'POST', {
    client_reference: `structured-${crypto.randomUUID()}`, objective: 'Audit this repository using declared source evidence',
    required_capabilities: ['security', 'code-review'], max_budget: { amount: '20.00', currency: 'USD' }, verification: policy,
  }))
  const stronger = await makePlan({ ...verification, source_evidence: { ...verification.source_evidence, max_age_days: 1 } })
  assert.equal(stronger.status, 201)
  assert.deepEqual((await stronger.json()).route.candidates, [])
  const planned = await makePlan(verification)
  assert.equal(planned.status, 201, await planned.clone().text())
  const route = (await planned.json()).route
  assert.equal(route.candidates.length, 1)
  assert.equal(route.candidates[0].service_id, offered.id)
  await db.update(schema.service_definitions).set({ verification_policy: JSON.stringify({ ...verification,
    assertions: { version: 1, rules: [{ ...verification.assertions.rules[0], value: 'changed' }] } }) }).where(eq(schema.service_definitions.id, offered.id))
  const execution = await executeRoute(request(`/api/routes/${route.id}/execute`, 'other-buyer', 'POST'), { params: Promise.resolve({ id: route.id }) })
  assert.equal(execution.status, 409)
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.service_id, offered.id))).length, 0)
})
