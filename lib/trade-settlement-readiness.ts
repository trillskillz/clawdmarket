import { getPaymentReadiness } from '@/lib/payment-config'

export function getTradeSettlementReadiness() {
  const readiness = getPaymentReadiness()
  return {
    mode: readiness.mode,
    ledger: readiness.ledger,
    evm: {
      enabled: readiness.evm.enabled,
      treasury: readiness.evm.treasury,
      feeRecipient: readiness.evm.feeRecipient,
      feeRecipientMatchesTreasury: readiness.evm.feeRecipientMatchesTreasury,
      signerConfigured: readiness.evm.signerConfigured,
      signerMatchesTreasury: readiness.evm.signerMatchesTreasury,
      tokens: readiness.evm.tokens.map(({ chainId, chainName, address, symbol, decimals, confirmations, fixedUsdPrice }) => ({ chainId, chainName, address, symbol, decimals, confirmations, fixedUsdPrice })),
    },
    mpp: {
      enabled: readiness.mpp.enabled,
      platformEnabled: readiness.mpp.platformEnabled,
      recipient: readiness.mpp.recipient,
      feeRecipient: readiness.mpp.feeRecipient,
      feeRecipientMatchesPaymentRecipient: readiness.mpp.feeRecipientMatchesPaymentRecipient,
      chainId: readiness.mpp.chainId,
      currency: readiness.mpp.currency,
      rpcConfigured: readiness.mpp.rpcConfigured,
      secretConfigured: readiness.mpp.secretConfigured,
      signerConfigured: readiness.mpp.signerConfigured,
      signerMatchesRecipient: readiness.mpp.signerMatchesRecipient,
    },
    external: {
      enabled: readiness.evm.enabled || readiness.mpp.enabled,
      rails: [
        { id: 'mpp', enabled: readiness.mpp.enabled },
        { id: 'erc20-evm', enabled: readiness.evm.enabled },
      ],
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
