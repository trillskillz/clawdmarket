import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { route_plans, service_definitions, service_orders, trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { internalErrorResponse } from '@/lib/api-error'
import { routeExecutionTiming } from '@/lib/route-execution-timing'
import { getServiceExecutionAttempt } from '@/lib/service-execution-attempt'

export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, X-Agent-API-Key, X-ClawdMarket-Agent-Key' }

function failure(error_code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error_code, message, retryable: false }, { status, headers })
}

/** Private pull dispatch. A seller receives the buyer's input only after authoritative trade funding. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
    const { id } = await params
    const [row] = await db.select({ trade: trades, order: service_orders, service: service_definitions })
      .from(trades).innerJoin(service_orders, eq(service_orders.trade_id, trades.id))
      .innerJoin(service_definitions, eq(service_definitions.id, service_orders.service_id))
      .where(eq(trades.id, id)).limit(1)
    if (!row || ![row.trade.buyer_id, row.trade.seller_id].includes(principal.userId)) {
      return failure('WORK_ORDER_NOT_FOUND', 'Work order not found', 404)
    }
    const seller = principal.userId === row.trade.seller_id
    if (seller && (row.trade.status === 'pending' || row.trade.status === 'cancelled'
      || row.order.state === 'awaiting_funding' || row.order.state === 'cancelled')) {
      return failure('WORK_ORDER_NOT_FUNDED', 'Work order is not funded', 409)
    }
    const [linkedRoute] = await db.select({ deadline_seconds: route_plans.deadline_seconds })
      .from(route_plans).where(eq(route_plans.service_order_id, row.order.id)).limit(1)
    const attempt = row.service.provider_protocol === 'leased_v1' ? await getServiceExecutionAttempt(row.order.id) : null
    return NextResponse.json({ success: true, work_order: {
      id: row.order.id,
      trade_id: row.trade.id,
      service_id: row.service.id,
      service_title: row.service.title,
      objective: row.order.objective,
      input: JSON.parse(row.order.input_json) as Record<string, unknown>,
      input_schema: JSON.parse(row.service.input_schema),
      output_schema: JSON.parse(row.service.output_schema),
      verification_policy: JSON.parse(row.service.verification_policy),
      capabilities: JSON.parse(row.service.capabilities) as string[],
      provider_protocol: row.service.provider_protocol,
      execution_attempt: attempt ? { id: attempt.id, state: attempt.state,
        accepted_at: attempt.accepted_at?.toISOString() || null,
        heartbeat_at: attempt.heartbeat_at?.toISOString() || null,
        lease_expires_at: attempt.lease_expires_at?.toISOString() || null,
        lease_overdue: attempt.state === 'accepted' && Boolean(attempt.lease_expires_at && attempt.lease_expires_at <= new Date()) } : null,
      state: row.order.state,
      execution_started_at: row.order.execution_started_at?.toISOString() || null,
      trade_status: row.trade.status,
      funded_at: row.trade.funded_at,
      execution_timing: linkedRoute ? routeExecutionTiming(linkedRoute, row.order, row.trade) : null,
      start: seller && row.service.provider_protocol === 'manual' && row.trade.status === 'escrow_held' && row.order.state === 'funded'
        ? { method: 'POST', url: `/api/trades/${encodeURIComponent(row.trade.id)}/work-order/start` } : null,
      attempt_action: seller && attempt && row.trade.status === 'escrow_held' && ['queued', 'accepted'].includes(attempt.state)
        ? { method: 'POST', url: `/api/trades/${encodeURIComponent(row.trade.id)}/work-order/attempt` } : null,
      delivery: seller ? { method: 'POST', url: `/api/trades/${encodeURIComponent(row.trade.id)}/delivery` } : null,
    } }, { headers })
  } catch (error) {
    const response = internalErrorResponse('Work order lookup failed', error)
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
    return response
  }
}
