import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents, trades, ratings, payment_receipts, tasks, listings } from '@/lib/schema'
import { eq, or, sql } from 'drizzle-orm'
import { getTradeSettlementReadiness } from '@/lib/trade-settlement-readiness'

export const dynamic = 'force-dynamic'

async function getVolumeByRail() {
  const defaults = { ledger: 0, mpp: 0, evm: 0 }
  try {
    const client = (db as any).$client
    const result = await client.execute(
      `SELECT payment_rail, COALESCE(SUM(amount), 0) as volume
       FROM trades
       WHERE status = 'completed' AND payment_rail IS NOT NULL
       GROUP BY payment_rail`
    )
    for (const row of (result?.rows || [])) {
      const rail = String(row.payment_rail || '').toLowerCase()
      if (rail in defaults) {
        (defaults as any)[rail] = Number(Number(row.volume || 0).toFixed(2))
      }
    }
  } catch { /* column may not exist yet */ }
  return defaults
}

export async function GET() {
  const [{ agent_count = 1 } = { agent_count: 1 }] = await db
    .select({ agent_count: sql<number>`COALESCE(COUNT(*), 0)` })
    .from(agents)
    .where(eq(agents.status, 'active'))
    .catch(() => [{ agent_count: 1 }])

  const [{ agents_online = 0 } = { agents_online: 0 }] = await db
    .select({
      agents_online: sql<number>`COALESCE(SUM(CASE
        WHEN ${agents.status} = 'active'
          AND ${agents.isOnline} = 1
          AND ${agents.lastSeenAt} >= unixepoch() - 180
        THEN 1 ELSE 0 END), 0)`,
    })
    .from(agents)
    .catch(() => [{ agents_online: 0 }])

  const [{ total_trades = 0 } = { total_trades: 0 }] = await db
    .select({ total_trades: sql<number>`COALESCE(COUNT(*), 0)` })
    .from(trades)
    .catch(() => [{ total_trades: 0 }])

  const [{ completed_trades = 0 } = { completed_trades: 0 }] = await db
    .select({ completed_trades: sql<number>`COALESCE(COUNT(*), 0)` })
    .from(trades)
    .where(or(eq(trades.status, 'completed'), eq(trades.status, 'complete')))
    .catch(() => [{ completed_trades: 0 }])

  const [{ trade_volume_usd = 0 } = { trade_volume_usd: 0 }] = await db
    .select({ trade_volume_usd: sql<number>`COALESCE(SUM(${trades.amount}), 0)` })
    .from(trades)
    .where(or(eq(trades.status, 'completed'), eq(trades.status, 'complete')))
    .catch(() => [{ trade_volume_usd: 0 }])

  const [{ receipt_volume_usd = 0 } = { receipt_volume_usd: 0 }] = await db
    .select({ receipt_volume_usd: sql<number>`COALESCE(SUM(${payment_receipts.usd_value_at_payment}), 0)` })
    .from(payment_receipts)
    .catch(() => [{ receipt_volume_usd: 0 }])

  const total_volume_usd = Number(trade_volume_usd || 0)
  const resolved_volume = total_volume_usd > 0 ? total_volume_usd : Number(receipt_volume_usd || 0)

  const [{ avg_rating = null } = { avg_rating: null as number | null }] = await db
    .select({ avg_rating: sql<number | null>`AVG(${ratings.score})` })
    .from(ratings)
    .catch(() => [{ avg_rating: null }])

  const [{ volume_last_24h = 0 } = { volume_last_24h: 0 }] = await db
    .select({ volume_last_24h: sql<number>`COALESCE(SUM(CASE WHEN ${payment_receipts.created_at} >= datetime('now', '-1 day') THEN ${payment_receipts.usd_value_at_payment} ELSE 0 END), 0)` })
    .from(payment_receipts)
    .catch(() => [{ volume_last_24h: 0 }])

  const [{ total_tasks = 2 } = { total_tasks: 2 }] = await db
    .select({ total_tasks: sql<number>`COALESCE(COUNT(*), 0)` })
    .from(tasks)
    .catch(() => [{ total_tasks: 2 }])

  const [{ services_listed = 0, services_online = 0, marketplace_profile_count = 0 } = { services_listed: 0, services_online: 0, marketplace_profile_count: 0 }] = await db
    .select({
      services_listed: sql<number>`COALESCE(COUNT(*), 0)`,
      services_online: sql<number>`COALESCE(SUM(CASE WHEN ${listings.status} = 'active' THEN 1 ELSE 0 END), 0)`,
      marketplace_profile_count: sql<number>`COALESCE(COUNT(DISTINCT CASE WHEN ${listings.status} = 'active' THEN ${listings.seller_id} END), 0)`,
    })
    .from(listings)
    .catch(() => [{ services_listed: 0, services_online: 0, marketplace_profile_count: 0 }])

  const [{ trades_today = 0 } = { trades_today: 0 }] = await db
    .select({ trades_today: sql<number>`(SELECT COUNT(*) FROM trades WHERE date(
      CASE
        WHEN typeof(created_at) IN ('integer', 'real') AND created_at > 9999999999 THEN datetime(created_at / 1000, 'unixepoch')
        WHEN typeof(created_at) IN ('integer', 'real') THEN datetime(created_at, 'unixepoch')
        ELSE datetime(created_at)
      END
    ) = date('now'))` })
    .from(trades)
    .limit(1)
    .catch(() => [{ trades_today: 0 }])

  const settlement = getTradeSettlementReadiness()
  const paymentMethods = [
    ...(settlement.ledger.enabled ? ['ledger'] : []),
    ...(settlement.mpp.enabled ? ['mpp'] : []),
    ...(settlement.evm.enabled ? ['evm'] : []),
  ]

  return NextResponse.json({
    agent_count: Number(agent_count || 0),
    total_trades: Number(total_trades || 0),
    completed_trades: Number(completed_trades || 0),
    total_volume_usd: resolved_volume,
    trade_volume_usd: Number(trade_volume_usd || 0),
    platform_fees_usd: Number((resolved_volume * 0.05).toFixed(2)),
    avg_rating: avg_rating === null ? null : Number(avg_rating),
    volume_last_24h: Number(volume_last_24h || 0),

    agents_registered: Number(agent_count || 0),
    trade_count: Number(completed_trades || 0),
    transactions_settled: Number(completed_trades || 0),
    agents_online: Number(agents_online || 0),
    trades_today: Number(trades_today || 0),
    volume_24h: Number(volume_last_24h || 0),
    waitlist_count: 0,
    marketplace_profile_count: Number(marketplace_profile_count || 0),
    services_listed: Number(services_listed || 0),
    services_online: Number(services_online || 0),
    volume_by_rail: await getVolumeByRail(),
    total_tasks: Number(total_tasks || 0),

    discovery: {
      llms_txt: 'https://clawdmkt.com/llms.txt',
      mpp_descriptor: 'https://clawdmkt.com/.well-known/mpp.json',
      agent_card: 'https://clawdmkt.com/.well-known/agent.json',
      mcp_server: 'https://clawdmkt.com/api/mcp',
      capabilities: 'https://clawdmkt.com/api/capabilities',
      wallets: 'https://clawdmkt.com/api/wallets',
      spec: 'https://clawdmkt.com/agent-spec.json',
    },
    payment_methods: paymentMethods,
    platform_fee_pct: 5,
    self_improvement_supported: true,
    versioning_supported: true,
    updated_at: new Date().toISOString(),
  })
}
