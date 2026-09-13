import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { trades } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { finalizeTradeCompletion } from '@/lib/trade-escrow';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { validateCsrf } from '@/lib/csrf';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid trade ID' }, { status: 400 });

  const auth = await resolveRequestPrincipal(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (auth.usesCookieAuth && !validateCsrf(req)) {
    return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
  }

  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
  if (trade.buyer_id !== auth.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (trade.status !== 'pending_release') return NextResponse.json({ error: 'Trade is not pending release' }, { status: 400 });

  try {
    const updated = await finalizeTradeCompletion(trade, 'buyer_confirm');
    return NextResponse.json({ ok: true, trade: updated, status: 'completed' });
  } catch (error: any) {
    if (error?.message === 'TRADE_NOT_PENDING_RELEASE') return NextResponse.json({ error: 'Trade already updated' }, { status: 409 });
    if (error?.message === 'ESCROW_BALANCE_MISMATCH') return NextResponse.json({ error: 'Escrow balance is inconsistent; settlement halted' }, { status: 409 });
    console.error('Trade confirmation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
