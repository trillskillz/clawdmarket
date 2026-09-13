import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { trades } from '@/lib/schema'
import { resolveRequestPrincipal } from '@/lib/request-principal'
import { validateCsrf } from '@/lib/csrf'
import { expireTradePayment } from '@/lib/trade-funding'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const principal = await resolveRequestPrincipal(request)
  if (!principal) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (principal.usesCookieAuth && !validateCsrf(request)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
  const { id } = await params
  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1)
  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })
  if (trade.buyer_id !== principal.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (trade.status !== 'pending') return NextResponse.json({ error: 'Only an unpaid trade can be cancelled' }, { status: 409 })
  const cancelled = await expireTradePayment(trade)
  return NextResponse.json({ ok: true, trade: cancelled })
}
