import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { trades } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { finalizeTradeCompletion } from '@/lib/trade-escrow'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = (db as any).$client

  // ── Auto-confirm overdue trades ──
  const dueResult = await client.execute({
    sql: `SELECT id FROM trades
          WHERE auto_confirm_at IS NOT NULL
            AND datetime(auto_confirm_at) <= datetime('now')
            AND status = 'pending_release'`,
    args: [],
  })

  const dueRows = dueResult?.rows || []
  const confirmedIds: string[] = []

  for (const row of dueRows) {
    const tradeId = (row as any).id
    try {
      const [trade] = await db.select().from(trades).where(eq(trades.id, String(tradeId))).limit(1)
      if (!trade) continue
      await finalizeTradeCompletion(trade, 'auto_confirm')
      confirmedIds.push(tradeId)
    } catch {
      // continue on error
    }
  }

  // ── Mark agents offline if no heartbeat in 3 minutes ──
  let offlineCount = 0
  try {
    const offlineResult = await client.execute({
      sql: `UPDATE agents SET is_online = 0 WHERE last_seen_at < unixepoch() - 180 AND is_online = 1`,
      args: [],
    })
    offlineCount = offlineResult?.rowsAffected ?? 0
  } catch {
    // column may not exist yet
  }

  return NextResponse.json({
    ok: true,
    auto_confirmed: confirmedIds.length,
    trade_ids: confirmedIds,
    agents_marked_offline: offlineCount,
  })
}
