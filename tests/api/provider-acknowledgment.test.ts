import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { createClient } from '@libsql/client'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let token: typeof import('@/lib/auth').generateJWT
let attempts: typeof import('@/lib/service-execution-attempt')
let dispatch: typeof import('@/lib/service-order-dispatch').queueFundedWorkOrder
let advance: typeof import('@/lib/service-order-state').advanceServiceOrder

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-provider-ack-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'ack.db')}`
  process.env.JWT_SECRET = 'provider-ack-tests-only'
  process.env.CRON_SECRET = 'provider-ack-cron-tests-only'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  token = (await import('@/lib/auth')).generateJWT
  attempts = await import('@/lib/service-execution-attempt')
  dispatch = (await import('@/lib/service-order-dispatch')).queueFundedWorkOrder
  advance = (await import('@/lib/service-order-state')).advanceServiceOrder
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function request(path: string, userId: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token({ userId, email: `${userId}@test.invalid`, role: 'human' })}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function fundedOrder(withWebhook = false) {
  const id = crypto.randomUUID()
  const sellerId = `ack-seller-${id}`
  const buyerId = `ack-buyer-${id}`
  await db.insert(schema.users).values([sellerId, buyerId].map((userId) => ({
    id: userId, name: userId, email: `${userId}@test.invalid`, password_hash: 'unused', role: 'human' as const,
  })))
  await db.insert(schema.service_definitions).values({ id, seller_id: sellerId, title: 'Acknowledgment fixture',
    description: 'A funded opt-in provider order', price_minor: 100, provider_protocol: 'leased_v1', status: 'active', active_orders: 1 })
  const [listing] = await db.insert(schema.listings).values({ seller_id: sellerId,
    category: 'code', title: 'Acknowledgment fixture', description: 'An isolated work order', price_bankr: 1, status: 'sold' }).returning()
  const [trade] = await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: buyerId,
    seller_id: sellerId, amount: 1, fee: 0.05, status: 'escrow_held', payment_rail: 'evm', funded_at: new Date().toISOString() }).returning()
  await db.insert(schema.service_orders).values({ id, service_id: id, listing_id: listing.id,
    trade_id: trade.id, buyer_id: buyerId, client_reference: `ack-order-${id}`, objective: 'Review this isolated fixture',
    price_minor: 100, payment_rail: 'evm', state: 'funded' })
  await db.insert(schema.route_plans).values({ id, buyer_id: buyerId, client_reference: `ack-route-${id}`,
    objective: 'Review this isolated fixture', required_capabilities: '["code-review"]', max_budget_minor: 105,
    service_order_id: id, state: 'funded', expires_at: new Date(Date.now() + 60_000) })
  if (withWebhook) await db.insert(schema.webhooks).values({ id, agent_id: sellerId,
    url: 'https://provider.example.invalid/work', secret_hash: 'unused', events: '["work_order.ready"]', active: 1 })
  await db.transaction((tx) => dispatch(tx, trade.id, sellerId))
  const attempt = (await attempts.getServiceExecutionAttempt(id))!
  return { id, sellerId, buyerId, trade, attempt }
}

async function makeOverdue(attemptId: string) {
  await db.update(schema.service_execution_attempts).set({ acknowledgment_due_at: new Date(Date.now() - 1000) })
    .where(eq(schema.service_execution_attempts.id, attemptId))
}

test('funding persists one deadline across dispatch replay, webhook success, and a reopened connection', async () => {
  const fixture = await fundedOrder(true)
  assert.ok(fixture.attempt.acknowledgment_due_at)
  assert.equal(fixture.attempt.acknowledgment_due_at.getTime() - fixture.attempt.created_at.getTime(), 600_000)
  assert.equal(await db.transaction((tx) => dispatch(tx, fixture.trade.id, fixture.sellerId)), 0)
  const replay = (await attempts.getServiceExecutionAttempt(fixture.id))!
  assert.equal(replay.id, fixture.attempt.id)
  assert.equal(replay.acknowledgment_due_at?.getTime(), fixture.attempt.acknowledgment_due_at.getTime())
  await db.update(schema.webhook_deliveries).set({ success: 1, response_status: 200 })
    .where(eq(schema.webhook_deliveries.id, `work-order-ready:${fixture.id}:${fixture.id}`))
  assert.equal((await attempts.getServiceExecutionAttempt(fixture.id))?.state, 'queued')
  assert.equal((await attempts.getServiceExecutionAttempt(fixture.id))?.accepted_at, null)
  const restarted = createClient({ url: process.env.TURSO_DATABASE_URL! })
  try {
    const persisted = await restarted.execute({ sql: 'SELECT id, acknowledgment_due_at FROM service_execution_attempts WHERE order_id = ?', args: [fixture.id] })
    assert.equal(persisted.rows.length, 1)
    assert.equal(persisted.rows[0].id, fixture.attempt.id)
    assert.equal(Number(persisted.rows[0].acknowledgment_due_at), fixture.attempt.acknowledgment_due_at.getTime() / 1000)
  } finally { restarted.close() }
})

test('overdue funded work is private, rejects late acknowledgment, and keeps escrow and capacity', async () => {
  const fixture = await fundedOrder()
  await makeOverdue(fixture.attempt.id)
  const { GET: getRoute } = await import('@/app/api/routes/[id]/route')
  const { GET: getOrder } = await import('@/app/api/service-orders/[id]/route')
  const { GET: getWork } = await import('@/app/api/trades/[id]/work-order/route')
  const { POST: action } = await import('@/app/api/trades/[id]/work-order/attempt/route')
  for (const response of [
    await getRoute(request(`/api/routes/${fixture.id}`, fixture.buyerId), { params: Promise.resolve({ id: fixture.id }) }),
    await getOrder(request(`/api/service-orders/${fixture.id}`, fixture.buyerId), { params: Promise.resolve({ id: fixture.id }) }),
    await getOrder(request(`/api/service-orders/${fixture.id}`, fixture.sellerId), { params: Promise.resolve({ id: fixture.id }) }),
  ]) {
    assert.equal(response.status, 200)
    const status = (await response.json()).provider_execution
    assert.equal(status.state, 'queued')
    assert.equal(status.acknowledgment_overdue, true)
    assert.equal(status.attention_reason, 'acknowledgment_timeout')
    assert.equal(status.automatic_retry_allowed, false)
    assert.equal(status.reconciliation.state, 'dispute_available')
  }
  const work = await getWork(request(`/api/trades/${fixture.trade.id}/work-order`, fixture.sellerId), { params: Promise.resolve({ id: fixture.trade.id }) })
  const body = (await work.json()).work_order
  assert.equal(body.execution_attempt.acknowledgment_overdue, true)
  assert.ok(body.execution_attempt.acknowledgment_due_at)
  assert.equal(body.attempt_action, null)
  assert.equal(body.provider_execution.attention_reason, 'acknowledgment_timeout')
  assert.equal((await getOrder(new NextRequest(`http://localhost/api/service-orders/${fixture.id}`), { params: Promise.resolve({ id: fixture.id }) })).status, 401)
  assert.equal((await action(request(`/api/trades/${fixture.trade.id}/work-order/attempt`, fixture.buyerId,
    { attempt_id: fixture.attempt.id, action: 'accept' }), { params: Promise.resolve({ id: fixture.trade.id }) })).status, 404)
  for (const intent of ['accept', 'decline', 'heartbeat'] as const) {
    const response = await action(request(`/api/trades/${fixture.trade.id}/work-order/attempt`, fixture.sellerId,
      { attempt_id: fixture.attempt.id, action: intent }), { params: Promise.resolve({ id: fixture.trade.id }) })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error_code, 'WORK_ATTEMPT_ACKNOWLEDGMENT_EXPIRED')
  }
  const observations = await Promise.all([attempts.expireServiceAcknowledgmentAttempts(), attempts.expireServiceAcknowledgmentAttempts()])
  assert.equal(observations.reduce((sum, count) => sum + count, 0), 1)
  assert.equal(await attempts.expireServiceAcknowledgmentAttempts(), 0)
  const timedOut = (await attempts.getServiceExecutionAttempt(fixture.id))!
  assert.equal(timedOut.state, 'acknowledgment_timed_out')
  assert.ok(timedOut.completed_at)
  assert.equal(timedOut.accepted_at, null)
  const [order] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, fixture.id))
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, fixture.trade.id))
  const [route] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, fixture.id))
  const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, fixture.id))
  assert.equal(order.state, 'funded')
  assert.equal(order.execution_started_at, null)
  assert.equal(order.capacity_released_at, null)
  assert.equal(trade.status, 'escrow_held')
  assert.equal(route.state, 'funded')
  assert.equal(service.active_orders, 1)
  assert.equal((await db.select().from(schema.payment_receipts)).length, 0)
  assert.equal((await db.select().from(schema.settlement_transfers)).length, 0)
  const { POST: deliver } = await import('@/app/api/trades/[id]/delivery/route')
  const delivery = await deliver(request(`/api/trades/${fixture.trade.id}/delivery`, fixture.sellerId,
    { summary: 'An attempted delivery without an accepted provider lease', execution_attempt_id: fixture.attempt.id }),
  { params: Promise.resolve({ id: fixture.trade.id }) })
  assert.equal(delivery.status, 409)
  const { POST: dispute } = await import('@/app/api/trades/[id]/dispute/route')
  assert.equal((await dispute(request(`/api/trades/${fixture.trade.id}/dispute`, fixture.buyerId,
    { reason: 'Provider acknowledgment deadline passed' }), { params: Promise.resolve({ id: fixture.trade.id }) })).status, 200)
  assert.equal((await attempts.getServiceExecutionAttempt(fixture.id))?.state, 'acknowledgment_timed_out')
})

