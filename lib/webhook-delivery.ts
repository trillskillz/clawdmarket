import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { webhook_deliveries, webhooks } from '@/lib/schema';
import { safeExternalFetch } from '@/lib/webhook-url';

export const ALLOWED_WEBHOOK_EVENTS = [
  'task.assigned',
  'task.bid_received',
  'trade.created',
  'trade.status_changed',
  'trade.completed',
  'trade.disputed',
  'trade.auto_confirmed',
  'message.received',
  'rating.received',
  'payment.received',
  'agent.deactivated',
  'balance.changed',
  'listing.sold',
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

function getWebhookMasterKey(): string {
  const key = process.env.WEBHOOK_SECRET_KEY?.trim() || process.env.JWT_SECRET?.trim();
  if (key) return key;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('WEBHOOK_SECRET_KEY or JWT_SECRET is required in production');
  }
  return 'clawdmarket-local-webhook-development-key';
}

export function createWebhookSecret(webhookId: string): string {
  return createHmac('sha256', getWebhookMasterKey()).update(`webhook:${webhookId}`).digest('base64url');
}

async function signingKeyForWebhook(webhookId: string, secretHash: string): Promise<string | null> {
  const secret = createWebhookSecret(webhookId);
  const expectedHash = await hashSecret(secret);
  const expected = Buffer.from(expectedHash);
  const stored = Buffer.from(secretHash);
  if (expected.length !== stored.length || !timingSafeEqual(expected, stored)) return null;
  return secret;
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
  principalId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const rows = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.agent_id, principalId), eq(webhooks.active, 1)));

  for (const webhook of rows) {
    let subscribed = false;
    try {
      const events = JSON.parse(webhook.events || '[]');
      subscribed = Array.isArray(events) && events.includes(eventType);
    } catch {
      subscribed = false;
    }
    if (!subscribed) continue;

    const deliveryId = randomUUID();
    const body = JSON.stringify({
      event: eventType,
      timestamp: new Date().toISOString(),
      agent_id: principalId,
      delivery_id: deliveryId,
      data: payload,
    });

    const secret = await signingKeyForWebhook(webhook.id, webhook.secret_hash);
    if (!secret) {
      await incrementFailureCount(webhook.id);
      continue;
    }
    const signature = generateSignature(secret, body);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 10_000);
      const res = await safeExternalFetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-ClawdMarket-Signature': signature,
          'X-ClawdMarket-Event': eventType,
          'X-ClawdMarket-Delivery': deliveryId,
          'User-Agent': 'ClawdMarket-Webhook/1.0',
        },
        body,
        signal: controller.signal,
        maxResponseBytes: 64 * 1024,
      });
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
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}
