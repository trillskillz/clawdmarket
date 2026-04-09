import { NextResponse } from 'next/server'
import { desc, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, ratings, trades } from '@/lib/schema'

export const dynamic = 'force-dynamic'

type ActivityEvent = {
  type: 'trade_created' | 'trade_completed' | 'trade_disputed' | 'trade_confirmed' | 'rating_received' | 'agent_registered' | 'agent_improved'
  description: string
  buyer_name?: string | null
  seller_name?: string | null
  agent_name?: string | null
  timestamp: string
  relative: string
}

function shortId(id?: string | null) {
  return id ? id.slice(0, 8) : 'unknown'
}

function safeDate(value: unknown): Date | null {
  if (value == null) return null

  // Raw number: unix seconds (< 1e12) or milliseconds
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value
    const d = new Date(ms)
    return isNaN(d.getTime()) ? null : d
  }

  // Date object — Drizzle may create dates from seconds-as-milliseconds
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null
    if (value.getFullYear() < 2000 && value.getTime() > 0) {
      const fixed = new Date(value.getTime() * 1000)
      if (!isNaN(fixed.getTime()) && fixed.getFullYear() >= 2020 && fixed.getFullYear() <= 2100) return fixed
    }
    return value
  }

  // String — could be ISO or numeric string
  const str = String(value)
  if (/^\d+$/.test(str)) {
    const n = Number(str)
    const ms = n < 1e12 ? n * 1000 : n
    const d = new Date(ms)
    return isNaN(d.getTime()) ? null : d
  }
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

function relativeTime(dateValue: Date | string | number) {
  const then = new Date(dateValue).getTime()
  if (isNaN(then)) return 'unknown'
  const now = Date.now()
  const diffSec = Math.max(1, Math.floor((now - then) / 1000))
  if (diffSec < 60) return `${diffSec}s ago`
  const mins = Math.floor(diffSec / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export async function GET() {
  try {
    const client = (db as any).$client

    const [recentTrades, recentRatings, recentRegistrations] = await Promise.all([
      db.select({
        id: trades.id,
        status: trades.status,
        created_at: trades.created_at,
        buyer_agent_id: trades.buyer_id,
        seller_agent_id: trades.seller_id,
      }).from(trades).orderBy(desc(trades.created_at)).limit(20),
      db.select({
        id: ratings.id,
        score: ratings.score,
        created_at: ratings.created_at,
        rater_agent_id: ratings.rater_id,
        rated_agent_id: ratings.rated_id,
      }).from(ratings).orderBy(desc(ratings.created_at)).limit(20),
      db.select({
        id: agents.id,
        name: agents.name,
        created_at: agents.created_at,
        owner_address: agents.owner_address,
      }).from(agents).where(eq(agents.status, 'active')).orderBy(desc(agents.created_at)).limit(10),
    ])

    const agentIds = new Set<string>()
    recentTrades.forEach((t) => {
      if (t.buyer_agent_id) agentIds.add(t.buyer_agent_id)
      if (t.seller_agent_id) agentIds.add(t.seller_agent_id)
    })
    recentRatings.forEach((r) => {
      if (r.rater_agent_id) agentIds.add(r.rater_agent_id)
      if (r.rated_agent_id) agentIds.add(r.rated_agent_id)
    })

    const agentRows = agentIds.size
      ? await db.select({ id: agents.id, name: agents.name }).from(agents).where(inArray(agents.id, Array.from(agentIds)))
      : []

    const nameById = new Map(agentRows.map((a) => [a.id, a.name]))

    const tradeEvents: Array<ActivityEvent & { createdAt: Date }> = recentTrades
      .filter((t) => safeDate(t.created_at) !== null)
      .map((t) => {
        const buyer = nameById.get(t.buyer_agent_id) || `Agent ${shortId(t.buyer_agent_id)}`
        const seller = nameById.get(t.seller_agent_id) || `Agent ${shortId(t.seller_agent_id)}`
        let type: ActivityEvent['type'] = 'trade_created'
        let description = `Agent "${buyer}" started a new trade with "${seller}"`
        if (t.status === 'completed' || t.status === 'complete') {
          type = 'trade_completed'
          description = `Agent "${buyer}" completed a trade with "${seller}"`
        } else if (t.status === 'disputed') {
          type = 'trade_disputed'
          description = `Trade dispute opened between "${buyer}" and "${seller}"`
        } else if (t.status === 'resolved') {
          type = 'trade_confirmed'
          description = `Trade confirmed and settled between "${buyer}" and "${seller}"`
        }

        const createdAt = safeDate(t.created_at) as Date
        const ts = createdAt.toISOString()
        return {
          type,
          description,
          buyer_name: buyer,
          seller_name: seller,
          timestamp: ts,
          relative: relativeTime(createdAt),
          createdAt,
        }
      })

    const ratingEvents: Array<ActivityEvent & { createdAt: Date }> = recentRatings
      .filter((r) => safeDate(r.created_at) !== null)
      .map((r) => {
        const agent = nameById.get(r.rated_agent_id) || `Agent ${shortId(r.rated_agent_id)}`
        const stars = '★'.repeat(Math.max(1, Math.min(5, Number(r.score) || 0)))
        const createdAt = safeDate(r.created_at) as Date
        const ts = createdAt.toISOString()
        return {
          type: 'rating_received' as const,
          description: `Agent "${agent}" received a ${stars.padEnd(5, '☆')} rating`,
          agent_name: agent,
          timestamp: ts,
          relative: relativeTime(createdAt),
          createdAt,
        }
      })

    const registrationEvents: Array<ActivityEvent & { createdAt: Date }> = recentRegistrations
      .filter((a) => safeDate(a.created_at) !== null)
      .map((a) => {
        const createdAt = safeDate(a.created_at) as Date
        const ts = createdAt.toISOString()
        return {
          type: 'agent_registered' as const,
          description: `New agent "${a.name || `Agent ${shortId(a.id)}`}" registered`,
          agent_name: a.name || `Agent ${shortId(a.id)}`,
          timestamp: ts,
          relative: relativeTime(createdAt),
          createdAt,
        }
      })

    // Fetch recent agent improvements
    const improvementsResult = await client.execute(
      `SELECT ai.id, ai.from_version, ai.to_version, ai.created_at,
              a.name as agent_name
       FROM agent_improvements ai
       LEFT JOIN agents a ON a.id = ai.base_agent_id
       ORDER BY ai.created_at DESC LIMIT 10`
    ).catch(() => null)

    const improvementEvents: Array<ActivityEvent & { createdAt: Date }> = (improvementsResult?.rows || [])
      .filter((row: any) => safeDate(row.created_at) !== null)
      .map((row: any) => {
        const createdAt = safeDate(row.created_at) as Date
        const ts = createdAt.toISOString()
        const name = row.agent_name || 'Unknown Agent'
        return {
          type: 'agent_improved' as const,
          description: `${name} improved from v${row.from_version} to v${row.to_version}`,
          agent_name: name,
          timestamp: ts,
          relative: relativeTime(createdAt),
          createdAt,
        }
      })

    const events = [...tradeEvents, ...ratingEvents, ...registrationEvents, ...improvementEvents]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50)
      .map(({ createdAt, ...event }) => event)

    return NextResponse.json(events, {
      headers: {
        'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
      },
    })
  } catch (error) {
    console.error('Activity fetch error:', error)
    return NextResponse.json([])
  }
}
