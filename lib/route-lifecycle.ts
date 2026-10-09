import { hasDurableBuyerFunding } from './route-automation-evidence'
import { findTradeFundingStep } from './route-funding-steps'
import { listRouteAttempts } from './route-attempts'
import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { parseUnits } from 'viem'
import { db } from './db'
import { credit_entries, payment_receipts, private_artifacts, route_plans, route_receipts, route_origins, route_agent_decisions, service_execution_attempts,
  service_orders, settlement_transfers, trade_deliveries, trades, transactions, verification_results } from './schema'
import { canonicalContract } from './structured-verification'
import { tradeAcceptanceStatus } from './trade-acceptance'
import { serviceExecutionContract } from './service-execution-contract'
import { queueFundedWorkOrder } from './service-order-dispatch'
import { withKeyedWriteLock } from './service-reservation-lock'

const digest = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
const transactionHash = /^0x[a-f0-9]{64}$/i
const usd = (value: number) => value.toFixed(2)
type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
export class RouteLifecycleError extends Error {
  constructor(public code: string, public status = 409) { super(code) }
}
async function owned(source: Source, routeId: string, buyerId: string) {
  const [route] = await source.select().from(route_plans).where(and(eq(route_plans.id, routeId), eq(route_plans.buyer_id, buyerId))).limit(1)
  if (!route) throw new RouteLifecycleError('ROUTE_NOT_FOUND', 404)
  const [order] = route.service_order_id ? await source.select().from(service_orders).where(eq(service_orders.id, route.service_order_id)).limit(1) : []
  const [trade] = order ? await source.select().from(trades).where(eq(trades.id, order.trade_id)).limit(1) : []
  if (route.service_order_id && (!order || !trade || order.buyer_id !== buyerId || trade.buyer_id !== buyerId)) throw new RouteLifecycleError('ROUTE_LINK_INVARIANT')
  return { route, order: order || null, trade: trade || null }
}

/** A completion flag is insufficient: require the existing financial records for this exact trade. */
export async function currentRouteFinancialProof(source: Source, trade: typeof trades.$inferSelect) {
  if (!['completed', 'complete'].includes(trade.status) || trade.payout_status !== 'complete' || !trade.completed_at) return null
  if (['mpp', 'evm'].includes(trade.payment_rail)) {
    const [funding] = await source.select().from(payment_receipts).where(eq(payment_receipts.trade_id, trade.id)).limit(1)
    const [payout] = await source.select().from(settlement_transfers).where(and(eq(settlement_transfers.trade_id, trade.id), eq(settlement_transfers.kind, 'seller_payout'))).limit(1)
    if (!funding || !funding.tx_hash || !transactionHash.test(funding.tx_hash) || funding.payment_rail !== trade.payment_rail
      || !funding.chain_id || !funding.token_address || funding.token_decimals === null || funding.token_usd_price !== 1
      || funding.token_amount !== parseUnits(usd(trade.total_cost), funding.token_decimals).toString()
      || Math.round((funding.usd_value_at_payment ?? funding.amount) * 100) !== Math.round(trade.total_cost * 100)
      || !payout || payout.status !== 'confirmed' || !payout.confirmed_at || !payout.tx_hash || !transactionHash.test(payout.tx_hash)
      || payout.business_key !== `${trade.id}:seller_payout` || payout.chain_id !== funding.chain_id || payout.token_address.toLowerCase() !== funding.token_address.toLowerCase()
      || Math.round(payout.usd_amount * 100) !== Math.round(trade.seller_amount * 100)
      || payout.token_amount !== parseUnits(usd(trade.seller_amount), funding.token_decimals).toString()) return null
    return { kind: 'confirmed_external' as const, funding: { receipt_id: funding.id, chain_id: funding.chain_id, token_address: funding.token_address,
      token_amount: funding.token_amount, tx_hash: funding.tx_hash }, payout: { transfer_id: payout.id, tx_hash: payout.tx_hash,
      token_amount: payout.token_amount, confirmed_at: payout.confirmed_at.toISOString() } }
  }
  const [release] = await source.select().from(transactions).where(and(eq(transactions.reference_id, trade.id), eq(transactions.type, 'escrow_release'),
    eq(transactions.from_user_id, trade.buyer_id), eq(transactions.to_user_id, trade.seller_id))).limit(1)
  if (!release || Math.round(release.amount * 100) !== Math.round(trade.amount * 100)) return null
  if (trade.payment_rail === 'credit') {
    const entries = await source.select().from(credit_entries).where(eq(credit_entries.reference, trade.id))
    const sellerMinor = Math.round(trade.amount * 100)
    if (!entries.some((e) => e.kind === 'purchase' && e.user_id === trade.buyer_id && e.available_delta === -Math.round(trade.total_cost * 100) && e.escrow_delta === sellerMinor)
      || !entries.some((e) => e.kind === 'settlement' && e.user_id === trade.buyer_id && e.available_delta === 0 && e.escrow_delta === -sellerMinor)
      || !entries.some((e) => e.kind === 'sale' && e.user_id === trade.seller_id && e.available_delta === sellerMinor && e.escrow_delta === 0)) return null
    return { kind: 'backed_account_credit' as const, release_id: release.id }
  }
  return { kind: 'historical_ledger' as const, release_id: release.id }
}

