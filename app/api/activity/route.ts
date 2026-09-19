import { NextResponse } from 'next/server'
import { inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { users } from '@/lib/schema'

export const dynamic = 'force-dynamic'

type ActivityEvent = {
  id: string
  type: 'trade_created' | 'trade_completed' | 'trade_disputed' | 'trade_confirmed' | 'rating_received' | 'agent_registered' | 'agent_improved'
  description: string
  buyer_name?: string | null
  seller_name?: string | null
  agent_name?: string | null
  timestamp: string
  relative: string
}

type TradeActivityRow = {
  id: string
  status: string
  created_at: unknown
  completed_at: unknown
  buyer_agent_id: string
  seller_agent_id: string
}

type RatingActivityRow = {
  id: string
  score: number
  created_at: unknown
  rater_agent_id: string
  rated_agent_id: string
}

type RegistrationActivityRow = {
  id: string
  name: string | null
  created_at: unknown
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
      client.execute(
        `SELECT id, status, created_at, completed_at,
                buyer_id AS buyer_agent_id, seller_id AS seller_agent_id
         FROM trades
         ORDER BY CASE
           WHEN typeof(COALESCE(completed_at, created_at)) IN ('integer', 'real')
             AND COALESCE(completed_at, created_at) > 9999999999
             THEN datetime(COALESCE(completed_at, created_at) / 1000, 'unixepoch')
           WHEN typeof(COALESCE(completed_at, created_at)) IN ('integer', 'real')
             THEN datetime(COALESCE(completed_at, created_at), 'unixepoch')
           ELSE datetime(COALESCE(completed_at, created_at))
         END DESC
         LIMIT 20`,
      ).then((result: any) => (result?.rows || []) as TradeActivityRow[]).catch(() => [] as TradeActivityRow[]),
      client.execute(
        `SELECT id, score, created_at,
                rater_id AS rater_agent_id, rated_id AS rated_agent_id
         FROM ratings
         ORDER BY CASE
           WHEN typeof(created_at) IN ('integer', 'real') AND created_at > 9999999999
             THEN datetime(created_at / 1000, 'unixepoch')
           WHEN typeof(created_at) IN ('integer', 'real') THEN datetime(created_at, 'unixepoch')
           ELSE datetime(created_at)
         END DESC
         LIMIT 20`,
      ).then((result: any) => (result?.rows || []) as RatingActivityRow[]).catch(() => [] as RatingActivityRow[]),
      client.execute(
        `SELECT id, name, created_at, owner_address
         FROM agents
         WHERE status = 'active' AND visibility = 'public' AND archived_at IS NULL
         ORDER BY CASE
           WHEN typeof(created_at) IN ('integer', 'real') AND created_at > 9999999999
             THEN datetime(created_at / 1000, 'unixepoch')
           WHEN typeof(created_at) IN ('integer', 'real') THEN datetime(created_at, 'unixepoch')
           ELSE datetime(created_at)
         END DESC
         LIMIT 10`,
      ).then((result: any) => (result?.rows || []) as RegistrationActivityRow[]).catch(() => [] as RegistrationActivityRow[]),
    ])

    const principalIds = new Set<string>()
    recentTrades.forEach((t: TradeActivityRow) => {
      if (t.buyer_agent_id) principalIds.add(t.buyer_agent_id)
      if (t.seller_agent_id) principalIds.add(t.seller_agent_id)
    })
    recentRatings.forEach((r: RatingActivityRow) => {
      if (r.rater_agent_id) principalIds.add(r.rater_agent_id)
      if (r.rated_agent_id) principalIds.add(r.rated_agent_id)
    })

    const principalRows = principalIds.size
      ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, Array.from(principalIds)))
      : []

    const nameById = new Map(principalRows.map((principal) => [principal.id, principal.name]))

    const tradeEvents: Array<ActivityEvent & { createdAt: Date }> = recentTrades
      .filter((t: TradeActivityRow) => safeDate(
        ['completed', 'complete', 'resolved'].includes(t.status) ? t.completed_at ?? t.created_at : t.created_at,
      ) !== null)
      .map((t: TradeActivityRow) => {
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

        const eventTimestamp = ['completed', 'complete', 'resolved'].includes(t.status)
          ? t.completed_at ?? t.created_at
          : t.created_at
        const createdAt = safeDate(eventTimestamp) as Date
        const ts = createdAt.toISOString()
        return {
          id: `trade_${t.id}_${type}`,
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
      .filter((r: RatingActivityRow) => safeDate(r.created_at) !== null)
      .map((r: RatingActivityRow) => {
        const agent = nameById.get(r.rated_agent_id) || `Agent ${shortId(r.rated_agent_id)}`
        const stars = '★'.repeat(Math.max(1, Math.min(5, Number(r.score) || 0)))
        const createdAt = safeDate(r.created_at) as Date
        const ts = createdAt.toISOString()
        return {
          id: `rating_${r.id}`,
          type: 'rating_received' as const,
          description: `Agent "${agent}" received a ${stars.padEnd(5, '☆')} rating`,
          agent_name: agent,
          timestamp: ts,
          relative: relativeTime(createdAt),
          createdAt,
        }
      })

    const registrationEvents: Array<ActivityEvent & { createdAt: Date }> = recentRegistrations
      .filter((a: RegistrationActivityRow) => safeDate(a.created_at) !== null)
      .map((a: RegistrationActivityRow) => {
        const createdAt = safeDate(a.created_at) as Date
        const ts = createdAt.toISOString()
        return {
          id: `registration_${a.id}`,
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
       ORDER BY CASE
         WHEN typeof(ai.created_at) IN ('integer', 'real') AND ai.created_at > 9999999999
           THEN datetime(ai.created_at / 1000, 'unixepoch')
         WHEN typeof(ai.created_at) IN ('integer', 'real') THEN datetime(ai.created_at, 'unixepoch')
         ELSE datetime(ai.created_at)
       END DESC
       LIMIT 10`
    ).catch(() => null)

    const improvementEvents: Array<ActivityEvent & { createdAt: Date }> = (improvementsResult?.rows || [])
      .filter((row: any) => safeDate(row.created_at) !== null)
      .map((row: any) => {
        const createdAt = safeDate(row.created_at) as Date
        const ts = createdAt.toISOString()
        const name = row.agent_name || 'Unknown Agent'
        return {
          id: `improvement_${row.id}`,
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
      .map(({ createdAt: _createdAt, ...event }) => event)

    return NextResponse.json(events, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error) {
    console.error('Activity fetch error:', error)
    return NextResponse.json([])
  }
}
