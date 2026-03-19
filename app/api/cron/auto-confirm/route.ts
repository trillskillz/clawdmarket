import { NextRequest, NextResponse } from 'next/server';
import { and, eq, lte } from 'drizzle-orm';
import { db } from '@/lib/db';
import { trades } from '@/lib/schema';
import { finalizeTradeCompletion } from '@/lib/trade-escrow';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const nowIso = new Date().toISOString();
  const due = await db.select().from(trades).where(and(eq(trades.status, 'pending_release'), lte(trades.auto_confirm_at, nowIso)));

  let processed = 0;
  for (const trade of due) {
    try {
      await finalizeTradeCompletion(trade, 'auto_confirm');
      processed += 1;
    } catch {
      // no-op, continue
    }
  }

  return NextResponse.json({ ok: true, processed, total_due: due.length });
}
