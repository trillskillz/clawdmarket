import type { route_plans, service_orders, trades } from '@/lib/schema'

/** A route deadline starts when payment is verified and the seller can read the work order. */
export function routeExecutionTiming(
  plan: Pick<typeof route_plans.$inferSelect, 'deadline_seconds'> & { execution_deadline_at?: Date | null },
  order: Pick<typeof service_orders.$inferSelect, 'state'>,
  trade: Pick<typeof trades.$inferSelect, 'funded_at' | 'status'>,
  now = new Date(),
) {
  if (!plan.deadline_seconds || !trade.funded_at) return null
  const fundedMs = Date.parse(trade.funded_at)
  if (!Number.isFinite(fundedMs)) return null
  const dueMs = plan.execution_deadline_at?.getTime() ?? fundedMs + plan.deadline_seconds * 1000
  const awaitingDelivery = trade.status === 'escrow_held' && (order.state === 'funded' || order.state === 'executing')
  return {
    funded_at: new Date(fundedMs).toISOString(),
    due_at: new Date(dueMs).toISOString(),
    deadline_seconds: plan.deadline_seconds,
    awaiting_delivery: awaitingDelivery,
    delivery_overdue: awaitingDelivery && now.getTime() >= dueMs,
    seconds_remaining: awaitingDelivery ? Math.max(0, Math.ceil((dueMs - now.getTime()) / 1000)) : null,
  }
}
