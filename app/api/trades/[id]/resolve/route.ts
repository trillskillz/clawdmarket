import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { trades } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { authenticateRequest } from '@/lib/auth';
import { authorizeAdmin } from '@/lib/admin-auth';
import { validateCsrf } from '@/lib/csrf';
import { isExternallyFundedTrade } from '@/lib/trade-settlement-readiness';
import { SettlementError, settleExternallyFundedTrade } from '@/lib/external-settlement';
import { finalizeTradeDispute, type TradeResolution } from '@/lib/trade-dispute';

export const dynamic = 'force-dynamic'
export const maxDuration = 120

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

    let tradeToFinalize = trade;
    if (externalFunding) {
      const [claimed] = await db.update(trades)
        .set({ resolution, resolution_seller_percent: splitPercent, payout_status: 'processing' })
        .where(and(
          eq(trades.id, trade.id),
          eq(trades.status, 'disputed'),
          isNull(trades.resolution),
          isNull(trades.resolution_seller_percent),
        ))
        .returning();
      if (claimed) {
        tradeToFinalize = claimed;
      } else {
        const [current] = await db.select().from(trades).where(eq(trades.id, trade.id)).limit(1);
        if (!current || current.status !== 'disputed' || current.resolution !== resolution || current.resolution_seller_percent !== splitPercent) {
          return NextResponse.json({ error: 'A different dispute resolution is already being settled' }, { status: 409 });
        }
        tradeToFinalize = current;
      }
      const settlement = await settleExternallyFundedTrade(tradeToFinalize, splitPercent);
      if (!settlement.complete) {
        return NextResponse.json({
          ok: true,
          status: 'settlement_processing',
          resolution,
          distribution: { buyer: buyerShare, seller: sellerShare },
          transfers: settlement.transfers.map(({ id, kind, status, tx_hash }) => ({ id, kind, status, tx_hash })),
        }, { status: 202 });
      }
    }

    const finalized = await finalizeTradeDispute(tradeToFinalize, resolution as TradeResolution, splitPercent, auth!.userId);
    if (!finalized) return NextResponse.json({ error: 'Trade already resolved' }, { status: 409 });

    return NextResponse.json({
      ok: true,
      trade: finalized.trade,
      distribution: finalized.distribution,
      external_payout_status: externalFunding ? 'complete' : 'not_applicable',
    });
  } catch (error) {
    if (error instanceof SettlementError) {
      return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: error.retryable ? 503 : 409 });
    }
    console.error('Trade resolve error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
