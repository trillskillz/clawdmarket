import { serviceExecutionContract } from '@/lib/service-execution-contract'
import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { route_plans, service_definitions, service_execution_attempts, service_orders, trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { checkoutForTrade } from '@/lib/trade-checkout'
import { internalErrorResponse } from '@/lib/api-error'
import { serviceOrderDto } from '@/lib/service-definitions'
import { providerExecutionStatus } from '@/lib/provider-execution-status'
import { routeExecutionTiming } from '@/lib/route-execution-timing'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ success: false, error_code: 'UNAUTHORIZED', message: 'Authentication required', retryable: false }, { status: 401 })
  try {
    const { id } = await params
    const [order] = await db.select().from(service_orders).where(eq(service_orders.id, id)).limit(1)
    if (!order) return NextResponse.json({ success: false, error_code: 'ORDER_NOT_FOUND', message: 'Order not found', retryable: false }, { status: 404 })
    const [service] = await db.select({ seller_id: service_definitions.seller_id,
      provider_protocol: service_definitions.provider_protocol }).from(service_definitions).where(eq(service_definitions.id, order.service_id)).limit(1)
    const [trade] = await db.select().from(trades).where(eq(trades.id, order.trade_id)).limit(1)
    if (!trade) return NextResponse.json({ success: false, error_code: 'ORDER_INTEGRITY_ERROR', message: 'Order trade is unavailable', retryable: true }, { status: 503 })
    if (principal.userId !== order.buyer_id && principal.userId !== trade.seller_id) {
      return NextResponse.json({ success: false, error_code: 'ORDER_NOT_FOUND', message: 'Order not found', retryable: false }, { status: 404 })
    }
    const agreed = service ? serviceExecutionContract(order, service) : null
    const [attempt] = agreed?.provider_protocol === 'leased_v1'
      ? await db.select().from(service_execution_attempts).where(eq(service_execution_attempts.order_id, order.id)).limit(1)
      : [null]
    const [route] = await db.select({ deadline_seconds: route_plans.deadline_seconds })
      .from(route_plans).where(eq(route_plans.service_order_id, order.id)).limit(1)
    const now = new Date()
    const executionTiming = route ? routeExecutionTiming(route, order, trade, now) : null
    return NextResponse.json({ order: serviceOrderDto(order), trade,
      execution_timing: executionTiming,
      provider_execution: providerExecutionStatus(agreed?.provider_protocol || 'manual', order, trade, attempt || null, executionTiming, now),
      checkout: principal.userId === order.buyer_id ? checkoutForTrade(trade) : undefined }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return internalErrorResponse('Service order lookup failed', error)
  }
}
