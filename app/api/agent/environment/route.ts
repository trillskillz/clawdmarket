import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { event_stream, listings, trades, transactions } from '@/lib/schema';
import { getBalance } from '@/lib/wallet';
import {
  ACTIONS,
  FAILURE_MODES,
  LATENCY_BENCHMARKS_MS,
  SUBSCRIPTIONS,
  envMeta,
} from '@/lib/agent-environment';
import { desc, eq, or } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

  if (!auth) {
    return NextResponse.json(
      {
        error: 'Unauthorized',
        code: 'UNAUTHORIZED',
        ...envMeta('clawdmarket/api/agent/environment'),
      },
      { status: 401 }
    );
  }

  const includeSnapshot = req.nextUrl.searchParams.get('snapshot') === '1';

  const base = {
    environment_declaration: {
      actions: ACTIONS,
      subscriptions: SUBSCRIPTIONS,
      latency_benchmarks_ms: LATENCY_BENCHMARKS_MS,
      failure_modes: FAILURE_MODES,
      transaction_guarantees: {
        atomic: true,
        partial_fills_default: false,
        pending_external_resolution: false,
      },
      trust: {
        authenticated_instructions_required: true,
        tamper_evidence: 'Bearer/JWT validation + webhook signatures',
        replay_protection: 'Token validation + request freshness controls',
      },
      counterparty_contract: {
        parameters_immutable_per_request: true,
        detectable_deviation: true,
      },
    },
    ...envMeta('clawdmarket/api/agent/environment'),
  };

  if (!includeSnapshot) {
    return NextResponse.json(base);
  }

  const [balance, openTrades, recentTransactions, activeListings, eventTail] = await Promise.all([
    getBalance(auth.userId),
    db
      .select()
      .from(trades)
      .where(or(eq(trades.buyer_id, auth.userId), eq(trades.seller_id, auth.userId)))
      .orderBy(desc(trades.created_at))
      .limit(100),
    db
      .select()
      .from(transactions)
      .where(or(eq(transactions.from_user_id, auth.userId), eq(transactions.to_user_id, auth.userId)))
      .orderBy(desc(transactions.created_at))
      .limit(200),
    db
      .select()
      .from(listings)
      .where(eq(listings.seller_id, auth.userId))
      .orderBy(desc(listings.created_at))
      .limit(100),
    db
      .select()
      .from(event_stream)
      .where(eq(event_stream.user_id, auth.userId))
      .orderBy(desc(event_stream.sequence_id))
      .limit(50),
  ]);

  const seqs = eventTail.map((e) => e.sequence_id).sort((a, b) => a - b);
  const contiguous = seqs.every((seq, idx) => idx === 0 || seq === seqs[idx - 1] + 1);

  return NextResponse.json({
    ...base,
    snapshot: {
      wallet: balance,
      trades: openTrades,
      listings: activeListings,
      transactions: recentTransactions,
      event_stream_tail: eventTail,
      reconciliation: {
        gap_detected: !contiguous,
        gap_reason: contiguous ? null : 'SEQUENCE_DISCONTINUITY',
        requires_resubscribe: !contiguous,
        proof: {
          first_sequence_id: seqs[0] ?? null,
          last_sequence_id: seqs[seqs.length - 1] ?? null,
          sample_size: seqs.length,
        },
      },
    },
  });
}
