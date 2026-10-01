import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { service_orders, trades } from '@/lib/schema'
import { advanceServiceOrder } from '@/lib/service-order-state'
import { withKeyedWriteLock } from '@/lib/service-reservation-lock'

export class ServiceOrderStartError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number, public readonly retryable = false) {
    super(message)
    this.name = 'ServiceOrderStartError'
  }
}

function retryableContention(error: unknown) {
  let current = error
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (current instanceof ServiceOrderStartError && current.code === 'WORK_ORDER_START_RACE') return true
    if (typeof current === 'object' && 'message' in current && /SQLITE_BUSY|database is locked/i.test(String(current.message))) return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

/** Idempotent seller acknowledgment; it never touches escrow or payment records. */
export function startServiceOrderExecution(tradeId: string, sellerId: string) {
  return withKeyedWriteLock(`work-order-start:${tradeId}`, async () => {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        return await db.transaction(async (tx) => {
          const [current] = await tx.select({ trade: trades, order: service_orders }).from(trades)
            .innerJoin(service_orders, eq(service_orders.trade_id, trades.id))
            .where(eq(trades.id, tradeId)).limit(1)
          if (!current || current.trade.seller_id !== sellerId) {
            throw new ServiceOrderStartError('WORK_ORDER_NOT_FOUND', 'Work order not found', 404)
          }
          if (current.order.execution_started_at) {
            return { order: current.order, trade_status: current.trade.status, idempotent: true }
          }
          if (current.trade.status !== 'escrow_held' || current.order.state !== 'funded') {
            throw new ServiceOrderStartError('WORK_ORDER_NOT_FUNDED', 'Work order is not ready for execution', 409)
          }
          const now = new Date()
          const [started] = await tx.update(service_orders).set({ state: 'executing', execution_started_at: now, updated_at: now })
            .where(and(eq(service_orders.id, current.order.id), eq(service_orders.state, 'funded'),
              isNull(service_orders.execution_started_at), sql`EXISTS (
                SELECT 1 FROM ${trades} funded_trade WHERE funded_trade.id = ${tradeId}
                  AND funded_trade.status = 'escrow_held' AND funded_trade.seller_id = ${sellerId}
              )`)).returning()
          if (!started) throw new ServiceOrderStartError('WORK_ORDER_START_RACE', 'Work order changed during execution start', 409, true)
          await advanceServiceOrder(tx, tradeId, 'executing')
          return { order: started, trade_status: current.trade.status, idempotent: false }
        })
      } catch (error) {
        if (!retryableContention(error)) throw error
        if (attempt === 5) throw new ServiceOrderStartError('WORK_ORDER_START_UNAVAILABLE', 'Work order start is temporarily unavailable', 503, true)
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
      }
    }
    throw new ServiceOrderStartError('WORK_ORDER_START_UNAVAILABLE', 'Work order start is temporarily unavailable', 503, true)
  })
}