test('expired notices are suppressed before the observer runs and cron records the timeout once', async () => {
  const fixture = await fundedOrder(true)
  const deliveryId = `work-order-ready:${fixture.id}:${fixture.id}`
  await makeOverdue(fixture.attempt.id)
  const { attemptWebhookDelivery } = await import('@/lib/webhook-delivery')
  assert.equal(await attemptWebhookDelivery(deliveryId), 'suppressed')
  const [notice] = await db.select().from(schema.webhook_deliveries).where(eq(schema.webhook_deliveries.id, deliveryId))
  assert.equal(notice.success, 0)
  assert.equal(notice.attempts, 0)
  assert.ok(notice.suppressed_at)
  const lateWebhookId = crypto.randomUUID()
  await db.insert(schema.webhooks).values({ id: lateWebhookId, agent_id: fixture.sellerId,
    url: 'https://provider.example.invalid/late-work', secret_hash: 'unused', events: '["work_order.ready"]', active: 1 })
  assert.equal(await db.transaction((tx) => dispatch(tx, fixture.trade.id, fixture.sellerId)), 0)
  assert.equal((await db.select().from(schema.webhook_deliveries).where(eq(schema.webhook_deliveries.webhook_id, lateWebhookId))).length, 0)
  const { GET: cron } = await import('@/app/api/cron/webhooks/route')
  assert.equal((await cron(new NextRequest('http://localhost/api/cron/webhooks'))).status, 401)
  const run = () => cron(new NextRequest('http://localhost/api/cron/webhooks', { headers: { Authorization: 'Bearer provider-ack-cron-tests-only' } }))
  const first = await run()
  assert.equal(first.status, 200)
  assert.equal((await first.json()).expired_provider_acknowledgments, 1)
  assert.equal((await (await run()).json()).expired_provider_acknowledgments, 0)
})

