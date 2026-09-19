import { NextRequest, NextResponse } from 'next/server'
import { authenticateRequest } from '@/lib/auth'
import { authorizeAdmin } from '@/lib/admin-auth'
import { validateCsrf } from '@/lib/csrf'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'
import { getNewPaymentControl, getNewPaymentControlEvents, setNewPaymentControl } from '@/lib/payment-control'

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
    const [control, events] = await Promise.all([getNewPaymentControl(), getNewPaymentControlEvents()])
    return NextResponse.json({ control, events }, { headers: noStore })
  } catch (error) {
    console.error('[admin/payment-pause/get]', error)
    return NextResponse.json({ error: 'Could not read payment controls' }, { status: 503, headers: noStore })
  }
}

export async function POST(request: NextRequest) {
  const { auth, header, error } = await adminFor(request)
  if (error) return error
  if (!header && !validateCsrf(request)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403, headers: noStore })
  const limit = await rateLimit(`admin:payment-pause:${auth!.userId}`, { interval: 60_000, maxRequests: 10, failClosed: true })
  if (!limit.success) return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...noStore, ...getRateLimitHeaders(limit) } })
  const body = await request.json().catch(() => null)
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (typeof body?.paused !== 'boolean' || reason.length < 8 || reason.length > 500) {
    return NextResponse.json({ error: 'paused must be a boolean and reason must be 8–500 characters' }, { status: 400, headers: noStore })
  }
  if (body.paused === false && process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED === 'true') {
    return NextResponse.json({ error: 'The environment payment pause must be cleared in a new deployment before payments can resume', code: 'ENVIRONMENT_PAYMENT_PAUSE' }, { status: 409, headers: noStore })
  }
  try {
    const control = await setNewPaymentControl({ paused: body.paused, reason, actorUserId: auth!.userId })
    return NextResponse.json({ control }, { headers: { ...noStore, ...getRateLimitHeaders(limit) } })
  } catch (error) {
    console.error('[admin/payment-pause/post]', error)
    return NextResponse.json({ error: 'Could not update payment controls' }, { status: 503, headers: noStore })
  }
}
