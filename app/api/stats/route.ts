import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { users, trades, waitlist, listings, payment_receipts } from '@/lib/schema';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { eq, gte, and, or } from 'drizzle-orm';

const PATHUSD = '0x20c000000000000000000000b9537d11c60e8b50'.toLowerCase();

function railFromReceipt(receipt: { route: string; currency: string | null }) {
  const currency = String(receipt.currency || '').toLowerCase();
  const route = String(receipt.route || '').toLowerCase();
  if (currency === PATHUSD || route.includes('/mpp/')) return 'mpp';
  return 'x402';
}

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
    const allAgents = await db.select().from(users).where(eq(users.role, 'agent'));
    const activeListings = await db.select().from(listings).where(eq(listings.status, 'active'));
    const settledTrades = await db
      .select({ id: trades.id, status: trades.status, amount: trades.amount, created_at: trades.created_at })
      .from(trades)
      .where(or(eq(trades.status, 'completed'), eq(trades.status, 'complete')));

    const agentsRegistered = allAgents.length;
    const servicesListed = activeListings.length;
    const transactionsSettled = settledTrades.length;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTrades = await db
      .select({ id: trades.id, amount: trades.amount, created_at: trades.created_at })
      .from(trades)
      .where(gte(trades.created_at, today));
    const tradesToday = todayTrades.length;

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent24hTrades = await db
      .select({ id: trades.id, amount: trades.amount, created_at: trades.created_at, status: trades.status })
      .from(trades)
      .where(
        and(
          gte(trades.created_at, last24h),
          or(eq(trades.status, 'completed'), eq(trades.status, 'complete'))
        )
      );
    const volume24h = recent24hTrades.reduce((sum, trade) => sum + (trade.amount || 0), 0);

    const waitlistEntries = await db.select().from(waitlist);
    const waitlistCount = waitlistEntries.length;

    const receipts = await db
      .select({ route: payment_receipts.route, currency: payment_receipts.currency, usd: payment_receipts.usd_value_at_payment, created_at: payment_receipts.created_at })
      .from(payment_receipts);

    const totalVolumeUsd = receipts.reduce((sum, r) => sum + Number(r.usd || 0), 0);
    const volumeLast24h = receipts
      .filter((r) => new Date(r.created_at).getTime() >= last24h.getTime())
      .reduce((sum, r) => sum + Number(r.usd || 0), 0);

    const volumeByRail = receipts.reduce(
      (acc, r) => {
        const rail = railFromReceipt(r);
        acc[rail] += Number(r.usd || 0);
        return acc;
      },
      { mpp: 0, x402: 0 },
    );

    return NextResponse.json(
      {
        agents_registered: agentsRegistered,
        services_listed: servicesListed,
        transactions_settled: transactionsSettled,
        agents_online: agentsRegistered,
        trades_today: tradesToday,
        volume_24h: Math.round(volume24h),
        waitlist_count: waitlistCount,
        agent_count: agentsRegistered,
        trade_count: transactionsSettled,
        total_volume_usd: Number(totalVolumeUsd.toFixed(2)),
        platform_fees_usd: Number((totalVolumeUsd * 0.05).toFixed(2)),
        volume_by_rail: {
          mpp: Number(volumeByRail.mpp.toFixed(2)),
          x402: Number(volumeByRail.x402.toFixed(2)),
        },
        volume_last_24h: Number(volumeLast24h.toFixed(2)),
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=60',
        },
      }
    );
  } catch (error) {
    console.error('Stats fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
