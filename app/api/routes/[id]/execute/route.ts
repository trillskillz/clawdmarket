import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { route_payment_mandates, route_plans, service_definitions, service_orders, trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { routePlanDto, type RouteCandidate } from '@/lib/route-planning'
import { serviceOrderDto } from '@/lib/service-definitions'
import { reserveServiceOrder, ServiceOrderReservationError } from '@/lib/service-order-reservation'
import { checkoutForTrade } from '@/lib/trade-checkout'
import { routeExecutionEnabled } from '@/lib/routing-feature-flags'
import { NewPaymentsPausedError } from '@/lib/payment-control'
import { AgentSpendPolicyError } from '@/lib/agent-spend-policy'
import { BuyerSpendPolicyError } from '@/lib/buyer-spend-policy'
import { internalErrorResponse } from '@/lib/api-error'
import { beginRouteAttempt, listRouteAttempts, markRouteAttemptIneligible } from '@/lib/route-attempts'
import { routePaymentExposure } from '@/lib/route-payment-exposure'
import { serviceSupportsRoute } from '@/lib/route-service-eligibility'
import { RouteMandateError, validateRouteMandate } from '@/lib/route-payment-mandate'
import { ArtifactError, readBoundedJson } from '@/lib/private-artifacts'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

function failure(error_code: string, message: string, status: number, retryable = false, state = 'no_funds_moved') {
  return NextResponse.json({ success: false, error_code, message, retryable, state }, { status, headers: { 'Cache-Control': 'no-store' } })
}

async function currentRoute(id: string, buyerId: string) {
  return (await db.select().from(route_plans).where(and(eq(route_plans.id, id), eq(route_plans.buyer_id, buyerId))).limit(1))[0]
}

async function linkedResponse(plan: typeof route_plans.$inferSelect, idempotent: boolean) {
  if (!plan.service_order_id) return null
  const [order] = await db.select().from(service_orders).where(eq(service_orders.id, plan.service_order_id)).limit(1)
  if (!order) throw new Error('ROUTE_ORDER_INVARIANT')
  const [trade] = await db.select().from(trades).where(eq(trades.id, order.trade_id)).limit(1)
  if (!trade) throw new Error('ROUTE_TRADE_INVARIANT')
  const paymentExposure = await routePaymentExposure(trade)
  return NextResponse.json({ route: routePlanDto(plan), attempts: await listRouteAttempts(plan.id), order: serviceOrderDto(order), trade, checkout: trade.status === 'pending' ? checkoutForTrade(trade) : null, idempotent, funds_state: paymentExposure.late_payment_possible ? 'payment_unknown' : 'see_trade', payment_exposure: paymentExposure }, { status: idempotent ? 200 : 201, headers: { 'Cache-Control': 'no-store' } })
}

/** Execution commits only an unpaid order. Funding remains an explicit, authenticated checkout action. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
  if (principal.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
  const { id } = await params
  try {
    const body = await readBoundedJson(request, 1024, 10_000, true)
    const parsed = z.object({ mandate_id: z.uuid().optional() }).strict().safeParse(body)
    if (!parsed.success) return failure('INVALID_ROUTE_EXECUTION', 'Execution accepts only an optional mandate_id', 400)
    const mandateId = parsed.data.mandate_id
    let plan = await currentRoute(id, principal.userId)
    if (!plan) return failure('ROUTE_NOT_FOUND', 'Route not found', 404)
    const [savedMandate] = await db.select({ id: route_payment_mandates.id }).from(route_payment_mandates).where(eq(route_payment_mandates.route_id, id)).limit(1)
    if (savedMandate && savedMandate.id !== mandateId) return failure('MANDATE_REQUIRED', 'Execution requires the saved buyer mandate', 409, false, plan.service_order_id ? 'see_trade' : 'no_funds_moved')
    const mandate = mandateId ? await validateRouteMandate(mandateId, plan) : null
    const linked = await linkedResponse(plan, true)
    if (linked) return linked
    if (!routeExecutionEnabled(principal.userId)) return failure('ROUTE_EXECUTION_DISABLED', 'Route execution is not enabled', 503, true)
    if (plan.state !== 'planned' && plan.state !== 'reserving') return failure('ROUTE_NOT_EXECUTABLE', 'Route is not executable', 409)
    if (plan.expires_at <= new Date()) {
      await db.update(route_plans).set({ state: 'failed', updated_at: new Date() }).where(and(eq(route_plans.id, id), eq(route_plans.state, plan.state)))
      return failure('ROUTE_PLAN_EXPIRED', 'Route plan expired; create a new plan', 410)
    }
    const candidates = JSON.parse(plan.candidates_json) as RouteCandidate[]
    if (!candidates.length) return failure('ROUTE_NO_ELIGIBLE_PROVIDER', 'Plan has no eligible provider', 409)
    if (plan.state === 'planned') {
      const [claimed] = await db.update(route_plans).set({ state: 'reserving', updated_at: new Date() })
        .where(and(eq(route_plans.id, id), eq(route_plans.buyer_id, principal.userId), eq(route_plans.state, 'planned'))).returning()
      plan = claimed || await currentRoute(id, principal.userId)
      if (!plan) return failure('ROUTE_NOT_FOUND', 'Route not found', 404)
      const raced = await linkedResponse(plan, true)
      if (raced) return raced
      if (plan.state !== 'reserving') return failure('ROUTE_STATE_CHANGED', 'Route changed during execution', 409, true)
    }
    const maxAttempts = Math.max(1, Math.min(3, Number((JSON.parse(plan.retry_policy) as { max_attempts?: number }).max_attempts || 1)))
    let lastCode = 'ROUTE_NO_ELIGIBLE_PROVIDER'
    const providerFailures = new Set(['PROVIDER_EVIDENCE_REQUIRED', 'PROVIDER_NOT_APPROVED', 'ROUTE_STALE_PROVIDER', 'SERVICE_UNAVAILABLE', 'SERVICE_CAPACITY_OR_PRICE_CHANGED', 'SERVICE_PRICE_CHANGED', 'SERVICE_INPUT_INVALID', 'SERVICE_INPUT_SCHEMA_UNSUPPORTED', 'EXECUTION_MODE_UNSUPPORTED', 'PROVIDER_PROTOCOL_UNSUPPORTED', 'VERIFICATION_UNSUPPORTED', 'SELLER_PAYOUT_REQUIRED', 'PAYMENT_RAIL_UNAVAILABLE', 'REFERENCE_FLEET_PAID_SERVICES_LOCKED'])
    for (let index = 0; index < Math.min(maxAttempts, candidates.length); index += 1) {
      const candidate = candidates[index]
      const attemptNumber = index + 1
      const attempt = await beginRouteAttempt(id, attemptNumber, candidate.service_id)
      if (attempt.state === 'ineligible') { lastCode = attempt.failure_code || lastCode; continue }
      if (attempt.state === 'reserved') {
        const raced = await currentRoute(id, principal.userId)
        if (raced?.service_order_id) return (await linkedResponse(raced, true))!
        throw new Error('ROUTE_ATTEMPT_ORDER_INVARIANT')
      }
      if (candidate.payment_rail === 'ledger' || candidate.payment_rail === 'credit') {
        lastCode = 'ROUTE_EXTERNAL_PAYMENT_REQUIRED'
        await markRouteAttemptIneligible(id, attemptNumber, lastCode)
        continue
      }
      if (mandate && candidate.payment_rail !== mandate.payment.rail) {
        lastCode = 'MANDATE_PAYMENT_RAIL_BLOCKED'
        await markRouteAttemptIneligible(id, attemptNumber, lastCode)
        continue
      }
      const [service] = await db.select().from(service_definitions).where(eq(service_definitions.id, candidate.service_id)).limit(1)
      if (!service || service.status !== 'active' || service.price_minor !== Math.round(Number(candidate.pricing.amount) * 100)) {
        lastCode = 'ROUTE_STALE_PROVIDER'
        await markRouteAttemptIneligible(id, attemptNumber, lastCode)
        continue
      }
      if (!serviceSupportsRoute(service, plan)) {
        lastCode = 'ROUTE_STALE_PROVIDER'
        await markRouteAttemptIneligible(id, attemptNumber, lastCode)
        continue
      }
      try {
        const result = await reserveServiceOrder({ serviceId: candidate.service_id, principal, routeId: id, attemptNumber, externalOnly: true, expectedSellerId: service.seller_id, mandateId, request: {
          client_reference: `route:${id}:attempt:${attemptNumber}`, objective: plan.objective,
          provider_requirements: JSON.parse(plan.provider_requirements_json),
          input: JSON.parse(plan.input_json), payment_rail: candidate.payment_rail,
          max_total: plan.max_budget_minor, expected_price: service.price_minor,
        } })
        plan = await currentRoute(id, principal.userId)
        if (!plan || plan.service_order_id !== result.order.id) throw new Error('ROUTE_ORDER_INVARIANT')
        return (await linkedResponse(plan, result.idempotent))!
      } catch (error) {
        if (error instanceof RouteMandateError && ['MANDATE_PROVIDER_OR_RAIL_BLOCKED', 'MANDATE_LATENCY_EXCEEDED', 'MANDATE_BUDGET_EXCEEDED'].includes(error.code)) {
          lastCode = error.code
          await markRouteAttemptIneligible(id, attemptNumber, lastCode)
          continue
        }
        if (!(error instanceof ServiceOrderReservationError) || !providerFailures.has(error.code)) throw error
        lastCode = error.code
        await markRouteAttemptIneligible(id, attemptNumber, lastCode)
      }
    }
    const [exhausted] = await db.update(route_plans).set({ state: 'failed', updated_at: new Date() })
      .where(and(eq(route_plans.id, id), eq(route_plans.state, 'reserving'))).returning()
    if (exhausted?.service_order_id) return (await linkedResponse(exhausted, true))!
    return failure(lastCode, 'No saved provider remains eligible; create a new plan', 409)
  } catch (error) {
    if (error instanceof RouteMandateError || error instanceof ArtifactError) {
      const current = await currentRoute(id, principal.userId)
      return failure(error.code, error.message, error.status, error.code === 'MANDATE_STORAGE_BUSY', current?.service_order_id ? 'see_trade' : 'no_funds_moved')
    }
    const raced = await currentRoute(id, principal.userId)
    if (raced?.service_order_id) return (await linkedResponse(raced, true))!
    if (error instanceof ServiceOrderReservationError) {
      if (!error.retryable && !['ROUTE_STATE_CHANGED', 'IDEMPOTENCY_CONFLICT'].includes(error.code)) {
        await db.update(route_plans).set({ state: 'failed', updated_at: new Date() })
          .where(and(eq(route_plans.id, id), eq(route_plans.buyer_id, principal.userId), eq(route_plans.state, 'reserving')))
      }
      return failure(error.code, error.message, error.status, error.retryable)
    }
    if (error instanceof NewPaymentsPausedError) return failure(error.code, error.message, error.status, true)
    if (error instanceof AgentSpendPolicyError) return failure(error.code, error.message, 409)
    if (error instanceof BuyerSpendPolicyError) return failure(error.code, error.message, 409)
    return internalErrorResponse('Route execution failed', error)
  }
}
