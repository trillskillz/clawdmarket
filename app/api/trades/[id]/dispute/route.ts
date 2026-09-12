import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { messages, trade_evidence, trades } from '@/lib/schema';
import { isValidUUID } from '@/lib/validation';
import { encryptMessage } from '@/lib/chat-crypto';
import { deliverWebhookEvent } from '@/lib/webhook-delivery';
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

  const body = await req.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 1000) : '';
  if (!reason) return NextResponse.json({ error: 'reason is required' }, { status: 400 });
  const evidenceContent = typeof body?.content === 'string' ? body.content.trim().slice(0, 20_000) : '';
  const evidenceUrl = typeof body?.evidence_url === 'string' ? body.evidence_url.trim().slice(0, 2_000) : '';
  if (evidenceUrl) {
    try {
      const parsed = new URL(evidenceUrl);
      if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('unsupported protocol');
    } catch {
      return NextResponse.json({ error: 'evidence_url must be an HTTP(S) URL' }, { status: 400 });
    }
  }

  const [trade] = await db.select().from(trades).where(eq(trades.id, id)).limit(1);
  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
  if (trade.buyer_id !== auth.userId && trade.seller_id !== auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (trade.status !== 'pending_release' && trade.status !== 'escrow_held') {
    return NextResponse.json({ error: 'Trade cannot be disputed in current status' }, { status: 400 });
  }

  const updated = await db.transaction(async (tx) => {
    const [claimed] = await tx.update(trades)
      .set({ status: 'disputed', dispute_reason: reason })
      .where(and(eq(trades.id, trade.id), eq(trades.status, trade.status as any)))
      .returning();
    if (!claimed) return null;
    if (evidenceContent || evidenceUrl) {
      await tx.insert(trade_evidence).values({
        trade_id: trade.id,
        submitter_agent_id: auth.userId,
        content: evidenceContent || `Evidence link: ${evidenceUrl}`,
        evidence_url: evidenceUrl || null,
      });
    }
    return claimed;
  });

  if (!updated) return NextResponse.json({ error: 'Trade already updated' }, { status: 409 });

  await Promise.allSettled([
    (async () => {
      const message = await encryptMessage(JSON.stringify({ type: 'trade_disputed', trade_id: trade.id, reason }));
      const receiverId = auth.userId === trade.buyer_id ? trade.seller_id : trade.buyer_id;
      await db.insert(messages).values({
        sender_id: auth.userId,
        receiver_id: receiverId,
        encrypted_content: message.encrypted_content,
        nonce: message.nonce,
      });
    })(),
    deliverWebhookEvent(trade.buyer_id, 'trade.disputed', { trade_id: trade.id, reason }),
    deliverWebhookEvent(trade.seller_id, 'trade.disputed', { trade_id: trade.id, reason }),
    deliverWebhookEvent(trade.buyer_id, 'trade.status_changed', { trade_id: trade.id, old_status: trade.status, new_status: 'disputed' }),
    deliverWebhookEvent(trade.seller_id, 'trade.status_changed', { trade_id: trade.id, old_status: trade.status, new_status: 'disputed' }),
  ]);

  return NextResponse.json({ ok: true, trade: updated });
}
