import 'server-only'
import { and, eq } from 'drizzle-orm'
import { parseUnits } from 'viem'
import { buyer_evm_payment_claims, buyer_mpp_payment_claims, buyer_mpp_payment_intents, evm_payment_intents,
  payment_receipts, route_payment_mandates, service_execution_attempts, service_orders, settlement_transfers, trades, verification_results } from './schema'
import { findTradeFundingStep, listRouteFundingSteps, type RouteFundingSource } from './route-funding-steps'

const txHash = /^0x[a-f0-9]{64}$/i
export class RouteRetryError extends Error {
  constructor(public code: string, public status = 409) { super(code) }
}

/** Only existing terminal full-buyer resolutions/refunds can free an economic attempt for retry.
 * Absence, expiry and a cancellation flag never prove that a wallet payment is absent. */
export async function inspectAttemptReconciliation(source: RouteFundingSource, tradeId: string) {
  const [trade] = await source.select().from(trades).where(eq(trades.id, tradeId)).limit(1)
  const [order] = await source.select().from(service_orders).where(eq(service_orders.trade_id, tradeId)).limit(1)
  const step = await findTradeFundingStep(source, tradeId)
  const [funding] = await source.select().from(payment_receipts).where(eq(payment_receipts.trade_id, tradeId)).limit(1)
  const transfers = await source.select().from(settlement_transfers).where(eq(settlement_transfers.trade_id, tradeId))
  const refund = transfers.find((entry) => entry.kind === 'buyer_refund')
  const [provider] = order ? await source.select().from(service_execution_attempts).where(eq(service_execution_attempts.order_id, order.id)).limit(1) : []
  const failures = await source.select({ method: verification_results.method }).from(verification_results)
    .where(and(eq(verification_results.trade_id, tradeId), eq(verification_results.status, 'failed'))).limit(1)
  const failureCode = provider && ['declined', 'expired', 'acknowledgment_timed_out'].includes(provider.state)
    ? `PROVIDER_${provider.state.toUpperCase()}` : failures.length ? 'VERIFICATION_FAILED' : trade?.status === 'cancelled' ? 'PAYMENT_CANCELLED_REFUNDED' : 'BUYER_REFUND_RESOLUTION'
  const blocked = (code: string) => ({ reconciled: false as boolean, blocking_reason: code, funds_state: funding ? 'refund_unconfirmed' : 'payment_unknown',
    trade_id: tradeId, order_id: order?.id || null, failure_code: failureCode, refund: null as null | { transfer_id: string; tx_hash: string; token_amount: string } })
  if (!trade || !order || !step || !['evm', 'mpp'].includes(trade.payment_rail)) return blocked('ROUTE_RETRY_LINK_INVARIANT')
  if (!funding) return blocked('ROUTE_RETRY_PAYMENT_UNKNOWN')
  const [mandate] = await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id, step.mandate_id)).limit(1)
  const payment = mandate ? JSON.parse(mandate.terms_json).payment : null
  if (!payment || !funding.tx_hash || !txHash.test(funding.tx_hash) || funding.payment_rail !== trade.payment_rail
    || funding.chain_id !== payment.chain_id || funding.token_address?.toLowerCase() !== payment.token_address
    || funding.payer_address?.toLowerCase() !== payment.payer_address || funding.token_decimals == null || funding.token_usd_price !== 1
    || funding.token_amount !== parseUnits(trade.total_cost.toFixed(2), funding.token_decimals).toString()
    || Math.round((funding.usd_value_at_payment ?? funding.amount) * 100) !== Math.round(trade.total_cost * 100)) return blocked('ROUTE_RETRY_FUNDING_EVIDENCE_MISSING')
  const cancelled = trade.status === 'cancelled' && trade.payout_status === 'refunded'
  const resolved = trade.status === 'resolved' && trade.resolution === 'buyer' && trade.resolution_seller_percent === 0 && trade.payout_status === 'complete' && !!trade.completed_at
  if ((!cancelled && !resolved) || !order.capacity_released_at || !['cancelled', 'resolved'].includes(order.state)) return blocked('ROUTE_RETRY_RECONCILIATION_REQUIRED')
  const refundUsd = cancelled ? trade.total_cost : trade.seller_amount
  if (transfers.some((entry) => entry.kind === 'seller_payout')) return blocked('ROUTE_RETRY_PAYOUT_CONFLICT')
  if (!refund || refund.status !== 'confirmed' || !refund.confirmed_at || !refund.tx_hash || !txHash.test(refund.tx_hash)
    || refund.business_key !== `${trade.id}:buyer_refund` || refund.chain_id !== funding.chain_id
    || refund.token_address.toLowerCase() !== funding.token_address!.toLowerCase()
    || refund.to_address.toLowerCase() !== payment.payer_address || refund.from_address.toLowerCase() !== payment.treasury_address
    || refund.token_amount !== parseUnits(refundUsd.toFixed(2), funding.token_decimals).toString()
    || Math.round(refund.usd_amount * 100) !== Math.round(refundUsd * 100)) return blocked('ROUTE_RETRY_REFUND_EVIDENCE_MISSING')
  const [evmIntent] = await source.select().from(evm_payment_intents).where(eq(evm_payment_intents.trade_id, tradeId)).limit(1)
  const [mppIntent] = await source.select().from(buyer_mpp_payment_intents).where(eq(buyer_mpp_payment_intents.trade_id, tradeId)).limit(1)
  const [evmClaim] = evmIntent ? await source.select().from(buyer_evm_payment_claims).where(eq(buyer_evm_payment_claims.intent_id, evmIntent.id)).limit(1) : []
  const [mppClaim] = mppIntent ? await source.select().from(buyer_mpp_payment_claims).where(eq(buyer_mpp_payment_claims.intent_id, mppIntent.id)).limit(1) : []
  if (evmClaim && (evmClaim.state !== 'confirmed' || evmClaim.tx_hash !== funding.tx_hash)
    || mppClaim && (mppClaim.state !== 'confirmed' || mppClaim.tx_hash !== funding.tx_hash)) return blocked('ROUTE_RETRY_WALLET_PAYMENT_UNRECONCILED')
  return { reconciled: true, blocking_reason: null, funds_state: 'refunded', trade_id: tradeId, order_id: order.id, failure_code: failureCode,
    refund: { transfer_id: refund.id, tx_hash: refund.tx_hash, token_amount: refund.token_amount } }
}

export async function assertRouteRetryReconciled(source: RouteFundingSource, routeId: string, previousTradeId: string, buyerId: string) {
  const steps = await listRouteFundingSteps(source, routeId)
  if (!steps.length || !steps.some((step) => step.trade_id === previousTradeId)) throw new RouteRetryError('ROUTE_RETRY_PREVIOUS_TRADE_CHANGED')
  let previous
  for (const step of steps) {
    const [trade] = await source.select().from(trades).where(eq(trades.id, step.trade_id)).limit(1)
    if (!trade || trade.buyer_id !== buyerId) throw new RouteRetryError('ROUTE_RETRY_LINK_INVARIANT')
    const proof = await inspectAttemptReconciliation(source, step.trade_id)
    if (!proof.reconciled) throw new RouteRetryError(proof.blocking_reason!)
    if (step.trade_id === previousTradeId) previous = proof
  }
  return previous!
}
