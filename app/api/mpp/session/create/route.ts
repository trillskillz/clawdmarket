import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { Receipt } from 'mppx';
import { db } from '@/lib/db';
import { mppx } from '@/lib/mpp';

const log = (step: string, data: Record<string, unknown> = {}) => {
  console.log(JSON.stringify({ mpp_session: step, data }));
};

const sessionGate = mppx.session({ amount: '0', unitType: 'request' })(async () => NextResponse.json({ ok: true }));

async function ensureTable() {
  const client = (db as any)?.$client;
  if (!client?.execute) return;
  await client.execute({
    sql: `CREATE TABLE IF NOT EXISTS mpp_sessions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      channel_id TEXT,
      payer_address TEXT,
      reserved_amount TEXT,
      spent_amount TEXT DEFAULT '0',
      status TEXT DEFAULT 'open',
      created_at TEXT DEFAULT (datetime('now')),
      closed_at TEXT,
      close_tx_hash TEXT
    )`,
    args: [],
  });
}

export async function POST(request: NextRequest) {
  try {
    log('entered');
    await ensureTable();
    log('table_ready');

    const gated = await sessionGate(request);
    const receiptHeader = gated.headers.get('Payment-Receipt');
    if (!receiptHeader) return gated;

    let receipt: any = null;
    try {
      receipt = Receipt.deserialize(receiptHeader);
    } catch {
      return gated;
    }

    const session_id = String(receipt?.channelId || receipt?.reference || '').trim();
    if (!session_id) {
      return NextResponse.json({ error: 'session_create_failed', detail: 'missing_session_id' }, { status: 500 });
    }

    const payer = String(receipt?.payerAddress || receipt?.payer || '').trim() || null;
    const reserved = String(receipt?.acceptedCumulative || receipt?.amount || '0');

    const client = (db as any)?.$client;
    await client.execute({
      sql: `INSERT INTO mpp_sessions (id, session_id, channel_id, payer_address, reserved_amount, spent_amount, status)
            VALUES (?, ?, ?, ?, ?, '0', 'open')`,
      args: [randomUUID(), session_id, session_id, payer, reserved],
    });

    log('inserted', { session_id, payer });

    const res = NextResponse.json({ ok: true, session_id, status: 'open' });
    for (const [k, v] of gated.headers.entries()) res.headers.set(k, v);
    return res;
  } catch (err: any) {
    log('error', { message: err?.message || 'unknown' });
    return NextResponse.json({ error: 'session_create_failed', detail: err?.message || 'unknown' }, { status: 500 });
  }
}
