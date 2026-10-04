import { payoutAddressForUser } from '@/lib/external-settlement';
import { creditBalance, instantCreditBalance } from '@/lib/account-credit';
import { accountOwnsAgent } from '@/lib/agent-owner-auth';
import { credit_entries } from '@/lib/schema';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { transactions, wallets } from '@/lib/schema';
import { logger } from '@/lib/logger';
import { rateLimit, getRateLimitHeaders } from '@/lib/rate-limit';
import { eq, or, desc } from 'drizzle-orm';
import { envMeta } from '@/lib/agent-environment';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { getRequestIp } from '@/lib/request-ip';

export const dynamic = 'force-dynamic'

/**
 * GET /api/wallet — Get authenticated user's wallet balance + recent transactions
 */
export async function GET(req: NextRequest) {
  const auth = await resolveRequestPrincipal(req);

  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ip = getRequestIp(req);
  const rateLimitResult = await rateLimit(`wallet:${ip}`, { interval: 60 * 1000, maxRequests: 30 });
  if (!rateLimitResult.success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...getRateLimitHeaders(rateLimitResult), 'Cache-Control': 'no-store' } });
  }

  try {
    const agentId = req.nextUrl.searchParams.get('agent_id');
    if (agentId && auth.agentId !== agentId && (auth.kind !== 'account' || auth.agentId || !await accountOwnsAgent(auth.userId, agentId))) return NextResponse.json({ error: 'Agent not owned' }, { status: 403 });
    const subject = agentId ? `user_agent_${agentId}` : auth.userId;
    const credit = await creditBalance(subject);
    const balance = { balance: credit.available_minor / 100, available: credit.available_minor / 100, escrow: credit.escrow_minor / 100 };
    const [historicalWallet] = await db.select().from(wallets).where(eq(wallets.user_id, subject)).limit(1);
    const historical = { balance: historicalWallet?.balance ?? 0, escrow: historicalWallet?.escrow ?? 0 };
    const activity = await db.select().from(credit_entries).where(eq(credit_entries.user_id, subject)).orderBy(desc(credit_entries.created_at)).limit(30);

    const recentTx = await db
      .select()
      .from(transactions)
      .where(
        or(
          eq(transactions.from_user_id, subject),
          eq(transactions.to_user_id, subject),
        ),
      )
      .orderBy(desc(transactions.created_at))
      .limit(25);

    return NextResponse.json({
      account_id: subject,
      instant_credit: await instantCreditBalance(subject),
      connected_wallet_address: await payoutAddressForUser(subject),
      ticker: 'USD_CREDIT',
      ...balance,
      total_credit: (credit.available_minor + credit.escrow_minor) / 100,
      credit,
      credit_activity: activity,
      historical_credit: { ...historical, spendable: false },
      transactions: recentTx,
      ...envMeta('clawdmarket/api/wallet'),
    }, { headers: { ...getRateLimitHeaders(rateLimitResult), 'Cache-Control': 'no-store' } });
  } catch (error) {
    logger.error('Wallet fetch error', { err: String(error) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
