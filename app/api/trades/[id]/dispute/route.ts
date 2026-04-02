import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, messages, trade_evidence, trades } from '@/lib/schema';
import { authenticateRequest } from '@/lib/auth';
import { isValidUUID } from '@/lib/validation';
import { encryptMessage } from '@/lib/chat-crypto';
import { payerAddressFromRequest } from '@/lib/trade-escrow';
import { deliverWebhookEvent } from '@/lib/webhook-delivery';

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUUID(id)) return NextResponse.json({ error: 'Invalid trade ID' }, { status: 400 });

  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('auth-token')?.value;
  const auth = await authenticateRequest(authHeader || (cookieToken ? `Bearer ${cookieToken}` : null));
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return NextResponse.json({ error: 'reason is required' }, { status: 400 });

  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
  if (trade.buyer_id !== auth.userId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (trade.status !== 'pending_release' && trade.status !== 'escrow_held') {
    return NextResponse.json({ error: 'Trade cannot be disputed in current status' }, { status: 400 });
  }

  const payerAddress = payerAddressFromRequest(req);
  const [buyerAgent] = await db.select().from(agents).where(eq(agents.id, trade.buyer_id)).limit(1);
  if (!payerAddress || !buyerAgent || payerAddress !== buyerAgent.owner_address.toLowerCase()) {
    return NextResponse.json({ error: 'forbidden', message: 'Payer must match buyer owner_address.' }, { status: 403 });
  }

  const [updated] = await db.update(trades)
    .set({ status: 'disputed', dispute_reason: reason })
    .where(and(eq(trades.id, trade.id), eq(trades.status, trade.status as any)))
    .returning();

  if (!updated) return NextResponse.json({ error: 'Trade already updated' }, { status: 409 });

  if (typeof body?.content === 'string' || typeof body?.evidence_url === 'string') {
    await db.insert(trade_evidence).values({
      trade_id: trade.id,
      submitter_agent_id: auth.userId,
      content: typeof body?.content === 'string' ? body.content : null,
      evidence_url: typeof body?.evidence_url === 'string' ? body.evidence_url : null,
    });
  }

  const buyerMsg = await encryptMessage(JSON.stringify({ type: 'trade_disputed', trade_id: trade.id, reason }));
  const sellerMsg = await encryptMessage(JSON.stringify({ type: 'trade_disputed', trade_id: trade.id, reason }));
  await db.insert(messages).values([
    { sender_id: trade.seller_id, receiver_id: trade.buyer_id, encrypted_content: buyerMsg.encrypted_content, nonce: buyerMsg.nonce },
    { sender_id: trade.buyer_id, receiver_id: trade.seller_id, encrypted_content: sellerMsg.encrypted_content, nonce: sellerMsg.nonce },
  ]);

  await deliverWebhookEvent(trade.buyer_id, 'trade.disputed', { trade_id: trade.id, reason });
  await deliverWebhookEvent(trade.seller_id, 'trade.disputed', { trade_id: trade.id, reason });
  await deliverWebhookEvent(trade.buyer_id, 'trade.status_changed', { trade_id: trade.id, old_status: trade.status, new_status: 'disputed' });
  await deliverWebhookEvent(trade.seller_id, 'trade.status_changed', { trade_id: trade.id, old_status: trade.status, new_status: 'disputed' });

  return NextResponse.json({ ok: true, trade: updated });
}
