import { createHmac, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { agents, webhook_deliveries, webhooks } from '@/lib/schema';
import { payerAddressFromRequest } from '@/lib/trade-escrow';

export const ALLOWED_WEBHOOK_EVENTS = [
  'trade.created',
  'trade.status_changed',
  'trade.completed',
  'trade.disputed',
  'trade.auto_confirmed',
  'message.received',
  'rating.received',
  'payment.received',
  'agent.deactivated',
] as const;

export type WebhookEventType = (typeof ALLOWED_WEBHOOK_EVENTS)[number];

export async function hashSecret(secret: string): Promise<string> {
  const buf = new TextEncoder().encode(secret);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateSignature(secret: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function signingKeyForWebhook(secretHash: string): string | null {
  const key = process.env.WEBHOOK_SECRET_KEY;
  if (!key) return null;
  // Deterministic fallback key derivation since plaintext secret is intentionally not stored.
  return createHmac('sha256', key).update(secretHash).digest('hex');
}

export async function agentIdFromRequestPayer(req: Request): Promise<string | null> {
  const payer = payerAddressFromRequest(req);
  if (!payer) return null;
  const [agent] = await db.select({ id: agents.id }).from(agents).where(eq(agents.owner_address, payer)).limit(1);
  return agent?.id || null;
}

export async function incrementFailureCount(webhookId: string) {
  const [row] = await db.select().from(webhooks).where(eq(webhooks.id, webhookId)).limit(1);
  const newCount = (row?.failure_count || 0) + 1;
  await db
    .update(webhooks)
    .set({
      failure_count: newCount,
      active: newCount >= 10 ? 0 : row?.active ?? 1,
    })
    .where(eq(webhooks.id, webhookId));
}

export async function deliverWebhookEvent(
  agentId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const rows = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.agent_id, agentId), eq(webhooks.active, 1)));

  for (const webhook of rows) {
    let subscribed = false;
    try {
      const events = JSON.parse(webhook.events || '[]');
      subscribed = Array.isArray(events) && events.includes(eventType);
    } catch {
      subscribed = false;
    }
    if (!subscribed) continue;

    const body = JSON.stringify({
      event: eventType,
      timestamp: new Date().toISOString(),
      agent_id: agentId,
      delivery_id: randomUUID(),
      data: payload,
    });

    const secret = signingKeyForWebhook(webhook.secret_hash);
    const signature = secret ? generateSignature(secret, body) : 'unsigned';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ClawdMarket-Signature': signature,
          'X-ClawdMarket-Event': eventType,
          'X-ClawdMarket-Delivery': randomUUID(),
          'User-Agent': 'ClawdMarket-Webhook/1.0',
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      await db.insert(webhook_deliveries).values({
        id: randomUUID(),
        webhook_id: webhook.id,
        event_type: eventType,
        payload: body,
        response_status: res.status,
        delivered_at: new Date().toISOString(),
        attempts: 1,
        success: res.ok ? 1 : 0,
      });

      if (res.ok) {
        await db
          .update(webhooks)
          .set({ failure_count: 0, last_triggered_at: new Date().toISOString() })
          .where(eq(webhooks.id, webhook.id));
      } else {
        await incrementFailureCount(webhook.id);
      }
    } catch {
      await incrementFailureCount(webhook.id);
      await db.insert(webhook_deliveries).values({
        id: randomUUID(),
        webhook_id: webhook.id,
        event_type: eventType,
        payload: body,
        response_status: 0,
        delivered_at: new Date().toISOString(),
        attempts: 1,
        success: 0,
      });
    }
  }
}
