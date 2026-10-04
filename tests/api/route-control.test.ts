import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let control: typeof import('@/lib/route-control'), api: typeof import('@/app/api/admin/routing/pause/route'), jwt: typeof import('@/lib/auth').generateJWT
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-route-control-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'controls.db')}`
  process.env.JWT_SECRET = 'route-control-dummy-tests-only'; process.env.ADMIN_USER_IDS = 'control-admin'
  delete process.env.VERCEL_ENV; delete process.env.CLAWDMARKET_ROUTE_EXECUTION_PAUSED
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  await db.insert(schema.users).values({ id: 'control-admin', email: 'control-admin@test.invalid', password_hash: 'unused', name: 'Admin' })
  control = await import('@/lib/route-control'); api = await import('@/app/api/admin/routing/pause/route'); jwt = (await import('@/lib/auth')).generateJWT
})
after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })
async function reset() { await db.delete(schema.route_control_events); await db.delete(schema.route_controls); await db.delete(schema.credit_accounts) }
function request(body?: unknown, user = 'control-admin', cookie = false, invalidBearer = false) {
  const token = jwt({ userId: user, email: `${user}@test.invalid`, role: 'human' })
  const headers: Record<string, string> = cookie ? { Cookie: `auth-token=${token}` } : { Authorization: `Bearer ${token}` }
  if (invalidBearer) headers.Authorization = 'Bearer invalid'
  return new NextRequest('http://localhost/api/admin/routing/pause', { method: body ? 'POST' : 'GET', headers,
    ...(body ? { body: JSON.stringify(body) } : {}) })
}
async function recoveredWindow() {
  await db.update(schema.route_controls).set({ healthy_since_at: new Date(Date.now() - 125_000), healthy_sampled_at: new Date(Date.now() - 60_000),
    last_checked_at: new Date(Date.now() - 60_000), healthy_check_count: 2 }).where(eq(schema.route_controls.key, 'new_routes'))
}

test('financial incident pauses are durable and automatically reopen only after healthy independent samples and the recovery window', async () => {
  await reset()
  await db.insert(schema.credit_accounts).values({ user_id: 'control-admin', available_minor: 100 })
  const first = await control.monitorRouteAdmission(); assert.equal(first.control.paused, true)
  assert.ok(first.financial.alerts.some((alert) => alert.code === 'ACCOUNT_CREDIT_INVARIANT'))
  assert.equal((await control.getRouteControl()).revision, 1); assert.equal(await control.routeAdmissionFailure(), 'ROUTE_EXECUTION_PAUSED')
  await control.monitorRouteAdmission(); assert.equal((await db.select().from(schema.route_control_events)).length, 1)
  await db.update(schema.credit_accounts).set({ available_minor: 0 })
  const healthy = await control.monitorRouteAdmission(); assert.equal(healthy.financial.healthy, true); assert.equal(healthy.control.paused, true)
  await control.monitorRouteAdmission(); assert.equal((await control.getRouteControl()).healthy_check_count, 1, 'rapid calls cannot create independent recovery samples')
  await recoveredWindow()
  const reopened = await control.monitorRouteAdmission(); assert.equal(reopened.control.paused, false); assert.equal(await control.routeAdmissionFailure(), null)
  const events = await db.select().from(schema.route_control_events)
  assert.equal(events.length, 2); assert.equal(events[1].reason_code, 'AUTOMATIC_HEALTHY_RESUME'); assert.equal(events[1].actor_user_id, null)
  assert.equal(events[1].revision, 2)
  assert.equal((await (await import('@/lib/payment-control')).getNewPaymentControl()).paused, false)
  for (const secret of ['control-admin', 'control-admin@test.invalid', 'route-control-dummy-tests-only']) assert.equal(JSON.stringify(reopened).includes(secret), false)
})

test('new financial failure resets recovery history and cannot auto reopen from stale healthy evidence', async () => {
  await reset(); await control.setRouteControl({ paused: true, expectedRevision: 0, actorUserId: 'control-admin' }); await recoveredWindow()
  await db.insert(schema.credit_accounts).values({ user_id: 'control-admin', escrow_minor: 100 })
  const failed = await control.monitorRouteAdmission(); assert.equal(failed.control.paused, true)
  assert.equal((await control.getRouteControl()).healthy_check_count, 0)
  await db.update(schema.credit_accounts).set({ escrow_minor: 0 })
  assert.equal((await control.monitorRouteAdmission()).control.paused, true)
  await recoveredWindow()
  await db.update(schema.route_controls).set({ last_checked_at: new Date(Date.now() - 901_000) })
  assert.equal((await control.monitorRouteAdmission()).control.paused, true)
  assert.equal((await control.getRouteControl()).healthy_check_count, 1)
})

test('admin control is private, CSRF safe and revision bound; financial recovery can reopen without an admin', async () => {
  await reset()
  assert.equal((await api.GET(request(undefined, 'ordinary'))).status, 403)
  const cookie = await api.POST(request({ paused: true, expected_revision: 0 }, 'control-admin', true, true))
  assert.equal(cookie.status, 403)
  const pause = await api.POST(request({ paused: true, expected_revision: 0 })); assert.equal(pause.status, 200)
  assert.equal(pause.headers.get('Cache-Control'), 'private, no-store')
  assert.equal((await api.POST(request({ paused: false, expected_revision: 0 }))).status, 409)
  await db.insert(schema.credit_accounts).values({ user_id: 'control-admin', available_minor: 100 })
  assert.equal((await api.POST(request({ paused: false, expected_revision: 1 }))).status, 409)
  await db.update(schema.credit_accounts).set({ available_minor: 0 }); await recoveredWindow()
  assert.equal((await control.monitorRouteAdmission()).control.paused, false)
  assert.equal((await api.POST(request({ paused: true, expected_revision: 2, private_reason: 'secret' }))).status, 400)
})

test('environment pause wins over automatic recovery and missing controls fail closed without pausing ordinary payments', async () => {
  await reset(); await control.setRouteControl({ paused: true, expectedRevision: 0, actorUserId: 'control-admin' }); await recoveredWindow()
  process.env.CLAWDMARKET_ROUTE_EXECUTION_PAUSED = 'true'
  try {
    await control.monitorRouteAdmission(); assert.equal((await control.getRouteControl()).paused, true)
    assert.equal((await control.getRouteControl()).source, 'environment')
    await assert.rejects(control.setRouteControl({ paused: false, expectedRevision: 2, actorUserId: 'control-admin' }), /ENVIRONMENT_ROUTE_PAUSE/)
  } finally { delete process.env.CLAWDMARKET_ROUTE_EXECUTION_PAUSED }
  await db.$client.execute('ALTER TABLE route_controls RENAME TO temporarily_missing_controls')
  try { assert.equal(await control.routeAdmissionFailure(), 'ROUTE_EXECUTION_PAUSED'); assert.equal((await (await import('@/lib/payment-control')).getNewPaymentControl()).paused, false) }
  finally { await db.$client.execute('ALTER TABLE temporarily_missing_controls RENAME TO route_controls') }
})

test('production monitor freshness is required and returns no deployment or wallet values', async () => {
  await reset(); process.env.VERCEL_ENV = 'production'
  try {
    assert.equal((await control.getRouteControl()).reason_code, 'MONITOR_STALE')
    const first = await control.monitorRouteAdmission(); assert.equal(first.control.paused, true)
    await recoveredWindow(); await control.monitorRouteAdmission(); assert.equal((await control.getRouteControl()).paused, false)
    await db.update(schema.route_controls).set({ last_checked_at: new Date(Date.now() - 901_000) })
    assert.equal((await control.getRouteControl()).reason_code, 'MONITOR_STALE')
  } finally { delete process.env.VERCEL_ENV }
})


test('concurrent operator commands cannot overwrite a newer revision', async () => {
  await reset()
  const replies = await Promise.all([api.POST(request({ paused: true, expected_revision: 0 })), api.POST(request({ paused: false, expected_revision: 0 }))])
  assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 409])
  assert.equal((await control.getRouteControl()).revision, 1)
  assert.equal((await db.select().from(schema.route_control_events)).length, 1)
})

test('inspection failure persists a hold and does not stop the webhook reconciliation worker', async () => {
  await reset()
  await db.$client.execute('ALTER TABLE credit_accounts RENAME TO unavailable_credit_accounts')
  try {
    const outcome = await control.monitorRouteAdmission()
    assert.equal(outcome.control.reason_code, 'MONITOR_FAILURE')
    assert.equal((await control.getRouteControl()).paused, true)
    assert.equal(JSON.stringify(outcome).includes('unavailable_credit_accounts'), false)
    process.env.CRON_SECRET = 'route-control-local-cron'
    const cron = await import('@/app/api/cron/webhooks/route')
    const reply = await cron.GET(new NextRequest('http://localhost/api/cron/webhooks', { headers: { Authorization: 'Bearer route-control-local-cron' } }))
    assert.equal(reply.status, 200)
    const body = await reply.json(); assert.equal(body.routing_admission.control.paused, true)
    assert.equal(body.expired_provider_leases, 0); assert.equal(body.expired_provider_acknowledgments, 0)
  } finally { await db.$client.execute('ALTER TABLE unavailable_credit_accounts RENAME TO credit_accounts') }
  await control.monitorRouteAdmission(); assert.equal((await control.getRouteControl()).paused, true)
  await recoveredWindow(); await control.monitorRouteAdmission(); assert.equal((await control.getRouteControl()).paused, false)
})

test('future monitor timestamps cannot grant production admission', async () => {
  await reset(); await control.monitorRouteAdmission(); process.env.VERCEL_ENV = 'production'
  try {
    await db.update(schema.route_controls).set({ last_checked_at: new Date(Date.now() + 60_000) })
    assert.equal(await control.routeAdmissionFailure(), 'ROUTE_EXECUTION_PAUSED')
    assert.equal((await control.monitorRouteAdmission()).control.paused, true)
    assert.equal((await control.getRouteControl()).healthy_check_count, 1)
  } finally { delete process.env.VERCEL_ENV }
})


test('pause/event writes roll back together and recover bounded database contention', async () => {
  await reset()
  const original = db.transaction.bind(db)
  let injected = false
  Reflect.set(db, 'transaction', (callback: Parameters<typeof db.transaction>[0]) => original(async (tx) => {
    const result = await callback(tx)
    if (!injected) { injected = true; throw new Error('SQLITE_BUSY: simulated contention after control/event writes') }
    return result
  }))
  try { assert.equal((await control.setRouteControl({ paused: true, expectedRevision: 0, actorUserId: 'control-admin' })).control.revision, 1) }
  finally { Reflect.set(db, 'transaction', original) }
  assert.equal(injected, true)
  assert.equal((await db.select().from(schema.route_control_events)).length, 1)
  const client = (await import('@libsql/client')).createClient({ url: process.env.TURSO_DATABASE_URL! })
  try { assert.equal((await client.execute("SELECT paused, revision FROM route_controls WHERE key = 'new_routes'")).rows[0].paused, 1) }
  finally { client.close() }
})
