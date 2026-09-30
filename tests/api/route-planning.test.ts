import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
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

async function service(price: string) {
  const result = await createService(request('/api/services', 'route-seller', 'POST', {
    title: 'Security code review', description: 'Audit an API repository and report authentication vulnerabilities.',
    capabilities: ['security', 'code-review'], pricing: { model: 'fixed', amount: price, currency: 'USD' },
    estimated_latency_seconds: 120, max_concurrency: 2, status: 'active',
  }))
  assert.equal(result.status, 201)
  return (await result.json()).service
}

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
