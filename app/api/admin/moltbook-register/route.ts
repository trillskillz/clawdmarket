import { NextRequest, NextResponse } from 'next/server'
import { registerAgent } from '@/lib/moltbook'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = await rateLimit('admin:moltbook-register', { interval: 60_000, maxRequests: 10 })
  if (!rl.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: getRateLimitHeaders(rl) })
  }

  try {
    const { name, description } = await req.json()
    if (!name || !description) {
      return NextResponse.json({ error: 'name and description required' }, { status: 400 })
    }

    const result = await registerAgent(name, description)
    if (!result.success) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 502 })
    }

    return NextResponse.json({
      ok: true,
      api_key: result.api_key,
      claim_url: result.claim_url,
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
