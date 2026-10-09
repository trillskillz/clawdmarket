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
  settlement_evidence?: boolean
}

function nonnegative(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : 0
}

// A verified payment receipt records the method actually used. The chain of a
// seller payout alone cannot distinguish MPP from a direct ERC-20 payment.
export function getPaymentMethodLabel(tradeRail: unknown, receiptRail?: unknown) {
  const rail = receiptRail === 'mpp' || receiptRail === 'evm' ? receiptRail : tradeRail
  switch (rail) {
    case 'mpp': return 'MPP on Tempo'
    case 'evm': return 'ERC-20 (EVM)'
    case 'credit': return 'Account balance'
    case 'ledger': return 'Legacy account balance'
    default: return 'Unknown payment method'
  }
}

export function getTradeReceipt(trade: ReceiptTrade) {
  // Older rows have zero defaults for the newer accounting columns.
  const sellerAmount = nonnegative(trade.seller_amount) || nonnegative(trade.amount)
  const platformFee = nonnegative(trade.platform_fee) || nonnegative(trade.fee)
  const buyerTotal = nonnegative(trade.total_cost) || Math.round((sellerAmount + platformFee) * 100) / 100
  const external = isExternallyFundedTrade(trade)
  const complete = ['completed', 'complete', 'resolved'].includes(trade.status || '')
  const payoutComplete = ['complete', 'seller_paid'].includes(trade.payout_status || '')
  return {
    sellerAmount, platformFee, buyerTotal, external,
    sellerLabel: external ? 'Seller payout' : trade.payment_rail === 'credit' ? 'Seller account credit' : 'Seller balance',
    settlementLabel: external
      ? (payoutComplete && trade.settlement_evidence ? 'External payout confirmed by recorded transaction' : payoutComplete ? 'External settlement recorded; transaction evidence unavailable' : 'External settlement processing')
      : (complete ? 'Account balance released' : 'Account balance held'),
  }
}
