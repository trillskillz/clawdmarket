import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateTradeFinancials } from '@/lib/settlement'
import { canTransitionMilestone, nextContractStateFromMilestones } from '@/lib/contracts-state'
import { getTaskPendingActions } from '@/lib/agent-contract'
import { hashAgentApiKey } from '@/lib/registered-agent-auth'
import {
  getTradeSettlementReadiness,
  isExternallyFundedTrade,
  isExternalTradePaymentRequested,
} from '@/lib/trade-settlement-readiness'

test('trade totals and the 5% fee are derived from the listing price', () => {
  assert.deepEqual(calculateTradeFinancials(25), {
    itemPrice: 25,
    platformFee: 1.25,
    totalCost: 26.25,
    sellerAmount: 25,
    devAmount: 1.25,
  })
})

test('assigned tasks never advertise another bid action', () => {
  const actions = getTaskPendingActions({
    id: 'task_assigned',
    status: 'assigned',
    poster_agent_id: 'poster',
  }, [], 'another-agent')

  assert.deepEqual(actions.map((action) => action.action), ['view'])
})

test('milestones cannot skip review and contract completion requires settlement', () => {
  assert.equal(canTransitionMilestone('ACTIVE', 'PAID'), false)
  assert.equal(canTransitionMilestone('AWAITING_BUYER_REVIEW', 'APPROVED'), true)
  assert.equal(canTransitionMilestone('APPROVED', 'PAID'), true)
  assert.equal(nextContractStateFromMilestones(['PAID', 'PAID']), 'COMPLETED')
  assert.equal(nextContractStateFromMilestones(['PAID', 'ACTIVE']), 'IN_PROGRESS')
  assert.equal(nextContractStateFromMilestones(['DISPUTED']), 'DISPUTED')
})

test('registered-agent API keys are stored as deterministic one-way digests', () => {
  const key = 'clawd_example_secret'
  const digest = hashAgentApiKey(key)
  assert.notEqual(digest, key)
  assert.equal(digest.length, 64)
  assert.equal(digest, hashAgentApiKey(key))
  assert.notEqual(digest, hashAgentApiKey(`${key}_other`))
})

test('marketplace settlement exposes the production rail model', () => {
  const readiness = getTradeSettlementReadiness()

  assert.equal(readiness.mode, 'production')
  assert.equal(typeof readiness.ledger.enabled, 'boolean')
  assert.equal(typeof readiness.ledger.redeemable, 'boolean')
  assert.equal(readiness.external.enabled, readiness.mpp.enabled || readiness.evm.enabled)
  assert.deepEqual(readiness.external.rails.map((rail) => rail.id), ['mpp', 'erc20-evm'])
  assert.deepEqual(readiness.external.rails.map((rail) => rail.enabled), [readiness.mpp.enabled, readiness.evm.enabled])
})

test('external trade payment requests are detected before funds can move', () => {
  assert.equal(isExternalTradePaymentRequested({ payment_mode: 'onchain' }), true)
  assert.equal(isExternalTradePaymentRequested({ payment_rail: 'mpp' }), true)
  assert.equal(isExternalTradePaymentRequested({ payment_rail: 'evm' }), true)
  assert.equal(isExternalTradePaymentRequested({ payment_rail: 'future-wallet-rail' }), true)
  assert.equal(isExternalTradePaymentRequested({ payment_rail: 'ledger' }), false)
  assert.equal(isExternalTradePaymentRequested(null), false)
})

test('historical external trades cannot be marked paid by an internal ledger credit', () => {
  assert.equal(isExternallyFundedTrade({ payment_rail: 'mpp', fee_tx_hash: 'proof' }), true)
  assert.equal(isExternallyFundedTrade({ payment_rail: 'evm', fee_tx_hash: '0xproof' }), true)
  assert.equal(isExternallyFundedTrade({ payment_rail: 'ledger', fee_tx_hash: null }), false)
})
