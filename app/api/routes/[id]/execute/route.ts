import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { route_plans, service_definitions, service_orders, trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { routePlanDto, type RouteCandidate } from '@/lib/route-planning'
import { serviceOrderDto } from '@/lib/service-definitions'
import { reserveServiceOrder, ServiceOrderReservationError } from '@/lib/service-order-reservation'
import { checkoutForTrade } from '@/lib/trade-checkout'
import { routeExecutionEnabled } from '@/lib/routing-feature-flags'
import { NewPaymentsPausedError } from '@/lib/payment-control'
import { AgentSpendPolicyError } from '@/lib/agent-spend-policy'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

function failure(error_code: string, message: string, status: number, retryable = false) {
  return NextResponse.json({ success: false, error_code, message, retryable, state: 'no_funds_moved' }, { status, headers: { 'Cache-Control': 'no-store' } })
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
  return NextResponse.json({ route: routePlanDto(plan), order: serviceOrderDto(order), trade, checkout: trade.status === 'pending' ? checkoutForTrade(trade) : null, idempotent, funds_state: trade.status === 'pending' ? 'no_funds_moved' : 'see_trade' }, { status: idempotent ? 200 : 201, headers: { 'Cache-Control': 'no-store' } })
}

/** Execution commits only an unpaid order. Funding remains an explicit, authenticated checkout action. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
  if (principal.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
  const { id } = await params
  try {
    let plan = await currentRoute(id, principal.userId)
    if (!plan) return failure('ROUTE_NOT_FOUND', 'Route not found', 404)
    const linked = await linkedResponse(plan, true)
    if (linked) return linked
    if (!routeExecutionEnabled()) return failure('ROUTE_EXECUTION_DISABLED', 'Route execution is not enabled', 503, true)
    if (plan.state !== 'planned' && plan.state !== 'reserving') return failure('ROUTE_NOT_EXECUTABLE', 'Route is not executable', 409)
    if (plan.expires_at <= new Date()) {
      await db.update(route_plans).set({ state: 'failed', updated_at: new Date() }).where(and(eq(route_plans.id, id), eq(route_plans.state, plan.state)))
      return failure('ROUTE_PLAN_EXPIRED', 'Route plan expired; create a new plan', 410)
    }
    const candidates = JSON.parse(plan.candidates_json) as RouteCandidate[]
    // A later batch will add persisted attempts and financial reconciliation before failover.
    const candidate = candidates[0]
    if (!candidate) return failure('ROUTE_NO_ELIGIBLE_PROVIDER', 'Plan has no eligible provider', 409)
    if (candidate.payment_rail === 'ledger') return failure('ROUTE_EXTERNAL_PAYMENT_REQUIRED', 'Automated route checkout requires an external payment rail', 409)
    if (plan.state === 'planned') {
      const [claimed] = await db.update(route_plans).set({ state: 'reserving', updated_at: new Date() })
        .where(and(eq(route_plans.id, id), eq(route_plans.buyer_id, principal.userId), eq(route_plans.state, 'planned'))).returning()
      plan = claimed || await currentRoute(id, principal.userId)
      if (!plan) return failure('ROUTE_NOT_FOUND', 'Route not found', 404)
      const raced = await linkedResponse(plan, true)
      if (raced) return raced
      if (plan.state !== 'reserving') return failure('ROUTE_STATE_CHANGED', 'Route changed during execution', 409, true)
    }
    const [service] = await db.select().from(service_definitions).where(eq(service_definitions.id, candidate.service_id)).limit(1)
    if (!service || service.status !== 'active' || service.price_minor !== Math.round(Number(candidate.pricing.amount) * 100)) {
      await db.update(route_plans).set({ state: 'failed', updated_at: new Date() }).where(and(eq(route_plans.id, id), eq(route_plans.state, 'reserving')))
      return failure('ROUTE_STALE_PROVIDER', 'Selected service or price changed; create a new plan', 409)
    }
    const required = JSON.parse(plan.required_capabilities) as string[]
    const offered = JSON.parse(service.capabilities) as string[]
    if (!required.every((capability) => offered.includes(capability)) || plan.deadline_seconds && (!service.estimated_latency_seconds || service.estimated_latency_seconds > plan.deadline_seconds)) {
      await db.update(route_plans).set({ state: 'failed', updated_at: new Date() }).where(and(eq(route_plans.id, id), eq(route_plans.state, 'reserving')))
      return failure('ROUTE_STALE_PROVIDER', 'Selected service no longer satisfies the plan', 409)
    }
    const result = await reserveServiceOrder({ serviceId: candidate.service_id, principal, routeId: id, externalOnly: true, request: {
      client_reference: `route:${id}:attempt:1`, objective: plan.objective,
      input: JSON.parse(plan.input_json), payment_rail: candidate.payment_rail,
      max_total: plan.max_budget_minor, expected_price: service.price_minor,
    } })
    plan = await currentRoute(id, principal.userId)
    if (!plan || plan.service_order_id !== result.order.id) throw new Error('ROUTE_ORDER_INVARIANT')
    return (await linkedResponse(plan, result.idempotent))!
  } catch (error) {
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
    return internalErrorResponse('Route execution failed', error)
  }
}
