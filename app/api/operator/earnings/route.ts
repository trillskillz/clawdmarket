import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet') || req.headers.get('x-wallet-address') || ''
  if (!wallet) {
    return NextResponse.json({ error: 'wallet query param or x-wallet-address header required' }, { status: 400 })
  }

  try {
    const client = (db as any).$client

    // Find all agent IDs owned by this wallet
    const agentsRes = await client.execute({
      sql: `SELECT id FROM agents WHERE owner_address = ?`,
      args: [wallet.toLowerCase()],
    })
    const agentIds = (agentsRes?.rows || []).map((r: any) => r.id)

    if (agentIds.length === 0) {
      return NextResponse.json({
        total_earned_usd: 0,
        total_spent_usd: 0,
        pending_usd: 0,
        completed_trades: 0,
        avg_trade_value: 0,
        last_payout_at: null,
        transactions: [],
      })
    }

    const placeholders = agentIds.map(() => '?').join(',')

    // Earnings: seller_amount from completed trades where agent is seller
    const earnedRes = await client.execute({
      sql: `SELECT COALESCE(SUM(CAST(seller_amount AS REAL)), 0) as total
            FROM trades WHERE seller_id IN (${placeholders}) AND status = 'completed'`,
      args: agentIds,
    })
    const totalEarned = Number((earnedRes?.rows?.[0] as any)?.total || 0)

    // Spent: amount from completed trades where agent is buyer
    const spentRes = await client.execute({
      sql: `SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total
            FROM trades WHERE buyer_id IN (${placeholders}) AND status = 'completed'`,
      args: agentIds,
    })
    const totalSpent = Number((spentRes?.rows?.[0] as any)?.total || 0)

    // Pending: from trades in escrow/in_progress
    const pendingRes = await client.execute({
      sql: `SELECT COALESCE(SUM(CAST(amount AS REAL)), 0) as total
            FROM trades WHERE (seller_id IN (${placeholders}) OR buyer_id IN (${placeholders}))
            AND status IN ('escrow', 'in_progress', 'escrow_held')`,
      args: [...agentIds, ...agentIds],
    })
    const pendingUsd = Number((pendingRes?.rows?.[0] as any)?.total || 0)

    // Completed trade count
    const countRes = await client.execute({
      sql: `SELECT COUNT(*) as count FROM trades
            WHERE (seller_id IN (${placeholders}) OR buyer_id IN (${placeholders}))
            AND status = 'completed'`,
      args: [...agentIds, ...agentIds],
    })
    const completedTrades = Number((countRes?.rows?.[0] as any)?.count || 0)

    const avgTradeValue = completedTrades > 0 ? Math.round(((totalEarned + totalSpent) / completedTrades) * 100) / 100 : 0

    // Last payout
    const payoutRes = await client.execute({
      sql: `SELECT MAX(completed_at) as last FROM trades
            WHERE seller_id IN (${placeholders}) AND status = 'completed' AND payout_status = 'complete'`,
      args: agentIds,
    })
    const lastPayoutAt = (payoutRes?.rows?.[0] as any)?.last || null

    // Last 20 transactions
    const txRes = await client.execute({
      sql: `SELECT id, buyer_id, seller_id, amount, status, created_at
            FROM trades
            WHERE seller_id IN (${placeholders}) OR buyer_id IN (${placeholders})
            ORDER BY created_at DESC LIMIT 20`,
      args: [...agentIds, ...agentIds],
    })
    const transactions = (txRes?.rows || []).map((r: any) => ({
      trade_id: r.id,
      role: agentIds.includes(r.seller_id) ? 'SELLER' : 'BUYER',
      amount: Number(r.amount || 0),
      status: r.status,
      created_at: r.created_at,
    }))

    return NextResponse.json({
      total_earned_usd: Math.round(totalEarned * 100) / 100,
      total_spent_usd: Math.round(totalSpent * 100) / 100,
      pending_usd: Math.round(pendingUsd * 100) / 100,
      completed_trades: completedTrades,
      avg_trade_value: avgTradeValue,
      last_payout_at: lastPayoutAt,
      transactions,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
