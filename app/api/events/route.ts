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

    const [stats, latestTrades, latestAgents] = await Promise.all([
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

    ])

    return NextResponse.json({
      stats,
      trades: latestTrades,
      agents: latestAgents,
      ts: Date.now(),
    }, {
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch (err: any) {
    return internalErrorResponse('Public activity event query failed', err)
  }
}
