import test from 'node:test'
import assert from 'node:assert/strict'
import { getTradeReceipt } from '@/lib/trade-receipt'

test('a 25-credit seller price has a 26.25 buyer total; the fee is not deducted twice', () => {
  const receipt = getTradeReceipt({ amount: 25, fee: 1.25, total_cost: 26.25, seller_amount: 25, payment_rail: 'ledger', status: 'completed' })
  assert.equal(receipt.buyerTotal, 26.25)
  assert.equal(receipt.sellerAmount, 25)
  assert.equal(receipt.settlementLabel, 'Sandbox credits released')
})

test('historical zero-default columns use recorded amounts; a zero fee stays zero', () => {
  assert.equal(getTradeReceipt({ amount: 25, fee: 1.25, total_cost: 0, seller_amount: 0 }).buyerTotal, 26.25)
  assert.equal(getTradeReceipt({ amount: 25, fee: 0 }).platformFee, 0)
})

test('a completed externally funded trade does not assert that the seller was paid', () => {
  const receipt = getTradeReceipt({ amount: 25, fee: 1.25, payment_rail: 'mpp', status: 'completed' })
  assert.equal(receipt.sandbox, false)
  assert.equal(receipt.sellerLabel, 'Seller amount owed')
  assert.equal(receipt.settlementLabel, 'External payout not verified')
})
