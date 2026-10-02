import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let token: typeof import('@/lib/auth').generateJWT
let inspect: typeof import('@/app/api/admin/routing/health/route').GET
let cron: typeof import('@/app/api/cron/webhooks/route').GET

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-routing-operator-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'routing-operator.db')}`
  process.env.JWT_SECRET = 'routing-operator-tests-only'
  process.env.CRON_SECRET = 'routing-operator-cron-secret'
  process.env.ADMIN_USER_IDS = 'routing-admin'
  db = (await import('@/lib/db')).db
  await createLocalTestSchema(db.$client, await import('@/lib/schema'))
  await db.$client.execute('CREATE TABLE _clawdmarket_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  await db.$client.execute({ sql: 'INSERT INTO _clawdmarket_migrations VALUES (?, ?)', args: ['2026-10-01-service-provider-protocol-v1', '2026-10-01T00:00:00.000Z'] })
  token = (await import('@/lib/auth')).generateJWT
  inspect = (await import('@/app/api/admin/routing/health/route')).GET
  cron = (await import('@/app/api/cron/webhooks/route')).GET
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function request(path: string, userId?: string) {
  return new NextRequest(`http://localhost${path}`, { headers: userId ? {
    authorization: `Bearer ${token({ userId, email: `${userId}@test.invalid`, role: 'human' })}`,
  } : {} })
}

test('routing operator health is admin-only and exposes aggregates without private values', async () => {
  const path = '/api/admin/routing/health'
  assert.equal((await inspect(request(path))).status, 401)
  assert.equal((await inspect(request(path, 'ordinary-user'))).status, 403)
  const beforeCron = await inspect(request(path, 'routing-admin'))
  assert.equal(beforeCron.status, 200)
  assert.equal(beforeCron.headers.get('cache-control'), 'private, no-store')
  const beforeBody = await beforeCron.json()
  assert.equal(beforeBody.workers.webhooks.status, 'never_observed')
  assert.deepEqual(beforeBody.migrations, [{ id: '2026-10-01-service-provider-protocol-v1', applied_at: '2026-10-01T00:00:00.000Z' }])
  assert.deepEqual(beforeBody.usage.services, {})
  assert.deepEqual(beforeBody.provider_execution, {
    acknowledgment_overdue_count: 0, acknowledgment_timed_out_count: 0,
    overdue_lease_count: 0, terminal_active_count: 0, funded_without_attempt_count: 0, delivery_deadline_overdue_count: 0,
  })
  assert.equal(beforeBody.outboxes.webhook.retrying_count, 0)
  assert.equal(beforeBody.outboxes.settlement.failed_count, 0)
  assert.equal(typeof beforeBody.flags.route_execution, 'boolean')

  const run = await cron(new NextRequest('http://localhost/api/cron/webhooks', { headers: { authorization: 'Bearer routing-operator-cron-secret' } }))
  assert.equal(run.status, 200)
  const afterCron = await inspect(request(path, 'routing-admin'))
  const afterBody = await afterCron.json()
  assert.equal(afterBody.workers.webhooks.status, 'healthy')
  assert.ok(afterBody.workers.webhooks.last_succeeded_at)
  assert.equal(JSON.stringify(afterBody).includes('routing-operator-cron-secret'), false)
  assert.equal(JSON.stringify(afterBody).includes('routing-operator-tests-only'), false)

  const { worker_heartbeats } = await import('@/lib/schema')
  await db.update(worker_heartbeats).set({ last_succeeded_at: new Date(Date.now() - 20 * 60_000) })
    .where(eq(worker_heartbeats.worker_name, 'webhooks'))
  assert.equal((await (await inspect(request(path, 'routing-admin'))).json()).workers.webhooks.status, 'stale')
  const { recordWorkerHeartbeat } = await import('@/lib/worker-heartbeats')
  await recordWorkerHeartbeat('webhooks', 'failed')
  assert.equal((await (await inspect(request(path, 'routing-admin'))).json()).workers.webhooks.status, 'failed')
})

