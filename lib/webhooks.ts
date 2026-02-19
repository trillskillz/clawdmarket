import crypto from 'crypto';
import dns from 'dns/promises';
import { db } from './db';
import { webhooks } from './schema';
import { eq } from 'drizzle-orm';

export type WebhookEvent = 'trade.created' | 'trade.completed' | 'listing.sold';

export interface WebhookPayload {
  event: WebhookEvent;
  data: any;
  timestamp: string;
}

function generateSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

export async function fireWebhook(userId: string, event: WebhookEvent, data: any): Promise<void> {
  // Non-blocking - fire and forget
  setImmediate(async () => {
    try {
      // Get all webhooks for this user that subscribe to this event
      const userWebhooks = await db.select()
        .from(webhooks)
        .where(eq(webhooks.user_id, userId));
      
      for (const webhook of userWebhooks) {
        const events = webhook.events.split(',').map(e => e.trim());
        if (!events.includes(event)) {
          continue;
        }
        
        const payload: WebhookPayload = {
          event,
          data,
          timestamp: new Date().toISOString(),
        };
        
        const payloadString = JSON.stringify(payload);
        const signature = generateSignature(payloadString, webhook.secret);
        
        try {
          const parsedUrl = new URL(webhook.url);
          const resolved = await dns.resolve4(parsedUrl.hostname).catch(() => []);
          const isPrivate = resolved.some(ip => {
            const p = ip.split('.').map(Number);
            return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
              (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
              (p[0] === 192 && p[1] === 168) ||
              (p[0] === 169 && p[1] === 254) ||
              (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
          });
          if (isPrivate || resolved.length === 0) {
            console.error(`Webhook ${webhook.id} blocked: resolves to private IP`);
            continue;
          }

          await fetch(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Signature': signature,
              'X-Webhook-Event': event,
            },
            body: payloadString,
            redirect: 'error',
            signal: AbortSignal.timeout(5000),
          });
        } catch (error) {
          console.error(`Failed to fire webhook ${webhook.id}:`, error);
        }
      }
    } catch (error) {
      console.error('Webhook firing error:', error);
    }
  });
}
