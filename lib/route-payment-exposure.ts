import 'server-only'
import { eq } from 'drizzle-orm'
import { db } from './db'
import { evm_payment_intents, payment_receipts, service_orders, trades } from './schema'

type Trade = typeof trades.$inferSelect

/** A checkout may be paid after cancellation, so absence of a receipt is never proof of no payment. */
export function classifyRoutePaymentExposure(trade: Trade, receiptExists: boolean, intentExists: boolean) {
  const paymentConfirmed = receiptExists || (trade.status !== 'pending' && trade.status !== 'cancelled')
  const state = trade.status === 'cancelled'
    ? receiptExists ? trade.payout_status === 'refunded' ? 'refunded' : 'refund_processing' : 'late_payment_possible'
    : trade.status === 'pending'
      ? intentExists ? 'payment_in_flight_possible' : 'checkout_open'
      : ['completed', 'complete', 'resolved'].includes(trade.status) ? 'settled' : 'funded'
  return {
    state,
    payment_confirmed: paymentConfirmed,
    late_payment_possible: trade.status === 'pending' || trade.status === 'cancelled' && !receiptExists,
    automatic_retry_allowed: false,
    retry_blocking_reason: 'A linked checkout may be paid late; reconcile the existing trade before another economic order.',
  }
}

export async function routePaymentExposure(trade: Trade) {
  const [receipts, intents] = await Promise.all([
    db.select({ id: payment_receipts.id }).from(payment_receipts).where(eq(payment_receipts.trade_id, trade.id)).limit(1),
    trade.payment_rail === 'evm'
      ? db.select({ id: evm_payment_intents.id }).from(evm_payment_intents).where(eq(evm_payment_intents.trade_id, trade.id)).limit(1)
      : Promise.resolve([]),
  ])
  return classifyRoutePaymentExposure(trade, receipts.length > 0, intents.length > 0)
}

export async function linkedRoutePaymentExposure(orderId: string) {
  const [order] = await db.select({ trade_id: service_orders.trade_id }).from(service_orders).where(eq(service_orders.id, orderId)).limit(1)
  if (!order) throw new Error('ROUTE_ORDER_INVARIANT')
  const [trade] = await db.select().from(trades).where(eq(trades.id, order.trade_id)).limit(1)
  if (!trade) throw new Error('ROUTE_TRADE_INVARIANT')
  return routePaymentExposure(trade)
}
