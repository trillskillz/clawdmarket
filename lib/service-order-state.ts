import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { route_plans, service_definitions, service_execution_attempts, service_orders, trades } from '@/lib/schema'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type ServiceOrderState = typeof service_orders.$inferSelect.state

/** Call in the same transaction as the authoritative trade status transition. */
export async function advanceServiceOrder(tx: Transaction, tradeId: string, state: ServiceOrderState) {
  const terminal = state === 'completed' || state === 'cancelled' || state === 'resolved'
  const now = new Date()
  const [linkedOrder] = await tx.select({ id: service_orders.id }).from(service_orders).where(eq(service_orders.trade_id, tradeId)).limit(1)
  if (linkedOrder && (state === 'disputed' || terminal)) {
    // Preserve an already overdue provider failure; otherwise the trade transition ended the lease.
    await tx.update(service_execution_attempts).set({ state: 'expired', completed_at: now, updated_at: now })
      .where(and(eq(service_execution_attempts.order_id, linkedOrder.id), eq(service_execution_attempts.state, 'accepted'),
        lte(service_execution_attempts.lease_expires_at, now)))
    await tx.update(service_execution_attempts).set({ state: 'interrupted', completed_at: now, updated_at: now })
      .where(and(eq(service_execution_attempts.order_id, linkedOrder.id),
        or(eq(service_execution_attempts.state, 'queued'),
          and(eq(service_execution_attempts.state, 'accepted'), gt(service_execution_attempts.lease_expires_at, now)))))
  }
  if (terminal) {
    const [released] = await tx.update(service_orders)
      .set({ state, capacity_released_at: now, updated_at: now })
      .where(and(eq(service_orders.trade_id, tradeId), isNull(service_orders.capacity_released_at)))
      .returning({ service_id: service_orders.service_id })
    if (released) {
      const [decremented] = await tx.update(service_definitions)
        .set({ active_orders: sql`${service_definitions.active_orders} - 1`, updated_at: now })
        .where(and(eq(service_definitions.id, released.service_id), sql`${service_definitions.active_orders} > 0`))
        .returning({ id: service_definitions.id })
      if (!decremented) throw new Error('SERVICE_CAPACITY_INVARIANT')
    }
    if (linkedOrder) await tx.update(route_plans).set({ state, updated_at: now }).where(eq(route_plans.service_order_id, linkedOrder.id))
    return
  }
  await tx.update(service_orders).set({ state, updated_at: now })
    .where(and(eq(service_orders.trade_id, tradeId), isNull(service_orders.capacity_released_at)))
  if (linkedOrder) await tx.update(route_plans).set({ state: state === 'verifying' ? 'awaiting_buyer' : state, updated_at: now })
    .where(eq(route_plans.service_order_id, linkedOrder.id))
}

/** Operator repair after a rollback or legacy worker settled a linked trade. */
export async function reconcileTerminalServiceOrders(limit = 1_000) {
  const rows = await db.select({ trade_id: service_orders.trade_id, status: trades.status })
    .from(service_orders).innerJoin(trades, eq(service_orders.trade_id, trades.id))
    .where(and(isNull(service_orders.capacity_released_at), inArray(trades.status, ['completed', 'complete', 'resolved', 'cancelled'])))
    .limit(Math.max(1, Math.min(limit, 1_000)))
  for (const row of rows) {
    await db.transaction((tx) => advanceServiceOrder(tx, row.trade_id, row.status === 'complete' ? 'completed' : row.status as ServiceOrderState))
  }
  return rows.length
}
