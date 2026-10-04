import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { route_plans, service_orders, trades } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { finalizeTradeCompletion } from '@/lib/trade-escrow';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { validateCsrf } from '@/lib/csrf';
import { isExternallyFundedTrade } from '@/lib/trade-settlement-readiness';
import { SettlementError, settleExternallyFundedTrade } from '@/lib/external-settlement';
import { advanceBuyerReview, markBuyerReviewAccepted } from '@/lib/verification-evidence';
import { AcceptanceError } from '@/lib/trade-acceptance';
import { ArtifactError, readBoundedJson } from '@/lib/private-artifacts';
import { z } from 'zod';
import { recordAgentRouteDecision } from './route-automation-evidence';

const decision = z.object({ content_hash: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()

export async function confirmBuyerTrade(req: NextRequest, { params }: { params: Promise<{ id: string }> }, options: { waitMs?: number; agentRouteId?: string } = {}) {
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
    const parsed = decision.safeParse(req.body ? await readBoundedJson(req, 1024, 10_000, true) : {})
    if (!parsed.success) return NextResponse.json({ error: 'Invalid buyer decision', code: 'BUYER_DECISION_INVALID' }, { status: 400 })
    const expectedHash = parsed.data.content_hash
    let tradeToFinalize = trade;
    if (isExternallyFundedTrade(trade)) {
      const [claimed] = await db.transaction(async (tx) => {
        const rows = await tx.update(trades).set({ payout_status: 'processing' })
          .where(and(eq(trades.id, trade.id), eq(trades.status, 'pending_release'), eq(trades.payout_status, 'pending')))
          .returning();
        if (rows[0]) {
          const acceptedNow = await advanceBuyerReview(tx, trade.id, 'passed', expectedHash);
          if (acceptedNow && expectedHash && options.agentRouteId && auth.kind === 'registered-agent') {
            await recordAgentRouteDecision(tx, options.agentRouteId, trade.id, auth.userId, expectedHash)
          }
          const [order] = await tx.select({ id: service_orders.id }).from(service_orders).where(eq(service_orders.trade_id, trade.id)).limit(1)
          if (order) await tx.update(route_plans).set({ state: 'settling', updated_at: new Date() }).where(eq(route_plans.service_order_id, order.id))
        }
        return rows;
      });
      if (claimed) {
        tradeToFinalize = claimed;
      } else {
        const [current] = await db.select().from(trades).where(eq(trades.id, trade.id)).limit(1);
        if (!current || current.status !== 'pending_release' || current.payout_status !== 'processing') {
          return NextResponse.json({ error: 'Trade settlement was already updated' }, { status: 409 });
        }
        tradeToFinalize = current;
        if (expectedHash) await (await import('@/lib/trade-acceptance')).assertReadyForBuyerAcceptance(trade.id, db, expectedHash)
      }
      const settlement = await settleExternallyFundedTrade(tradeToFinalize, 100, options);
      if (!settlement.complete) {
        return NextResponse.json({ ok: true, status: 'settlement_processing', transfers: settlement.transfers.map(({ id, kind, status, tx_hash }) => ({ id, kind, status, tx_hash })) }, { status: 202 });
      }
    }
    if (!isExternallyFundedTrade(trade)) await markBuyerReviewAccepted(trade.id, expectedHash);
    const updated = await finalizeTradeCompletion(tradeToFinalize, 'buyer_confirm');
    return NextResponse.json({ ok: true, trade: updated, status: 'completed' });
  } catch (error: any) {
    if (error instanceof ArtifactError) return NextResponse.json({ error: error.code, code: error.code }, { status: error.status });
    if (error instanceof AcceptanceError) return NextResponse.json({ error: 'Required verification or explicit acceptance is missing', code: error.code, retryable: false }, { status: 409 });
    if (error instanceof SettlementError) {
      return NextResponse.json({ error: error.message, code: error.code, retryable: error.retryable }, { status: error.retryable ? 503 : 409 });
    }
    if (error?.message === 'TRADE_NOT_PENDING_RELEASE') return NextResponse.json({ error: 'Trade already updated' }, { status: 409 });
    if (error?.message === 'ESCROW_BALANCE_MISMATCH') return NextResponse.json({ error: 'Escrow balance is inconsistent; settlement halted' }, { status: 409 });
    console.error('Trade confirmation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
