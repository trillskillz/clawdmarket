import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { route_plans, service_orders, trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { routePlanDto } from '@/lib/route-planning'
import { internalErrorResponse } from '@/lib/api-error'
import { expireTradePayment } from '@/lib/trade-funding'
import { linkedRoutePaymentExposure, routePaymentExposure } from '@/lib/route-payment-exposure'
import { inspectOwnedRoute } from '@/lib/route-inspection'
import { ArtifactError, readBoundedJson } from '@/lib/private-artifacts'

export const dynamic = 'force-dynamic'

function failure(error_code: string, message: string, status: number, state = 'no_funds_moved') {
  return NextResponse.json({ success: false, error_code, message, retryable: false, state }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
  try {
    const { id } = await params
    const snapshot = await inspectOwnedRoute(id, principal.userId)
    if (!snapshot) return failure('ROUTE_NOT_FOUND', 'Route not found', 404)
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return internalErrorResponse('Route lookup failed', error)
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
  if (principal.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
  try {
    const { id } = await params
    const parsed = z.object({ expected_service_order_id: z.uuid().nullable().optional() }).strict()
      .safeParse(await readBoundedJson(request, 1024, 10_000, true))
    if (!parsed.success) return failure('INVALID_ROUTE_CANCELLATION', 'Cancellation accepts only an optional original order precondition', 400, 'payment_unknown')
    const expected = parsed.data.expected_service_order_id
    const [cancelled] = await db.update(route_plans).set({ state: 'cancelled', updated_at: new Date() })
      .where(and(eq(route_plans.id, id), eq(route_plans.buyer_id, principal.userId), eq(route_plans.state, 'planned'),
        expected === undefined ? undefined : expected === null ? isNull(route_plans.service_order_id) : eq(route_plans.service_order_id, expected))).returning()
    if (cancelled) return NextResponse.json({ route: routePlanDto(cancelled), payment_exposure: null }, { headers: { 'Cache-Control': 'no-store' } })
    const [plan] = await db.select().from(route_plans).where(and(eq(route_plans.id, id), eq(route_plans.buyer_id, principal.userId))).limit(1)
    if (!plan) return failure('ROUTE_NOT_FOUND', 'Route not found', 404)
    if (expected !== undefined && plan.service_order_id !== expected) return failure('ROUTE_CANCELLATION_TARGET_CHANGED', 'The original checkout changed; inspect it before another cancellation', 409, 'payment_unknown')
    if (plan.state === 'cancelled') {
      const paymentExposure = plan.service_order_id ? await linkedRoutePaymentExposure(plan.service_order_id) : null
      return NextResponse.json({ route: routePlanDto(plan), idempotent: true, payment_exposure: paymentExposure,
        funds_state: paymentExposure ? paymentExposure.late_payment_possible ? 'payment_unknown' : 'see_trade' : 'no_funds_moved' }, { headers: { 'Cache-Control': 'no-store' } })
    }
    if (plan.service_order_id) {
      const [order] = await db.select().from(service_orders).where(eq(service_orders.id, plan.service_order_id)).limit(1)
      if (!order) throw new Error('ROUTE_ORDER_INVARIANT')
      const [trade] = await db.select().from(trades).where(eq(trades.id, order.trade_id)).limit(1)
      if (!trade) throw new Error('ROUTE_TRADE_INVARIANT')
      if (trade.status !== 'pending') return failure('ROUTE_FUNDS_ALREADY_COMMITTED', 'Funded work cannot be cancelled as an unpaid reservation', 409, 'see_trade')
      const cancelledTrade = await expireTradePayment(trade)
      if (!cancelledTrade) return failure('ROUTE_FUNDING_RACE', 'Funding or cancellation changed this route', 409, 'payment_unknown')
      const [updated] = await db.select().from(route_plans).where(eq(route_plans.id, id)).limit(1)
      const paymentExposure = await routePaymentExposure(cancelledTrade)
      return NextResponse.json({ route: routePlanDto(updated), funds_state: paymentExposure.late_payment_possible ? 'payment_unknown' : 'see_trade', payment_exposure: paymentExposure }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return failure('ROUTE_ALREADY_EXECUTING', 'Route reservation is in progress; retry cancellation shortly', 409)
  } catch (error) {
    if (error instanceof ArtifactError) return failure(error.code, error.status === 413 ? 'Cancellation body is too large' : 'Invalid cancellation body', error.status, 'payment_unknown')
    return internalErrorResponse('Route cancellation failed', error)
  }
}
