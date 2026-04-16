import { NextRequest, NextResponse } from 'next/server'
import { fetchHNStories } from '@/lib/hn-fetch'
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const internalKey = req.headers.get('x-internal-key')
  if (!process.env.INTERNAL_API_SECRET || internalKey !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  const rl = await rateLimit(`internal:seller:${ip}`, { interval: 1_000, maxRequests: 1 })
  if (!rl.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: getRateLimitHeaders(rl) })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const artifact = await fetchHNStories(body.count || 5)
    return NextResponse.json({ ok: true, artifact })
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err.message,
        artifact: {
          stories: [],
          source: 'hacker-news',
          fetched_at: new Date().toISOString(),
          story_count: 0,
          note: 'Seller agent encountered an error during execution.',
        },
      },
      { status: 500 },
    )
  }
}
