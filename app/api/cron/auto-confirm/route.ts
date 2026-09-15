import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { trades } from '@/lib/schema'
import { and, eq } from 'drizzle-orm'
import { finalizeTradeCompletion } from '@/lib/trade-escrow'
import { isExternallyFundedTrade } from '@/lib/trade-settlement-readiness'
import { processPendingSettlementTransfers, refundCancelledExternalTrade, settleExternallyFundedTrade } from '@/lib/external-settlement'
import { expireTradePayment } from '@/lib/trade-funding'
import { finalizeTradeDispute, type TradeResolution } from '@/lib/trade-dispute'
import { internalErrorResponse, reportInternalError } from '@/lib/api-error'
import { logger } from '@/lib/logger'
import { AGENT_ONLINE_WINDOW_SECONDS } from '@/lib/agent-presence'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || ''
  const expected = process.env.CRON_SECRET
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
  const client = (db as any).$client

  const transferBatch = await processPendingSettlementTransfers(10, 5_000)
  const failures = {
    requested_settlements: 0,
    disputed_settlements: 0,
    refunds: 0,
    auto_confirmations: 0,
    offline_updates: 0,
  }

  const expiredResult = await client.execute({
    sql: `SELECT id FROM trades WHERE payment_due_at IS NOT NULL AND datetime(payment_due_at) <= datetime('now') AND status = 'pending'`,
    args: [],
  })
  const expiredIds: string[] = []
  for (const row of expiredResult?.rows || []) {
    const [trade] = await db.select().from(trades).where(eq(trades.id, String((row as any).id))).limit(1)
    if (trade && await expireTradePayment(trade)) expiredIds.push(trade.id)
  }

  const requestedResult = await client.execute({
    sql: `SELECT id FROM trades WHERE status = 'pending_release' AND payout_status = 'processing' LIMIT 20`,
    args: [],
  })
  const settledIds: string[] = []
  for (const row of requestedResult?.rows || []) {
    const [trade] = await db.select().from(trades).where(eq(trades.id, String((row as any).id))).limit(1)
    if (!trade || !isExternallyFundedTrade(trade)) continue
    try {
      const settlement = await settleExternallyFundedTrade(trade, 100, { process: false })
      if (settlement.complete) {
        await finalizeTradeCompletion(trade, 'buyer_confirm')
        settledIds.push(trade.id)
      }
    } catch (error) {
      failures.requested_settlements += 1
      reportInternalError('Requested external settlement retry failed', error, { trade_id: trade.id })
      // Retained for the next retry; the durable transfer records preserve idempotency.
    }
  }

  const disputedResult = await client.execute({
    sql: `SELECT id FROM trades WHERE status = 'disputed' AND payout_status = 'processing' AND resolution IS NOT NULL AND resolution_seller_percent IS NOT NULL LIMIT 20`,
    args: [],
  })
  const resolvedIds: string[] = []
  for (const row of disputedResult?.rows || []) {
    const [trade] = await db.select().from(trades).where(eq(trades.id, String((row as any).id))).limit(1)
    if (!trade || !isExternallyFundedTrade(trade) || trade.resolution_seller_percent == null || !trade.resolution) continue
    try {
      const settlement = await settleExternallyFundedTrade(trade, trade.resolution_seller_percent, { process: false })
      if (!settlement.complete) continue
      const finalized = await finalizeTradeDispute(trade, trade.resolution as TradeResolution, trade.resolution_seller_percent)
      if (finalized) resolvedIds.push(trade.id)
    } catch (error) {
      failures.disputed_settlements += 1
      reportInternalError('Disputed external settlement retry failed', error, { trade_id: trade.id })
      // Retained for the next retry; the durable transfer records preserve idempotency.
    }
  }

  const refundResult = await client.execute({
    sql: `SELECT id FROM trades WHERE status = 'cancelled' AND payout_status = 'processing' LIMIT 20`,
    args: [],
  })
  const refundedIds: string[] = []
  for (const row of refundResult?.rows || []) {
    const [trade] = await db.select().from(trades).where(eq(trades.id, String((row as any).id))).limit(1)
    if (!trade || !isExternallyFundedTrade(trade)) continue
    try {
      const refund = await refundCancelledExternalTrade(trade, { process: false })
      if (refund.complete) refundedIds.push(trade.id)
    } catch (error) {
      failures.refunds += 1
      reportInternalError('External refund retry failed', error, { trade_id: trade.id })
      // Retained for the next retry; the durable transfer records preserve idempotency.
    }
  }

  // ── Auto-confirm overdue trades ──
  const dueResult = await client.execute({
    sql: `SELECT id FROM trades
          WHERE auto_confirm_at IS NOT NULL
            AND datetime(auto_confirm_at) <= datetime('now')
            AND status = 'pending_release'
          LIMIT 5`,
    args: [],
  })

  const dueRows = dueResult?.rows || []
  const confirmedIds: string[] = []

  for (const row of dueRows) {
    const tradeId = (row as any).id
    try {
      let [trade] = await db.select().from(trades).where(eq(trades.id, String(tradeId))).limit(1)
      if (!trade) continue
      if (isExternallyFundedTrade(trade)) {
        const [claimed] = await db.update(trades).set({ payout_status: 'processing' })
          .where(and(eq(trades.id, trade.id), eq(trades.status, 'pending_release'), eq(trades.payout_status, 'pending')))
          .returning()
        if (!claimed) continue
        trade = claimed
        const settlement = await settleExternallyFundedTrade(trade, 100, { waitMs: 5_000 })
        if (!settlement.complete) continue
      }
      await finalizeTradeCompletion(trade, 'auto_confirm')
      confirmedIds.push(tradeId)
    } catch (error) {
      failures.auto_confirmations += 1
      reportInternalError('Trade auto-confirmation failed', error, { trade_id: String(tradeId) })
    }
  }

  // ── Mark agents offline if no heartbeat in 3 minutes ──
  let offlineCount = 0
  try {
    const offlineResult = await client.execute({
      sql: `UPDATE agents SET is_online = 0 WHERE last_seen_at < unixepoch() - ? AND is_online = 1`,
      args: [AGENT_ONLINE_WINDOW_SECONDS],
    })
    offlineCount = offlineResult?.rowsAffected ?? 0
  } catch (error) {
    failures.offline_updates += 1
    reportInternalError('Offline agent update failed', error)
  }

  const failureCount = transferBatch.failed + Object.values(failures).reduce((sum, count) => sum + count, 0)
  if (failureCount > 0) {
    logger.warn('Auto-confirm cron completed with retained failures', {
      failure_count: failureCount,
      settlement_transfers: transferBatch,
      ...failures,
    })
  }

  return NextResponse.json({
    ok: failureCount === 0,
    auto_confirmed: confirmedIds.length,
    trade_ids: confirmedIds,
    payment_intents_expired: expiredIds.length,
    expired_trade_ids: expiredIds,
    requested_settlements_completed: settledIds.length,
    disputed_settlements_completed: resolvedIds.length,
    resolved_trade_ids: resolvedIds,
    late_payments_refunded: refundedIds.length,
    refunded_trade_ids: refundedIds,
    settlement_transfers: transferBatch,
    agents_marked_offline: offlineCount,
    failures,
    failure_count: failureCount,
  })
  } catch (error) {
    return internalErrorResponse('Auto-confirm cron failed', error, {
      code: 'auto_confirm_failed',
      message: 'The settlement maintenance run failed. Use the error ID to inspect server logs.',
    })
  }
}
