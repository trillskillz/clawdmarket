import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { trades, listings, users, wallets, transactions } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { createTradeSchema } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { validateCsrf } from '@/lib/csrf';
import { fireWebhook } from '@/lib/webhooks';
import { eq, or, desc, sql } from 'drizzle-orm';
import { envMeta } from '@/lib/agent-environment';

const ECOSYSTEM_FEE_PERCENT = 0.03; // 3% fee

export async function POST(req: NextRequest) {
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

  const rateLimitResult = rateLimit(`trade:${auth.userId}`, { 
    interval: 60 * 1000, 
    maxRequests: 20 
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

    // Fetch listing
    const [listing] = await db
      .select()
      .from(listings)
      .where(eq(listings.id, validated.listing_id));

    if (!listing) {
      return NextResponse.json(
        { error: 'Listing not found', code: 'LISTING_NOT_FOUND', ...envMeta('clawdmarket/api/trades') },
        { status: 404 }
      );
    }

    if (listing.status !== 'active') {
      return NextResponse.json(
        { error: 'Listing is not active', code: 'LISTING_NOT_ACTIVE', ...envMeta('clawdmarket/api/trades') },
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

    // Calculate fee
    const fee = validated.amount * ECOSYSTEM_FEE_PERCENT;
    const totalCost = validated.amount + fee;

    // ─── ESCROW LOGIC START ───
    
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
      return NextResponse.json(
        {
          error: `Insufficient funds. Cost: ${totalCost} BANKR, Balance: ${buyerWallet.balance} BANKR`,
          code: 'INSUFFICIENT_FUNDS',
          ...envMeta('clawdmarket/api/trades'),
        },
        { status: 402 } // Payment Required
      );
    }

    // 2. Perform atomic trade creation & fund locking
    // Note: Drizzle's `db.transaction` works with @libsql/client (Turso)
    const newTrade = await db.transaction(async (tx) => {
      // Deduct from buyer balance, move amount to escrow
      // Fee is burned (or moved to platform wallet - for now we just deduct it)
      await tx
        .update(wallets)
        .set({
          balance: sql`${wallets.balance} - ${totalCost}`,
          escrow: sql`${wallets.escrow} + ${validated.amount}`,
        })
        .where(eq(wallets.user_id, auth.userId));

      // Record transaction: Lock funds
      await tx.insert(transactions).values({
        from_user_id: auth.userId,
        amount: validated.amount,
        type: 'escrow_lock',
        reference_id: validated.listing_id, // temporarily link to listing until trade ID exists
        memo: `Escrow lock for listing ${listings.title.name || validated.listing_id}`,
      });

      // Record transaction: Fee
      await tx.insert(transactions).values({
        from_user_id: auth.userId,
        amount: fee,
        type: 'fee',
        reference_id: validated.listing_id,
        memo: 'Marketplace fee (3%)',
      });

      // Create trade record
      const [trade] = await tx
        .insert(trades)
        .values({
          listing_id: validated.listing_id,
          buyer_id: auth.userId,
          seller_id: listing.seller_id,
          amount: validated.amount,
          fee: fee,
          status: 'pending',
        })
        .returning();

      // Update transactions to reference the real trade ID
      await tx
        .update(transactions)
        .set({ reference_id: trade.id })
        .where(eq(transactions.reference_id, validated.listing_id));

      // Mark listing as sold
      await tx
        .update(listings)
        .set({ status: 'sold' })
        .where(eq(listings.id, validated.listing_id));

      return trade;
    });
    // ─── ESCROW LOGIC END ───

    // Fire webhooks (fire-and-forget, don't block response)
    Promise.all([
      fireWebhook(auth.userId, 'trade.created', { trade: newTrade }),
      fireWebhook(listing.seller_id, 'trade.created', { trade: newTrade }),
      fireWebhook(listing.seller_id, 'listing.sold', { listing_id: validated.listing_id, trade: newTrade }),
      fireWebhook(auth.userId, 'balance.changed', { reason: 'escrow_lock', trade_id: newTrade.id }),
    ]).catch(err => console.error('Webhook error:', err));

    return NextResponse.json(
      {
        message: 'Trade initiated successfully. Funds locked in escrow.',
        trade: newTrade,
        code: 'TRADE_CREATED',
        fee_info: {
          amount: validated.amount,
          ecosystem_fee: fee,
          seller_receives: validated.amount, // No fee for seller in this model, buyer pays fee
        },
        ...envMeta('clawdmarket/api/trades'),
      },
      { 
        status: 201,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  } catch (error: any) {
    if (error.errors) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors, code: 'VALIDATION_FAILED', ...envMeta('clawdmarket/api/trades') },
        { status: 400 }
      );
    }
    console.error('Trade creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error', code: 'INTERNAL_ERROR', ...envMeta('clawdmarket/api/trades') },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  try {
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
        status: trades.status,
        created_at: trades.created_at,
        completed_at: trades.completed_at,
      })
      .from(trades)
      .leftJoin(listings, eq(trades.listing_id, listings.id))
      .leftJoin(users, eq(trades.buyer_id, users.id))
      .where(
        or(
          eq(trades.buyer_id, auth.userId),
          eq(trades.seller_id, auth.userId)
        )
      )
      .orderBy(desc(trades.created_at));

    return NextResponse.json({ trades: userTrades, ...envMeta('clawdmarket/api/trades') });
  } catch (error) {
    console.error('Trades fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
