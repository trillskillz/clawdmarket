import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { messages, mpp_sessions, trades, transactions, wallets } from '@/lib/schema'
import { encryptMessage } from '@/lib/chat-crypto'
import { deliverWebhookEvent } from '@/lib/webhook-delivery'
import { isExternallyFundedTrade } from '@/lib/trade-settlement-readiness'

export type TradeResolution = 'buyer' | 'seller' | 'split'

export async function finalizeTradeDispute(
  trade: typeof trades.$inferSelect,
  resolution: TradeResolution,
  splitPercent: number,
  messageSenderId?: string,
) {
  const sellerShare = Math.round(trade.amount * (splitPercent / 100) * 100) / 100
  const buyerShare = Math.round((trade.amount - sellerShare) * 100) / 100
  const externalFunding = isExternallyFundedTrade(trade)

  const updated = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(trades)
      .set({
        status: 'resolved',
        resolution,
        resolution_seller_percent: splitPercent,
        payout_status: 'complete',
        completed_at: new Date(),
      })
      .where(and(eq(trades.id, trade.id), eq(trades.status, 'disputed')))
      .returning()
    if (!claimed) return null

    if (!externalFunding) {
      await tx.insert(wallets).values({ user_id: trade.buyer_id, balance: 0, escrow: 0 }).onConflictDoNothing()
      await tx.insert(wallets).values({ user_id: trade.seller_id, balance: 0, escrow: 0 }).onConflictDoNothing()
      const released = await tx.update(wallets)
        .set({ escrow: sql`${wallets.escrow} - ${trade.amount}` })
        .where(and(eq(wallets.user_id, trade.buyer_id), sql`${wallets.escrow} >= ${trade.amount}`))
        .returning({ user_id: wallets.user_id })
      if (!released.length) throw new Error('ESCROW_BALANCE_MISMATCH')
    }

    if (buyerShare > 0) {
      if (!externalFunding) await tx.update(wallets).set({ balance: sql`${wallets.balance} + ${buyerShare}` }).where(eq(wallets.user_id, trade.buyer_id))
      await tx.insert(transactions).values({
        from_user_id: null,
        to_user_id: trade.buyer_id,
        amount: buyerShare,
        type: 'escrow_refund',
        reference_id: trade.id,
        memo: externalFunding ? `Dispute resolved: ${resolution}; external refund confirmed` : `Dispute resolved: ${resolution}`,
      })
    }
    if (sellerShare > 0) {
      if (!externalFunding) await tx.update(wallets).set({ balance: sql`${wallets.balance} + ${sellerShare}` }).where(eq(wallets.user_id, trade.seller_id))
      await tx.insert(transactions).values({
        from_user_id: trade.buyer_id,
        to_user_id: trade.seller_id,
        amount: sellerShare,
        type: 'escrow_release',
        reference_id: trade.id,
        memo: externalFunding ? `Dispute resolved: ${resolution}; external seller payout confirmed` : `Dispute resolved: ${resolution}`,
      })
    }
    await tx.update(mpp_sessions).set({ status: 'closed', closed_at: new Date() })
      .where(and(eq(mpp_sessions.session_id, trade.escrow_session_id || ''), eq(mpp_sessions.status, 'active')))
    return claimed
  })

  if (!updated) return null

  const notifications: Promise<unknown>[] = [
    deliverWebhookEvent(trade.buyer_id, 'trade.status_changed', { trade_id: trade.id, old_status: 'disputed', new_status: 'resolved', resolution }),
    deliverWebhookEvent(trade.seller_id, 'trade.status_changed', { trade_id: trade.id, old_status: 'disputed', new_status: 'resolved', resolution }),
  ]
  if (messageSenderId) {
    const buyerMessage = await encryptMessage(JSON.stringify({ type: 'trade_status_update', trade_id: trade.id, status: 'resolved', resolution }))
    const sellerMessage = await encryptMessage(JSON.stringify({ type: 'trade_status_update', trade_id: trade.id, status: 'resolved', resolution }))
    notifications.push(db.insert(messages).values([
      { sender_id: messageSenderId, receiver_id: trade.buyer_id, encrypted_content: buyerMessage.encrypted_content, nonce: buyerMessage.nonce },
      { sender_id: messageSenderId, receiver_id: trade.seller_id, encrypted_content: sellerMessage.encrypted_content, nonce: sellerMessage.nonce },
    ]))
  }
  await Promise.allSettled(notifications)
  return { trade: updated, distribution: { buyer: buyerShare, seller: sellerShare } }
}
