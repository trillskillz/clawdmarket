import { Credential } from 'mppx';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { messages, mpp_sessions, trades } from '@/lib/schema';
import { encryptMessage } from '@/lib/chat-crypto';
import { deliverWebhookEvent } from '@/lib/webhook-delivery';

export function addressFromSource(source?: string | null) {
  if (!source) return null;
  const match = source.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0].toLowerCase() : null;
}

export function payerAddressFromRequest(request: Request) {
  try {
    const credential = Credential.fromRequest(request);
    return addressFromSource(credential.source ?? null);
  } catch {
    return null;
  }
}

export async function closeEscrowSession(sessionId?: string | null) {
  if (!sessionId) return;
  await db
    .update(mpp_sessions)
    .set({ status: 'closed', closed_at: new Date() })
    .where(and(eq(mpp_sessions.session_id, sessionId), eq(mpp_sessions.status, 'active')));
}

async function sendMessage(sender_id: string, receiver_id: string, payload: Record<string, any>) {
  const encrypted = await encryptMessage(JSON.stringify(payload));
  await db.insert(messages).values({
    sender_id,
    receiver_id,
    encrypted_content: encrypted.encrypted_content,
    nonce: encrypted.nonce,
  });
}

export async function finalizeTradeCompletion(trade: typeof trades.$inferSelect, reason: 'buyer_confirm' | 'auto_confirm') {
  const now = Date.now();
  const ratingWindowIso = new Date(now + 72 * 60 * 60 * 1000).toISOString();

  const [updatedTrade] = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(trades)
      .set({
        status: 'completed',
        completed_at: new Date(),
        payout_status: 'complete',
        rating_window_expires_at: ratingWindowIso,
      })
      .where(and(eq(trades.id, trade.id), eq(trades.status, 'pending_release')))
      .returning();

    if (!updated) {
      throw new Error('TRADE_NOT_PENDING_RELEASE');
    }

    await tx
      .update(mpp_sessions)
      .set({ status: 'closed', closed_at: new Date() })
      .where(and(eq(mpp_sessions.session_id, trade.escrow_session_id || ''), eq(mpp_sessions.status, 'active')));

    return [updated];
  });

  await sendMessage(trade.seller_id, trade.buyer_id, {
    type: 'rating_request',
    trade_id: trade.id,
    counterpart_id: trade.seller_id,
    rating_window_expires_at: ratingWindowIso,
  });

  await sendMessage(trade.buyer_id, trade.seller_id, {
    type: 'rating_request',
    trade_id: trade.id,
    counterpart_id: trade.buyer_id,
    rating_window_expires_at: ratingWindowIso,
  });

  await sendMessage(trade.buyer_id, trade.seller_id, {
    type: 'trade_status_update',
    trade_id: trade.id,
    status: 'completed',
    reason,
  });

  await deliverWebhookEvent(trade.buyer_id, 'trade.status_changed', { trade_id: trade.id, old_status: 'pending_release', new_status: 'completed' });
  await deliverWebhookEvent(trade.seller_id, 'trade.status_changed', { trade_id: trade.id, old_status: 'pending_release', new_status: 'completed' });
  await deliverWebhookEvent(trade.buyer_id, 'trade.completed', { trade_id: trade.id, settled_amount: trade.amount });
  await deliverWebhookEvent(trade.seller_id, 'trade.completed', { trade_id: trade.id, settled_amount: trade.amount });
  if (reason === 'auto_confirm') {
    await deliverWebhookEvent(trade.buyer_id, 'trade.auto_confirmed', { trade_id: trade.id });
    await deliverWebhookEvent(trade.seller_id, 'trade.auto_confirmed', { trade_id: trade.id });
  }

  return updatedTrade;
}