test('accepted attempts keep their lease after acknowledgment time passes; rollback rows keep their creation deadline', async () => {
  const fixture = await fundedOrder()
  const [accepted, observed] = await Promise.all([
    attempts.changeServiceExecutionAttempt(fixture.trade.id, fixture.sellerId, fixture.attempt.id, 'accept'),
    attempts.expireServiceAcknowledgmentAttempts(),
  ])
  assert.equal(accepted.attempt.state, 'accepted')
  assert.equal(observed, 0)
  await makeOverdue(fixture.attempt.id)
  assert.equal(await attempts.expireServiceAcknowledgmentAttempts(), 0)
  assert.equal((await attempts.changeServiceExecutionAttempt(fixture.trade.id, fixture.sellerId, fixture.attempt.id, 'accept')).idempotent, true)
  assert.equal((await attempts.changeServiceExecutionAttempt(fixture.trade.id, fixture.sellerId, fixture.attempt.id, 'heartbeat')).attempt.state, 'accepted')
  const legacy = await fundedOrder()
  await db.update(schema.service_execution_attempts).set({ acknowledgment_due_at: null, created_at: new Date(Date.now() - 601_000) })
    .where(eq(schema.service_execution_attempts.id, legacy.attempt.id))
  await assert.rejects(attempts.changeServiceExecutionAttempt(legacy.trade.id, legacy.sellerId, legacy.attempt.id, 'accept'),
    (error: any) => error.code === 'WORK_ATTEMPT_ACKNOWLEDGMENT_EXPIRED')
  assert.equal(await attempts.expireServiceAcknowledgmentAttempts(), 1)
})

