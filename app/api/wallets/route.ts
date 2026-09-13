import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const clean = (value?: string) => (value || '').trim()

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown'
  const rl = await rateLimit(`wallets:${ip}`, { interval: 3_600_000, maxRequests: 10 })
  if (!rl.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: getRateLimitHeaders(rl) })
  }

 return NextResponse.json({
  evm:
   clean(process.env.TREASURY_ADDRESS) ||
   clean(process.env.MPP_RECIPIENT_ADDRESS) || null,
  mpp: clean(process.env.MPP_RECIPIENT_ADDRESS) || null,
 })
}
