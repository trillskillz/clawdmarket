import { NextRequest, NextResponse } from 'next/server'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { DeliveryError, submitTradeDelivery } from '@/lib/trade-delivery'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const principal = await resolveRequestPrincipal(request)
    if (!principal) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    if (principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    const { id } = await params
    const result = await submitTradeDelivery(id, principal.userId, await request.json().catch(() => null))
    return NextResponse.json({ ok: true, delivery: result.delivery, verification: result.verification }, { status: 201 })
  } catch (error) {
    if (error instanceof DeliveryError) return NextResponse.json({ error: error.message, details: error.details }, { status: error.status })
    console.error('[trade/delivery]', error)
    return NextResponse.json({ error: 'Could not submit delivery' }, { status: 500 })
  }
}
