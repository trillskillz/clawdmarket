import { deliverWebhookEvent } from './webhook-delivery';
import type { WebhookEventType } from './webhook-events';

export type WebhookEvent = WebhookEventType;

export interface WebhookPayload {
  event: WebhookEvent;
  data: any;
  timestamp: string;
}

// Backward-compatible helper used across the codebase.
export async function fireWebhook(agentId: string, event: WebhookEvent, data: any): Promise<void> {
  await deliverWebhookEvent(agentId, event, data || {});
}
