import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { serviceOrderDto, serviceOrderInput } from '@/lib/service-definitions'
import { checkoutForTrade } from '@/lib/trade-checkout'
import { reserveServiceOrder, ServiceOrderReservationError } from '@/lib/service-order-reservation'
import { NewPaymentsPausedError } from '@/lib/payment-control'
import { AgentSpendPolicyError } from '@/lib/agent-spend-policy'
import { BuyerSpendPolicyError } from '@/lib/buyer-spend-policy'
import { TradeRaceError } from '@/lib/settlement'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

function failure(error_code: string, message: string, status: number, retryable = false) {
  return NextResponse.json({ success: false, error_code, message, retryable, state: 'no_funds_moved' }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
  if (principal.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
  const parsed = serviceOrderInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ success: false, error_code: 'INVALID_ORDER', message: 'Order request is invalid', retryable: false, state: 'no_funds_moved', details: parsed.error.issues }, { status: 400 })
  const { id } = await params
  try {
    const result = await reserveServiceOrder({ serviceId: id, principal, request: parsed.data })
    return NextResponse.json({ order: serviceOrderDto(result.order), trade: result.trade, checkout: checkoutForTrade(result.trade), idempotent: result.idempotent }, { status: result.idempotent ? 200 : 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ServiceOrderReservationError) return failure(error.code, error.message, error.status, error.retryable)
    if (error instanceof NewPaymentsPausedError) return failure(error.code, error.message, error.status, true)
    if (error instanceof AgentSpendPolicyError) return failure(error.code, error.message, 409)
    if (error instanceof BuyerSpendPolicyError) return failure(error.code, error.message, 409)
    if (error instanceof TradeRaceError) return failure(error.code, error.message, 409)
    return internalErrorResponse('Service order reservation failed', error)
  }
}
