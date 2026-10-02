import type { service_execution_attempts, service_orders, trades } from '@/lib/schema'

type Attempt = Pick<typeof service_execution_attempts.$inferSelect, 'id' | 'state' | 'accepted_at' | 'heartbeat_at' | 'lease_expires_at' | 'completed_at'>
type Order = Pick<typeof service_orders.$inferSelect, 'state' | 'capacity_released_at'>
type Trade = Pick<typeof trades.$inferSelect, 'status'>

/** Read-only provider state. An expired or missing attempt never authorizes another checkout. */
export function providerExecutionStatus(protocol: string, order: Order, trade: Trade, attempt: Attempt | null, now = new Date()) {
  if (protocol !== 'leased_v1') return null
  const fundedWork = trade.status === 'escrow_held' && !order.capacity_released_at
    && (order.state === 'funded' || order.state === 'executing')
  const leaseOverdue = attempt?.state === 'accepted'
    && !!attempt.lease_expires_at && attempt.lease_expires_at <= now
  const attentionReason = !fundedWork ? null
    : !attempt ? 'attempt_missing'
      : attempt.state === 'declined' ? 'provider_declined'
        : attempt.state === 'expired' || leaseOverdue ? 'lease_expired' : null
  return {
    attempt_id: attempt?.id || null,
    state: attempt?.state || (fundedWork ? 'missing' : 'not_started'),
    accepted_at: attempt?.accepted_at?.toISOString() || null,
    heartbeat_at: attempt?.heartbeat_at?.toISOString() || null,
    lease_expires_at: attempt?.lease_expires_at?.toISOString() || null,
    completed_at: attempt?.completed_at?.toISOString() || null,
    lease_overdue: Boolean(leaseOverdue),
    attention_required: Boolean(attentionReason),
    attention_reason: attentionReason,
    automatic_retry_allowed: false,
  }
}
