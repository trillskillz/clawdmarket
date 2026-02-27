import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { trades, listings, users } from '@/lib/schema';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { desc, eq } from 'drizzle-orm';

type ActivityItem = {
  id: string;
  action: string;
  category: string | null;
  amount: number | null;
  timestamp: Date | null;
};

const BLOCKED_LISTING_PHRASE = 'cli test gpu';
const includesBlockedPhrase = (value?: string | null) =>
  (value ?? '').toLowerCase().includes(BLOCKED_LISTING_PHRASE);

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
    const [recentTrades, recentBounties] = await Promise.all([
      db
        .select({
          id: trades.id,
          listing_title: listings.title,
          listing_category: listings.category,
          status: trades.status,
          amount: trades.amount,
          created_at: trades.created_at,
        })
        .from(trades)
        .leftJoin(listings, eq(trades.listing_id, listings.id))
        .orderBy(desc(trades.created_at))
        .limit(8),
      db
        .select({
          id: listings.id,
          title: listings.title,
          category: listings.category,
          price_bankr: listings.price_bankr,
          created_at: listings.created_at,
          seller_name: users.name,
          seller_id: users.id,
        })
        .from(listings)
        .leftJoin(users, eq(listings.seller_id, users.id))
        .where(eq(listings.category, 'bounties'))
        .orderBy(desc(listings.created_at))
        .limit(8),
    ]);

    const tradeActivity: ActivityItem[] = recentTrades
      .filter((t) => !includesBlockedPhrase(t.listing_title))
      .map((t) => ({
        id: `Agent_${t.id.slice(0, 4)}`,
        action:
          t.status === 'completed'
            ? `completed trade for "${t.listing_title ?? 'untitled listing'}"`
            : t.status === 'pending'
              ? `initiated trade for "${t.listing_title ?? 'untitled listing'}"`
              : `disputed trade for "${t.listing_title ?? 'untitled listing'}"`,
        category: t.listing_category,
        amount: t.amount,
        timestamp: t.created_at,
      }));

    const bountyActivity: ActivityItem[] = recentBounties
      .filter((b) => !includesBlockedPhrase(b.title))
      .map((b) => ({
        id: b.seller_id ? `Agent_${b.seller_id.slice(0, 4)}` : `Agent_${b.id.slice(0, 4)}`,
        action: `posted bounty "${b.title}" for ${b.price_bankr} BANKR`,
        category: b.category,
        amount: b.price_bankr,
        timestamp: b.created_at,
      }));

    // Bias the feed toward bounty posts, keep only a light touch of trade events.
    const prioritized = [...bountyActivity, ...tradeActivity.slice(0, 2)]
      .sort((a, b) => (b.timestamp?.getTime() ?? 0) - (a.timestamp?.getTime() ?? 0));

    const seenActions = new Set<string>();
    const activity = prioritized
      .filter((item) => !includesBlockedPhrase(item.action))
      .filter((item) => {
        const key = item.action.toLowerCase();
        if (seenActions.has(key)) return false;
        seenActions.add(key);
        return true;
      })
      .slice(0, 5);

    return NextResponse.json({ activity });
  } catch (error) {
    console.error('Activity fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
