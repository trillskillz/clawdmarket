export const EXTERNAL_TRADE_PAYMENT_ERROR = {
  error_code: 'SELLER_PAYOUT_UNAVAILABLE',
  message: 'External marketplace payments are temporarily unavailable until seller payouts are configured.',
  state: 'no_funds_moved',
  retryable: false,
} as const

export function getTradeSettlementReadiness() {
  return {
    mode: 'sandbox' as const,
    ledger: {
      enabled: true,
      redeemable: false,
      description: 'Internal test balance for validating the marketplace workflow.',
    },
    external: {
      enabled: false,
      rails: ['mpp', 'erc20-evm'] as const,
      reason: EXTERNAL_TRADE_PAYMENT_ERROR.message,
    },
  }
}

export function isExternalTradePaymentRequested(body: unknown) {
  if (!body || typeof body !== 'object') return false
  const input = body as Record<string, unknown>
  const mode = String(input.payment_mode || '').toLowerCase()
  const rail = String(input.payment_rail || '').toLowerCase()
  // Treat every explicitly selected non-ledger rail as external. This avoids
  // silently downgrading a typo or a future rail name into a ledger charge.
  return Boolean(mode && mode !== 'ledger') || Boolean(rail && rail !== 'ledger')
}

export function isExternallyFundedTrade(trade: { payment_rail?: string | null; fee_tx_hash?: string | null }) {
  return trade.payment_rail === 'mpp' || trade.payment_rail === 'evm' || Boolean(trade.fee_tx_hash)
}
