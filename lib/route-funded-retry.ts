import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { route_attempts, route_plans, route_retry_funding_steps, service_definitions, service_orders, trades } from './schema'
import { assertRouteRetryReconciled, inspectAttemptReconciliation, RouteRetryError } from './route-retry-reconciliation'
import { freshRouteRetryTerms } from './route-payment-mandate'
import { listRouteFundingSteps } from './route-funding-steps'
import { reserveServiceOrder, ServiceOrderReservationError } from './service-order-reservation'
import { routeExecutionEnabled } from './routing-feature-flags'
import { serviceSupportsRoute } from './route-service-eligibility'
import type { RouteCandidate } from './route-planning'
import type { RequestPrincipal } from './request-principal'
import { workflowTransaction } from './workflow-approval'

export type RouteRetryCommand = { version: 1; mandate_id: string; previous_trade_id: string; retry_operation_id: string }
export async function inspectFundedRouteRetry(routeId: string, buyerId: string) {
  const [plan] = await db.select().from(route_plans).where(and(eq(route_plans.id, routeId), eq(route_plans.buyer_id, buyerId))).limit(1)
  if (!plan) throw new RouteRetryError('ROUTE_NOT_FOUND', 404)
  const [order] = plan.service_order_id ? await db.select().from(service_orders).where(eq(service_orders.id, plan.service_order_id)).limit(1) : []
  const proof = order ? await inspectAttemptReconciliation(db, order.trade_id) : null
  return { route_id: plan.id, trade_id: order?.trade_id || null, reconciliation: proof,
    retry: { reconciliation_required: true, funds_state: proof?.funds_state || 'no_funds_moved', blocking_reason: proof?.blocking_reason || null } }
}

async function retryResponse(plan: typeof route_plans.$inferSelect, step: typeof route_retry_funding_steps.$inferSelect, idempotent: boolean) {
  const [order] = await db.select().from(service_orders).where(eq(service_orders.id, step.order_id)).limit(1)
  const [trade] = await db.select().from(trades).where(eq(trades.id, step.trade_id)).limit(1)
  if (!order || !trade || order.buyer_id !== plan.buyer_id || trade.buyer_id !== plan.buyer_id) throw new RouteRetryError('ROUTE_RETRY_LINK_INVARIANT')
  return { route: { id: plan.id }, order, trade, funding_step: step, idempotent, funds_state: trade.status === 'pending' ? 'checkout_open' : 'see_original_trade' }
}

/** One original mandate, cumulative gross exposure and a stable retry operation. No refunds are invented here. */
export async function reserveFundedRouteRetry(routeId: string, principal: RequestPrincipal, command: RouteRetryCommand) {
  const [plan] = await db.select().from(route_plans).where(and(eq(route_plans.id, routeId), eq(route_plans.buyer_id, principal.userId))).limit(1)
  if (!plan) throw new RouteRetryError('ROUTE_NOT_FOUND', 404)
  const [prior] = await db.select().from(route_retry_funding_steps).where(eq(route_retry_funding_steps.retry_operation_id, command.retry_operation_id)).limit(1)
  if (prior) {
    if (prior.route_id !== routeId || prior.mandate_id !== command.mandate_id || prior.previous_trade_id !== command.previous_trade_id) throw new RouteRetryError('ROUTE_RETRY_OPERATION_CONFLICT')
    return retryResponse(plan, prior, true)
  }
  if (!routeExecutionEnabled(principal.userId)) throw new RouteRetryError('ROUTE_EXECUTION_DISABLED', 503)
  // Workflow counters and their ledger must describe one committed snapshot.
  // Another child may reserve while this read-only retry preflight is running.
  const terms = await workflowTransaction((tx) => freshRouteRetryTerms(command.mandate_id, plan, tx))
  const steps = await listRouteFundingSteps(db, routeId)
  if (steps.length >= terms.max_attempts) throw new RouteRetryError('MANDATE_ATTEMPTS_EXHAUSTED')
  await assertRouteRetryReconciled(db, routeId, command.previous_trade_id, principal.userId)
  const [current] = plan.service_order_id ? await db.select().from(service_orders).where(eq(service_orders.id, plan.service_order_id)).limit(1) : []
  if (!current || current.trade_id !== command.previous_trade_id) throw new RouteRetryError('ROUTE_RETRY_PREVIOUS_TRADE_CHANGED')
  const attempts = await db.select().from(route_attempts).where(eq(route_attempts.route_id, routeId))
  const attemptNumber = Math.max(0, ...attempts.map((entry) => entry.attempt_number)) + 1
  if (attemptNumber > Number(JSON.parse(plan.retry_policy).max_attempts || 1)) throw new RouteRetryError('ROUTE_RETRY_ATTEMPTS_EXHAUSTED')
  const excludedSellers = new Set<string>()
  for (const step of steps) {
    const [trade] = await db.select().from(trades).where(eq(trades.id, step.trade_id)).limit(1)
    if (!trade) throw new RouteRetryError('ROUTE_RETRY_LINK_INVARIANT')
    excludedSellers.add(trade.seller_id)
  }
  const candidates = JSON.parse(plan.candidates_json) as RouteCandidate[]
  const attemptId = crypto.randomUUID()
  for (const candidate of candidates) {
    if (attempts.some((entry) => entry.service_id === candidate.service_id) || candidate.payment_rail !== terms.payment.rail) continue
    const [service] = await db.select().from(service_definitions).where(eq(service_definitions.id, candidate.service_id)).limit(1)
    if (!service || service.status !== 'active' || excludedSellers.has(service.seller_id) || !terms.approved_providers.includes(service.seller_id)
      || service.price_minor !== Math.round(Number(candidate.pricing.amount) * 100) || !serviceSupportsRoute(service, plan)) continue
    try {
      const reserved = await reserveServiceOrder({ serviceId: service.id, principal, routeId, attemptNumber, externalOnly: true, expectedSellerId: service.seller_id,
        mandateId: command.mandate_id, retry: { operationId: command.retry_operation_id, previousTradeId: command.previous_trade_id, attemptId }, request: {
          client_reference: `route-retry:${command.retry_operation_id}`, objective: plan.objective, input: JSON.parse(plan.input_json),
          provider_requirements: JSON.parse(plan.provider_requirements_json), payment_rail: candidate.payment_rail,
          max_total: plan.max_budget_minor, expected_price: service.price_minor,
        } })
      const [step] = await db.select().from(route_retry_funding_steps).where(eq(route_retry_funding_steps.trade_id, reserved.trade.id)).limit(1)
      if (!step) throw new RouteRetryError('ROUTE_RETRY_LINK_INVARIANT')
      return retryResponse(plan, step, reserved.idempotent)
    } catch (error) {
      const [raced] = await db.select().from(route_retry_funding_steps).where(eq(route_retry_funding_steps.retry_operation_id, command.retry_operation_id)).limit(1)
      if (raced) {
        if (raced.route_id !== routeId || raced.mandate_id !== command.mandate_id || raced.previous_trade_id !== command.previous_trade_id) throw new RouteRetryError('ROUTE_RETRY_OPERATION_CONFLICT')
        return retryResponse(plan, raced, true)
      }
      if (error instanceof ServiceOrderReservationError && ['SERVICE_CAPACITY_OR_PRICE_CHANGED', 'SERVICE_PRICE_CHANGED', 'SERVICE_UNAVAILABLE', 'ROUTE_STALE_PROVIDER'].includes(error.code)) continue
      throw error
    }
  }
  throw new RouteRetryError('ROUTE_RETRY_NO_ELIGIBLE_PROVIDER')
}
