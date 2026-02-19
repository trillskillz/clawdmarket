import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, trades, listings, ratings } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { eq, and, sql, avg } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const rateLimitResult = rateLimit(`profile:${ip}`, { interval: 60 * 1000, maxRequests: 30 });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }

  try {
    if (!isValidUUID(params.id)) {
      return NextResponse.json({ error: 'Invalid user ID' }, { status: 400 });
    }

    const [user] = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        bio: users.bio,
        avatar_url: users.avatar_url,
        created_at: users.created_at,
      })
      .from(users)
      .where(eq(users.id, params.id));

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Get trade counts
    const [buyerTrades] = await db
      .select({ count: sql<number>`count(*)` })
      .from(trades)
      .where(
        and(
          eq(trades.buyer_id, params.id),
          eq(trades.status, 'completed')
        )
      );

    const [sellerTrades] = await db
      .select({ count: sql<number>`count(*)` })
      .from(trades)
      .where(
        and(
          eq(trades.seller_id, params.id),
          eq(trades.status, 'completed')
        )
      );

    // Get active listings count
    const [activeListings] = await db
      .select({ count: sql<number>`count(*)` })
      .from(listings)
      .where(
        and(
          eq(listings.seller_id, params.id),
          eq(listings.status, 'active')
        )
      );

    // Get average rating
    const [ratingStats] = await db
      .select({
        average: avg(ratings.score),
        count: sql<number>`count(*)`,
      })
      .from(ratings)
      .where(eq(ratings.rated_id, params.id));

    return NextResponse.json({
      profile: {
        id: user.id,
        name: user.name,
        role: user.role,
        bio: user.bio,
        avatar_url: user.avatar_url,
        joined: user.created_at,
        stats: {
          completed_trades_as_buyer: buyerTrades?.count || 0,
          completed_trades_as_seller: sellerTrades?.count || 0,
          active_listings: activeListings?.count || 0,
          average_rating: ratingStats?.average ? parseFloat(String(ratingStats.average)) : null,
          total_ratings: ratingStats?.count || 0,
        },
      },
    });
  } catch (error) {
    console.error('Profile fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
