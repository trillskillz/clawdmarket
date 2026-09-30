import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { route_plans } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { routePlanDto } from '@/lib/route-planning'
import { internalErrorResponse } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

function failure(error_code: string, message: string, status: number) {
  return NextResponse.json({ success: false, error_code, message, retryable: false, state: 'no_funds_moved' }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return failure('UNAUTHORIZED', 'Authentication required', 401)
  try {
    const { id } = await params
    const [plan] = await db.select().from(route_plans).where(and(eq(route_plans.id, id), eq(route_plans.buyer_id, principal.userId))).limit(1)
    if (!plan) return failure('ROUTE_NOT_FOUND', 'Route not found', 404)
    return NextResponse.json({ route: routePlanDto(plan) }, { headers: { 'Cache-Control': 'no-store' } })
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
    const [cancelled] = await db.update(route_plans).set({ state: 'cancelled', updated_at: new Date() })
      .where(and(eq(route_plans.id, id), eq(route_plans.buyer_id, principal.userId), eq(route_plans.state, 'planned'))).returning()
    if (cancelled) return NextResponse.json({ route: routePlanDto(cancelled) }, { headers: { 'Cache-Control': 'no-store' } })
    const [plan] = await db.select().from(route_plans).where(and(eq(route_plans.id, id), eq(route_plans.buyer_id, principal.userId))).limit(1)
    if (!plan) return failure('ROUTE_NOT_FOUND', 'Route not found', 404)
    if (plan.state === 'cancelled') return NextResponse.json({ route: routePlanDto(plan), idempotent: true }, { headers: { 'Cache-Control': 'no-store' } })
    return failure('ROUTE_ALREADY_EXECUTING', 'An executing route must be cancelled through its order and settlement state', 409)
  } catch (error) {
    return internalErrorResponse('Route cancellation failed', error)
  }
}
