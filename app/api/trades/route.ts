import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { trades, listings, users, wallets, fee_errors, ratings } from '@/lib/schema';
import { createTradeSchema } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { validateCsrf } from '@/lib/csrf';
import { fireWebhook } from '@/lib/webhooks';
import { and, eq, or, desc, sql } from 'drizzle-orm';
import { envMeta } from '@/lib/agent-environment';
import { validateAgentInstruction } from '@/lib/agent-security';
import { logPaymentFailure, paymentError } from '@/lib/payment-failure';
import { logger } from '@/lib/logger';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import {
  calculateTradeFinancials,
  TradeRaceError,
  createLedgerTrade,
  ensureAdminFeeRecipient,
} from '@/lib/settlement';
import { AgentSpendPolicyError } from '@/lib/agent-spend-policy';
import { enforceAgentSpendPolicy } from '@/lib/agent-spend-policy';
import { getPaymentReadiness } from '@/lib/payment-config';
import { payoutAddressForUser } from '@/lib/external-settlement';
import { checkoutForTrade } from '@/lib/trade-checkout';
import { NewPaymentsPausedError, requireNewPaymentsOpen } from '@/lib/payment-control';

export const dynamic = 'force-dynamic'

async function createTradePost(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const auth = await resolveRequestPrincipal(req);

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  // Validate CSRF for cookie-based auth
  if (auth.usesCookieAuth && !validateCsrf(req)) {
    return NextResponse.json(
      { error: 'CSRF validation failed' },
      { status: 403 }
    );
  }

  const replayValidation = await validateAgentInstruction(req, auth.userId, authHeader || null);
  if (replayValidation) return replayValidation;

  const rateLimitResult = await rateLimit(`trade:${auth.userId}`, { 
    interval: 60 * 1000, 
    maxRequests: 20,
    failClosed: true,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many trade attempts. Please try again later.' },
      { 
        status: 429,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  }

  try {
    const body = await req.json();
    const validated = createTradeSchema.parse(body);
    const clientReference = validated.client_reference || req.headers.get('idempotency-key') || crypto.randomUUID();
    if (validated.listing_id.startsWith('demo-')) {
      return NextResponse.json(
        { error: 'Preview listings cannot be purchased', code: 'DEMO_LISTING' },
        { status: 409 },
      );
    }

    const [existingTrade] = await db.select().from(trades).where(eq(trades.client_reference, clientReference)).limit(1);
    if (existingTrade) {
      if (existingTrade.buyer_id !== auth.userId || existingTrade.listing_id !== validated.listing_id
        || existingTrade.payment_rail !== validated.payment_rail || validated.amount !== 1 || validated.allow_partial_fill) {
        return NextResponse.json({ error: 'Idempotency key already belongs to another trade', code: 'IDEMPOTENCY_CONFLICT' }, { status: 409 });
      }
      return NextResponse.json({ message: 'Existing trade returned.', trade: existingTrade, code: 'TRADE_EXISTS', checkout: checkoutForTrade(existingTrade) });
    }

    await requireNewPaymentsOpen();

    const [listing]: any = await db
      .select()
      .from(listings)
      .where(eq(listings.id, validated.listing_id));

    if (!listing) {
      await logPaymentFailure({
        buyer_id: auth.userId,
        amount: validated.amount,
        token: 'ledger',
        route: 'POST /api/trades',
        listing_id: validated.listing_id,
        error_code: 'LISTING_NOT_FOUND',
        message: 'Listing not found',
        state: 'no_funds_moved',
      });
      return NextResponse.json(
        { ...paymentError('LISTING_NOT_FOUND', 'Listing not found'), ...envMeta('clawdmarket/api/trades') },
        { status: 404 }
      );
    }

    if (listing.status !== 'active') {
      await logPaymentFailure({
        buyer_id: auth.userId,
        seller_id: listing.seller_id,
        amount: validated.amount,
        token: 'ledger',
        route: 'POST /api/trades',
        listing_id: validated.listing_id,
        error_code: 'LISTING_NOT_ACTIVE',
        message: 'Listing is not active',
        state: 'no_funds_moved',
      });
      return NextResponse.json(
        { ...paymentError('LISTING_NOT_ACTIVE', 'Listing is not active'), ...envMeta('clawdmarket/api/trades') },
        { status: 400 }
      );
    }

    if (validated.allow_partial_fill) {
      return NextResponse.json(
        { error: 'Partial fills are not supported', code: 'PARTIAL_FILL_NOT_SUPPORTED', ...envMeta('clawdmarket/api/trades') },
        { status: 400 }
      );
    }

    if (listing.seller_id === auth.userId) {
      return NextResponse.json(
        { error: 'Cannot buy your own listing' },
        { status: 400 }
      );
    }

    // Server-authoritative fee math (never trust client-provided fee/price)
    const requestedQuantity = Number(validated.amount || 1);
    if (requestedQuantity !== 1) {
      return NextResponse.json({ error: 'Only quantity=1 is supported' }, { status: 400 });
    }

    const itemPrice = Number(listing.price_bankr);
    const { totalCost, sellerAmount, devAmount } = calculateTradeFinancials(itemPrice);

    if (validated.payment_rail === 'mpp' || validated.payment_rail === 'evm') {
      const readiness = getPaymentReadiness();
      const railReady = validated.payment_rail === 'mpp' ? readiness.mpp.enabled : readiness.evm.enabled;
      if (!railReady) {
        return NextResponse.json({
          error: `${validated.payment_rail.toUpperCase()} settlement is not configured on this deployment`,
          code: 'PAYMENT_RAIL_NOT_CONFIGURED',
          state: 'no_funds_moved',
        }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
      }
      const sellerPayout = await payoutAddressForUser(listing.seller_id);
      if (!sellerPayout) {
        return NextResponse.json({
          error: 'The seller must configure a payout wallet before accepting external payments',
          code: 'SELLER_PAYOUT_ADDRESS_REQUIRED',
          state: 'no_funds_moved',
        }, { status: 409 });
      }
      const [newTrade] = await db.transaction(async (tx) => {
        if (auth.agentId) await enforceAgentSpendPolicy(tx, { agentId: auth.agentId, buyerId: auth.userId, totalCost });
        const claimed = await tx.update(listings).set({ status: 'sold' })
          .where(and(eq(listings.id, listing.id), eq(listings.status, 'active'))).returning({ id: listings.id });
        if (!claimed.length) throw new TradeRaceError('LISTING_ALREADY_CLAIMED', 'Listing was claimed by another buyer.');
        return tx.insert(trades).values({
          listing_id: listing.id,
          buyer_id: auth.userId,
          seller_id: listing.seller_id,
          amount: sellerAmount,
          fee: devAmount,
          item_price: itemPrice,
          platform_fee: devAmount,
          total_cost: totalCost,
          seller_amount: sellerAmount,
          dev_amount: devAmount,
          dev_wallet: validated.payment_rail === 'mpp' ? readiness.mpp.feeRecipient : readiness.evm.feeRecipient,
          payout_status: 'pending',
          payment_rail: validated.payment_rail,
          client_reference: clientReference,
          payment_due_at: new Date(Date.now() + 30 * 60_000).toISOString(),
          status: 'pending',
          auto_confirm_at: new Date(Date.now() + (30 * 60 + 259200) * 1000).toISOString(),
        }).returning();
      });
      const checkout = checkoutForTrade(newTrade);
      await Promise.allSettled([
        fireWebhook(auth.userId, 'trade.created', { trade: newTrade, checkout }),
        fireWebhook(listing.seller_id, 'trade.created', { trade: newTrade, checkout }),
      ]);
      return NextResponse.json({
        message: 'Trade reserved. Complete payment before the checkout deadline.',
        trade: newTrade,
        checkout,
        code: 'TRADE_PAYMENT_REQUIRED',
        fee_info: { item_price: sellerAmount, platform_fee: devAmount, total_cost: totalCost },
        ...envMeta('clawdmarket/api/trades'),
      }, { status: 201, headers: getRateLimitHeaders(rateLimitResult) });
    }

    if (!getPaymentReadiness().ledger.enabled) {
      return NextResponse.json({ error: 'Account-balance settlement is not enabled', code: 'PAYMENT_RAIL_NOT_CONFIGURED' }, { status: 503 });
    }

    // ─── INTERNAL LEDGER ESCROW ───

    // 1. Check buyer balance
    const [buyerWallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.user_id, auth.userId));

    if (!buyerWallet) {
      return NextResponse.json(
        { error: 'Buyer wallet not found' },
        { status: 404 }
      );
    }

    if (buyerWallet.balance < totalCost) {
      await logPaymentFailure({
        buyer_id: auth.userId,
        seller_id: listing.seller_id,
        amount: totalCost,
        token: 'ledger',
        route: 'POST /api/trades',
        listing_id: validated.listing_id,
        error_code: 'INSUFFICIENT_FUNDS',
        message: `Insufficient funds. Cost: ${totalCost}, Balance: ${buyerWallet.balance}`,
        state: 'no_funds_moved',
      });
      return NextResponse.json(
        {
          ...paymentError('INSUFFICIENT_FUNDS', `Insufficient funds. Cost: ${totalCost}, Balance: ${buyerWallet.balance}`),
          ...envMeta('clawdmarket/api/trades'),
        },
        { status: 402 } // Payment Required
      );
    }

    const adminFeeRecipientUserId = await ensureAdminFeeRecipient();

    const newTrade = await db.transaction((tx) => createLedgerTrade(tx, listing, auth.userId, adminFeeRecipientUserId, { agentId: auth.agentId, clientReference }));
    // ─── ESCROW LOGIC END ───

    // Queue webhook records durably before returning the trade response.
    await Promise.allSettled([
      fireWebhook(auth.userId, 'trade.created', { trade: newTrade }),
      fireWebhook(listing.seller_id, 'trade.created', { trade: newTrade }),
      fireWebhook(listing.seller_id, 'listing.sold', { listing_id: validated.listing_id, trade: newTrade }),
      fireWebhook(auth.userId, 'balance.changed', { reason: 'escrow_lock', trade_id: newTrade.id }),
    ]);

    return NextResponse.json(
      {
        message: 'Trade initiated successfully with ledger funds held in escrow.',
        trade: newTrade,
        code: 'TRADE_CREATED',
        fee_info: {
          item_price: sellerAmount,
          platform_fee: devAmount,
          total_cost: totalCost,
          seller_amount: sellerAmount,
          dev_amount: devAmount,
          dev_wallet: process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS || null,
          admin_fee_wallet_configured: Boolean(process.env.DEV_WALLET_ADDRESS || process.env.DEV_FEE_WALLET_ADDRESS),
        },
        ...envMeta('clawdmarket/api/trades'),
      },
      { 
        status: 201,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  } catch (error: any) {
    if (error instanceof NewPaymentsPausedError) {
      return NextResponse.json({ error: error.message, code: error.code, state: 'no_funds_moved' }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    }
    if (error?.message === 'DEV_FEE_MISMATCH') {
      await db.insert(fee_errors).values({
        trade_id: null,
        listing_id: null,
        buyer_id: auth.userId,
        item_price: 0,
        expected_dev_fee: 0,
        actual_dev_fee: 0,
        message: 'Dev fee mismatch — transaction halted',
      });
      return NextResponse.json(
        { ...paymentError('DEV_FEE_MISMATCH', 'Dev fee mismatch — transaction halted'), ...envMeta('clawdmarket/api/trades') },
        { status: 500 }
      );
    }

    if (error instanceof TradeRaceError) {
      const status = error.code === 'LISTING_ALREADY_CLAIMED' ? 409 : 402;
      await logPaymentFailure({
        buyer_id: auth.userId,
        token: 'ledger',
        route: 'POST /api/trades',
        error_code: error.code,
        message: error.message,
        state: 'no_funds_moved',
      });
      return NextResponse.json(
        {
          ...paymentError(error.code, error.message),
          ...envMeta('clawdmarket/api/trades'),
        },
        { status }
      );
    }

    if (error instanceof AgentSpendPolicyError) {
      return NextResponse.json({
        ...paymentError(error.code, error.message),
        spending_policy: error.policy,
        ...envMeta('clawdmarket/api/trades'),
      }, { status: 409 });
    }

    const zodIssues = error?.errors || error?.issues;
    if (zodIssues) {
      return NextResponse.json(
        { error: 'Validation failed', details: zodIssues, code: 'VALIDATION_FAILED', ...envMeta('clawdmarket/api/trades') },
        { status: 400 }
      );
    }
    logger.error('Trade creation error', { err: error?.message });
    await logPaymentFailure({
      buyer_id: auth.userId,
      token: 'ledger',
      route: 'POST /api/trades',
      error_code: 'INTERNAL_ERROR',
      message: error?.message || 'Internal server error',
      state: 'no_funds_moved',
    });
    return NextResponse.json(
      {
        ...paymentError('INTERNAL_ERROR', 'Internal server error'),
        ...envMeta('clawdmarket/api/trades'),
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const principal = await resolveRequestPrincipal(req);
  return principal ? createTradePost(req) : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const auth = await resolveRequestPrincipal(req);

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
    const requestedPage = Number(req.nextUrl.searchParams.get('page') || 1);
    const requestedLimit = Number(req.nextUrl.searchParams.get('limit') || 50);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 100)
      : 50;
    const requestedTradeId = req.nextUrl.searchParams.get('trade_id')?.trim();
    const participantWhere = or(eq(trades.buyer_id, auth.userId), eq(trades.seller_id, auth.userId));
    const whereClause = requestedTradeId
      ? and(participantWhere, eq(trades.id, requestedTradeId))
      : participantWhere;
    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(trades)
      .where(whereClause);
    const total = Number(countRow?.count || 0);
    const userTrades = await db
        .select({
          id: trades.id,
          listing_id: trades.listing_id,
          listing_title: listings.title,
          buyer_id: trades.buyer_id,
          buyer_name: users.name,
          seller_id: trades.seller_id,
          amount: trades.amount,
          fee: trades.fee,
          item_price: trades.item_price,
          platform_fee: trades.platform_fee,
          total_cost: trades.total_cost,
          seller_amount: trades.seller_amount,
          dev_amount: trades.dev_amount,
          dev_wallet: trades.dev_wallet,
          fee_tx_hash: trades.fee_tx_hash,
          payout_status: trades.payout_status,
          payment_rail: trades.payment_rail,
          payment_due_at: trades.payment_due_at,
          funded_at: trades.funded_at,
          status: trades.status,
          auto_confirm_at: trades.auto_confirm_at,
          created_at: trades.created_at,
          completed_at: trades.completed_at,
          rated_by_caller: sql<number>`EXISTS(
            SELECT 1 FROM ${ratings}
            WHERE ${ratings.trade_id} = ${trades.id}
              AND ${ratings.rater_id} = ${auth.userId}
          )`,
        })
        .from(trades)
        .leftJoin(listings, eq(trades.listing_id, listings.id))
        .leftJoin(users, eq(trades.buyer_id, users.id))
        .where(whereClause)
        .orderBy(desc(trades.created_at))
        .limit(limit)
        .offset((page - 1) * limit);

    return NextResponse.json({
      trades: userTrades.map((trade) => ({
        ...trade,
        checkout: trade.buyer_id === auth.userId && (
          (trade.status === 'pending' && ['mpp', 'evm'].includes(trade.payment_rail))
          || (trade.status === 'cancelled' && trade.payment_rail === 'evm' && trade.payout_status !== 'refunded')
        )
          ? checkoutForTrade(trade)
          : null,
      })),
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit),
      has_more: page * limit < total,
      ...envMeta('clawdmarket/api/trades'),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: any) {
    logger.error('Trades fetch error', { err: error?.message });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
