import { NextRequest, NextResponse } from 'next/server'
import { fetchHNStories } from '@/lib/hn-fetch'

export const dynamic = 'force-dynamic'

/**
 * Internal seller agent endpoint.
 * Accepts a task, fetches real data from Hacker News, and returns
 * a structured result artifact. No auth required — internal use only.
 */
export async function POST(req: NextRequest) {
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