test('operator snapshot exposes aggregate missing, overdue, and terminal attempt states', async () => {
  const schema = await import('@/lib/schema')
  const sellerId = `operator-seller-${crypto.randomUUID()}`
  const buyerId = `operator-buyer-${crypto.randomUUID()}`
  const listingId = crypto.randomUUID()
  const serviceId = crypto.randomUUID()
  const tradeId = crypto.randomUUID()
  const orderId = crypto.randomUUID()
  const attemptId = crypto.randomUUID()
  for (const id of [sellerId, buyerId]) {
    await db.insert(schema.users).values({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' })
  }
  await db.insert(schema.listings).values({ id: listingId, seller_id: sellerId,
    category: 'analysis', title: 'Operator fixture', description: 'Operator fixture listing', price_bankr: 10 })
  await db.insert(schema.service_definitions).values({ id: serviceId, seller_id: sellerId,
    title: 'Operator fixture', description: 'Operator fixture service', price_minor: 1000, provider_protocol: 'leased_v1' })
  await db.insert(schema.trades).values({ id: tradeId, listing_id: listingId,
    buyer_id: buyerId, seller_id: sellerId, amount: 10, fee: 0.5, status: 'escrow_held',
    funded_at: new Date(Date.now() - 2 * 60_000).toISOString() })
  await db.insert(schema.service_orders).values({ id: orderId, service_id: serviceId, listing_id: listingId,
    trade_id: tradeId, buyer_id: buyerId, client_reference: `operator-${orderId}`,
    objective: 'Inspect provider attempt health', price_minor: 1000, payment_rail: 'evm', state: 'funded' })
  await db.insert(schema.route_plans).values({ id: crypto.randomUUID(), buyer_id: buyerId,
    client_reference: `operator-route-${orderId}`, objective: 'Inspect overdue funded provider work',
    required_capabilities: '["code-review"]', max_budget_minor: 1050, deadline_seconds: 60,
    state: 'funded', service_order_id: orderId, expires_at: new Date(Date.now() + 300_000) })

  const snapshot = async () => (await inspect(request('/api/admin/routing/health', 'routing-admin'))).json()
  assert.equal((await snapshot()).provider_execution.funded_without_attempt_count, 1)
  assert.equal((await snapshot()).provider_execution.delivery_deadline_overdue_count, 1)
  await db.insert(schema.service_execution_attempts).values({ id: attemptId, order_id: orderId,
    state: 'queued', acknowledgment_due_at: new Date(Date.now() - 1000) })
  const queued = await snapshot()
  assert.equal(queued.provider_execution.acknowledgment_overdue_count, 1)
  assert.equal(queued.provider_execution.acknowledgment_timed_out_count, 0)
  const { expireServiceAcknowledgmentAttempts } = await import('@/lib/service-execution-attempt')
  assert.equal(await expireServiceAcknowledgmentAttempts(), 1)
  const timedOut = await snapshot()
  assert.equal(timedOut.provider_execution.acknowledgment_overdue_count, 0)
  assert.equal(timedOut.provider_execution.acknowledgment_timed_out_count, 1)
  assert.equal(JSON.stringify(timedOut).includes(attemptId), false)
  assert.equal(JSON.stringify(timedOut).includes(tradeId), false)
  await db.update(schema.service_execution_attempts).set({
    state: 'accepted', accepted_at: new Date(Date.now() - 20 * 60_000),
    lease_expires_at: new Date(Date.now() - 10 * 60_000) }).where(eq(schema.service_execution_attempts.id, attemptId))
  const overdue = await snapshot()
  assert.deepEqual(overdue.provider_execution, {
    acknowledgment_overdue_count: 0, acknowledgment_timed_out_count: 0,
    overdue_lease_count: 1, terminal_active_count: 0, funded_without_attempt_count: 0, delivery_deadline_overdue_count: 1,
  })
  assert.equal(JSON.stringify(overdue).includes(attemptId), false)

  await db.update(schema.trades).set({ status: 'resolved' }).where(eq(schema.trades.id, tradeId))
  const terminal = await snapshot()
  assert.equal(terminal.provider_execution.terminal_active_count, 1)
  assert.equal(terminal.provider_execution.delivery_deadline_overdue_count, 0)
})
