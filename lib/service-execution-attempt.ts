import 'server-only'
import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { service_execution_attempts, service_orders, trades } from '@/lib/schema'
import { advanceServiceOrder } from '@/lib/service-order-state'
import { withKeyedWriteLock } from '@/lib/service-reservation-lock'
import { PROVIDER_ACKNOWLEDGMENT_TIMEOUT_SECONDS, providerAcknowledgmentDueAt, providerAcknowledgmentDueSql } from '@/lib/provider-acknowledgment'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
const LEASE_MS = 10 * 60_000

export class ServiceAttemptError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409, public readonly retryable = false) { super(message) }
}

function sqliteBusy(error: unknown) {
  let current = error
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (current instanceof ServiceAttemptError) return false
    if (typeof current === 'object' && ('code' in current && /^SQLITE_BUSY(?:_SNAPSHOT)?$/.test(String(current.code))
      || 'message' in current && /SQLITE_BUSY|database is locked/i.test(String(current.message)))) return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

/** Funding and the provider's attempt are committed together; retries reuse the same ID. */
export async function queueServiceExecutionAttempt(tx: Transaction, orderId: string) {
  const now = new Date()
  const [created] = await tx.insert(service_execution_attempts).values({ id: crypto.randomUUID(), order_id: orderId,
    acknowledgment_due_at: new Date(now.getTime() + PROVIDER_ACKNOWLEDGMENT_TIMEOUT_SECONDS * 1000), created_at: now, updated_at: now })
    .onConflictDoNothing().returning()
  if (created) return created
  const [existing] = await tx.select().from(service_execution_attempts).where(eq(service_execution_attempts.order_id, orderId)).limit(1)
  if (!existing) throw new Error('SERVICE_ATTEMPT_INVARIANT')
  return existing
}

export async function getServiceExecutionAttempt(orderId: string) {
  return (await db.select().from(service_execution_attempts).where(eq(service_execution_attempts.order_id, orderId)).limit(1))[0] || null
}

/** Seller-only state transitions; no escrow, capacity, or payment records are touched. */
export function changeServiceExecutionAttempt(tradeId: string, sellerId: string, attemptId: string, action: 'accept' | 'decline' | 'heartbeat') {
  return withKeyedWriteLock(`service-attempt:${tradeId}`, async () => {
    for (let retry = 0; retry < 6; retry += 1) {
      try { return await changeServiceExecutionAttemptOnce(tradeId, sellerId, attemptId, action) }
      catch (error) {
        if (!sqliteBusy(error)) throw error
        if (retry === 5) throw new ServiceAttemptError('WORK_ATTEMPT_UNAVAILABLE', 'Provider attempt is temporarily unavailable; retry the same request', 503, true)
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** retry))
      }
    }
    throw new ServiceAttemptError('WORK_ATTEMPT_UNAVAILABLE', 'Provider attempt is temporarily unavailable; retry the same request', 503, true)
  })
}

