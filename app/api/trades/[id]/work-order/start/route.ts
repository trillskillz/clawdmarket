import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { internalErrorResponse } from '@/lib/api-error'
import { ServiceOrderStartError, startServiceOrderExecution } from '@/lib/service-order-execution'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, X-Agent-API-Key, X-ClawdMarket-Agent-Key' }

function failure(error_code: string, message: string, status: number, retryable = false) {
  return NextResponse.json({ success: false, error_code, message, retryable, state: 'no_funds_moved_by_this_request' }, { status, headers })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
    if (principal.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
    const { id } = await params
    const result = await startServiceOrderExecution(id, principal.userId)
    return NextResponse.json({ success: true, order: { id: result.order.id, trade_id: id,
      state: result.order.state, execution_started_at: result.order.execution_started_at?.toISOString() || null },
      trade_status: result.trade_status, idempotent: result.idempotent, funds_state: 'see_trade' },
    { status: result.idempotent ? 200 : 201, headers })
  } catch (error) {
    if (error instanceof ServiceOrderStartError) return failure(error.code, error.message, error.status, error.retryable)
    const response = internalErrorResponse('Work order start failed', error)
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
    return response
  }
}
