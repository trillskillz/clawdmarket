import test from 'node:test'
import assert from 'node:assert/strict'
import { verificationEvidenceLabels } from '@/lib/verification-evidence-labels'
import { publicAnalyticsMetadata } from '@/lib/analytics-metadata'
import { providerConcentration, rankPositionChanges } from '@/lib/reputation-promotion-measurements'
import { selectMarketplaceRail } from '@/lib/payment-rail-selection'

test('buyer acceptance and authenticated reports never imply structure, observed execution or semantic accuracy', () => {
  const labels = verificationEvidenceLabels([{ method: 'buyer_review', status: 'passed' }, { method: 'isolated_checks', status: 'passed' }])
  assert.equal(labels.buyer_accepted, true)
  assert.equal(labels.authenticated_verifier_report_passed, true)
  assert.equal(labels.structure_verified, false)
  assert.equal(labels.semantic_verified, false)
  assert.equal(labels.remote_sandbox_execution_observed, false)
  const finite = verificationEvidenceLabels([{ method: 'assertions', status: 'passed' }, { method: 'schema', status: 'passed' }])
  assert.equal(finite.deterministic_tests_passed, true)
  assert.equal(finite.structure_verified, true)
  assert.equal(finite.buyer_accepted, false)
})
test('analytics retain only bounded public funnel dimensions, excluding artifacts, credentials and free text', () => {
  assert.deepEqual(publicAnalyticsMetadata({ trade_id: 'trade-example', payment_rail: 'credit', source: 'catalog', token: 'secret', artifact: { private: true }, query: 'private customer text', endpoint: 'https://user:password@example.invalid', category: 'private prompt' }), { trade_id: 'trade-example', payment_rail: 'credit', source: 'catalog' })
})
test('provider concentration measures provider identities rather than service count and empty evidence stays null', () => {
  const providers = new Map([['a', 'provider-one'], ['b', 'provider-one'], ['c', 'provider-two']])
  assert.deepEqual(providerConcentration(['a', 'b', 'c'], providers), { positions: 3, distinct_providers: 2, unknown_provider_positions: 0, largest_provider_share: 2 / 3 })
  assert.equal(providerConcentration([], providers).largest_provider_share, null)
  assert.equal(providerConcentration(['a', 'unmapped'], providers).largest_provider_share, null)
  assert.equal(rankPositionChanges(['b', 'a'], ['a', 'b']), 2)
})
test('explicit and automatic rail selection cannot cross seller-supported rails', () => {
  const ready = { credit: { enabled: true }, ledger: { enabled: true }, mpp: { enabled: true }, evm: { enabled: true } }
  assert.equal(selectMarketplaceRail('credit', ready, true, ['evm']), null)
  assert.equal(selectMarketplaceRail('auto', ready, true, ['evm']), 'evm')
  assert.equal(selectMarketplaceRail('auto', ready, false, ['evm']), null)
  assert.equal(selectMarketplaceRail('auto', ready, true, []), null)
})
