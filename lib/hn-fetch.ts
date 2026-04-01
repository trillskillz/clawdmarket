interface HNStory {
  id: number
  title: string
  url?: string
  score: number
  by: string
  descendants: number
  time: number
}

export interface HNArtifact {
  stories: {
    title: string
    url: string
    score: number
    author: string
    comments: number
    posted: string
  }[]
  source: 'hacker-news'
  fetched_at: string
  story_count: number
}

/**
 * Fetch top Hacker News stories directly from the Firebase API.
 * Used by both the internal seller endpoint and the seed cron.
 */
export async function fetchHNStories(count: number): Promise<HNArtifact> {
  const safeCount = Math.min(count || 5, 10)

  const idsRes = await fetch(
    'https://hacker-news.firebaseio.com/v0/topstories.json',
    { cache: 'no-store', signal: AbortSignal.timeout(10000) },
  )
  if (!idsRes.ok) {
    throw new Error(`HN topstories returned ${idsRes.status}`)
  }

  const allIds: number[] = await idsRes.json()
  const topIds = allIds.slice(0, safeCount)

  const stories: HNStory[] = await Promise.all(
    topIds.map(async (id) => {
      try {
        const r = await fetch(
          `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
          { cache: 'no-store', signal: AbortSignal.timeout(8000) },
        )
        return r.ok ? r.json() : null
      } catch {
        return null
      }
    }),
  ).then((results) => results.filter(Boolean))

  return {
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
}
