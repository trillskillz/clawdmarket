import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { route_plans } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { normalizedCapabilities, planRoute, routePlanDto, routePlanInput, type NormalizedRouteRequest } from '@/lib/route-planning'
import { internalErrorResponse } from '@/lib/api-error'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { routePlanningEnabled } from '@/lib/routing-feature-flags'

export const dynamic = 'force-dynamic'

function failure(error_code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error_code, message, retryable: false, state: 'no_funds_moved' }, { status, headers: { 'Cache-Control': 'no-store' } })
}

function matchesRequest(plan: typeof route_plans.$inferSelect, buyerId: string, input: NormalizedRouteRequest, capabilities: string[]) {
  return plan.buyer_id === buyerId && plan.objective === input.objective
    && plan.required_capabilities === JSON.stringify(capabilities)
    && plan.input_json === JSON.stringify(input.input)
    && plan.max_budget_minor === input.max_budget.amount
    && plan.deadline_seconds === (input.deadline_seconds ?? null)
    && plan.verification_policy === JSON.stringify(input.verification)
    && plan.payment_policy === JSON.stringify(input.payment_policy)
    && plan.retry_policy === JSON.stringify(input.retry_policy)
}

export async function POST(request: NextRequest) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
  if (principal.usesCookieAuth && !validateCsrf(request)) return failure('CSRF_REJECTED', 'CSRF validation failed', 403)
  const parsed = routePlanInput.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ success: false, error_code: 'INVALID_ROUTE_REQUEST', message: 'Route request is invalid', retryable: false, state: 'no_funds_moved', details: parsed.error.issues }, { status: 400 })
  const input = parsed.data
  const capabilities = normalizedCapabilities(input.required_capabilities)
  const existing = async () => (await db.select().from(route_plans).where(eq(route_plans.client_reference, input.client_reference)).limit(1))[0]
  const prior = await existing()
  if (prior) {
    if (!matchesRequest(prior, principal.userId, input, capabilities)) {
      return failure('IDEMPOTENCY_CONFLICT', 'Reference belongs to a different route request', 409)
    }
    return NextResponse.json({ route: routePlanDto(prior), idempotent: true }, { headers: { 'Cache-Control': 'no-store' } })
  }
  if (!routePlanningEnabled()) return NextResponse.json({ success: false, error_code: 'ROUTE_PLANNING_DISABLED', message: 'Route planning is not enabled', retryable: true, state: 'no_funds_moved' }, { status: 503 })
  const limit = await rateLimit(`route-plan:${principal.userId}`, { interval: 60_000, maxRequests: 10, failClosed: true })
  if (!limit.success) return NextResponse.json({ success: false, error_code: 'ROUTE_PLAN_RATE_LIMIT', message: 'Route planning rate limit reached', retryable: true, state: 'no_funds_moved' }, { status: 429, headers: getRateLimitHeaders(limit) })
  try {
    const planned = await planRoute(input, principal.userId)
    const now = new Date()
    const [row] = await db.insert(route_plans).values({
      id: crypto.randomUUID(), buyer_id: principal.userId, client_reference: input.client_reference,
      objective: input.objective, required_capabilities: JSON.stringify(capabilities), input_json: JSON.stringify(input.input),
      max_budget_minor: input.max_budget.amount, currency: 'USD', deadline_seconds: input.deadline_seconds ?? null,
      verification_policy: JSON.stringify(input.verification), payment_policy: JSON.stringify(input.payment_policy),
      retry_policy: JSON.stringify(input.retry_policy), candidates_json: JSON.stringify(planned.candidates),
      state: 'planned', expires_at: new Date(now.getTime() + 5 * 60_000), created_at: now, updated_at: now,
    }).returning()
    return NextResponse.json({ route: routePlanDto(row), idempotent: false, planning: { examined: planned.examined, truncated: planned.truncated, candidate_count: planned.candidates.length, funds_moved: false } }, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const raced = await existing()
    if (raced) return matchesRequest(raced, principal.userId, input, capabilities)
      ? NextResponse.json({ route: routePlanDto(raced), idempotent: true }, { headers: { 'Cache-Control': 'no-store' } })
      : failure('IDEMPOTENCY_CONFLICT', 'Reference belongs to another buyer', 409)
    return internalErrorResponse('Route planning failed', error)
  }
}
