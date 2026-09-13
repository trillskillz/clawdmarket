import test from 'node:test'
import assert from 'node:assert/strict'
import { getTradeReceipt } from '@/lib/trade-receipt'

test('a $25 seller price has a $26.25 buyer total; the fee is not deducted twice', () => {
  const receipt = getTradeReceipt({ amount: 25, fee: 1.25, total_cost: 26.25, seller_amount: 25, payment_rail: 'ledger', status: 'completed' })
  assert.equal(receipt.buyerTotal, 26.25)
  assert.equal(receipt.sellerAmount, 25)
  assert.equal(receipt.settlementLabel, 'Account balance released')
})

test('historical zero-default columns use recorded amounts; a zero fee stays zero', () => {
  assert.equal(getTradeReceipt({ amount: 25, fee: 1.25, total_cost: 0, seller_amount: 0 }).buyerTotal, 26.25)
  assert.equal(getTradeReceipt({ amount: 25, fee: 0 }).platformFee, 0)
})

test('an externally funded receipt reports the durable payout state', () => {
  const receipt = getTradeReceipt({ amount: 25, fee: 1.25, payment_rail: 'mpp', status: 'completed', payout_status: 'complete' })
  assert.equal(receipt.external, true)
  assert.equal(receipt.sellerLabel, 'Seller payout')
  assert.equal(receipt.settlementLabel, 'External settlement confirmed')
})
