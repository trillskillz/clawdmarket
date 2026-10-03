import { NextRequest } from 'next/server'
import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let getMetrics: typeof import('@/app/api/routes/metrics/route').GET

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-route-metrics-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'metrics.db')}`
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  getMetrics = (await import('@/app/api/routes/metrics/route')).GET
  await db.insert(schema.users).values([
    { id: 'metric-buyer', email: 'metric-buyer@test.invalid', name: 'Buyer', password_hash: 'unused' },
    { id: 'user_agent_metric-seller', email: 'metric-seller@test.invalid', name: 'Seller', password_hash: 'unused', role: 'agent' },
  ])
  await db.insert(schema.agents).values({ id: 'metric-seller', name: 'Seller', description: 'Independent provider', capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: 'private@test.invalid', api_key: 'unused' })
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function plan(state: 'planned' | 'completed', candidates = '[{"service_id":"x"}]', orderId?: string) {
  const id = crypto.randomUUID()
  await db.insert(schema.route_plans).values({
    id, buyer_id: 'metric-buyer', client_reference: id, objective: 'Review the API security',
    required_capabilities: '["code-review"]', max_budget_minor: 2000, candidates_json: candidates,
    state, service_order_id: orderId, expires_at: new Date(Date.now() + 60_000),
  })
  return id
}

async function order(status: 'completed' | 'pending_release', priceMinor: number) {
  const [listing] = await db.insert(schema.listings).values({ seller_id: 'user_agent_metric-seller', category: 'code', title: 'Review', description: 'Review API security', price_bankr: priceMinor / 100, status: 'sold' }).returning()
  const [trade] = await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: 'metric-buyer', seller_id: 'user_agent_metric-seller', amount: priceMinor / 100, fee: 0, status, payment_rail: 'ledger' }).returning()
  const [service] = await db.insert(schema.service_definitions).values({ id: crypto.randomUUID(), seller_id: 'user_agent_metric-seller', title: 'Review', description: 'Review API security', capabilities: '["code-review"]', price_minor: priceMinor }).returning()
  const id = crypto.randomUUID()
  await db.insert(schema.service_orders).values({ id, service_id: service.id, listing_id: listing.id, trade_id: trade.id, buyer_id: 'metric-buyer', client_reference: id, objective: 'Review the API security', price_minor: priceMinor, payment_rail: 'ledger', state: status === 'completed' ? 'completed' : 'verifying' })
  return { id, tradeId: trade.id }
}

test('route metrics exclude unverified and unsettled work and do not overstate autonomous GMV', async () => {
  const empty = await (await getMetrics()).json()
  assert.equal(empty.autonomously_routed_gmv, '0.00')
  assert.equal(empty.planning_to_execution_rate, null)
  await plan('planned')
  const accepted = await order('completed', 1234)
  await plan('completed', '[{"service_id":"x"}]', accepted.id)
  await db.insert(schema.capability_performance_events).values([
    { id: crypto.randomUUID(), trade_id: accepted.tradeId, service_order_id: accepted.id, seller_agent_id: 'metric-seller', capability_id: 'code-review', evidence_kind: 'buyer_accepted_completion', verification_method: 'buyer_review' },
    { id: crypto.randomUUID(), trade_id: accepted.tradeId, service_order_id: accepted.id, seller_agent_id: 'metric-seller', capability_id: 'security-analysis', evidence_kind: 'buyer_accepted_completion', verification_method: 'buyer_review' },
  ])
  const unverified = await order('completed', 900)
  await plan('completed', '[]', unverified.id)
  const unsettled = await order('pending_release', 700)
  await plan('completed', '[]', unsettled.id)
  await db.insert(schema.capability_performance_events).values({ id: crypto.randomUUID(), trade_id: unsettled.tradeId, service_order_id: unsettled.id, seller_agent_id: 'metric-seller', capability_id: 'code-review', evidence_kind: 'buyer_accepted_completion', verification_method: 'buyer_review' })
  const response = await getMetrics()
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  const body = await response.json()
  assert.equal(body.plans, 4)
  assert.equal(body.viable_plans, 2)
  assert.equal(body.executions, 3)
  assert.equal(body.accepted_settled_routes, 1)
  assert.equal(body.assisted_routed_gmv, '12.34')
  assert.equal(body.autonomously_routed_gmv, '0.00')
  assert.equal(body.autonomy_status, 'evidence_gated')
  assert.equal(body.planning_to_execution_rate, 0.75)
  assert.equal(body.execution_to_accepted_settlement_rate, 0.3333)
  assert.ok(!JSON.stringify(body).includes('private@test.invalid'))
})

test('malformed origin labels collapse into one aggregate unknown bucket without leaking values', async () => {
  const ids = [await plan('planned'), await plan('planned')]
  for (let i = 0; i < ids.length; i++) await db.$client.execute({ sql: 'INSERT INTO route_origins(route_id, channel, cohort, created_at) VALUES (?, ?, ?, unixepoch())', args: [ids[i], `private-channel-${i}`, `private-cohort-${i}`] })
  const body = await (await getMetrics()).json()
  const unknown = body.origins.filter((entry: { channel: string; cohort: string }) => entry.channel === 'legacy_unknown' && entry.cohort === 'legacy_unknown')
  assert.equal(unknown.length, 1); assert.equal(unknown[0].plans, body.plans)
  assert.equal(JSON.stringify(body).includes('private-channel'), false); assert.equal(JSON.stringify(body).includes('private-cohort'), false)
})

test('run-kind headers only suppress server production attribution and account callers cannot label themselves agents', async () => {
  const { attributeRouteOrigin } = await import('@/lib/route-automation-evidence')
  const principal = { userId: 'metric-buyer', agentId: null, kind: 'account' as const, usesCookieAuth: false }
  const original = process.env.VERCEL_ENV
  try {
    process.env.VERCEL_ENV = 'preview'
    assert.deepEqual(attributeRouteOrigin(principal, new NextRequest('https://example.invalid', { headers: { 'X-ClawdMarket-Run-Kind': 'production' } }), 'ordinary'), { channel: 'account', cohort: 'nonproduction' })
    process.env.VERCEL_ENV = 'production'
    assert.equal(attributeRouteOrigin(principal, new NextRequest('http://localhost:3000'), 'ordinary').cohort, 'nonproduction')
    const origin = attributeRouteOrigin(principal, new NextRequest('https://example.invalid'), 'ordinary')
    assert.deepEqual(origin, { channel: 'account', cohort: 'production' })
    for (const kind of ['canary', 'demo', 'reference', 'test']) assert.notEqual(attributeRouteOrigin(principal, new NextRequest('https://example.invalid', { headers: { 'X-ClawdMarket-Run-Kind': kind } }), 'ordinary').cohort, 'production')
    assert.equal(attributeRouteOrigin(principal, new NextRequest('https://example.invalid'), 'route-canary-case').cohort, 'canary')
  } finally { if (original == null) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = original }
})
