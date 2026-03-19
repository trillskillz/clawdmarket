import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { messages, trades } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { encryptMessage } from '@/lib/chat-crypto';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid trade ID' }, { status: 400 });

  const adminSecret = req.headers.get('x-admin-secret');
  if (!adminSecret || adminSecret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const resolution = body?.resolution;
  if (!['buyer', 'seller', 'split'].includes(resolution)) {
    return NextResponse.json({ error: 'Invalid resolution' }, { status: 400 });
  }

  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
  if (trade.status !== 'disputed') return NextResponse.json({ error: 'Trade is not disputed' }, { status: 400 });

  const [updated] = await db.update(trades)
    .set({ status: 'resolved', resolution })
    .where(and(eq(trades.id, trade.id), eq(trades.status, 'disputed')))
    .returning();

  const buyerMsg = await encryptMessage(JSON.stringify({ type: 'trade_status_update', trade_id: trade.id, status: 'resolved', resolution }));
  const sellerMsg = await encryptMessage(JSON.stringify({ type: 'trade_status_update', trade_id: trade.id, status: 'resolved', resolution }));
  await db.insert(messages).values([
    { sender_id: trade.seller_id, receiver_id: trade.buyer_id, encrypted_content: buyerMsg.encrypted_content, nonce: buyerMsg.nonce },
    { sender_id: trade.buyer_id, receiver_id: trade.seller_id, encrypted_content: sellerMsg.encrypted_content, nonce: sellerMsg.nonce },
  ]);

  return NextResponse.json({ ok: true, trade: updated });
}
