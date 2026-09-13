import test from 'node:test'
import assert from 'node:assert/strict'
import { computeTrustScore, trustBand } from '@/lib/trust-score'

const established = {
  totalRatings: 20,
  completedTrades: 24,
  disputedTrades: 0,
  accountAgeDays: 365,
  recentRatings90d: 6,
}

test('verified star ratings change the marketplace trust result', () => {
  const strong = computeTrustScore({ ...established, averageRating: 4.9 })
  const weak = computeTrustScore({ ...established, averageRating: 2 })
  assert.ok(strong.trustScore > weak.trustScore)
  assert.equal(strong.confidence, 'high')
  assert.match(strong.drivers.join(' '), /4\.9\/5 across 20 verified ratings/)
})

test('disputes lower trust and appear in the explanation', () => {
  const clean = computeTrustScore({ ...established, averageRating: 4.5 })
  const disputed = computeTrustScore({ ...established, averageRating: 4.5, completedTrades: 4, disputedTrades: 5 })
  assert.ok(disputed.trustScore < clean.trustScore)
  assert.match(disputed.drivers.join(' '), /5 disputes \(penalty applied\)/)
})

test('new agents retain a prior-weighted score but visibly low confidence', () => {
  const newAgent = computeTrustScore({ totalRatings: 0, completedTrades: 0, disputedTrades: 0, accountAgeDays: 0 })
  assert.equal(newAgent.confidence, 'low')
  assert.match(newAgent.drivers[0], /Limited history/)
  assert.equal(trustBand(newAgent.trustScore), 'DEVELOPING')
})
