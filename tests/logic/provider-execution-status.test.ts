import test from 'node:test'
import assert from 'node:assert/strict'
import { providerExecutionStatus } from '@/lib/provider-execution-status'

const now = new Date('2026-10-02T12:10:00.000Z')
const trade = { id: 'trade-1', status: 'escrow_held' as const }
const order = { state: 'executing' as const, capacity_released_at: null }
const accepted = { id: 'attempt-1', state: 'accepted' as const, accepted_at: now,
  heartbeat_at: now, lease_expires_at: new Date('2026-10-02T12:20:00.000Z'), completed_at: null }

test('overdue delivery asks the buyer to reconcile without permitting another checkout', () => {
  const current = providerExecutionStatus('leased_v1', order, trade, accepted, { delivery_overdue: false }, now)
  assert.equal(current?.attention_required, false)
  const overdue = providerExecutionStatus('leased_v1', order, trade, accepted, { delivery_overdue: true }, now)
  assert.equal(overdue?.attention_reason, 'delivery_deadline_overdue')
  assert.deepEqual(overdue?.reconciliation, { state: 'dispute_available',
    action: { method: 'POST', url: '/api/trades/trade-1/dispute' } })
  assert.equal(overdue?.automatic_retry_allowed, false)
  assert.equal(overdue?.lease_overdue, false)
  assert.equal(providerExecutionStatus('leased_v1', { ...order, state: 'verifying' }, trade,
    accepted, { delivery_overdue: true }, now)?.attention_required, false)
})

test('expired leases and terminal work retain their established classification', () => {
  const expired = providerExecutionStatus('leased_v1', order, trade,
    { ...accepted, lease_expires_at: new Date('2026-10-02T12:09:00.000Z') }, { delivery_overdue: true }, now)
  assert.equal(expired?.attention_reason, 'lease_expired')
  const settled = providerExecutionStatus('leased_v1', order, { ...trade, status: 'completed' },
    accepted, { delivery_overdue: true }, now)
  assert.equal(settled?.attention_required, false)
  assert.equal(settled?.automatic_retry_allowed, false)
  assert.equal(providerExecutionStatus('manual', order, trade, null, { delivery_overdue: true }, now), null)
})
