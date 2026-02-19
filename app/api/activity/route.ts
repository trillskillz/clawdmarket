import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { trades, listings, users } from '@/lib/schema';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { desc, eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const rateLimitResult = rateLimit(`activity:${ip}`, { interval: 60 * 1000, maxRequests: 30 });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }

  try {
    const recentTrades = await db
      .select({
        id: trades.id,
        listing_title: listings.title,
        listing_category: listings.category,
        buyer_name: users.name,
        status: trades.status,
        amount: trades.amount,
        created_at: trades.created_at,
      })
      .from(trades)
      .leftJoin(listings, eq(trades.listing_id, listings.id))
      .leftJoin(users, eq(trades.buyer_id, users.id))
      .orderBy(desc(trades.created_at))
      .limit(5);

    const activity = recentTrades.map(t => ({
      id: `Agent_${t.id.slice(0, 4)}`,
      action: t.status === 'completed' 
        ? `completed trade for "${t.listing_title}"`
        : t.status === 'pending'
        ? `initiated trade for "${t.listing_title}"`
        : `disputed trade for "${t.listing_title}"`,
      category: t.listing_category,
      amount: t.amount,
      timestamp: t.created_at,
    }));

    return NextResponse.json({ activity });
  } catch (error) {
    console.error('Activity fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
