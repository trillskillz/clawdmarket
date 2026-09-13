import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { agents, messages, users } from '@/lib/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { encryptMessage } from '@/lib/chat-crypto';
import { deliverWebhookEvent } from '@/lib/webhook-delivery';
import { resolveRequestPrincipal } from '@/lib/request-principal';
import { validateCsrf } from '@/lib/csrf';
import { ensureSyntheticAgentUser } from '@/lib/registered-agent-auth';

import { DeliveryError, submitTradeDelivery } from '@/lib/trade-delivery';

export const dynamic = 'force-dynamic'

function parsePayload(content?: string) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// POST /api/messages
// Send an encrypted message
export async function POST(req: NextRequest) {
  try {
    const principal = await resolveRequestPrincipal(req);
    if (!principal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (principal.usesCookieAuth && !validateCsrf(req)) {
      return NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    let receiverId = String(body.receiverId || body.receiver_id || body.to_agent_id || '').trim();
    let content = typeof body.content === 'string' ? body.content : '';
    if (!content && typeof body.type === 'string') {
      content = JSON.stringify({ type: body.type, payload: body.payload ?? null });
    }
    const encryptedContent = body.encryptedContent || body.encrypted_content;
    const nonce = body.nonce;

    if (receiverId && !receiverId.startsWith('user_agent_')) {
      const [registeredAgent] = await db
        .select({ id: agents.id, name: agents.name })
        .from(agents)
        .where(and(eq(agents.id, receiverId), eq(agents.status, 'active')))
        .limit(1);
      if (registeredAgent) {
        await ensureSyntheticAgentUser({
          agentId: registeredAgent.id,
          name: registeredAgent.name,
          syntheticUserId: `user_agent_${registeredAgent.id}`,
        });
        receiverId = `user_agent_${registeredAgent.id}`;
      }
    }

    if (!receiverId || (!content && (!encryptedContent || !nonce))) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }
    if (receiverId === principal.userId) {
      return NextResponse.json({ error: 'Cannot message yourself' }, { status: 400 });
    }
    if (content.length > 10_000 || String(encryptedContent || '').length > 20_000 || String(nonce || '').length > 512) {
      return NextResponse.json({ error: 'Message payload is too large' }, { status: 413 });
    }

    const [receiver] = await db.select({ id: users.id }).from(users).where(eq(users.id, receiverId)).limit(1);
    if (!receiver) {
      return NextResponse.json({ error: 'Receiver not found' }, { status: 404 });
    }

    const parsed = parsePayload(content);
    if (parsed?.type === 'task_complete' && typeof parsed?.trade_id === 'string') {
      const { delivery, message } = await submitTradeDelivery(parsed.trade_id, principal.userId, parsed, receiverId);
      return NextResponse.json({ ...message, delivery_id: delivery.id }, { status: 201 });
    }

    const payload = content
      ? await encryptMessage(content)
      : { encrypted_content: encryptedContent, nonce };

    const message = await db.insert(messages).values({
      sender_id: principal.userId,
      receiver_id: receiverId,
      encrypted_content: payload.encrypted_content,
      nonce: payload.nonce,
    }).returning();

    await deliverWebhookEvent(receiverId, 'message.received', {
      message_id: message[0].id,
      from_agent_id: principal.userId,
      type: parsed?.type || 'custom',
      payload: parsed || null,
    });

    return NextResponse.json(message[0], { status: 201 });
  } catch (error) {
    if (error instanceof DeliveryError) return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
    console.error('Error sending message:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET /api/messages
// List recent conversations
export async function GET(req: NextRequest) {
  try {
    const principal = await resolveRequestPrincipal(req);
    if (!principal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = principal.userId;

    // Fetch distinct conversation partners
    const sent = await db.query.messages.findMany({
      where: eq(messages.sender_id, userId),
      columns: { receiver_id: true, created_at: true },
      orderBy: [desc(messages.created_at)],
    });

    const received = await db.query.messages.findMany({
      where: eq(messages.receiver_id, userId),
      columns: { sender_id: true, created_at: true },
      orderBy: [desc(messages.created_at)],
    });

    // Combine and deduce partners
    const partners = new Set<string>();
    sent.forEach((m) => partners.add(m.receiver_id));
    received.forEach((m) => partners.add(m.sender_id));

    // Fetch partner details (name, avatar)
    const partnerDetails = await db.query.users.findMany({
      where: inArray(users.id, Array.from(partners)),
      columns: {
        id: true,
        name: true,
        avatar_url: true,
        avatar_emoji: true,
        bio: true,
        role: true,
      },
    });

    return NextResponse.json(partnerDetails);
  } catch (error) {
    console.error('Error listing conversations:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
