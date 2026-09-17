import 'server-only'
import { trades } from '@/lib/schema'
import { getPaymentReadiness } from '@/lib/payment-config'

type CheckoutTrade = Pick<
  typeof trades.$inferSelect,
  'id' | 'payment_rail' | 'payment_due_at' | 'status' | 'total_cost'
>

export function checkoutForTrade(trade: CheckoutTrade) {
  if (trade.payment_rail === 'mpp') {
    return { rail: 'mpp' as const, method: 'POST', funding_url: `/api/trades/${trade.id}/fund/mpp`, amount_usd: trade.total_cost, expires_at: trade.payment_due_at }
  }
  if (trade.payment_rail === 'evm') {
    const readiness = getPaymentReadiness()
    return {
      rail: 'evm' as const,
      method: 'POST',
      funding_url: `/api/trades/${trade.id}/fund/evm`,
      intent_url: `/api/trades/${trade.id}/fund/evm/intent`,
      amount_usd: trade.total_cost,
      treasury: readiness.evm.treasury,
      tokens: readiness.evm.tokens.map(({ chainId, chainName, address, symbol, decimals, fixedUsdPrice }) => ({ chain_id: chainId, chain_name: chainName, token_address: address, symbol, decimals, fixed_usd_price: fixedUsdPrice })),
      expires_at: trade.payment_due_at,
    }
  }
  return { rail: 'ledger' as const, status: trade.status }
}