test('dispute interrupts timely queued work and preserves overdue acknowledgment failure before cron', async () => {
  for (const overdue of [false, true]) {
    const fixture = await fundedOrder()
    if (overdue) await makeOverdue(fixture.attempt.id)
    await db.transaction(async (tx) => {
      await tx.update(schema.trades).set({ status: 'disputed' }).where(eq(schema.trades.id, fixture.trade.id))
      await advance(tx, fixture.trade.id, 'disputed')
    })
    const stopped = (await attempts.getServiceExecutionAttempt(fixture.id))!
    assert.equal(stopped.state, overdue ? 'acknowledgment_timed_out' : 'interrupted')
    assert.equal(await attempts.expireServiceAcknowledgmentAttempts(), 0)
    const [order] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, fixture.id))
    assert.equal(order.capacity_released_at, null)
  }
})

test('a stale observer scan cannot overwrite acceptance committed by another connection', async () => {
  const fixture = await fundedOrder()
  await makeOverdue(fixture.attempt.id)
  const otherWorker = createClient({ url: process.env.TURSO_DATABASE_URL! })
  const originalExecute = db.$client.execute.bind(db.$client)
  let changed = false
  Reflect.set(db.$client, 'execute', async (...args: Parameters<typeof db.$client.execute>) => {
    const result = await originalExecute(...args)
    const statement = args[0] as string | { sql: string }
    const query = typeof statement === 'string' ? statement : statement.sql
    if (!changed && query.startsWith('select') && query.includes('"trades"."id"') && query.includes('"service_execution_attempts"')) {
      changed = true
      // The observer has a queued snapshot; a previously started acceptance now commits.
      await otherWorker.execute({ sql: "UPDATE service_execution_attempts SET state = 'accepted', accepted_at = ?, lease_expires_at = ? WHERE id = ?",
        args: [Math.floor(Date.now() / 1000) - 60, Math.floor(Date.now() / 1000) + 600, fixture.attempt.id] })
      await otherWorker.execute({ sql: "UPDATE service_orders SET state = 'executing' WHERE id = ?", args: [fixture.id] })
    }
    return result
  })
  try {
    assert.equal(await attempts.expireServiceAcknowledgmentAttempts(), 0)
    assert.equal(changed, true)
    const saved = (await attempts.getServiceExecutionAttempt(fixture.id))!
    assert.equal(saved.state, 'accepted')
    assert.equal(saved.completed_at, null)
  } finally {
    Reflect.set(db.$client, 'execute', originalExecute)
    otherWorker.close()
  }
})

async function snapshot(fixture: Awaited<ReturnType<typeof fundedOrder>>) {
  const [order] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, fixture.id))
  const [route] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, fixture.id))
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, fixture.trade.id))
  const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, fixture.id))
  return { attempt: await attempts.getServiceExecutionAttempt(fixture.id), order, route, trade, service }
}

async function act(fixture: Awaited<ReturnType<typeof fundedOrder>>, action: 'accept' | 'decline' | 'heartbeat') {
  const { POST } = await import('@/app/api/trades/[id]/work-order/attempt/route')
  return POST(request(`/api/trades/${fixture.trade.id}/work-order/attempt`, fixture.sellerId,
    { attempt_id: fixture.attempt.id, action }), { params: Promise.resolve({ id: fixture.trade.id }) })
}

