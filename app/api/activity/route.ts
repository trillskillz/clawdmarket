import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { activityDate as safeDate, activityTimeline } from '@/lib/activity-timeline'
import { latestActivitySql } from '@/lib/activity-query'
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from '@/lib/constants'
import historicalPayments from '@/lib/historical-mpp-proofs.json'
import { inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { publicTradeWhereSql } from '@/lib/public-trade-visibility'
import { users } from '@/lib/schema'

export const dynamic = 'force-dynamic'

type ActivityEvent = {
  id: string
  type: 'trade_created' | 'trade_completed' | 'trade_disputed' | 'trade_confirmed' | 'rating_received' | 'agent_registered' | 'account_registered' | 'wallet_payment' | 'wallet_payout' | 'wallet_refund'
  description: string
  buyer_name?: string | null
  seller_name?: string | null
  agent_name?: string | null
  agents?: Array<{ id: string; name: string }>
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

type AccountRegistrationRow = RegistrationActivityRow & { role: string }

function shortId(id?: string | null) {
  return id ? id.slice(0, 8) : 'unknown'
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

    const rows = async (query: string, timestamp = 'created_at') =>
      (await client.execute(latestActivitySql(query, timestamp))).rows as any[]
    const [recentTrades, recentRatings, recentRegistrations, recentAgentAccounts, receipts, settlements] = await Promise.all([
      rows(`SELECT id, status, created_at, completed_at,
        buyer_id AS buyer_agent_id, seller_id AS seller_agent_id FROM trades
        WHERE ${publicTradeWhereSql('trades')}`,
        "CASE WHEN status IN ('completed', 'complete', 'resolved') THEN COALESCE(completed_at, created_at) ELSE created_at END"),
      rows(`SELECT id, score, created_at, rater_id AS rater_agent_id, rated_id AS rated_agent_id
        FROM ratings WHERE EXISTS (SELECT 1 FROM trades WHERE trades.id = ratings.trade_id AND ${publicTradeWhereSql('trades')})`),
      rows(`SELECT id, name, created_at FROM agents WHERE visibility = 'public' AND archived_at IS NULL
        AND status IN ('active', 'inactive')`),
      rows(`SELECT id, name, role, created_at FROM users WHERE role IN ('human', 'agent')
        AND substr(id, 1, 11) <> 'user_agent_' AND id NOT GLOB 'user_wallet_*' AND COALESCE(is_banned, 0) = 0`),
      rows(`SELECT p.id, p.amount, p.currency, p.created_at FROM payment_receipts p JOIN trades t ON t.id = p.trade_id
        WHERE ${publicTradeWhereSql('t')}
        UNION ALL SELECT ('platform_' || lower(p.tx_hash)) AS id, p.amount, p.currency, p.created_at
        FROM payment_receipts p WHERE p.trade_id IS NULL AND p.route = '/api/mcp' AND p.payment_rail = 'mpp'
          AND p.chain_id = ${TEMPO_CHAIN_ID} AND p.token_address = '${PATHUSD_ADDRESS}' AND p.currency = 'pathUSD'
          AND p.amount > 0 AND length(p.tx_hash) = 66 AND substr(p.tx_hash, 1, 2) = '0x'
          AND substr(p.tx_hash, 3) NOT GLOB '*[^a-fA-F0-9]*'`),
      rows(`SELECT s.id, s.kind, s.usd_amount, s.confirmed_at FROM settlement_transfers s JOIN trades t ON t.id = s.trade_id
        WHERE s.status = 'confirmed' AND s.tx_hash IS NOT NULL AND s.confirmed_at IS NOT NULL AND ${publicTradeWhereSql('t')}`, 'confirmed_at'),
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
      ? await db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(inArray(users.id, Array.from(principalIds)))
      : []

    const nameById = new Map(principalRows.map((principal) => [principal.id, principal.role === 'agent' ? principal.name : 'Member']))

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
          description = `Agent "${buyer}" completed a trade with "${seller}"${t.completed_at == null ? ' (trade creation date)' : ''}`
        } else if (t.status === 'disputed') {
          type = 'trade_disputed'
          description = `Trade between "${buyer}" and "${seller}" is disputed (trade creation date)`
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
          agents: [{ id: a.id, name: a.name || `Agent ${shortId(a.id)}` }],
          timestamp: ts,
          relative: relativeTime(createdAt),
          createdAt,
        }
      })

    const accountRegistrationEvents: Array<ActivityEvent & { createdAt: Date }> = recentAgentAccounts
      .filter((account: AccountRegistrationRow) => safeDate(account.created_at) !== null)
      .map((account: AccountRegistrationRow) => {
        const createdAt = safeDate(account.created_at) as Date
        const name = account.name || `Agent ${shortId(account.id)}`
        return {
          id: account.role === 'human' ? `account_registration_${createHash('sha256').update(account.id).digest('hex')}` : `account_registration_${account.id}`,
          type: account.role === 'human' ? 'account_registered' as const : 'agent_registered' as const,
          description: account.role === 'human' ? 'New member account registered' : `New agent account "${name}" joined`,
          ...(account.role === 'human' ? {} : { agent_name: name }),
          timestamp: createdAt.toISOString(),
          relative: relativeTime(createdAt),
          createdAt,
        }
      })

    const paymentEvents: ActivityEvent[] = [
      ...historicalPayments.map(proof => ({ id: `wallet_payment_platform_${proof.tx_hash.toLowerCase()}`, type: 'wallet_payment' as const,
        description: `Platform payment confirmed: ${proof.amount.toFixed(3)} pathUSD (MPP on Tempo)`,
        timestamp: new Date(proof.created_at * 1000).toISOString(), relative: relativeTime(proof.created_at * 1000) })),
      ...receipts.map((row: any) => ({ id: `wallet_payment_${row.id}`, type: 'wallet_payment' as const,
        description: row.id.startsWith('platform_') ? `Platform payment confirmed: ${Number(row.amount).toFixed(3)} pathUSD (MPP on Tempo)`
          : `Market payment recorded: ${Number(row.amount).toFixed(2)} ${row.currency}`,
        timestamp: new Date(Number(row.event_at_ms)).toISOString(), relative: relativeTime(Number(row.event_at_ms)) })),
      ...settlements.map((row: any) => ({ id: `wallet_settlement_${row.id}`,
        type: row.kind === 'buyer_refund' ? 'wallet_refund' as const : 'wallet_payout' as const,
        description: `Market ${row.kind === 'buyer_refund' ? 'refund' : 'payout'} confirmed: $${Number(row.usd_amount).toFixed(2)}`,
        timestamp: new Date(Number(row.event_at_ms)).toISOString(), relative: relativeTime(Number(row.event_at_ms)) })),
    ]
    const events = activityTimeline([...tradeEvents, ...ratingEvents, ...registrationEvents,
      ...accountRegistrationEvents, ...paymentEvents])
      .map(({ createdAt: _createdAt, ...event }: any) => event)

    return NextResponse.json(events, {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch {
    console.error('Activity timeline could not be read')
    return NextResponse.json({ error: 'Activity temporarily unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
