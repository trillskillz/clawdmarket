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
const sellerId = 'reusable-seller'
const buyerId = 'reusable-buyer'
const treasury = privateKeyToAccount(`0x${'77'.repeat(32)}`)

before(async () => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-reusable-services-'))
  process.env.TURSO_DATABASE_URL = `file:${join(fixtureDirectory, 'services.db')}`
  process.env.JWT_SECRET = 'reusable-service-tests-only'
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
  await db.insert(schema.users).values([
    { id: sellerId, name: 'Reusable Seller', email: 'reusable-seller@test.invalid', password_hash: 'unused', role: 'human' },
    { id: buyerId, name: 'Reusable Buyer', email: 'reusable-buyer@test.invalid', password_hash: 'unused', role: 'human' },
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