test('provider actions retry a rolled-back transaction without duplicating execution or renewing acknowledgment', async () => {
  for (const action of ['accept', 'decline', 'heartbeat'] as const) {
    const fixture = await fundedOrder()
    if (action === 'heartbeat') await attempts.changeServiceExecutionAttempt(fixture.trade.id, fixture.sellerId, fixture.attempt.id, 'accept')
    const before = await snapshot(fixture)
    const originalTransaction = db.transaction.bind(db)
    let writes = 0
    Reflect.set(db, 'transaction', async (callback: Parameters<typeof db.transaction>[0]) => {
      // Check the previous failed write actually rolled back every linked state.
      if (writes > 0) assert.deepEqual(await snapshot(fixture), before)
      return originalTransaction(async (tx) => {
        const result = await callback(tx)
        writes += 1
        if (writes <= 2) throw new Error('Drizzle write failed', { cause: Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }) })
        return result
      })
    })
    let response: Response
    try { response = await act(fixture, action) }
    finally { Reflect.set(db, 'transaction', originalTransaction) }
    assert.equal(writes, 3)
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
    const saved = await snapshot(fixture)
    assert.equal(saved.attempt?.id, fixture.attempt.id)
    assert.equal(saved.attempt?.acknowledgment_due_at?.getTime(), fixture.attempt.acknowledgment_due_at?.getTime())
    assert.equal(saved.attempt?.state, action === 'decline' ? 'declined' : 'accepted')
    assert.equal(saved.order.state, action === 'decline' ? 'funded' : 'executing')
    assert.equal(saved.route.state, saved.order.state)
    assert.deepEqual(saved.trade, before.trade)
    assert.equal(saved.order.capacity_released_at, null)
    assert.equal(saved.service.active_orders, 1)
    if (action !== 'heartbeat') {
      const replay = await act(fixture, action)
      assert.equal(replay.status, 200)
      assert.equal((await replay.json()).idempotent, true)
      assert.deepEqual(await snapshot(fixture), saved)
    }
    const restarted = createClient({ url: process.env.TURSO_DATABASE_URL! })
    try {
      const persisted = await restarted.execute({ sql: 'SELECT state, acknowledgment_due_at FROM service_execution_attempts WHERE id = ?', args: [fixture.attempt.id] })
      assert.equal(persisted.rows[0].state, saved.attempt?.state)
      assert.equal(Number(persisted.rows[0].acknowledgment_due_at), fixture.attempt.acknowledgment_due_at!.getTime() / 1000)
    } finally { restarted.close() }
  }
})

test('exhausted provider contention returns a private retryable response and the same request recovers', async () => {
  const fixture = await fundedOrder()
  const before = await snapshot(fixture)
  const originalTransaction = db.transaction.bind(db)
  let writes = 0
  Reflect.set(db, 'transaction', (callback: Parameters<typeof db.transaction>[0]) => originalTransaction(async (tx) => {
    await callback(tx)
    writes += 1
    throw Object.assign(new Error('SQLITE_BUSY_SNAPSHOT: injected contention'), { code: 'SQLITE_BUSY_SNAPSHOT' })
  }))
  let response: Response
  try { response = await act(fixture, 'accept') }
  finally { Reflect.set(db, 'transaction', originalTransaction) }
  assert.equal(writes, 6)
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  assert.match(response.headers.get('vary')!, /Authorization/)
  const body = await response.json()
  assert.equal(body.error_code, 'WORK_ATTEMPT_UNAVAILABLE')
  assert.equal(body.retryable, true)
  assert.equal(body.state, 'see_trade')
  assert.equal(JSON.stringify(body).includes('injected contention'), false)
  assert.deepEqual(await snapshot(fixture), before)
  assert.equal((await act(fixture, 'accept')).status, 201)
  assert.equal((await act(fixture, 'accept')).status, 200)
  assert.equal((await db.select().from(schema.payment_receipts)).length, 0)
  assert.equal((await db.select().from(schema.settlement_transfers)).length, 0)
})

