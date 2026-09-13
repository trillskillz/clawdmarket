import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { trades } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { finalizeTradeCompletion } from '@/lib/trade-escrow';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { validateCsrf } from '@/lib/csrf';
import { isExternallyFundedTrade } from '@/lib/trade-settlement-readiness';
import { SettlementError, settleExternallyFundedTrade } from '@/lib/external-settlement';

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid trade ID' }, { status: 400 });

  const auth = await resolveRequestPrincipal(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.usesCookieAuth && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
  if (trade.buyer_id !== auth.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (trade.status !== 'pending_release') return NextResponse.json({ error: 'Trade is not pending release' }, { status: 400 });

  try {
    let tradeToFinalize = trade;
    if (isExternallyFundedTrade(trade)) {
      const [claimed] = await db.update(trades).set({ payout_status: 'processing' })
        .where(and(eq(trades.id, trade.id), eq(trades.status, 'pending_release'), eq(trades.payout_status, 'pending')))
        .returning();
      if (claimed) {
        tradeToFinalize = claimed;
      } else {
        const [current] = await db.select().from(trades).where(eq(trades.id, trade.id)).limit(1);
        if (!current || current.status !== 'pending_release' || current.payout_status !== 'processing') {
          return NextResponse.json({ error: 'Trade settlement was already updated' }, { status: 409 });
        }
        tradeToFinalize = current;
      }
      const settlement = await settleExternallyFundedTrade(tradeToFinalize, 100);
      if (!settlement.complete) {
        return NextResponse.json({ ok: true, status: 'settlement_processing', transfers: settlement.transfers.map(({ id, kind, status, tx_hash }) => ({ id, kind, status, tx_hash })) }, { status: 202 });
      }
    }
    const updated = await finalizeTradeCompletion(tradeToFinalize, 'buyer_confirm');
    return NextResponse.json({ ok: true, trade: updated, status: 'completed' });
  } catch (error: any) {
    if (error instanceof SettlementError) {
      return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: error.retryable ? 503 : 409 });
    }
    if (error?.message === 'TRADE_NOT_PENDING_RELEASE') return NextResponse.json({ error: 'Trade already updated' }, { status: 409 });
    if (error?.message === 'ESCROW_BALANCE_MISMATCH') return NextResponse.json({ error: 'Escrow balance is inconsistent; settlement halted' }, { status: 409 });
    console.error('Trade confirmation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
