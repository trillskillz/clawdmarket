import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateRequest } from '@/lib/auth'
import { authorizeAdmin } from '@/lib/admin-auth'
import { validateCsrf } from '@/lib/csrf'
import { getRouteControl, setRouteControl, RouteControlError } from '@/lib/route-control'
import { readBoundedJson, ArtifactError } from '@/lib/private-artifacts'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, Cookie' }
const command = z.object({ paused: z.boolean(), expected_revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict()
async function handle(request: NextRequest) {
  const bearer = request.headers.get('authorization'), cookie = request.cookies.get('auth-token')?.value
  const fromBearer = bearer ? await authenticateRequest(bearer) : null
  const auth = fromBearer || (cookie ? await authenticateRequest(`Bearer ${cookie}`) : null)
  const denied = authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null)
  if (denied) { for (const [key, value] of Object.entries(headers)) denied.headers.set(key, value); return denied }
  const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers })
  if (request.method === 'POST' && !fromBearer && !validateCsrf(request)) return json({ code: 'CSRF_REJECTED' }, 403)
  try {
    if (request.method === 'GET') return json({ control: await getRouteControl() })
    if (!(await rateLimit(`admin:route-pause:${auth!.userId}`, { interval: 60_000, maxRequests: 10, failClosed: true })).success) return json({ code: 'RATE_LIMITED' }, 429)
    const parsed = command.safeParse(await readBoundedJson(request, 512, 10_000))
    if (!parsed.success) return json({ code: 'ROUTE_CONTROL_COMMAND_INVALID' }, 400)
    return json(await setRouteControl({ paused: parsed.data.paused, expectedRevision: parsed.data.expected_revision, actorUserId: auth!.userId }))
  } catch (error) {
    if (error instanceof RouteControlError || error instanceof ArtifactError) return json({ code: error.code }, error.status)
    return json({ code: 'ROUTE_CONTROL_UNAVAILABLE' }, 503)
  }
}
export const GET = handle
export const POST = handle
