import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { service_definitions, service_orders, webhook_deliveries, webhooks } from '@/lib/schema'
import { queueServiceExecutionAttempt } from '@/lib/service-execution-attempt'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Persist subscribed provider notifications in the same transaction that funds the order. */
export async function queueFundedWorkOrder(tx: Transaction, tradeId: string, sellerId: string) {
  const [order] = await tx.select({ id: service_orders.id, protocol: service_definitions.provider_protocol })
    .from(service_orders).innerJoin(service_definitions, eq(service_definitions.id, service_orders.service_id))
    .where(and(eq(service_orders.trade_id, tradeId), eq(service_orders.state, 'funded'))).limit(1)
  if (!order) return 0
  const attempt = order.protocol === 'leased_v1' ? await queueServiceExecutionAttempt(tx, order.id) : null
  const subscriptions = await tx.select({ id: webhooks.id, events: webhooks.events }).from(webhooks)
    .where(and(eq(webhooks.agent_id, sellerId), eq(webhooks.active, 1)))
  let queued = 0
  for (const subscription of subscriptions) {
    let events: unknown
    try { events = JSON.parse(subscription.events) } catch { continue }
    if (!Array.isArray(events) || !events.includes('work_order.ready')) continue
    const deliveryId = `work-order-ready:${order.id}:${subscription.id}`
    const now = new Date()
    const payload = JSON.stringify({
      event: 'work_order.ready', timestamp: now.toISOString(), agent_id: sellerId,
      delivery_id: deliveryId,
      data: { trade_id: tradeId, work_order_url: `/api/trades/${encodeURIComponent(tradeId)}/work-order`,
        ...(attempt ? { execution_attempt_id: attempt.id } : {}) },
    })
    const inserted = await tx.insert(webhook_deliveries).values({
      id: deliveryId, webhook_id: subscription.id, event_type: 'work_order.ready', payload,
      attempts: 0, success: 0, created_at: now, next_attempt_at: now,
    }).onConflictDoNothing().returning({ id: webhook_deliveries.id })
    queued += inserted.length
  }
  return queued
}
