import crypto from 'crypto';
import dns from 'dns/promises';
import { db } from './db';
import { event_stream, webhooks } from './schema';
import { eq, sql } from 'drizzle-orm';

export type WebhookEvent =
  | 'agent.registered'
  | 'job.created'
  | 'job.completed'
  | 'job.failed'
  | 'trade.created'
  | 'trade.completed'
  | 'listing.sold'
  | 'balance.changed';

export interface WebhookPayload {
  event: WebhookEvent;
  data: any;
  timestamp: string;
  sequence_id: number;
}

function generateSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliverWithRetry(url: string, headers: Record<string, string>, payloadString: string, attempts = 3) {
  let lastError: any = null;

  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: payloadString,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });

      if (res.ok) return;
      lastError = new Error(`Webhook returned ${res.status}`);
    } catch (error) {
      lastError = error;
    }

    if (i < attempts - 1) {
      const backoffMs = 500 * Math.pow(2, i); // 500ms, 1000ms, 2000ms
      await delay(backoffMs);
    }
  }

  throw lastError;
}

async function isBlockedHost(webhookUrl: string): Promise<boolean> {
  try {
    const parsedUrl = new URL(webhookUrl);
    const resolved = await dns.resolve4(parsedUrl.hostname).catch(() => []);
    if (!resolved.length) return true;

    return resolved.some((ip) => {
      const p = ip.split('.').map(Number);
      return (
        p[0] === 10 ||
        p[0] === 127 ||
        p[0] === 0 ||
        (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
        (p[0] === 192 && p[1] === 168) ||
        (p[0] === 169 && p[1] === 254) ||
        (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
      );
    });
  } catch {
    return true;
  }
}

export async function fireWebhook(userId: string, event: WebhookEvent, data: any): Promise<void> {
  setImmediate(async () => {
    try {
      const [maxSeqRow] = await db
        .select({ max: sql<number>`coalesce(max(${event_stream.sequence_id}), 0)` })
        .from(event_stream)
        .where(eq(event_stream.user_id, userId));

      const nextSequenceId = (maxSeqRow?.max ?? 0) + 1;
      await db.insert(event_stream).values({
        user_id: userId,
        event,
        sequence_id: nextSequenceId,
        payload: JSON.stringify(data),
      });

      const userWebhooks = await db.select().from(webhooks).where(eq(webhooks.user_id, userId));

      for (const webhook of userWebhooks) {
        const events = webhook.events.split(',').map((e) => e.trim());
        if (!events.includes(event)) continue;

        if (await isBlockedHost(webhook.url)) {
          console.error(`Webhook ${webhook.id} blocked: private/invalid host`);
          continue;
        }

        const payload: WebhookPayload = {
          event,
          data,
          timestamp: new Date().toISOString(),
          sequence_id: nextSequenceId,
        };

        const payloadString = JSON.stringify(payload);
        const signature = generateSignature(payloadString, webhook.secret);

        try {
          await deliverWithRetry(
            webhook.url,
            {
              'Content-Type': 'application/json',
              'X-Webhook-Signature': signature,
              'X-Webhook-Event': event,
              'X-Webhook-Timestamp': payload.timestamp,
            },
            payloadString,
            3
          );
        } catch (error) {
          console.error(`Failed to deliver webhook ${webhook.id} after retries:`, error);
        }
      }
    } catch (error) {
      console.error('Webhook firing error:', error);
    }
  });
}
