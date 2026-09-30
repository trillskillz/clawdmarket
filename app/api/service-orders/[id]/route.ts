import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { service_definitions, service_orders, trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { checkoutForTrade } from '@/lib/trade-checkout'
import { internalErrorResponse } from '@/lib/api-error'
import { serviceOrderDto } from '@/lib/service-definitions'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ success: false, error_code: 'UNAUTHORIZED', message: 'Authentication required', retryable: false }, { status: 401 })
  try {
    const { id } = await params
    const [order] = await db.select().from(service_orders).where(eq(service_orders.id, id)).limit(1)
    if (!order) return NextResponse.json({ success: false, error_code: 'ORDER_NOT_FOUND', message: 'Order not found', retryable: false }, { status: 404 })
    const [service] = await db.select({ seller_id: service_definitions.seller_id }).from(service_definitions).where(eq(service_definitions.id, order.service_id)).limit(1)
    if (principal.userId !== order.buyer_id && principal.userId !== service?.seller_id) {
      return NextResponse.json({ success: false, error_code: 'ORDER_NOT_FOUND', message: 'Order not found', retryable: false }, { status: 404 })
    }
    const [trade] = await db.select().from(trades).where(eq(trades.id, order.trade_id)).limit(1)
    if (!trade) return NextResponse.json({ success: false, error_code: 'ORDER_INTEGRITY_ERROR', message: 'Order trade is unavailable', retryable: true }, { status: 503 })
    return NextResponse.json({ order: serviceOrderDto(order), trade, checkout: principal.userId === order.buyer_id ? checkoutForTrade(trade) : undefined }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return internalErrorResponse('Service order lookup failed', error)
  }
}