export async function persistBackedRouteReceipt(routeId: string, buyerId: string) {
  return withKeyedWriteLock(`route-receipt:${routeId}`, () => db.transaction(async (tx) => {
    const { route, order, trade } = await owned(tx, routeId, buyerId)
    const [prior] = await tx.select().from(route_receipts).where(eq(route_receipts.route_id, routeId)).limit(1)
    if (prior) {
      const receipt = JSON.parse(prior.receipt_json)
      if (digest(receipt) !== prior.content_hash || receipt.route_id !== routeId || receipt.trade_id !== trade?.id) throw new RouteLifecycleError('ROUTE_RECEIPT_INVARIANT')
      return { receipt, content_hash: prior.content_hash, idempotent: true }
    }
    if (!order || !trade) return null
    const financial = await currentRouteFinancialProof(tx, trade), acceptance = await tradeAcceptanceStatus(trade.id, tx)
    const [delivered] = await tx.select().from(trade_deliveries).where(eq(trade_deliveries.trade_id, trade.id)).limit(1)
    const delivery = delivered ? { id: delivered.id, content_hash: delivered.content_hash } : null
    if (!financial || !delivery || !acceptance.accepted || !order.capacity_released_at || order.state !== 'completed' || route.state !== 'completed') return null
    const checks = await tx.select().from(verification_results).where(and(eq(verification_results.trade_id, trade.id), eq(verification_results.delivery_id, delivery.id), eq(verification_results.content_hash, delivery.content_hash))).orderBy(verification_results.method)
    const artifacts = await tx.select({ id: private_artifacts.id, sha256: private_artifacts.sha256, size_bytes: private_artifacts.size_bytes, media_type: private_artifacts.media_type })
      .from(private_artifacts).where(eq(private_artifacts.delivery_id, delivery.id)).orderBy(private_artifacts.id)
    const attempts = await listRouteAttempts(routeId, tx)
    const [provider] = await tx.select({ id: service_execution_attempts.id, state: service_execution_attempts.state }).from(service_execution_attempts).where(eq(service_execution_attempts.order_id, order.id)).limit(1)
    const authorityStep = await findTradeFundingStep(tx, trade.id)
    const authority = authorityStep ? { mandate_id: authorityStep.mandate_id, terms_hash: authorityStep.terms_hash, funding_step_id: authorityStep.id } : null
    const [origin] = await tx.select({ channel: route_origins.channel, cohort: route_origins.cohort }).from(route_origins).where(eq(route_origins.route_id, routeId)).limit(1)
    const [agentDecision] = await tx.select().from(route_agent_decisions).where(eq(route_agent_decisions.trade_id, trade.id)).limit(1)
    const automation = { origin: origin || { channel: 'legacy_unknown', cohort: 'legacy_unknown' }, durable_buyer_funding: await hasDurableBuyerFunding(tx, trade.id),
      authenticated_agent_decision: !!agentDecision && agentDecision.route_id === routeId && agentDecision.delivery_hash === delivery.content_hash }
    const grossMinor = attempts.reduce((sum, attempt) => sum + (attempt.economic?.amount_minor || 0), 0)
    const passed = (method: string) => checks.some((c) => c.method === method && c.status === 'passed')
    const receipt = { version: 1, route_id: routeId, order_id: order.id, trade_id: trade.id,
      objective_hash: digest(route.objective), input_hash: digest(JSON.parse(route.input_json)),
      selected_provider: { service_id: order.service_id, protocol: order.execution_contract_json === null ? null : serviceExecutionContract(order, { provider_protocol: 'manual' as 'manual' | 'leased_v1' }).provider_protocol }, attempts, provider_attempt: provider || null,
      pricing: { currency: 'USD', item_amount: usd(trade.item_price || trade.amount), fee_amount: usd(trade.platform_fee || trade.fee), buyer_total: usd(trade.total_cost), seller_amount: usd(trade.seller_amount || trade.amount) },
      gross_attempt_total: (grossMinor / 100).toFixed(2),
      payment_rail: trade.payment_rail, automation, authority: authority || null, delivery,
      result_hash: digest({ summary: delivered!.summary, artifact: delivered!.artifact_json ? JSON.parse(delivered!.artifact_json) : null, delivery_url: delivered!.delivery_url }), artifacts,
      verification: { checks: checks.map((c) => ({ method: c.method, version: c.version, status: c.status })),
        structure_verified: passed('structure') || passed('schema'), source_list_verified: passed('source_urls'), artifact_integrity_verified: passed('artifact_integrity'),
        assertions_verified: passed('assertions'), declared_source_evidence_verified: passed('source_evidence'),
        isolated_checks_attested: passed('isolated_checks'), isolation_observed_by_app: false, semantic_verified: false,
        provenance_verified: false, benchmark_verified: false },
      buyer_decision: { decision: 'accepted', content_hash: delivery.content_hash, accepted_at: checks.find((c) => c.method === 'buyer_review' && c.status === 'passed')?.updated_at.toISOString() || null }, financial,
      settlement_status: 'completed', completed_at: trade.completed_at!.toISOString(), capacity_released: true }
    const serialized = canonicalContract(receipt), contentHash = digest(receipt)
    await tx.insert(route_receipts).values({ route_id: routeId, trade_id: trade.id, content_hash: contentHash, receipt_json: serialized }).onConflictDoNothing()
    const [saved] = await tx.select().from(route_receipts).where(eq(route_receipts.route_id, routeId)).limit(1)
    if (!saved || saved.content_hash !== contentHash) throw new RouteLifecycleError('ROUTE_RECEIPT_INVARIANT')
    return { receipt, content_hash: contentHash, idempotent: false }
  }))
}

