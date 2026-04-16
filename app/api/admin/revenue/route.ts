import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, inArray, or } from 'drizzle-orm';
import { db } from '@/lib/db';
import { payment_receipts, trades, users, mpp_sessions } from '@/lib/schema';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic'

const PATHUSD = '0x20c000000000000000000000b9537d11c60e8b50'.toLowerCase();

function railFromReceipt(receipt: { route: string; currency: string | null }) {
  const currency = String(receipt.currency || '').toLowerCase();
  const route = String(receipt.route || '').toLowerCase();
  if (currency === PATHUSD || route.includes('/mpp/')) return 'mpp';
  return 'x402';
}

function modeFromRoute(route: string) {
  return route.includes('/session/') ? 'session' : 'charge';
}

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-admin-secret') || '';
  const expected = process.env.ADMIN_SECRET || process.env.ADMIN_API_SECRET || '';
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const rl = await rateLimit('admin:revenue', { interval: 60_000, maxRequests: 30 });
  if (!rl.success) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: getRateLimitHeaders(rl) });
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const receipts = await db
    .select({ route: payment_receipts.route, currency: payment_receipts.currency, usd: payment_receipts.usd_value_at_payment, created_at: payment_receipts.created_at })
    .from(payment_receipts)
    .where(gte(payment_receipts.created_at, since));

  const dayMap = new Map<string, number>();
  for (const r of receipts) {
    const date = new Date(r.created_at).toISOString().slice(0, 10);
    dayMap.set(date, (dayMap.get(date) || 0) + Number(r.usd || 0));
  }

  const dailyVolume = Array.from(dayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, volume]) => ({ date, volume_usd: Number(volume.toFixed(2)) }));

  const railSplit = receipts.reduce(
    (acc, r) => {
      const rail = railFromReceipt(r);
      acc[rail] += Number(r.usd || 0);
      return acc;
    },
    { mpp: 0, x402: 0 },
  );

  const modeSplit = receipts.reduce(
    (acc, r) => {
      const mode = modeFromRoute(r.route || '');
      acc[mode] += Number(r.usd || 0);
      return acc;
    },
    { session: 0, charge: 0 },
  );

  const settledTrades = await db
    .select({ seller_id: trades.seller_id, seller_amount: trades.seller_amount })
    .from(trades)
    .where(or(eq(trades.status, 'completed'), eq(trades.status, 'complete')));

  const sellerTotals = new Map<string, number>();
  for (const t of settledTrades) {
    sellerTotals.set(t.seller_id, (sellerTotals.get(t.seller_id) || 0) + Number(t.seller_amount || 0));
  }

  const sellerIds = Array.from(sellerTotals.keys());
  const sellerUsers = sellerIds.length
    ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, sellerIds))
    : [];
  const userNameById = new Map(sellerUsers.map((u) => [u.id, u.name]));

  const perAgentEarnings = sellerIds
    .map((sellerId) => ({
      seller_id: sellerId,
      name: userNameById.get(sellerId) || 'Unknown',
      earnings_usd: Number((sellerTotals.get(sellerId) || 0).toFixed(2)),
    }))
    .sort((a, b) => b.earnings_usd - a.earnings_usd);

  const activeSessions = await db
    .select({ reserved_amount: mpp_sessions.reserved_amount, spent_amount: mpp_sessions.spent_amount })
    .from(mpp_sessions)
    .where(eq(mpp_sessions.status, 'active'));

  const openSessionValue = activeSessions.reduce((sum, s) => sum + Math.max(0, Number(s.reserved_amount || 0) - Number(s.spent_amount || 0)), 0);

  return NextResponse.json({
    daily_volume_last_30_days: dailyVolume,
    per_agent_earnings: perAgentEarnings,
    payment_rail_split: {
      mpp: Number(railSplit.mpp.toFixed(2)),
      x402: Number(railSplit.x402.toFixed(2)),
    },
    session_vs_charge_split: {
      session: Number(modeSplit.session.toFixed(2)),
      charge: Number(modeSplit.charge.toFixed(2)),
    },
    open_session_value: Number(openSessionValue.toFixed(2)),
    platform_fees_usd: Number(((railSplit.mpp + railSplit.x402) * 0.05).toFixed(2)),
  });
}
