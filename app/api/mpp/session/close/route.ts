import { NextRequest, NextResponse } from 'next/server';
import { mppx } from '@/lib/mpp';
import { db } from '@/lib/db';

const closeGate = mppx.session({ amount: '0', unitType: 'request' })(async () => NextResponse.json({ ok: true }));

async function closeInDb(session_id: string) {
  const client = (db as any)?.$client;
  const row = await client.execute({
    sql: `SELECT session_id, spent_amount FROM mpp_sessions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`,
    args: [session_id],
  });

  const spent_amount = String(row?.rows?.[0]?.spent_amount ?? '0');

  await client.execute({
    sql: `UPDATE mpp_sessions SET status = 'closed', closed_at = datetime('now') WHERE session_id = ?`,
    args: [session_id],
  });

  return { session_id, spent_amount };
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as any));
  const session_id = String(body?.session_id || '').trim();
  if (!session_id) return NextResponse.json({ error: 'session_id is required' }, { status: 400 });

  try {
    const gated = await closeGate(request);
    if (gated.status === 410) {
      const session = await closeInDb(session_id);
      return NextResponse.json({ ok: true, status: 'closed', session });
    }

    const session = await closeInDb(session_id);
    const res = NextResponse.json({ ok: true, status: 'closed', session });
    for (const [k, v] of gated.headers.entries()) res.headers.set(k, v);
    return res;
  } catch (err: any) {
    const msg = String(err?.message || '').toLowerCase();
    if (msg.includes('410') || msg.includes('channel-not-found') || msg.includes('channel not found')) {
      const session = await closeInDb(session_id);
      return NextResponse.json({ ok: true, status: 'closed', session });
    }
    return NextResponse.json({ error: 'session_close_failed', detail: err?.message || 'unknown' }, { status: 500 });
  }
}
