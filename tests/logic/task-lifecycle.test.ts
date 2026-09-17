import test from 'node:test'
import assert from 'node:assert/strict'
import { effectiveTaskStatus } from '@/lib/task-lifecycle'
import { getTaskPendingActions } from '@/lib/agent-contract'

test('expiry affects only unassigned open work, including legacy SQLite timestamps', () => {
  const now = Date.parse('2026-09-16T12:00:00Z')
  assert.equal(effectiveTaskStatus({ status: 'open', expiresAt: '2026-09-16T11:59:59Z' }, now), 'expired')
  assert.equal(effectiveTaskStatus({ status: 'open', expires_at: '2026-09-16 11:59:59' }, now), 'expired')
  assert.equal(effectiveTaskStatus({ status: 'open', expiresAt: '2026-09-17T00:00:00Z', deadlineAt: '2026-09-16T11:59:59Z' }, now), 'expired')
  assert.equal(effectiveTaskStatus({ status: 'open', expiresAt: '2026-09-17T00:00:00Z' }, now), 'open')
  assert.equal(effectiveTaskStatus({ status: 'assigned', expiresAt: '2026-09-16T11:59:59Z' }, now), 'assigned')
  assert.deepEqual(getTaskPendingActions({ id: 'old', status: 'open', expiresAt: '2000-01-01T00:00:00Z' }), [])
})
