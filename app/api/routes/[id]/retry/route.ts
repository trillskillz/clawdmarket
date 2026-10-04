import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { ArtifactError, privateArtifactHeaders, readBoundedJson } from '@/lib/private-artifacts'
import { inspectFundedRouteRetry, reserveFundedRouteRetry } from '@/lib/route-funded-retry'
import { RouteRetryError } from '@/lib/route-retry-reconciliation'
import { RouteMandateError } from '@/lib/route-payment-mandate'
import { ServiceOrderReservationError } from '@/lib/service-order-reservation'
import { BuyerSpendPolicyError } from '@/lib/buyer-spend-policy'
import { AgentSpendPolicyError } from '@/lib/agent-spend-policy'
import { NewPaymentsPausedError } from '@/lib/payment-control'

export const dynamic = 'force-dynamic'
const command = z.object({ version: z.literal(1), mandate_id: z.uuid(), previous_trade_id: z.uuid(), retry_operation_id: z.uuid() }).strict()
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: privateArtifactHeaders })
const failure = (code: string, status: number) => json({ error_code: code, retryable: status === 503, funds_state: 'see_original_trade' }, status)
async function handle(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return failure('UNAUTHORIZED', 401)
  if (request.method === 'POST' && principal.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 403)
  try {
    const { id } = await params
    if (request.method === 'GET') return json(await inspectFundedRouteRetry(id, principal.userId))
    const parsed = command.safeParse(await readBoundedJson(request, 1024, 10_000))
    if (!parsed.success) return failure('ROUTE_RETRY_COMMAND_INVALID', 400)
    const result = await reserveFundedRouteRetry(id, principal, parsed.data)
    return json(result, result.idempotent ? 200 : 201)
  } catch (error) {
    if (error instanceof RouteRetryError || error instanceof RouteMandateError || error instanceof ServiceOrderReservationError || error instanceof ArtifactError || error instanceof NewPaymentsPausedError) return failure(error.code, error.status)
    if (error instanceof BuyerSpendPolicyError || error instanceof AgentSpendPolicyError) return failure(error.code, 409)
    return failure('ROUTE_RETRY_UNAVAILABLE', 503)
  }
}
export const GET = handle
export const POST = handle
