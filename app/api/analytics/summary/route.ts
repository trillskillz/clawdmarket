import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { api_keys, analytics_events, listings, trades } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { gte } from 'drizzle-orm';

async function ensureAnalyticsTable() {
  await (db as any).$client.execute({
    sql: `CREATE TABLE IF NOT EXISTS analytics_events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      event_type TEXT NOT NULL,
      metadata TEXT,
      ip_hash TEXT,
      created_at INTEGER NOT NULL
    )`,
    args: [],
  });
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await ensureAnalyticsTable();

    const [allTrades, allListings, allApiKeys] = await Promise.all([
      db.select().from(trades),
      db.select().from(listings),
      db.select().from(api_keys),
    ]);

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recentEvents = await db
      .select()
      .from(analytics_events)
      .where(gte(analytics_events.created_at, sevenDaysAgo));

    const tradeByStatus = {
      pending: allTrades.filter((t) => t.status === 'pending').length,
      completed: allTrades.filter((t) => t.status === 'completed').length,
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

    return NextResponse.json({
      trade_by_status: tradeByStatus,
      listing_funnel: listingFunnel,
      api_key_summary: keySummary,
      analytics_events_7d: {
        total: recentEvents.length,
        by_type: eventsByType,
      },
    });
  } catch (error) {
    console.error('Analytics summary error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
