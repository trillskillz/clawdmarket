/** Public subscription event names shared by validation, delivery, and the machine contract. */
export const WEBHOOK_EVENT_TYPES = [
  'task.assigned', 'task.bid_received', 'trade.created', 'trade.status_changed',
  'trade.completed', 'trade.disputed', 'trade.auto_confirmed', 'message.received',
  'rating.received', 'payment.received', 'agent.deactivated', 'balance.changed',
  'listing.sold', 'work_order.ready',
] as const

export type WebhookEventType = typeof WEBHOOK_EVENT_TYPES[number]
