import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { trades, wallets, transactions, fee_errors, messages } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { updateTradeStatusSchema, isValidUUID } from '@/lib/validation';
import { validateCsrf } from '@/lib/csrf';
import { fireWebhook } from '@/lib/webhooks';
import { and, eq, sql } from 'drizzle-orm';
import { envMeta } from '@/lib/agent-environment';
import { validateAgentInstruction } from '@/lib/agent-security';
import { logPaymentFailure, paymentError } from '@/lib/payment-failure';
import { encryptMessage } from '@/lib/chat-crypto';

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Validate CSRF for cookie-based auth
  if (!authHeader && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  const replayValidation = await validateAgentInstruction(req, auth.userId, authHeader || null);
  if (replayValidation) return replayValidation;

  try {
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: 'Invalid trade ID' }, { status: 400 });
    }

    const [trade] = await db
      .select()
      .from(trades)
      .where(eq(trades.id, id));

    if (!trade) {
      return NextResponse.json(
        { error: 'Trade not found' },
        { status: 404 }
      );
    }

    // Check authorization
    const isParty = trade.buyer_id === auth.userId || trade.seller_id === auth.userId;
    
    if (!isParty) {
      return NextResponse.json(
        { error: 'You are not part of this trade' },
        { status: 403 }
      );
    }

    if (trade.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot update trade with status '${trade.status}'. Only pending trades can be updated.` },
        { status: 400 }
      );
    }

    const body = await req.json();
    const validated = updateTradeStatusSchema.parse(body);
    const targetStatus = validated.status === 'completed' ? 'complete' : validated.status;

    if (targetStatus === 'complete') {
      if (trade.buyer_id !== auth.userId) {
        return NextResponse.json(
          { error: 'Only the buyer can mark a trade as completed' },
          { status: 403 }
        );
      }
    }

    // ─── ESCROW RELEASE LOGIC ───
    const updatedTrade = await db.transaction(async (tx) => {
      // 1. Update trade status atomically only if still pending.
      const [t] = await tx
        .update(trades)
        .set({
          status: targetStatus,
          payout_status: targetStatus === 'complete' ? 'complete' : trade.payout_status,
          completed_at: targetStatus === 'complete' ? new Date() : null,
          rating_window_expires_at: targetStatus === 'complete' ? new Date(Date.now() + (72 * 60 * 60 * 1000)).toISOString() : null,
        })
        .where(and(eq(trades.id, id), eq(trades.status, 'pending')))
        .returning();

      if (!t) {
        throw new Error('TRADE_NOT_PENDING_AT_COMMIT');
      }

      // 2. Handle funds if completing
      if (targetStatus === 'complete') {
        const expectedDevFee = Math.round(Number(trade.amount) * 0.05 * 100) / 100;
        const actualDevFee = Math.round(Number(trade.fee) * 100) / 100;
        if (actualDevFee !== expectedDevFee) {
          await tx.insert(fee_errors).values({
            trade_id: trade.id,
            listing_id: trade.listing_id,
            buyer_id: trade.buyer_id,
            item_price: Number(trade.amount),
            expected_dev_fee: expectedDevFee,
            actual_dev_fee: actualDevFee,
            message: 'Dev fee mismatch — transaction halted',
          });
          throw new Error('DEV_FEE_MISMATCH');
        }

        const [escrowLockTx] = await tx
          .select()
          .from(transactions)
          .where(and(eq(transactions.reference_id, trade.id), eq(transactions.type, 'escrow_lock')))
          .limit(1);

        if (escrowLockTx) {
          // Legacy internal-ledger settlement path
          await tx
            .update(wallets)
            .set({ escrow: sql`${wallets.escrow} - ${trade.amount}` })
            .where(eq(wallets.user_id, trade.buyer_id));

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
            memo: 'Trade completed',
          });
        } else {
          // On-chain settlement path: funds already moved on-chain at purchase time.
          await tx.insert(transactions).values({
            from_user_id: trade.buyer_id,
            to_user_id: trade.seller_id,
            amount: trade.amount,
            type: 'transfer',
            reference_id: trade.id,
            memo: 'Trade completed (on-chain settlement already recorded)',
          });
        }
      } else if (targetStatus === 'disputed') {
        // For disputes, funds stay in escrow until admin resolution (manual for now)
        // Or we could auto-refund, but 'dispute' usually means freeze.
        // We'll leave them in buyer's escrow for now.
      }

      return t;
    });

    // Fire webhooks
    if (targetStatus === 'complete') {
      await fireWebhook(trade.buyer_id, 'trade.completed', { trade: updatedTrade });
      await fireWebhook(trade.seller_id, 'trade.completed', { trade: updatedTrade });
      await fireWebhook(trade.buyer_id, 'balance.changed', { reason: 'escrow_release', trade_id: trade.id });
      await fireWebhook(trade.seller_id, 'balance.changed', { reason: 'escrow_release', trade_id: trade.id });

      const expiresAtIso = new Date(Date.now() + (72 * 60 * 60 * 1000)).toISOString();
      const buyerPrompt = await encryptMessage(JSON.stringify({
        type: 'rating_request',
        trade_id: trade.id,
        counterpart_id: trade.seller_id,
        rating_window_expires_at: expiresAtIso,
      }));
      const sellerPrompt = await encryptMessage(JSON.stringify({
        type: 'rating_request',
        trade_id: trade.id,
        counterpart_id: trade.buyer_id,
        rating_window_expires_at: expiresAtIso,
      }));

      await db.insert(messages).values([
        {
          sender_id: trade.seller_id,
          receiver_id: trade.buyer_id,
          encrypted_content: buyerPrompt.encrypted_content,
          nonce: buyerPrompt.nonce,
        },
        {
          sender_id: trade.buyer_id,
          receiver_id: trade.seller_id,
          encrypted_content: sellerPrompt.encrypted_content,
          nonce: sellerPrompt.nonce,
        },
      ]);
    }

    return NextResponse.json({
      message: `Trade status updated to ${targetStatus}`,
      code: 'TRADE_STATUS_UPDATED',
      trade: updatedTrade,
      ...envMeta('clawdmarket/api/trades/:id'),
    });
  } catch (error: any) {
    if (error?.message === 'DEV_FEE_MISMATCH') {
      return NextResponse.json(
        { ...paymentError('DEV_FEE_MISMATCH', 'Dev fee mismatch — transaction halted'), ...envMeta('clawdmarket/api/trades/:id') },
        { status: 500 }
      );
    }

    if (error?.message === 'TRADE_NOT_PENDING_AT_COMMIT') {
      await logPaymentFailure({
        buyer_id: auth.userId,
        token: 'bnkr',
        route: 'PATCH /api/trades/:id',
        trade_id: id,
        error_code: 'TRADE_ALREADY_UPDATED',
        message: 'Trade was already updated by another request',
        state: 'escrow_held',
      });
      return NextResponse.json(
        { ...paymentError('TRADE_ALREADY_UPDATED', 'Trade was already updated by another request'), ...envMeta('clawdmarket/api/trades/:id') },
        { status: 409 }
      );
    }

    if (error.errors) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Trade update error:', error);
    await logPaymentFailure({
      buyer_id: auth.userId,
      token: 'bnkr',
      route: 'PATCH /api/trades/:id',
      trade_id: id,
      error_code: 'INTERNAL_ERROR',
      message: error?.message || 'Internal server error',
      state: 'escrow_held',
    });
    return NextResponse.json(
      { ...paymentError('INTERNAL_ERROR', 'Internal server error') },
      { status: 500 }
    );
  }
}
