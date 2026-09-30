import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { service_definitions, service_orders } from '@/lib/schema'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type ServiceOrderState = typeof service_orders.$inferSelect.state

/** Call in the same transaction as the authoritative trade status transition. */
export async function advanceServiceOrder(tx: Transaction, tradeId: string, state: ServiceOrderState) {
  const terminal = state === 'completed' || state === 'cancelled' || state === 'resolved'
  const now = new Date()
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
    return
  }
  await tx.update(service_orders).set({ state, updated_at: now })
    .where(and(eq(service_orders.trade_id, tradeId), isNull(service_orders.capacity_released_at)))
}
