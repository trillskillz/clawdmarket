import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transactions, trades } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { getBalance } from '@/lib/wallet';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { eq, or, desc, and, sql } from 'drizzle-orm';
import { envMeta } from '@/lib/agent-environment';

export const dynamic = 'force-dynamic'

/**
 * GET /api/wallet — Get authenticated user's wallet balance + recent transactions
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  const rateLimitResult = rateLimit(`wallet:${ip}`, { interval: 60 * 1000, maxRequests: 30 });
  if (!rateLimitResult.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: getRateLimitHeaders(rateLimitResult) });
  }

  try {
    const balance = await getBalance(auth.userId);

    const [pending] = await db
      .select({ pending_escrow: sql<number>`coalesce(sum(${trades.amount}), 0)` })
      .from(trades)
      .where(and(eq(trades.buyer_id, auth.userId), eq(trades.status, 'pending')));

    const recentTx = await db
      .select()
      .from(transactions)
      .where(
        or(
          eq(transactions.from_user_id, auth.userId),
          eq(transactions.to_user_id, auth.userId),
        ),
      )
      .orderBy(desc(transactions.created_at))
      .limit(25);

    const pendingEscrow = Number(pending?.pending_escrow || 0);
    const escrow = Math.max(balance.escrow, pendingEscrow);

    return NextResponse.json({
      ticker: '$BANKR',
      ...balance,
      escrow,
      available: Math.max(0, balance.balance - escrow),
      transactions: recentTx,
      ...envMeta('clawdmarket/api/wallet'),
    }, { headers: getRateLimitHeaders(rateLimitResult) });
  } catch (error) {
    console.error('Wallet fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
