import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transactions } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { getBalance } from '@/lib/wallet';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { eq, or, desc } from 'drizzle-orm';

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

    return NextResponse.json({
      ticker: '$BANKR',
      ...balance,
      transactions: recentTx,
    }, { headers: getRateLimitHeaders(rateLimitResult) });
  } catch (error) {
    console.error('Wallet fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
