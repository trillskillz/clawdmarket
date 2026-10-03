import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { ArtifactError, readBoundedJson } from '@/lib/private-artifacts'
import { advanceFundedRouteDispatch, inspectRouteLifecycle, persistBackedRouteReceipt, RouteLifecycleError } from '@/lib/route-lifecycle'
import { confirmBuyerTrade } from '@/lib/buyer-trade-confirmation'

export const dynamic = 'force-dynamic'
export const maxDuration = 120
const command = z.discriminatedUnion('action', [
  z.object({ version: z.literal(1), action: z.literal('observe') }).strict(),
  z.object({ version: z.literal(1), action: z.literal('accept'), content_hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
])
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie, X-ClawdMarket-Agent-Key' } })
const failure = (code: string, status: number) => json({ error: code, code, retryable: status === 503, funds_state: 'see_original_trade' }, status)

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return failure('UNAUTHORIZED', 401)
  try { return json(await inspectRouteLifecycle((await params).id, principal.userId)) }
  catch (error) { return error instanceof RouteLifecycleError ? failure(error.code, error.status) : failure('ROUTE_LIFECYCLE_UNAVAILABLE', 503) }
}

/** One bounded pass over the existing authoritative lifecycle; no buyer signing or replacement checkout. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return failure('UNAUTHORIZED', 401)
  if (principal.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 403)
  try {
    const parsed = command.safeParse(await readBoundedJson(request, 1024, 10_000))
    if (!parsed.success) return failure('ROUTE_COMMAND_INVALID', 400)
    const { id } = await params, actor = principal.userId, input = parsed.data
    const original = await inspectRouteLifecycle(id, actor)
    if (input.action === 'accept' && (!original.delivery || original.delivery.content_hash !== input.content_hash)) return failure('DELIVERY_CHANGED', 409)
    if (input.action === 'accept' && !['awaiting_buyer', 'settling', 'completed'].includes(original.phase)) return failure('ROUTE_NOT_READY_FOR_ACCEPTANCE', 409)
    await advanceFundedRouteDispatch(id, actor)
    if (original.trade_id && (input.action === 'accept' && original.phase !== 'completed' || original.next_action === 'resume_settlement')) {
      // The existing confirmation API owns verification, buyer decision, payout outbox and completion.
      const confirmation = new NextRequest(new URL(`/api/trades/${original.trade_id}/confirm`, request.url), { method: 'POST',
        headers: request.headers, body: JSON.stringify({ content_hash: original.delivery!.content_hash }) })
      const outcome = await confirmBuyerTrade(confirmation, { params: Promise.resolve({ id: original.trade_id }) }, { waitMs: 100,
        ...(input.action === 'accept' && principal.kind === 'registered-agent' ? { agentRouteId: id } : {}) })
      if (!outcome.ok) {
        const recovered = await inspectRouteLifecycle(id, actor)
        if (recovered.phase !== 'completed') {
          const body = await outcome.json()
          return json({ ...recovered, error_code: body.code || 'ROUTE_SETTLEMENT_NOT_READY', retryable: outcome.status === 503 }, outcome.status)
        }
      }
    }
    await persistBackedRouteReceipt(id, actor)
    const result = await inspectRouteLifecycle(id, actor)
    return json(result, result.phase === 'settling' ? 202 : 200)
  } catch (error) {
    if (error instanceof RouteLifecycleError || error instanceof ArtifactError) return failure(error.code, error.status)
    return failure('ROUTE_LIFECYCLE_UNAVAILABLE', 503)
  }
}
