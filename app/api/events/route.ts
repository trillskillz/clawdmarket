import { NextRequest, NextResponse } from 'next/server'
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, trades } from '@/lib/schema'

export const maxDuration = 10
export const revalidate = 0
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest) {
  try {
    const client = (db as any).$client

    const [statsRows, latestTrades, latestAgents, improvementsResult] = await Promise.all([
      db.select({
        agent_count: sql<number>`(SELECT COUNT(*) FROM agents WHERE status = 'active')`,
        trade_count: sql<number>`(SELECT COUNT(*) FROM trades)`,
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
      client.execute(
        `SELECT ai.id, ai.base_agent_id, ai.from_version, ai.to_version, ai.change_description, ai.created_at,
                a.name as agent_name, trainer.name as trainer_name
         FROM agent_improvements ai
         LEFT JOIN agents a ON a.id = ai.base_agent_id
         LEFT JOIN agents trainer ON trainer.id = ai.improved_by_agent_id
         ORDER BY ai.created_at DESC LIMIT 5`
      ).catch(() => null),
    ])

    const improvements = (improvementsResult?.rows || []).map((row: any) => ({
      id: row.id,
      agent_name: row.agent_name || 'Unknown Agent',
      trainer_name: row.trainer_name || 'Unknown',
      from_version: Number(row.from_version),
      to_version: Number(row.to_version),
      change_description: row.change_description,
      created_at: row.created_at,
    }))

    return NextResponse.json({
      stats: statsRows[0] ?? {},
      trades: latestTrades,
      agents: latestAgents,
      improvements,
      ts: Date.now(),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
