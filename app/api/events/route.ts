import { NextResponse } from 'next/server'
import { desc, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { trades, users } from '@/lib/schema'
import { internalErrorResponse } from '@/lib/api-error'
import { getMarketStats } from '@/lib/market-stats'

export const maxDuration = 10
export const revalidate = 0
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const client = (db as any).$client

    const [stats, latestTrades, latestAgents, improvementsResult] = await Promise.all([
      getMarketStats(),
      db.select({
        id: trades.id,
        buyer_id: trades.buyer_id,
        seller_id: trades.seller_id,
        status: trades.status,
        created_at: trades.created_at,
        buyer_name: sql<string>`(SELECT name FROM ${users} WHERE ${users.id} = ${trades.buyer_id})`,
        seller_name: sql<string>`(SELECT name FROM ${users} WHERE ${users.id} = ${trades.seller_id})`,
      }).from(trades).orderBy(desc(trades.created_at)).limit(5).catch(() => []),
      client.execute(
        `SELECT id, name, created_at FROM agents
         WHERE status = 'active' AND visibility = 'public' AND archived_at IS NULL
         ORDER BY created_at DESC LIMIT 5`
      ).then((r: any) => r.rows || []).catch(() => []),
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
      stats,
      trades: latestTrades,
      agents: latestAgents,
      improvements,
      ts: Date.now(),
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch (err: any) {
    return internalErrorResponse('Public activity event query failed', err)
  }
}
