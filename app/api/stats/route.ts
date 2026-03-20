import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agents, trades, ratings, payment_receipts, tasks } from '@/lib/schema'
import { eq, or, sql } from 'drizzle-orm'

export async function GET(_req: NextRequest) {
  const [{ agent_count = 1 } = { agent_count: 1 }] = await db
    .select({ agent_count: sql<number>`COALESCE(COUNT(*), 0)` })
    .from(agents)
    .where(eq(agents.status, 'active'))
    .catch(() => [{ agent_count: 1 }])

  const [{ total_trades = 0 } = { total_trades: 0 }] = await db
    .select({ total_trades: sql<number>`COALESCE(COUNT(*), 0)` })
    .from(trades)
    .catch(() => [{ total_trades: 0 }])

  const [{ completed_trades = 0 } = { completed_trades: 0 }] = await db
    .select({ completed_trades: sql<number>`COALESCE(COUNT(*), 0)` })
    .from(trades)
    .where(or(eq(trades.status, 'completed'), eq(trades.status, 'complete')))
    .catch(() => [{ completed_trades: 0 }])

  const [{ total_volume_usd = 0 } = { total_volume_usd: 0 }] = await db
    .select({ total_volume_usd: sql<number>`COALESCE(SUM(${payment_receipts.usd_value_at_payment}), 0)` })
    .from(payment_receipts)
    .catch(() => [{ total_volume_usd: 0 }])

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

  return NextResponse.json({
    agent_count: Number(agent_count || 0),
    total_trades: Number(total_trades || 0),
    completed_trades: Number(completed_trades || 0),
    total_volume_usd: Number(total_volume_usd || 0),
    platform_fees_usd: Number((Number(total_volume_usd || 0) * 0.05).toFixed(2)),
    avg_rating: avg_rating === null ? null : Number(avg_rating),
    volume_last_24h: Number(volume_last_24h || 0),

    agents_registered: Number(agent_count || 0),
    trade_count: Number(completed_trades || 0),
    transactions_settled: Number(completed_trades || 0),
    agents_online: Number(agent_count || 0),
    trades_today: 0,
    volume_24h: Number(volume_last_24h || 0),
    waitlist_count: 0,
    services_listed: 0,
    volume_by_rail: { mpp: 0, x402: 0 },
    solana_volume_usd: 0,
    solana_tx_count: 0,
    bitcoin_volume_usd: 0,
    bitcoin_tx_count: 0,
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
    payment_methods: ['mpp', 'x402', 'evm', 'solana', 'bitcoin'],
    platform_fee_pct: 5,
    self_improvement_supported: true,
    versioning_supported: true,
  })
}
