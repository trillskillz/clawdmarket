import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { trades, listings, users } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { createTradeSchema } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { validateCsrf } from '@/lib/csrf';
import { fireWebhook } from '@/lib/webhooks';
import { eq, or, desc } from 'drizzle-orm';

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
        { error: 'Listing not found' },
        { status: 404 }
      );
    }

    if (listing.status !== 'active') {
      return NextResponse.json(
        { error: 'Listing is not active' },
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

    // Create trade (in a real app, this would involve escrow logic)
    const [newTrade] = await db
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

    // Mark listing as sold
    await db
      .update(listings)
      .set({ status: 'sold' })
      .where(eq(listings.id, validated.listing_id));

    // Fire webhooks
    await fireWebhook(auth.userId, 'trade.created', { trade: newTrade });
    await fireWebhook(listing.seller_id, 'trade.created', { trade: newTrade });
    await fireWebhook(listing.seller_id, 'listing.sold', { listing_id: validated.listing_id, trade: newTrade });

    return NextResponse.json(
      {
        message: 'Trade initiated successfully',
        trade: newTrade,
        fee_info: {
          amount: validated.amount,
          ecosystem_fee: fee,
          seller_receives: validated.amount - fee,
        },
      },
      { 
        status: 201,
        headers: getRateLimitHeaders(rateLimitResult),
      }
    );
  } catch (error: any) {
    if (error.errors) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.errors },
        { status: 400 }
      );
    }
    console.error('Trade creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
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

    return NextResponse.json({ trades: userTrades });
  } catch (error) {
    console.error('Trades fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
