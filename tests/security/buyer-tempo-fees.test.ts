import test from 'node:test'
import assert from 'node:assert/strict'
import { assertBuyerTempoReserve, tempoMaximumFeeUnits } from '../../lib/buyer-tempo-fees.mjs'

const payment = { rail: 'mpp', token_address: `0x${'11'.repeat(20)}`, fee_token_address: `0x${'11'.repeat(20)}`,
  minimum_token_reserve_units: '1000000', minimum_fee_token_reserve_units: '1500000', max_fee_token_cost_units: '5000' }

test('Tempo fee bound rounds up sub-unit costs and rejects zero/overflow instead of under-reserving', () => {
  assert.equal(tempoMaximumFeeUnits(50_000n, 100_000_000_000n), 5000n)
  assert.equal(tempoMaximumFeeUnits(1n, 1n), 1n)
  assert.equal(tempoMaximumFeeUnits(1n, 1_000_000_000_001n), 2n)
  for (const [gas, price] of [[0n, 1n], [1n, 0n], [-1n, 1n], [2n ** 255n, 2n]]) assert.throws(() => tempoMaximumFeeUnits(gas, price), /BUYER_TEMPO_FEE_BOUNDS_INVALID/)
})

test('same-token payment, gas, uncertain principal and fees preserve both owner reserve floors exactly', () => {
  const input = { tokenBalance: 3_005_000n, paymentAmount: 1_000_000n, maximumFeeUnits: 5000n, outstandingToken: 400_000n, outstandingFees: 100_000n, payment }
  assert.doesNotThrow(() => assertBuyerTempoReserve(input)) // Exactly 1.5 tokens remains.
  assert.throws(() => assertBuyerTempoReserve({ ...input, tokenBalance: input.tokenBalance - 1n }), /BUYER_TEMPO_TOKEN_RESERVE_REQUIRED/)
  assert.throws(() => assertBuyerTempoReserve({ ...input, maximumFeeUnits: 5001n }), /BUYER_TEMPO_FEE_BOUNDS_INVALID/)
  assert.throws(() => assertBuyerTempoReserve({ ...input, outstandingFees: -1n }), /BUYER_TEMPO_FEE_BOUNDS_INVALID/)
})

test('Tempo reserves reject missing legacy fee authority, another token and noncanonical numeric limits', () => {
  const input = { tokenBalance: 5_000_000n, paymentAmount: 1_000_000n, maximumFeeUnits: 5000n, payment }
  for (const change of [{ fee_token_address: undefined }, { fee_token_address: `0x${'22'.repeat(20)}` },
    { minimum_fee_token_reserve_units: '01' }, { max_fee_token_cost_units: '1e6' }, { max_fee_token_cost_units: (2n ** 256n).toString() }]) {
    assert.throws(() => assertBuyerTempoReserve({ ...input, payment: { ...payment, ...change } }), /BUYER_TEMPO_FEE_TERMS_INVALID/)
  }
})
