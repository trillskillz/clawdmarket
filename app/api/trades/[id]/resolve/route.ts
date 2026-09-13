import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { messages, mpp_sessions, trades, transactions, wallets } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { encryptMessage } from '@/lib/chat-crypto';
import { deliverWebhookEvent } from '@/lib/webhook-delivery';
import { authenticateRequest } from '@/lib/auth';
import { authorizeAdmin } from '@/lib/admin-auth';
import { validateCsrf } from '@/lib/csrf';
import { isExternallyFundedTrade } from '@/lib/trade-settlement-readiness';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid trade ID' }, { status: 400 });

  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  const authError = authorizeAdmin(auth ? { userId: auth.userId, email: auth.email } : null);
  if (authError) return authError;
  if (!authHeader && !validateCsrf(req)) return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const resolution = body?.resolution;
  if (!['buyer', 'seller', 'split'].includes(resolution)) {
    return NextResponse.json({ error: 'Invalid resolution' }, { status: 400 });
  }
  const splitPercent = resolution === 'split' ? Number(body?.split_percent_to_seller ?? 50) : resolution === 'seller' ? 100 : 0;
  if (!Number.isFinite(splitPercent) || splitPercent < 0 || splitPercent > 100) {
    return NextResponse.json({ error: 'split_percent_to_seller must be between 0 and 100' }, { status: 400 });
  }

  try {
    const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
    if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    if (trade.status !== 'disputed') return NextResponse.json({ error: 'Trade is not disputed' }, { status: 400 });

    const sellerShare = Math.round(trade.amount * (splitPercent / 100) * 100) / 100;
    const buyerShare = Math.round((trade.amount - sellerShare) * 100) / 100;
    const externalFunding = isExternallyFundedTrade(trade);

    const updated = await db.transaction(async (tx) => {
      const [claimed] = await tx.update(trades)
        .set({ status: 'resolved', resolution, payout_status: externalFunding ? 'pending' : 'complete', completed_at: new Date() })
        .where(and(eq(trades.id, trade.id), eq(trades.status, 'disputed')))
        .returning();
      if (!claimed) return null;

      await tx.insert(wallets).values({ user_id: trade.buyer_id, balance: 0, escrow: 0 }).onConflictDoNothing();
      await tx.insert(wallets).values({ user_id: trade.seller_id, balance: 0, escrow: 0 }).onConflictDoNothing();

      if (!externalFunding) {
        const released = await tx.update(wallets)
          .set({ escrow: sql`${wallets.escrow} - ${trade.amount}` })
          .where(and(eq(wallets.user_id, trade.buyer_id), sql`${wallets.escrow} >= ${trade.amount}`))
          .returning({ user_id: wallets.user_id });
        if (released.length === 0) throw new Error('ESCROW_BALANCE_MISMATCH');
      }

      if (buyerShare > 0) {
        await tx.update(wallets).set({ balance: sql`${wallets.balance} + ${buyerShare}` }).where(eq(wallets.user_id, trade.buyer_id));
        await tx.insert(transactions).values({
          from_user_id: null,
          to_user_id: trade.buyer_id,
          amount: buyerShare,
          type: 'escrow_refund',
          reference_id: trade.id,
          memo: externalFunding
            ? `Dispute resolved: ${resolution}; external refund pending`
            : `Sandbox dispute resolved: ${resolution}`,
        });
      }
      if (sellerShare > 0) {
        await tx.update(wallets).set({ balance: sql`${wallets.balance} + ${sellerShare}` }).where(eq(wallets.user_id, trade.seller_id));
        await tx.insert(transactions).values({
          from_user_id: trade.buyer_id,
          to_user_id: trade.seller_id,
          amount: sellerShare,
          type: 'escrow_release',
          reference_id: trade.id,
          memo: externalFunding
            ? `Dispute resolved: ${resolution}; external seller payout pending`
            : `Sandbox dispute resolved: ${resolution}`,
        });
      }
      await tx
        .update(mpp_sessions)
        .set({ status: 'closed', closed_at: new Date() })
        .where(and(eq(mpp_sessions.session_id, trade.escrow_session_id || ''), eq(mpp_sessions.status, 'active')));
      return claimed;
    });

    if (!updated) return NextResponse.json({ error: 'Trade already resolved' }, { status: 409 });

    const buyerMsg = await encryptMessage(JSON.stringify({ type: 'trade_status_update', trade_id: trade.id, status: 'resolved', resolution }));
    const sellerMsg = await encryptMessage(JSON.stringify({ type: 'trade_status_update', trade_id: trade.id, status: 'resolved', resolution }));
    await Promise.allSettled([
      db.insert(messages).values([
        { sender_id: auth!.userId, receiver_id: trade.buyer_id, encrypted_content: buyerMsg.encrypted_content, nonce: buyerMsg.nonce },
        { sender_id: auth!.userId, receiver_id: trade.seller_id, encrypted_content: sellerMsg.encrypted_content, nonce: sellerMsg.nonce },
      ]),
      deliverWebhookEvent(trade.buyer_id, 'trade.status_changed', { trade_id: trade.id, old_status: 'disputed', new_status: 'resolved', resolution }),
      deliverWebhookEvent(trade.seller_id, 'trade.status_changed', { trade_id: trade.id, old_status: 'disputed', new_status: 'resolved', resolution }),
    ]);

    return NextResponse.json({
      ok: true,
      trade: updated,
      distribution: { buyer: buyerShare, seller: sellerShare },
      external_payout_status: externalFunding ? 'pending' : 'not_applicable',
    });
  } catch (error) {
    console.error('Trade resolve error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
