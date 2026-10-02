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
