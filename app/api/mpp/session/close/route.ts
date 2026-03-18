import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { Receipt } from 'mppx';
import { db } from '@/lib/db';
import { mpp_sessions } from '@/lib/schema';
import { mppx } from '@/lib/mpp';

const closeSessionPaidRoute = mppx.session({
  amount: '0',
  unitType: 'request',
})(async (_request: Request) => {
  return NextResponse.json({ ok: true });
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const requestedSessionId = String(body?.session_id || '').trim();

  const mppResponse = await closeSessionPaidRoute(req);
  const receiptHeader = mppResponse.headers.get('Payment-Receipt');

  if (!receiptHeader) {
    return mppResponse;
  }

  let receipt: Record<string, any>;
  try {
    receipt = Receipt.deserialize(receiptHeader) as Record<string, any>;
  } catch {
    return mppResponse;
  }

  const sessionId = String(receipt.channelId || receipt.reference || requestedSessionId || '').trim();
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id is required' }, { status: 400 });
  }

  const spentAmount = Number(receipt.spent ?? 0);
  const now = new Date();

  const existing = await db.select().from(mpp_sessions).where(eq(mpp_sessions.session_id, sessionId)).limit(1);

  if (existing.length > 0) {
    await db
      .update(mpp_sessions)
      .set({
        spent_amount: Number.isFinite(spentAmount) ? spentAmount : existing[0].spent_amount,
        status: 'closed',
        closed_at: now,
      })
      .where(eq(mpp_sessions.session_id, sessionId));
  } else {
    await db.insert(mpp_sessions).values({
      session_id: sessionId,
      agent_id: String(body?.agent_id || 'unknown-agent'),
      payer_address: String(receipt.payerAddress || receipt.payer || receipt.from || body?.payer_address || '').trim() || null,
      reserved_amount: Number(body?.reserved_amount || 0),
      spent_amount: Number.isFinite(spentAmount) ? spentAmount : 0,
      status: 'closed',
      created_at: now,
      closed_at: now,
    });
  }

  const responseWithBody = NextResponse.json(
    {
      ok: true,
      session: {
        session_id: sessionId,
        spent_amount: Number.isFinite(spentAmount) ? spentAmount : 0,
        status: 'closed',
        closed_at: now.toISOString(),
      },
      mpp_receipt: receipt,
    },
    { status: 200 },
  );

  for (const [k, v] of mppResponse.headers.entries()) {
    responseWithBody.headers.set(k, v);
  }

  return responseWithBody;
}
