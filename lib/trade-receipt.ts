import { isExternallyFundedTrade } from './trade-settlement-readiness'

type ReceiptTrade = {
  amount: unknown
  fee?: unknown
  platform_fee?: unknown
  seller_amount?: unknown
  total_cost?: unknown
  status?: string | null
  payment_rail?: string | null
  fee_tx_hash?: string | null
  payout_status?: string | null
}

function nonnegative(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

export function getTradeReceipt(trade: ReceiptTrade) {
  // Older rows have zero defaults for the newer accounting columns.
  const sellerAmount = nonnegative(trade.seller_amount) || nonnegative(trade.amount)
  const platformFee = nonnegative(trade.platform_fee) || nonnegative(trade.fee)
  const buyerTotal = nonnegative(trade.total_cost) || Math.round((sellerAmount + platformFee) * 100) / 100
  const external = isExternallyFundedTrade(trade)
  const complete = ['completed', 'complete', 'resolved'].includes(trade.status || '')
  const payoutComplete = ['complete', 'seller_paid', 'refunded'].includes(trade.payout_status || '')
  return {
    sellerAmount, platformFee, buyerTotal, external,
    sellerLabel: external ? 'Seller payout' : 'Seller balance',
    settlementLabel: external
      ? (payoutComplete ? 'External settlement confirmed' : 'External settlement processing')
      : (complete ? 'Account balance released' : 'Account balance held'),
  }
}
