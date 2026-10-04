import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { inspectOwnedRouteResult, RouteLifecycleError } from '@/lib/route-lifecycle'

export const dynamic = 'force-dynamic'
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie, X-ClawdMarket-Agent-Key' } })
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return json({ code: 'UNAUTHORIZED' }, 401)
  try { return json(await inspectOwnedRouteResult((await params).id, principal.userId)) }
  catch (error) { return error instanceof RouteLifecycleError ? json({ code: error.code }, error.status) : json({ code: 'ROUTE_RESULT_UNAVAILABLE' }, 503) }
}
