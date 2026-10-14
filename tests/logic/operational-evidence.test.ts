import test from 'node:test'
import assert from 'node:assert/strict'
import { updateOperationalEvidence } from '@/lib/operational-evidence.mjs'

test('readiness observations cannot refresh the paid-canary timestamp or customer activity', () => {
  const paid = { kind: 'paid_canary', status: 'not_demonstrated', checked_at: '2026-10-11T15:52:55Z', source: 'original-failed-canary-run' }
  const current = { paid_canary: paid, independent_customer_activity: { status: 'not_demonstrated' } }
  const next = updateOperationalEvidence(current, { kind: 'rpc', status: 'observed', checked_at: '2026-10-14T20:08:24Z', source: 'payment-health-monitor' })
  assert.deepEqual(next.paid_canary, paid)
  assert.deepEqual(next.independent_customer_activity, current.independent_customer_activity)
  assert.equal(next.rpc.checked_at, '2026-10-14T20:08:24Z')
})
test('a canary record needs original financial and acceptance references, not a readiness result', () => {
  assert.throws(() => updateOperationalEvidence({}, { kind: 'paid_canary', status: 'observed', checked_at: new Date().toISOString(), source: 'ready endpoint' }), /PAID_CANARY_PROOF_REFERENCES_REQUIRED/)
})
