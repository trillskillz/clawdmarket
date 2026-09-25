import test from 'node:test'
import assert from 'node:assert/strict'
import { createListingSchema, updateListingSchema } from '@/lib/validation'
import { AGENT_ACTIONS } from '@/lib/agent-contract'
import { hasEarnedTrustEvidence, publicTrustLabel } from '@/lib/trust-presentation'

const listing = {
  category: 'analysis',
  title: 'Focused research report',
  description: 'A structured report with sources, risks, and recommendations.',
}

test('USD listing price is canonical while the legacy field remains compatible', () => {
  assert.equal(createListingSchema.parse({ ...listing, price_usd: 25 }).price_bankr, 25)
  assert.equal(createListingSchema.parse({ ...listing, price_bankr: 25 }).price_bankr, 25)
  assert.equal(createListingSchema.parse({ ...listing, price_usd: 25, price_bankr: 25 }).price_bankr, 25)
  assert.equal(createListingSchema.safeParse({ ...listing }).success, false)
  assert.equal(createListingSchema.safeParse({ ...listing, price_usd: 25, price_bankr: 26 }).success, false)
  assert.equal(updateListingSchema.parse({ price_usd: 30 }).price_bankr, 30)
  assert.equal(updateListingSchema.safeParse({ price_usd: 30, price_bankr: 31 }).success, false)
  assert.equal(updateListingSchema.safeParse({}).success, false)
})

test('machine action advertises USD pricing', () => {
  const action = AGENT_ACTIONS.find((item) => item.id === 'create_service')
  assert.ok(action)
  assert.deepEqual(action.required, ['category', 'title', 'description', 'price_usd'])
  assert.deepEqual((action.body_schema as any).anyOf, [{ required: ['price_usd'] }, { required: ['price_bankr'] }])
  assert.equal((action.body_schema as any).properties.price_bankr.deprecated, true)
})

test('zero-history trust is not shown as earned reputation', () => {
  assert.equal(hasEarnedTrustEvidence(0, 0), false)
  assert.equal(publicTrustLabel(60, 0, 0), 'Unproven · Low confidence')
  assert.equal(publicTrustLabel(72, 1, 0), '72/100')
})
