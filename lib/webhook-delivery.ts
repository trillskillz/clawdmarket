import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
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
const MAX_DELIVERY_ATTEMPTS = 8;
const DELIVERY_LEASE_MS = 2 * 60_000;

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

function retryAt(attempt: number): Date | null {
  if (attempt >= MAX_DELIVERY_ATTEMPTS) return null;
  const seconds = [60, 5 * 60, 30 * 60, 2 * 60 * 60, 12 * 60 * 60, 24 * 60 * 60, 24 * 60 * 60];
  return new Date(Date.now() + seconds[Math.min(attempt - 1, seconds.length - 1)] * 1000);
}

async function recordFailure(deliveryId: string, webhookId: string, attempt: number, responseStatus: number, error: string) {
  await Promise.all([
    db.update(webhook_deliveries).set({
      attempts: attempt,
      response_status: responseStatus,
      delivered_at: new Date().toISOString(),
      next_attempt_at: retryAt(attempt),
      locked_at: null,
      last_error: error.slice(0, 1000),
    }).where(eq(webhook_deliveries.id, deliveryId)),
    incrementFailureCount(webhookId),
  ]);
}

export async function attemptWebhookDelivery(deliveryId: string): Promise<'delivered' | 'failed' | 'skipped'> {
  const now = new Date();
  const [claimed] = await db.update(webhook_deliveries).set({ locked_at: now })
    .where(and(
      eq(webhook_deliveries.id, deliveryId),
      eq(webhook_deliveries.success, 0),
      lt(webhook_deliveries.attempts, MAX_DELIVERY_ATTEMPTS),
      or(isNull(webhook_deliveries.locked_at), lt(webhook_deliveries.locked_at, new Date(now.getTime() - DELIVERY_LEASE_MS))),
    )).returning({ id: webhook_deliveries.id });
  if (!claimed) return 'skipped';

  const [row] = await db.select({
    id: webhook_deliveries.id,
    webhook_id: webhook_deliveries.webhook_id,
    event_type: webhook_deliveries.event_type,
    payload: webhook_deliveries.payload,
    attempts: webhook_deliveries.attempts,
    url: webhooks.url,
    secret_hash: webhooks.secret_hash,
    active: webhooks.active,
  }).from(webhook_deliveries)
    .innerJoin(webhooks, eq(webhook_deliveries.webhook_id, webhooks.id))
    .where(eq(webhook_deliveries.id, deliveryId)).limit(1);
  if (!row) return 'skipped';
  const attempt = row.attempts + 1;
  if (row.active !== 1) {
    await db.update(webhook_deliveries).set({
      attempts: MAX_DELIVERY_ATTEMPTS, locked_at: null, next_attempt_at: null, last_error: 'Webhook is inactive',
    }).where(eq(webhook_deliveries.id, deliveryId));
    return 'failed';
  }

  const secret = await signingKeyForWebhook(row.webhook_id, row.secret_hash);
  if (!secret) {
    await recordFailure(deliveryId, row.webhook_id, attempt, 0, 'Webhook signing key does not match the stored subscription');
    return 'failed';
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await safeExternalFetch(row.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ClawdMarket-Signature': generateSignature(secret, row.payload),
        'X-ClawdMarket-Event': row.event_type,
        'X-ClawdMarket-Delivery': row.id,
        'User-Agent': 'ClawdMarket-Webhook/1.0',
      },
      body: row.payload,
      signal: controller.signal,
      maxResponseBytes: 64 * 1024,
    });
    if (!response.ok) {
      await recordFailure(deliveryId, row.webhook_id, attempt, response.status, `Webhook returned HTTP ${response.status}`);
      return 'failed';
    }
    await Promise.all([
      db.update(webhook_deliveries).set({
        attempts: attempt, response_status: response.status, delivered_at: new Date().toISOString(),
        success: 1, next_attempt_at: null, locked_at: null, last_error: null,
      }).where(eq(webhook_deliveries.id, deliveryId)),
      db.update(webhooks).set({ failure_count: 0, last_triggered_at: new Date().toISOString() }).where(eq(webhooks.id, row.webhook_id)),
    ]);
    return 'delivered';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Webhook request failed';
    await recordFailure(deliveryId, row.webhook_id, attempt, 0, message);
    return 'failed';
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function processPendingWebhookDeliveries(limit = 20) {
  const result = await db.$client.execute({
    sql: `SELECT id FROM webhook_deliveries
          WHERE success = 0 AND attempts < ?
            AND (next_attempt_at IS NULL OR next_attempt_at <= unixepoch())
            AND (locked_at IS NULL OR locked_at < unixepoch() - ?)
          ORDER BY COALESCE(next_attempt_at, created_at), created_at
          LIMIT ?`,
    args: [MAX_DELIVERY_ATTEMPTS, Math.ceil(DELIVERY_LEASE_MS / 1000), Math.max(1, Math.min(100, limit))],
  });
  const outcomes = { attempted: 0, delivered: 0, failed: 0, skipped: 0 };
  const ids = result.rows.map((candidate) => String(candidate.id));
  for (let index = 0; index < ids.length; index += 5) {
    const batch = await Promise.all(ids.slice(index, index + 5).map((id) => attemptWebhookDelivery(id)));
    for (const outcome of batch) {
      outcomes.attempted += outcome === 'skipped' ? 0 : 1;
      outcomes[outcome] += 1;
    }
  }
  return outcomes;
}

export async function inspectWebhookDeliveryHealth() {
  const result = await db.$client.execute({
    sql: `SELECT
            SUM(CASE WHEN success = 0 AND attempts < ? THEN 1 ELSE 0 END) AS retrying_count,
            SUM(CASE WHEN success = 0 AND attempts >= ? THEN 1 ELSE 0 END) AS failed_count,
            SUM(CASE WHEN success = 0 AND attempts < ? AND next_attempt_at IS NOT NULL AND next_attempt_at < unixepoch() - 900 THEN 1 ELSE 0 END) AS overdue_count,
            MIN(CASE WHEN success = 0 THEN created_at ELSE NULL END) AS oldest_pending_at
          FROM webhook_deliveries`,
    args: [MAX_DELIVERY_ATTEMPTS, MAX_DELIVERY_ATTEMPTS, MAX_DELIVERY_ATTEMPTS],
  });
  const row = result.rows[0] || {};
  const retrying = Number(row.retrying_count || 0);
  const failed = Number(row.failed_count || 0);
  const overdue = Number(row.overdue_count || 0);
  const oldest = row.oldest_pending_at == null ? null : new Date(Number(row.oldest_pending_at) * 1000).toISOString();
  return { healthy: failed === 0 && overdue === 0, retrying_count: retrying, failed_count: failed, overdue_count: overdue, oldest_pending_at: oldest };
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

  const queued: string[] = [];
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

    await db.insert(webhook_deliveries).values({
      id: deliveryId,
      webhook_id: webhook.id,
      event_type: eventType,
      payload: body,
      attempts: 0,
      success: 0,
      created_at: new Date(),
      next_attempt_at: new Date(),
    });
    queued.push(deliveryId);
  }
  await Promise.allSettled(queued.map((deliveryId) => attemptWebhookDelivery(deliveryId)));
}
