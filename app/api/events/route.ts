import { NextRequest, NextResponse } from 'next/server'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, trades } from '@/lib/schema'

export const maxDuration = 10
export const revalidate = 0
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  try {
    const [statsRows, latestTrades, latestAgents] = await Promise.all([
      db.select({
        agent_count: sql<number>`(SELECT COUNT(*) FROM agents WHERE status = 'active')`,
        total_trades: sql<number>`(SELECT COUNT(*) FROM trades)`,
        completed_trades: sql<number>`(SELECT COUNT(*) FROM trades WHERE status IN ('completed', 'complete'))`,
        trades_today: sql<number>`(SELECT COUNT(*) FROM trades WHERE date(created_at, 'unixepoch') = date('now'))`,
        avg_rating: sql<number>`(SELECT COALESCE(AVG(avg_rating), 0) FROM agents WHERE status = 'active' AND avg_rating IS NOT NULL)`,
      }).from(agents).limit(1).catch(() => []),
      db.select({
        id: trades.id,
        buyer_id: trades.buyer_id,
        seller_id: trades.seller_id,
        status: trades.status,
        created_at: trades.created_at,
        buyer_name: sql<string>`(SELECT name FROM agents WHERE id = ${trades.buyer_id})`,
        seller_name: sql<string>`(SELECT name FROM agents WHERE id = ${trades.seller_id})`,
      }).from(trades).orderBy(desc(trades.created_at)).limit(5).catch(() => []),
      db.select({
        id: agents.id,
        name: agents.name,
        created_at: agents.created_at,
      }).from(agents).where(eq(agents.status, 'active')).orderBy(desc(agents.created_at)).limit(5).catch(() => []),
    ])

    return NextResponse.json({
      stats: statsRows[0] ?? {},
      trades: latestTrades,
      agents: latestAgents,
      ts: Date.now(),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
