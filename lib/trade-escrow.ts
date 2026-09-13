import { Credential } from 'mppx';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { messages, mpp_sessions, trades, transactions, wallets, tasks, task_workspaces } from '@/lib/schema';
import { ensureTaskWorkspaceSchema } from '@/lib/task-workspace-schema';
import { encryptMessage } from '@/lib/chat-crypto';
import { deliverWebhookEvent } from '@/lib/webhook-delivery';
import { isExternallyFundedTrade } from '@/lib/trade-settlement-readiness';

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

/** Call only from inside an MPP handler, after the library has verified payment. */
export function attachVerifiedMppPrincipal<T extends Request>(request: T): T {
  const credential = Credential.fromRequest<any>(request);
  const payer = addressFromSource(credential.source ?? null);
  if (!payer) throw new Error('MPP credential must include a valid payer source address');
  const reference = credential?.payload?.hash || credential?.challenge?.id || crypto.randomUUID();
  (request as any).mppReceipt = { payer, reference: String(reference) };
  return request;
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
  await ensureTaskWorkspaceSchema();
  const now = Date.now();
  const ratingWindowIso = new Date(now + 72 * 60 * 60 * 1000).toISOString();
  const externalFunding = isExternallyFundedTrade(trade);

  const [updatedTrade] = await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(trades)
      .set({
        status: 'completed',
        completed_at: new Date(),
        payout_status: externalFunding ? 'pending' : 'complete',
        rating_window_expires_at: ratingWindowIso,
      })
      .where(and(eq(trades.id, trade.id), eq(trades.status, 'pending_release')))
      .returning();

    if (!updated) {
      throw new Error('TRADE_NOT_PENDING_RELEASE');
    }

    const [workspace] = await tx.select().from(task_workspaces).where(eq(task_workspaces.trade_id, trade.id)).limit(1);
    if (workspace) {
      await tx.update(tasks).set({ status: 'completed' })
        .where(and(eq(tasks.id, workspace.task_id), eq(tasks.status, 'assigned')));
    }

    await tx.insert(wallets).values({ user_id: trade.seller_id, balance: 0, escrow: 0 }).onConflictDoNothing();

    // On-chain purchases are held by the configured treasury. Ledger purchases
    // reserve the seller amount in the buyer's escrow balance.
    if (!externalFunding) {
      const released = await tx
        .update(wallets)
        .set({ escrow: sql`MAX(0, ${wallets.escrow} - ${trade.amount})` })
        .where(and(eq(wallets.user_id, trade.buyer_id), sql`${wallets.escrow} >= ${trade.amount}`))
        .returning({ user_id: wallets.user_id });
      if (released.length === 0) throw new Error('ESCROW_BALANCE_MISMATCH');
    }

    await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} + ${trade.amount}` })
      .where(eq(wallets.user_id, trade.seller_id));

    await tx.insert(transactions).values({
      from_user_id: trade.buyer_id,
      to_user_id: trade.seller_id,
      amount: trade.amount,
      type: 'escrow_release',
      reference_id: trade.id,
      memo: externalFunding
        ? 'Seller ledger claim recorded; external payout pending'
        : 'Sandbox ledger escrow released',
    });

    await tx
      .update(mpp_sessions)
      .set({ status: 'closed', closed_at: new Date() })
      .where(and(eq(mpp_sessions.session_id, trade.escrow_session_id || ''), eq(mpp_sessions.status, 'active')));

    return [updated];
  });

  const notifications: Promise<unknown>[] = [
    sendMessage(trade.seller_id, trade.buyer_id, {
      type: 'rating_request', trade_id: trade.id, counterpart_id: trade.seller_id, rating_window_expires_at: ratingWindowIso,
    }),
    sendMessage(trade.buyer_id, trade.seller_id, {
      type: 'rating_request', trade_id: trade.id, counterpart_id: trade.buyer_id, rating_window_expires_at: ratingWindowIso,
    }),
    sendMessage(trade.buyer_id, trade.seller_id, {
      type: 'trade_status_update', trade_id: trade.id, status: 'completed', reason,
    }),
    deliverWebhookEvent(trade.buyer_id, 'trade.status_changed', { trade_id: trade.id, old_status: 'pending_release', new_status: 'completed' }),
    deliverWebhookEvent(trade.seller_id, 'trade.status_changed', { trade_id: trade.id, old_status: 'pending_release', new_status: 'completed' }),
    deliverWebhookEvent(trade.buyer_id, 'trade.completed', {
      trade_id: trade.id,
      seller_credit_amount: trade.amount,
      payout_status: externalFunding ? 'pending' : 'complete',
    }),
    deliverWebhookEvent(trade.seller_id, 'trade.completed', {
      trade_id: trade.id,
      seller_credit_amount: trade.amount,
      payout_status: externalFunding ? 'pending' : 'complete',
    }),
  ];
  if (reason === 'auto_confirm') {
    notifications.push(
      deliverWebhookEvent(trade.buyer_id, 'trade.auto_confirmed', { trade_id: trade.id }),
      deliverWebhookEvent(trade.seller_id, 'trade.auto_confirmed', { trade_id: trade.id }),
    );
  }
  await Promise.allSettled(notifications);

  return updatedTrade;
}
