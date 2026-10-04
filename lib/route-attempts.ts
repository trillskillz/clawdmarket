import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { buyer_mpp_payment_intents, evm_payment_intents, payment_receipts, route_attempts, service_orders, settlement_transfers, trades } from './schema'
import { findTradeFundingStep, type RouteFundingSource } from './route-funding-steps'

export async function beginRouteAttempt(routeId: string, attemptNumber: number, serviceId: string) {
  await db.insert(route_attempts).values({ id: crypto.randomUUID(), route_id: routeId,
    attempt_number: attemptNumber, service_id: serviceId, state: 'checking' }).onConflictDoNothing()
  const [attempt] = await db.select().from(route_attempts).where(and(eq(route_attempts.route_id, routeId), eq(route_attempts.attempt_number, attemptNumber))).limit(1)
  if (!attempt || attempt.service_id !== serviceId) throw new Error('ROUTE_ATTEMPT_SNAPSHOT_CONFLICT')
  return attempt
}

export async function markRouteAttemptIneligible(routeId: string, attemptNumber: number, failureCode: string) {
  await db.update(route_attempts).set({ state: 'ineligible', failure_code: failureCode, updated_at: new Date() })
    .where(and(eq(route_attempts.route_id, routeId), eq(route_attempts.attempt_number, attemptNumber), eq(route_attempts.state, 'checking')))
}

export async function listRouteAttempts(routeId: string, source: RouteFundingSource = db) {
  const rows = await source.select().from(route_attempts).where(eq(route_attempts.route_id, routeId)).orderBy(route_attempts.attempt_number)
  return Promise.all(rows.map(async ({ id, attempt_number, service_id, state, failure_code, service_order_id, created_at, updated_at }) => {
    const [order] = service_order_id ? await source.select().from(service_orders).where(eq(service_orders.id, service_order_id)).limit(1) : []
    const [trade] = order ? await source.select().from(trades).where(eq(trades.id, order.trade_id)).limit(1) : []
    const step = trade ? await findTradeFundingStep(source, trade.id) : null
    const [receipt] = trade ? await source.select().from(payment_receipts).where(eq(payment_receipts.trade_id, trade.id)).limit(1) : []
    const [evmIntent] = trade ? await source.select({ id: evm_payment_intents.id, tx_hash: evm_payment_intents.tx_hash }).from(evm_payment_intents).where(eq(evm_payment_intents.trade_id, trade.id)).limit(1) : []
    const [mppIntent] = trade ? await source.select({ id: buyer_mpp_payment_intents.id }).from(buyer_mpp_payment_intents).where(eq(buyer_mpp_payment_intents.trade_id, trade.id)).limit(1) : []
    const transfers = trade ? await source.select({ id: settlement_transfers.id, kind: settlement_transfers.kind, status: settlement_transfers.status,
      tx_hash: settlement_transfers.tx_hash, token_amount: settlement_transfers.token_amount, confirmed_at: settlement_transfers.confirmed_at }).from(settlement_transfers).where(eq(settlement_transfers.trade_id, trade.id)) : []
    const category = !failure_code ? null : failure_code.startsWith('VERIFICATION') ? 'verification' : /MANDATE|POLICY|BUDGET|BUYER/.test(failure_code) ? 'buyer_policy'
      : /PAYMENT|RAIL|PAYOUT/.test(failure_code) ? 'payment' : /PROVIDER|SERVICE/.test(failure_code) ? 'provider' : 'infrastructure'
    return { id, attempt_number, service_id, state, failure_code, failure_category: category, service_order_id, created_at: created_at.toISOString(), updated_at: updated_at.toISOString(),
      economic: trade ? { trade_id: trade.id, trade_status: trade.status, payout_status: trade.payout_status,
        funding_step_id: step?.id || null, mandate_id: step?.mandate_id || null, terms_hash: step?.terms_hash || null,
        amount_minor: step?.amount_minor ?? Math.round(trade.total_cost * 100), funding_state: step?.state || null,
        payment_intent_id: evmIntent?.id || mppIntent?.id || null, payment_receipt: receipt ? { id: receipt.id, tx_hash: receipt.tx_hash, token_amount: receipt.token_amount } : null,
        transfers: transfers.map((entry) => ({ ...entry, confirmed_at: entry.confirmed_at?.toISOString() || null })), capacity_released_at: order!.capacity_released_at?.toISOString() || null } : null }
  }))
}
