import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { authorizeAdmin } from '@/lib/admin-auth'
import { validateCsrf } from '@/lib/csrf'
import { getRateLimitHeaders, rateLimit } from '@/lib/rate-limit'
import {
  getReferenceFleetExecutionControl,
  getReferenceFleetExecutionControlEvents,
  setReferenceFleetExecutionControl,
} from '@/lib/reference-fleet-control'
import {
  getRecentReferenceFleetExecutionRuns,
  inspectReferenceFleetExecutionHealth,
} from '@/lib/reference-fleet-executor'

export const dynamic = 'force-dynamic'
const noStore = { 'Cache-Control': 'no-store' }

async function adminFor(request: NextRequest) {
  const header = request.headers.get('authorization')
  const cookie = request.cookies.get('auth-token')?.value
  const auth = await authenticateRequest(header || (cookie ? `Bearer ${cookie}` : null))
  return { auth, header, error: authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null) }
}

export async function GET(request: NextRequest) {
  const { error } = await adminFor(request)
  if (error) return error
  try {
    const [control, events, health, runs] = await Promise.all([
      getReferenceFleetExecutionControl(),
      getReferenceFleetExecutionControlEvents(),
      inspectReferenceFleetExecutionHealth(),
      getRecentReferenceFleetExecutionRuns(),
    ])
    return NextResponse.json({
      control,
      health,
      runs,
      events,
      paid_service_publication: 'locked',
    }, { headers: noStore })
  } catch (error) {
    console.error('[admin/reference-fleet-execution/get]', error)
    return NextResponse.json({ error: 'Could not read managed execution controls' }, { status: 503, headers: noStore })
  }
}

export async function POST(request: NextRequest) {
  const { auth, header, error } = await adminFor(request)
  if (error) return error
  if (!header && !validateCsrf(request)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403, headers: noStore })
  }
  const limit = await rateLimit(`admin:reference-fleet-execution:${auth!.userId}`, {
    interval: 60_000,
    maxRequests: 10,
    failClosed: true,
  })
  if (!limit.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, {
      status: 429,
      headers: { ...noStore, ...getRateLimitHeaders(limit) },
    })
  }
  const body = await request.json().catch(() => null)
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (typeof body?.paused !== 'boolean' || reason.length < 8 || reason.length > 500) {
    return NextResponse.json({
      error: 'paused must be a boolean and reason must be 8–500 characters',
    }, { status: 400, headers: noStore })
  }
  if (body.paused === false && process.env.CLAWDMARKET_REFERENCE_FLEET_EXECUTION_PAUSED === 'true') {
    return NextResponse.json({
      error: 'The environment execution pause must be cleared in a new deployment before workers can resume',
      code: 'ENVIRONMENT_EXECUTION_PAUSE',
    }, { status: 409, headers: noStore })
  }
  try {
    const control = await setReferenceFleetExecutionControl({
      paused: body.paused,
      reason,
      actorUserId: auth!.userId,
    })
    return NextResponse.json({ control }, { headers: { ...noStore, ...getRateLimitHeaders(limit) } })
  } catch (error) {
    console.error('[admin/reference-fleet-execution/post]', error)
    return NextResponse.json({ error: 'Could not update managed execution controls' }, { status: 503, headers: noStore })
  }
}