/** Private content retrieval is separate from the immutable receipt. Remote URLs are never fetched. */
export async function inspectOwnedRouteResult(routeId: string, buyerId: string) {
  const { trade } = await owned(db, routeId, buyerId)
  const [delivery] = trade ? await db.select().from(trade_deliveries).where(eq(trade_deliveries.trade_id, trade.id)).limit(1) : []
  if (!trade || !delivery) throw new RouteLifecycleError('ROUTE_RESULT_NOT_READY')
  const content = { summary: delivery.summary, artifact: delivery.artifact_json ? JSON.parse(delivery.artifact_json) : null, delivery_url: delivery.delivery_url }
  const artifacts = await db.select({ id: private_artifacts.id, sha256: private_artifacts.sha256, size_bytes: private_artifacts.size_bytes, media_type: private_artifacts.media_type })
    .from(private_artifacts).where(eq(private_artifacts.delivery_id, delivery.id)).orderBy(private_artifacts.id)
  return { route_id: routeId, trade_id: trade.id, delivery: { id: delivery.id, content_hash: delivery.content_hash }, content,
    result_hash: digest(content), artifacts }
}

/** Repair only already funded dispatch; neither a plan nor an unknown payment can queue work. */
export async function advanceFundedRouteDispatch(routeId: string, buyerId: string) {
  return db.transaction(async (tx) => {
    const { order, trade } = await owned(tx, routeId, buyerId)
    if (!order || !trade || trade.status !== 'escrow_held' || order.state !== 'funded') return 0
    return queueFundedWorkOrder(tx, trade.id, trade.seller_id)
  })
}