test('a provider retry rereads another worker acceptance, decline, dispute, or expired deadline', async () => {
  for (const outcome of ['accepted', 'declined', 'disputed', 'overdue', 'lease_overdue'] as const) {
    const fixture = await fundedOrder()
    if (outcome === 'lease_overdue') await attempts.changeServiceExecutionAttempt(fixture.trade.id, fixture.sellerId, fixture.attempt.id, 'accept')
    const otherWorker = createClient({ url: process.env.TURSO_DATABASE_URL! })
    const originalTransaction = db.transaction.bind(db)
    let transactions = 0
    let winner: Awaited<ReturnType<typeof snapshot>> | null = null
    Reflect.set(db, 'transaction', async (callback: Parameters<typeof db.transaction>[0]) => {
      transactions += 1
      if (transactions !== 1) return originalTransaction(callback)
      try {
        return await originalTransaction(async (tx) => {
          await callback(tx)
          throw Object.assign(new Error('SQLITE_BUSY: another worker won'), { code: 'SQLITE_BUSY' })
        })
      } catch (error) {
        const now = Math.floor(Date.now() / 1000)
        if (outcome === 'accepted') await otherWorker.batch([
          { sql: "UPDATE service_execution_attempts SET state = 'accepted', accepted_at = ?, heartbeat_at = ?, lease_expires_at = ? WHERE id = ?", args: [now, now, now + 600, fixture.attempt.id] },
          { sql: "UPDATE service_orders SET state = 'executing', execution_started_at = ? WHERE id = ?", args: [now, fixture.id] },
          { sql: "UPDATE route_plans SET state = 'executing' WHERE id = ?", args: [fixture.id] },
        ], 'write')
        else if (outcome === 'disputed') await otherWorker.batch([
          { sql: "UPDATE trades SET status = 'disputed' WHERE id = ?", args: [fixture.trade.id] },
          { sql: "UPDATE service_orders SET state = 'disputed' WHERE id = ?", args: [fixture.id] },
          { sql: "UPDATE route_plans SET state = 'disputed' WHERE id = ?", args: [fixture.id] },
          { sql: "UPDATE service_execution_attempts SET state = 'interrupted', completed_at = ? WHERE id = ?", args: [now, fixture.attempt.id] },
        ], 'write')
        else if (outcome === 'declined') await otherWorker.execute({ sql: "UPDATE service_execution_attempts SET state = 'declined', completed_at = ? WHERE id = ?", args: [now, fixture.attempt.id] })
        else if (outcome === 'lease_overdue') await otherWorker.execute({ sql: 'UPDATE service_execution_attempts SET lease_expires_at = ? WHERE id = ?', args: [now - 1, fixture.attempt.id] })
        else await otherWorker.execute({ sql: 'UPDATE service_execution_attempts SET acknowledgment_due_at = ? WHERE id = ?', args: [now - 1, fixture.attempt.id] })
        winner = await snapshot(fixture)
        throw error
      }
    })
    let response: Response
    try { response = await act(fixture, outcome === 'lease_overdue' ? 'heartbeat' : 'accept') }
    finally {
      Reflect.set(db, 'transaction', originalTransaction)
      otherWorker.close()
    }
    assert.equal(transactions, 2)
    const body = await response.json()
    if (outcome === 'accepted') {
      assert.equal(response.status, 200)
      assert.equal(body.idempotent, true)
    } else {
      assert.equal(response.status, 409)
      assert.equal(body.error_code, outcome === 'disputed' ? 'WORK_ORDER_NOT_FUNDED'
        : outcome === 'declined' ? 'WORK_ATTEMPT_STATE_CHANGED'
          : outcome === 'lease_overdue' ? 'WORK_ATTEMPT_LEASE_EXPIRED' : 'WORK_ATTEMPT_ACKNOWLEDGMENT_EXPIRED')
      assert.equal(body.retryable, false)
    }
    assert.deepEqual(await snapshot(fixture), winner)
  }
})

test('provider business errors and unrelated database failures are never retried', async () => {
  const fixture = await fundedOrder()
  const originalTransaction = db.transaction.bind(db)
  let transactions = 0
  Reflect.set(db, 'transaction', (callback: Parameters<typeof db.transaction>[0]) => {
    transactions += 1
    return originalTransaction(callback)
  })
  try {
    await assert.rejects(attempts.changeServiceExecutionAttempt(fixture.trade.id, fixture.buyerId, fixture.attempt.id, 'accept'),
      (error: unknown) => error instanceof attempts.ServiceAttemptError && error.code === 'WORK_ORDER_NOT_FOUND' && !error.retryable)
    assert.equal(transactions, 1)
    const failure = Object.assign(new Error('injected constraint failure'), { code: 'SQLITE_CONSTRAINT' })
    Reflect.set(db, 'transaction', () => { transactions += 1; throw failure })
    await assert.rejects(attempts.changeServiceExecutionAttempt(fixture.trade.id, fixture.sellerId, fixture.attempt.id, 'accept'), (error: unknown) => error === failure)
    assert.equal(transactions, 2)
  } finally { Reflect.set(db, 'transaction', originalTransaction) }
})
