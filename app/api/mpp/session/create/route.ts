import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { Receipt } from 'mppx';
import { authenticateRequest } from '@/lib/auth';
import { db } from '@/lib/db';
import { mpp_sessions } from '@/lib/schema';
import { mppx } from '@/lib/mpp';
import { ensureMppSessionsSchema } from '@/lib/mpp-sessions-schema-ensure';

const LOG = (step: string, data?: unknown) =>
  console.log(JSON.stringify({ mpp_session: step, ...(data ? { data } : {}) }));

const createSessionPaidRoute = mppx.session({
  amount: '0.001',
  unitType: 'request',
  suggestedDeposit: '0.01',
})(async (_request: Request) => {
  return NextResponse.json({ ok: true });
});

export async function POST(req: NextRequest) {
  try {
    LOG('handler_entered', { method: req.method });

    const authHeader = req.headers.get('authorization');
    const cookieToken = req.cookies.get('auth-token')?.value;
    const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));

    const body = await req.json().catch(() => ({} as any));
    const agentId = String(body?.agent_id || auth?.userId || '').trim();
    if (!agentId) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }

    const mppResponse = await createSessionPaidRoute(req);
    const receiptHeader = mppResponse.headers.get('Payment-Receipt');

    if (!receiptHeader) {
      return mppResponse;
    }

    let receipt: Record<string, any>;
    try {
      receipt = Receipt.deserialize(receiptHeader) as Record<string, any>;
      LOG('receipt_received', { receipt: JSON.stringify(receipt) });
    } catch {
      return mppResponse;
    }

    const sessionId = String(receipt.channelId || receipt.reference || body?.session_id || '').trim();
    if (!sessionId) {
      return NextResponse.json({ error: 'MPP session receipt did not include a session identifier' }, { status: 500 });
    }

    const reservedAmount = Number(body?.reserved_amount ?? receipt.acceptedCumulative ?? 0);

    const normalizeReceiptAmount = (value: unknown) => {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      if (n >= 1000) return n / 1_000_000;
      return n;
    };

    const spentIncrement =
      normalizeReceiptAmount(receipt.amount) ??
      normalizeReceiptAmount(receipt.value) ??
      normalizeReceiptAmount(receipt.spentDelta) ??
      normalizeReceiptAmount(receipt?.request?.amount) ??
      0.001;

    const payerAddress = String(receipt.payerAddress || receipt.payer || receipt.from || body?.payer_address || '').trim() || null;

    LOG('schema_ensure_start');
    await ensureMppSessionsSchema();
    LOG('schema_ensure_done');

    LOG('db_write_start', { sessionId, payerAddress, amount: spentIncrement });

    const existing = await db.select().from(mpp_sessions).where(eq(mpp_sessions.session_id, sessionId)).limit(1);

    let updatedSpentAmount = spentIncrement;
    if (existing.length > 0) {
      updatedSpentAmount = (Number(existing[0].spent_amount) || 0) + spentIncrement;
      await db
        .update(mpp_sessions)
        .set({
          agent_id: agentId,
          payer_address: payerAddress,
          reserved_amount: Number.isFinite(reservedAmount) ? reservedAmount : existing[0].reserved_amount,
          spent_amount: updatedSpentAmount,
          status: 'active',
          closed_at: null,
        })
        .where(eq(mpp_sessions.session_id, sessionId));
    } else {
      updatedSpentAmount = spentIncrement;
      await db.insert(mpp_sessions).values({
        session_id: sessionId,
        agent_id: agentId,
        payer_address: payerAddress,
        reserved_amount: Number.isFinite(reservedAmount) ? reservedAmount : 0,
        spent_amount: updatedSpentAmount,
        status: 'active',
      });
    }

    LOG('db_write_done');

    const responseWithBody = NextResponse.json(
      {
        ok: true,
        session: {
          session_id: sessionId,
          agent_id: agentId,
          payer_address: payerAddress,
          reserved_amount: Number.isFinite(reservedAmount) ? reservedAmount : 0,
          spent_amount: updatedSpentAmount,
          status: 'active',
        },
        mpp_receipt: receipt,
      },
      { status: 201 },
    );

    for (const [k, v] of mppResponse.headers.entries()) {
      responseWithBody.headers.set(k, v);
    }

    LOG('response_ok');
    return responseWithBody;
  } catch (error: any) {
    LOG('error', { message: error?.message, stack: error?.stack });
    return Response.json({ error: 'session_create_failed', detail: error?.message }, { status: 500 });
  }
}
