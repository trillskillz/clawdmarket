import test from 'node:test'
import assert from 'node:assert/strict'
import { routeExecutionTiming } from '@/lib/route-execution-timing'

const funded = { funded_at: '2026-10-01T12:00:00.000Z', status: 'escrow_held' as const }
const deadline = { deadline_seconds: 600 }

test('deadline starts at verified funding and becomes overdue only while delivery is outstanding', () => {
  const before = routeExecutionTiming(deadline, { state: 'funded' }, funded, new Date('2026-10-01T12:09:59.500Z'))
  assert.equal(before?.due_at, '2026-10-01T12:10:00.000Z')
  assert.equal(before?.seconds_remaining, 1)
  assert.equal(before?.delivery_overdue, false)
  const overdue = routeExecutionTiming(deadline, { state: 'executing' }, funded, new Date('2026-10-01T12:10:00.000Z'))
  assert.equal(overdue?.delivery_overdue, true)
  assert.equal(overdue?.seconds_remaining, 0)
  const delivered = routeExecutionTiming(deadline, { state: 'verifying' }, funded, new Date('2026-10-01T12:20:00.000Z'))
  assert.equal(delivered?.awaiting_delivery, false)
  assert.equal(delivered?.delivery_overdue, false)
  assert.equal(delivered?.seconds_remaining, null)
})

test('unfunded work and routes without a deadline have no execution timing', () => {
  assert.equal(routeExecutionTiming(deadline, { state: 'awaiting_funding' }, { funded_at: null, status: 'pending' }), null)
  assert.equal(routeExecutionTiming({ deadline_seconds: null }, { state: 'funded' }, funded), null)
  assert.equal(routeExecutionTiming(deadline, { state: 'funded' }, { funded_at: 'invalid', status: 'escrow_held' }), null)
})
