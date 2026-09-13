import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { api_keys, analytics_events, listings, trades } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { and, eq, gte, or } from 'drizzle-orm';

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [allTrades, allListings, allApiKeys] = await Promise.all([
      db.select({ id: trades.id, status: trades.status, created_at: trades.created_at, amount: trades.amount })
        .from(trades)
        .where(or(eq(trades.buyer_id, auth.userId), eq(trades.seller_id, auth.userId))),
      db.select({ id: listings.id, status: listings.status }).from(listings).where(eq(listings.seller_id, auth.userId)),
      db.select().from(api_keys).where(eq(api_keys.user_id, auth.userId)),
    ]);

    const rangeParam = req.nextUrl.searchParams.get('range');
    const rangeDays = rangeParam === '30' ? 30 : 7;

    const rangeStart = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
    const recentEvents = await db
      .select()
      .from(analytics_events)
      .where(and(eq(analytics_events.user_id, auth.userId), gte(analytics_events.created_at, rangeStart)));

    const tradeByStatus = {
      pending: allTrades.filter((t) => t.status === 'escrow_held' || t.status === 'pending_release').length,
      completed: allTrades.filter((t) => t.status === 'completed' || t.status === 'complete').length,
      disputed: allTrades.filter((t) => t.status === 'disputed').length,
    };

    const listingFunnel = {
      active: allListings.filter((l) => l.status === 'active').length,
      sold: allListings.filter((l) => l.status === 'sold').length,
      expired: allListings.filter((l) => l.status === 'expired').length,
      total: allListings.length,
    };

    const now = Date.now();
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const keySummary = {
      total: allApiKeys.length,
      recently_used: allApiKeys.filter((k) => k.last_used && new Date(k.last_used) >= thirtyDaysAgo).length,
      never_used: allApiKeys.filter((k) => !k.last_used).length,
    };

    const eventsByType = recentEvents.reduce<Record<string, number>>((acc, e) => {
      acc[e.event_type] = (acc[e.event_type] || 0) + 1;
      return acc;
    }, {});

    const trendBuckets: { date: string; count: number }[] = [];
    for (let i = rangeDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      trendBuckets.push({ date: d.toISOString().slice(0, 10), count: 0 });
    }

    for (const ev of recentEvents) {
      const key = new Date(ev.created_at).toISOString().slice(0, 10);
      const bucket = trendBuckets.find((b) => b.date === key);
      if (bucket) bucket.count += 1;
    }

    return NextResponse.json({
      range_days: rangeDays,
      trade_by_status: tradeByStatus,
      listing_funnel: listingFunnel,
      api_key_summary: keySummary,
      analytics_events: {
        total: recentEvents.length,
        by_type: eventsByType,
        trend: trendBuckets,
      },
    });
  } catch (error) {
    console.error('Analytics summary error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
