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

async function markClosedIfExists(sessionId: string) {
  if (!sessionId) return;
  const now = new Date();
  await db
    .update(mpp_sessions)
    .set({
      status: 'closed',
      closed_at: now,
    })
    .where(eq(mpp_sessions.session_id, sessionId));
}

function alreadyClosedResponse(sessionId: string) {
  return NextResponse.json(
    {
      ok: true,
      status: 'already_closed',
      session: {
        session_id: sessionId,
        status: 'closed',
      },
    },
    { status: 200 },
  );
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const requestedSessionId = String(body?.session_id || '').trim();

  let mppResponse: Response;
  try {
    mppResponse = await closeSessionPaidRoute(req);
  } catch (error: any) {
    const msg = String(error?.message || error || '').toLowerCase();
    if (msg.includes('channel-not-found') || msg.includes('channel not found')) {
      await markClosedIfExists(requestedSessionId);
      return alreadyClosedResponse(requestedSessionId);
    }
    throw error;
  }

  if (mppResponse.status === 410) {
    await markClosedIfExists(requestedSessionId);
    return alreadyClosedResponse(requestedSessionId);
  }

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

  const now = new Date();

  const existing = await db.select().from(mpp_sessions).where(eq(mpp_sessions.session_id, sessionId)).limit(1);
  if (existing.length === 0) {
    return alreadyClosedResponse(sessionId);
  }

  const receiptSpentRaw = Number(receipt.spent ?? receipt.spentAmount ?? 0);
  const resolvedSpentAmount = Number.isFinite(receiptSpentRaw) && receiptSpentRaw > 0
    ? receiptSpentRaw
    : Number(existing[0].spent_amount) || 0;

  await db
    .update(mpp_sessions)
    .set({
      spent_amount: resolvedSpentAmount,
      status: 'closed',
      closed_at: now,
    })
    .where(eq(mpp_sessions.session_id, sessionId));

  const responseWithBody = NextResponse.json(
    {
      ok: true,
      session: {
        session_id: sessionId,
        spent_amount: resolvedSpentAmount,
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