export async function inspectRouteLifecycle(routeId: string, buyerId: string) {
  const { route, order, trade } = await owned(db, routeId, buyerId)
  const [saved] = await db.select().from(route_receipts).where(eq(route_receipts.route_id, routeId)).limit(1)
  const receipt = saved ? { receipt: JSON.parse(saved.receipt_json), content_hash: saved.content_hash } : null
  if (receipt && (digest(receipt.receipt) !== receipt.content_hash || receipt.receipt.trade_id !== trade?.id)) throw new RouteLifecycleError('ROUTE_RECEIPT_INVARIANT')
  const [delivery] = trade ? await db.select({ id: trade_deliveries.id, content_hash: trade_deliveries.content_hash }).from(trade_deliveries).where(eq(trade_deliveries.trade_id, trade.id)).limit(1) : []
  const acceptance = trade ? await tradeAcceptanceStatus(trade.id) : null
  let phase = route.state as string, nextAction = 'fund_original_payment', fundsState = 'payment_unknown', errorCode: string | null = null
  if (!trade) { nextAction = 'authorize_and_reserve'; fundsState = 'no_funds_moved' }
  else if (['completed', 'complete'].includes(trade.status)) {
    const proof = await currentRouteFinancialProof(db, trade)
    phase = proof && acceptance?.accepted && order?.capacity_released_at && order.state === 'completed' && route.state === 'completed' ? 'completed' : 'financial_uncertainty'
    nextAction = phase === 'completed' ? receipt ? 'done' : 'persist_receipt' : 'operator_reconciliation'
    fundsState = phase === 'completed' ? 'settled' : 'payment_unknown'
    if (phase !== 'completed') errorCode = 'ROUTE_SETTLEMENT_EVIDENCE_MISSING'
  } else if (trade.status === 'pending_release') {
    phase = acceptance?.accepted ? 'settling' : 'awaiting_buyer'; nextAction = acceptance?.accepted ? 'resume_settlement' : 'explicit_buyer_decision'; fundsState = 'escrow_held'
  } else if (trade.status === 'escrow_held') {
    phase = delivery ? 'verification_failed' : order?.state === 'executing' ? 'executing' : 'funded'
    nextAction = delivery ? 'provider_correction_or_dispute' : 'provider_execution'; fundsState = 'escrow_held'
  } else if (trade.status === 'disputed') { phase = 'disputed'; nextAction = 'existing_dispute_resolution'; fundsState = 'escrow_held' }
  else if (trade.status === 'cancelled') { phase = trade.payout_status === 'refunded' ? 'refunded' : 'cancelled'; nextAction = trade.payout_status === 'refunded' ? 'done' : 'reconcile_original_payment'; fundsState = trade.payout_status === 'refunded' ? 'refunded' : 'payment_unknown' }
  else if (trade.status === 'resolved') { phase = 'resolved'; nextAction = 'existing_resolution_receipt'; fundsState = 'see_trade' }
  else { phase = 'awaiting_funding' }
  return { route_id: routeId, order_id: order?.id || null, trade_id: trade?.id || null, phase, next_action: nextAction,
    funds_state: fundsState, error_code: errorCode, delivery: delivery || null, acceptance, receipt: phase === 'completed' ? receipt : null,
    provider_protocol: order ? order.execution_contract_json === null ? null : serviceExecutionContract(order, { provider_protocol: 'manual' as 'manual' | 'leased_v1' }).provider_protocol : null }
}
