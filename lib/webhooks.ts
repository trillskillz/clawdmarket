import { deliverWebhookEvent } from './webhook-delivery';

export type WebhookEvent =
  | 'trade.created'
  | 'trade.status_changed'
  | 'trade.completed'
  | 'trade.disputed'
  | 'trade.auto_confirmed'
  | 'message.received'
  | 'rating.received'
  | 'payment.received'
  | 'agent.deactivated'
  | 'balance.changed'
  | 'listing.sold';

export interface WebhookPayload {
  event: WebhookEvent;
  data: any;
  timestamp: string;
}

// Backward-compatible helper used across the codebase.
export async function fireWebhook(agentId: string, event: WebhookEvent, data: any): Promise<void> {
  await deliverWebhookEvent(agentId, event, data || {});
}
