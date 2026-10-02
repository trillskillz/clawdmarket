import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { expireTradePayment } from '@/lib/trade-funding'
import { routePaymentExposure } from '@/lib/route-payment-exposure'
import { isExternallyFundedTrade } from '@/lib/trade-settlement-readiness'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization, X-Agent-API-Key, X-ClawdMarket-Agent-Key' }

async function cancelledResponse(trade: typeof trades.$inferSelect, idempotent: boolean) {
  const external = isExternallyFundedTrade(trade)
  return NextResponse.json({ ok: true, trade, idempotent,
    funds_state: external ? 'payment_unknown' : 'no_funds_moved',
    payment_exposure: external ? await routePaymentExposure(trade) : null }, { headers })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers })
  if (principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403, headers })
  const { id } = await params
  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1)
  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404, headers })
  if (trade.buyer_id !== principal.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers })
  if (trade.status === 'cancelled') return cancelledResponse(trade, true)
  if (trade.status !== 'pending') return NextResponse.json({ error: 'Only an unpaid trade can be cancelled', funds_state: 'see_trade',
    payment_exposure: isExternallyFundedTrade(trade) ? await routePaymentExposure(trade) : null }, { status: 409, headers })
  const cancelled = await expireTradePayment(trade)
  if (cancelled) return cancelledResponse(cancelled, false)
  const [current] = await db.select().from(trades).where(eq(trades.id, id)).limit(1)
  if (current?.status === 'cancelled') return cancelledResponse(current, true)
  return NextResponse.json({ error: 'Funding or cancellation changed this trade', funds_state: 'payment_unknown',
    payment_exposure: current && isExternallyFundedTrade(current) ? await routePaymentExposure(current) : null }, { status: 409, headers })
}
