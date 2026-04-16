import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveCapabilityQuery } from '@/lib/capabilities'
import { computeReputationScore } from '@/lib/reputation'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim().slice(0, 500)
  if (!q) {
    return NextResponse.json({ agents: [], query: '', keywords: [] })
  }

  try {
    const keywords = normalizeKeywords([
      ...(await extractKeywords(q)),
      ...resolveCapabilityQuery(q),
    ])
    if (keywords.length === 0) {
      return NextResponse.json({ agents: [], query: q, keywords: [] })
    }

    const client = (db as any).$client

    // Build LIKE conditions for each keyword across name, description, capabilities
    const conditions = keywords.map(
      () => `(LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(capabilities) LIKE ?)`
    )
    const args: string[] = []
    for (const kw of keywords) {
      const like = `%${kw.toLowerCase()}%`
      args.push(like, like, like)
    }

    // Score = count of matching keywords
    const scoreExprs = keywords.map(
      () => `(CASE WHEN LOWER(name) LIKE ? OR LOWER(description) LIKE ? OR LOWER(capabilities) LIKE ? THEN 1 ELSE 0 END)`
    )
    const scoreArgs: string[] = []
    for (const kw of keywords) {
      const like = `%${kw.toLowerCase()}%`
      scoreArgs.push(like, like, like)
    }
    const scoreExpr = scoreExprs.join(' + ')

    const sql = `
      SELECT id, name, description, capabilities, status, avg_rating, rating_count,
             version, endpoint, owner_address, created_at,
             benchmark_score, velocity_score, improvement_count,
             (${scoreExpr}) as match_score
      FROM agents
      WHERE status = 'active' AND (${conditions.join(' OR ')})
      ORDER BY match_score DESC, COALESCE(avg_rating, 0) DESC
      LIMIT 20
    `

    const result = await client.execute({
      sql,
      args: [...scoreArgs, ...args],
    })

    const agents = (result?.rows || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      capabilities: (() => { try { return JSON.parse(row.capabilities || '[]') } catch { return [] } })(),
      status: row.status,
      avg_rating: row.avg_rating ? Number(row.avg_rating) : null,
      rating_count: Number(row.rating_count || 0),
      version: row.version || 1,
      reputation_score: computeReputationScore({
        benchmark_score: row.benchmark_score ? Number(row.benchmark_score) : null,
        avg_rating: row.avg_rating ? Number(row.avg_rating) : null,
        rating_count: Number(row.rating_count || 0),
        improvement_count: Number(row.improvement_count || 0),
        velocity_score: row.velocity_score ? Number(row.velocity_score) : null,
      }),
      moltbook_handle: null,
      match_score: Number(row.match_score || 0),
      max_score: keywords.length,
    }))

    return NextResponse.json({
      agents,
      query: q,
      keywords,
      mode: process.env.ANTHROPIC_API_KEY ? 'semantic' : 'keyword',
    })
  } catch (err: any) {
    return NextResponse.json(
      { agents: [], query: q, keywords: [], error: 'search_failed', detail: err.message },
      { status: 500 }
    )
  }
}

function normalizeKeywords(values: string[]): string[] {
  return [...new Set(
    values
      .map((value) => value.toLowerCase().trim())
      .filter((value) => value.length > 2)
      .slice(0, 8)
  )]
}

async function extractKeywords(query: string): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return query
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2)
      .slice(0, 5)
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 128,
        system: 'Extract 3-5 key capability keywords from this agent search query. Return only a JSON array of strings, nothing else.',
        messages: [{ role: 'user', content: query }],
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}`)
    const data = await res.json()
    const text = data.content?.[0]?.text || ''
    const match = text.match(/\[[\s\S]*?\]/)
    if (match) {
      const parsed = JSON.parse(match[0])
      if (Array.isArray(parsed) && parsed.every((s: any) => typeof s === 'string')) {
        return parsed.slice(0, 5).map((s: string) => s.toLowerCase())
      }
    }
  } catch (err: any) {
    console.error('[agents/search] LLM keyword extraction failed:', err?.message)
  }

  // Fallback to simple split
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2)
    .slice(0, 5)
}
