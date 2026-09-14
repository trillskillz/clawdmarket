import assert from 'node:assert/strict'
import test from 'node:test'
import { claimAgentSchema } from '@/lib/validation'

test('claim validation normalizes bounded email and code input', () => {
  const parsed = claimAgentSchema.parse({ code: ' claim_123 ', email: ' OWNER@EXAMPLE.COM ' })
  assert.deepEqual(parsed, { code: 'claim_123', email: 'owner@example.com' })
})

test('claim validation rejects oversized and malformed values', () => {
  assert.equal(claimAgentSchema.safeParse({ code: 'x'.repeat(129), email: 'owner@example.com' }).success, false)
  assert.equal(claimAgentSchema.safeParse({ code: 'claim_123', email: 'x'.repeat(255) }).success, false)
  assert.equal(claimAgentSchema.safeParse({ code: 'claim_123', email: 'not-an-email' }).success, false)
})
