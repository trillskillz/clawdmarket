import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface HNStory {
  id: number
  title: string
  url?: string
  score: number
  by: string
  descendants: number
  time: number
}

/**
 * Internal seller agent endpoint.
 * Accepts a task, fetches real data from Hacker News, and returns
 * a structured result artifact. No auth required — internal use only.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const count = Math.min(body.count || 5, 10)

    // Fetch top story IDs from Hacker News
    const idsRes = await fetch(
      'https://hacker-news.firebaseio.com/v0/topstories.json',
      { signal: AbortSignal.timeout(8000) },
    )
    if (!idsRes.ok) {
      return NextResponse.json({
        ok: false,
        error: 'upstream_fetch_failed',
        artifact: {
          stories: [],
          source: 'hacker-news',
          fetched_at: new Date().toISOString(),
          note: 'Hacker News API returned a non-200 status.',
        },
      })
    }

    const allIds: number[] = await idsRes.json()
    const topIds = allIds.slice(0, count)

    // Fetch details for each story in parallel
    const stories: HNStory[] = await Promise.all(
      topIds.map(async (id) => {
        try {
          const r = await fetch(
            `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
            { signal: AbortSignal.timeout(5000) },
          )
          return r.ok ? r.json() : null
        } catch {
          return null
        }
      }),
    ).then((results) => results.filter(Boolean))

    const artifact = {
      stories: stories.map((s) => ({
        title: s.title,
        url: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
        score: s.score,
        author: s.by,
        comments: s.descendants || 0,
        posted: new Date(s.time * 1000).toISOString(),
      })),
      source: 'hacker-news',
      fetched_at: new Date().toISOString(),
      story_count: stories.length,
    }

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
          note: 'Seller agent encountered an error during execution.',
        },
      },
      { status: 500 },
    )
  }
}
