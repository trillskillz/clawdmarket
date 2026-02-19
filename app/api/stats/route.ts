import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, trades, waitlist } from '@/lib/schema';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { eq, gte, and } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const rateLimitResult = rateLimit(`stats:${ip}`, { interval: 60 * 1000, maxRequests: 30 });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: getRateLimitHeaders(rateLimitResult) }
    );
  }

  try {
    // Get agents count (users with role 'agent' who have activity in last 7 days)
    const allUsers = await db.select().from(users).where(eq(users.role, 'agent'));
    const agentsOnline = allUsers.length;

    // Get trades today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayTrades = await db
      .select()
      .from(trades)
      .where(gte(trades.created_at, today));
    
    const tradesToday = todayTrades.length;

    // Get 24h volume
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent24hTrades = await db
      .select()
      .from(trades)
      .where(
        and(
          gte(trades.created_at, last24h),
          eq(trades.status, 'completed')
        )
      );

    const volume24h = recent24hTrades.reduce((sum, trade) => sum + (trade.amount || 0), 0);

    // Get waitlist count
    const waitlistEntries = await db.select().from(waitlist);
    const waitlistCount = waitlistEntries.length;

    return NextResponse.json({
      agents_online: agentsOnline,
      trades_today: tradesToday,
      volume_24h: Math.round(volume24h),
      waitlist_count: waitlistCount,
    });
  } catch (error) {
    console.error('Stats fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
