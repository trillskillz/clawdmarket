import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, trades } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/validation';
import { payerAddressFromRequest, finalizeTradeCompletion } from '@/lib/trade-escrow';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid trade ID' }, { status: 400 });

  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
  if (trade.buyer_id !== auth.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (trade.status !== 'pending_release') return NextResponse.json({ error: 'Trade is not pending release' }, { status: 400 });

  const payerAddress = payerAddressFromRequest(req);
  const [buyerAgent] = await db.select().from(agents).where(eq(agents.id, trade.buyer_id)).limit(1);
  if (!payerAddress || !buyerAgent || payerAddress !== buyerAgent.owner_address.toLowerCase()) {
    return NextResponse.json({ error: 'forbidden', message: 'Payer must match buyer owner_address.' }, { status: 403 });
  }

  try {
    const updated = await finalizeTradeCompletion(trade, 'buyer_confirm');
    return NextResponse.json({ ok: true, trade: updated, status: 'completed' });
  } catch (error: any) {
    if (error?.message === 'TRADE_NOT_PENDING_RELEASE') return NextResponse.json({ error: 'Trade already updated' }, { status: 409 });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