/** Each retry reads current trade/attempt state and time inside a fresh transaction. */
function changeServiceExecutionAttemptOnce(tradeId: string, sellerId: string, attemptId: string, action: 'accept' | 'decline' | 'heartbeat') {
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ trade: trades, order: service_orders, attempt: service_execution_attempts })
      .from(trades).innerJoin(service_orders, eq(service_orders.trade_id, trades.id))
      .innerJoin(service_execution_attempts, eq(service_execution_attempts.order_id, service_orders.id))
      .where(and(eq(trades.id, tradeId), eq(service_execution_attempts.id, attemptId))).limit(1)
    if (!row || row.trade.seller_id !== sellerId) throw new ServiceAttemptError('WORK_ORDER_NOT_FOUND', 'Work order attempt not found', 404)
    const { trade, order, attempt } = row
    if (trade.status !== 'escrow_held' || order.capacity_released_at || !['funded', 'executing'].includes(order.state)) {
      throw new ServiceAttemptError('WORK_ORDER_NOT_FUNDED', 'Work order is not available for execution')
    }
    const now = new Date()
    if (attempt.state === 'acknowledgment_timed_out'
      || attempt.state === 'queued' && providerAcknowledgmentDueAt(attempt) <= now) {
      throw new ServiceAttemptError('WORK_ATTEMPT_ACKNOWLEDGMENT_EXPIRED', 'Provider acknowledgment deadline has passed')
    }
    if (action === 'accept' && attempt.state === 'accepted') {
      if (order.state !== 'executing' || !attempt.lease_expires_at || attempt.lease_expires_at <= now) {
        throw new ServiceAttemptError('WORK_ATTEMPT_LEASE_EXPIRED', 'Provider lease is not active')
      }
      return { attempt, idempotent: true }
    }
    if (action === 'decline' && attempt.state === 'declined') return { attempt, idempotent: true }
    if (action === 'accept' || action === 'decline') {
      if (attempt.state !== 'queued' || order.state !== 'funded') throw new ServiceAttemptError('WORK_ATTEMPT_STATE_CHANGED', 'Provider attempt is no longer available')
      const [updated] = await tx.update(service_execution_attempts)
        .set(action === 'accept'
          ? { state: 'accepted', accepted_at: now, heartbeat_at: now, lease_expires_at: new Date(now.getTime() + LEASE_MS), updated_at: now }
          : { state: 'declined', completed_at: now, updated_at: now })
        .where(and(eq(service_execution_attempts.id, attemptId), eq(service_execution_attempts.state, 'queued'),
          gt(providerAcknowledgmentDueSql, Math.floor(now.getTime() / 1000)))).returning()
      if (!updated) throw new ServiceAttemptError('WORK_ATTEMPT_STATE_CHANGED', 'Provider attempt changed concurrently')
      if (action === 'accept') {
        const [started] = await tx.update(service_orders).set({ execution_started_at: now, updated_at: now })
          .where(and(eq(service_orders.id, order.id), eq(service_orders.state, 'funded'), isNull(service_orders.execution_started_at))).returning()
        if (!started) throw new ServiceAttemptError('WORK_ATTEMPT_STATE_CHANGED', 'Work order changed concurrently')
        await advanceServiceOrder(tx, tradeId, 'executing')
      }
      return { attempt: updated, idempotent: false }
    }
    if (attempt.state !== 'accepted' || !attempt.lease_expires_at || attempt.lease_expires_at <= now || order.state !== 'executing') {
      throw new ServiceAttemptError('WORK_ATTEMPT_LEASE_EXPIRED', 'Provider lease is not active')
    }
    const [updated] = await tx.update(service_execution_attempts)
      .set({ heartbeat_at: now, lease_expires_at: new Date(now.getTime() + LEASE_MS), updated_at: now })
      .where(and(eq(service_execution_attempts.id, attemptId), eq(service_execution_attempts.state, 'accepted'), gt(service_execution_attempts.lease_expires_at, now))).returning()
    if (!updated) throw new ServiceAttemptError('WORK_ATTEMPT_LEASE_EXPIRED', 'Provider lease expired concurrently')
    return { attempt: updated, idempotent: false }
  })
}

/** Observation only. Conditional writes cannot expire an attempt accepted by another worker. */
export async function expireServiceAcknowledgmentAttempts(limit = 100) {
  const now = new Date()
  const due = await db.select({ id: service_execution_attempts.id, tradeId: trades.id }).from(service_execution_attempts)
    .innerJoin(service_orders, eq(service_orders.id, service_execution_attempts.order_id))
    .innerJoin(trades, eq(trades.id, service_orders.trade_id))
    .where(and(eq(service_execution_attempts.state, 'queued'), lte(providerAcknowledgmentDueSql, Math.floor(now.getTime() / 1000)),
      eq(trades.status, 'escrow_held'), eq(service_orders.state, 'funded'), isNull(service_orders.capacity_released_at)))
    .orderBy(providerAcknowledgmentDueSql, service_execution_attempts.id)
    .limit(Math.max(1, Math.min(limit, 100)))
  let expired = 0
  for (const row of due) {
    expired += await withKeyedWriteLock(`service-attempt:${row.tradeId}`, async () => {
      const updated = await db.update(service_execution_attempts)
        .set({ state: 'acknowledgment_timed_out', completed_at: now, updated_at: now })
        .where(and(eq(service_execution_attempts.id, row.id), eq(service_execution_attempts.state, 'queued'),
          lte(providerAcknowledgmentDueSql, Math.floor(now.getTime() / 1000)),
          sql`EXISTS (SELECT 1 FROM service_orders o JOIN trades t ON t.id = o.trade_id
            WHERE o.id = ${service_execution_attempts.order_id} AND o.state = 'funded'
              AND o.capacity_released_at IS NULL AND t.status = 'escrow_held')`))
        .returning({ id: service_execution_attempts.id })
      return updated.length
    })
  }
  return expired
}

/** Observation only: expiration never releases escrow or authorizes another provider. */
export async function expireServiceExecutionAttempts(limit = 100) {
  const now = new Date()
  const due = await db.select({ id: service_execution_attempts.id }).from(service_execution_attempts)
    .where(and(eq(service_execution_attempts.state, 'accepted'), lte(service_execution_attempts.lease_expires_at, now)))
    .limit(Math.max(1, Math.min(limit, 100)))
  let expired = 0
  for (const row of due) {
    const [updated] = await db.update(service_execution_attempts).set({ state: 'expired', completed_at: now, updated_at: now })
      .where(and(eq(service_execution_attempts.id, row.id), eq(service_execution_attempts.state, 'accepted'), lte(service_execution_attempts.lease_expires_at, now)))
      .returning({ id: service_execution_attempts.id })
    expired += updated ? 1 : 0
  }
  return expired
}
