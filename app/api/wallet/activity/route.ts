import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { walletPrincipal, walletError } from '@/lib/wallet-api'
import { latestActivitySql } from '@/lib/activity-query'
import { activityTimeline } from '@/lib/activity-timeline'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' }
const creditLabels: Record<string, string> = {
  deposit: 'Wallet deposit credited', transfer_out: 'Account credit sent', transfer_in: 'Account credit received',
  purchase: 'Purchase credit reserved', settlement: 'Purchase credit settled', sale: 'Sale credit received',
  fee: 'Market fee credited', session_fund: 'Instant session funded', session_refund: 'Instant session refunded',
}

/** Optional personal overlay. Anonymous requests receive no personal events. */
export async function GET(request: NextRequest) {
  try {
    const principal = await walletPrincipal(request)
    if (!principal) return NextResponse.json({ events: [] }, { headers })
    const ledger = await db.$client.execute({
      sql: latestActivitySql('SELECT id, kind, available_delta, escrow_delta, created_at FROM credit_entries WHERE user_id = ?', 'created_at'),
      args: [principal.userId],
    })
    const transfers = await db.$client.execute({
      sql: latestActivitySql(`SELECT s.id, s.kind, s.usd_amount, s.confirmed_at FROM settlement_transfers s
        JOIN trades t ON t.id = s.trade_id WHERE s.status = 'confirmed' AND s.tx_hash IS NOT NULL
        AND s.confirmed_at IS NOT NULL AND ((s.kind = 'seller_payout' AND t.seller_id = ?)
          OR (s.kind = 'buyer_refund' AND t.buyer_id = ?))`, 'confirmed_at'),
      args: [principal.userId, principal.userId],
    })
    const events = activityTimeline([
      ...ledger.rows.map(row => ({ id: `wallet_credit_${row.id}`, type: 'wallet_credit', personal: true,
        description: `${creditLabels[String(row.kind)] || 'Account credit updated'}: available ${Number(row.available_delta) >= 0 ? '+' : '-'}$${(Math.abs(Number(row.available_delta)) / 100).toFixed(2)}, escrow ${Number(row.escrow_delta) >= 0 ? '+' : '-'}$${(Math.abs(Number(row.escrow_delta)) / 100).toFixed(2)}`,
        timestamp: new Date(Number(row.event_at_ms)).toISOString() })),
      ...transfers.rows.map(row => ({ id: `wallet_settlement_${row.id}`,
        type: row.kind === 'buyer_refund' ? 'wallet_refund' : 'wallet_payout', personal: true,
        description: `Market ${row.kind === 'buyer_refund' ? 'refund' : 'payout'} confirmed: $${Number(row.usd_amount).toFixed(2)}`,
        timestamp: new Date(Number(row.event_at_ms)).toISOString() })),
    ])
    return NextResponse.json({ events }, { headers })
  } catch (error) {
    const response = walletError(error)
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
    return response
  }
}
