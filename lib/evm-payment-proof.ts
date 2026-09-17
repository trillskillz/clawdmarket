import { verifyMessage, type Address, type Hex } from 'viem'

export const PAYMENT_TX_HASH = /^0x[a-fA-F0-9]{64}$/

export type EvmPaymentIntent = {
  id: string
  trade_id: string
  buyer_id: string
  origin: string
  payer_address: string
  chain_id: number
  token_address: string
  treasury_address: string
  token_amount: string
  amount_usd: number
  expires_at: string
  created_at: Date | string
  tx_hash: string | null
  payer_signature: string | null
}

// Reconstructed from persisted server fields, never from a client-supplied
// message. Unlike a login signature, this authorizes one exact payment proof.
export function evmPaymentProofMessage(intent: EvmPaymentIntent, txHash: string) {
  if (!PAYMENT_TX_HASH.test(txHash)) throw new Error('Invalid transaction hash')
  return [
    'ClawdMarket payment attribution v1',
    'Authorize this existing transfer for this trade. This signature does not send another payment.',
    `Origin: ${intent.origin}`,
    `Intent: ${intent.id}`,
    `Trade: ${intent.trade_id}`,
    `Buyer: ${intent.buyer_id}`,
    `Payer: ${intent.payer_address.toLowerCase()}`,
    `Chain: ${intent.chain_id}`,
    `Token: ${intent.token_address.toLowerCase()}`,
    `Recipient: ${intent.treasury_address.toLowerCase()}`,
    `Token amount (base units): ${intent.token_amount}`,
    `Total USD: ${intent.amount_usd.toFixed(2)}`,
    `Created: ${new Date(intent.created_at).toISOString()}`,
    `Checkout deadline: ${intent.expires_at}`,
    `Transaction: ${txHash.toLowerCase()}`,
    'A late payment is refunded, not used to start work.',
  ].join('\n')
}

export async function verifyEvmPaymentProof(intent: EvmPaymentIntent, txHash: string, signature: string) {
  if (!/^0x[a-fA-F0-9]{130}$/.test(signature)) return false
  return verifyMessage({
    address: intent.payer_address as Address,
    message: evmPaymentProofMessage(intent, txHash),
    signature: signature as Hex,
  }).catch(() => false)
}

export type FundingResult = { ok?: boolean; status?: string; trade?: { status: string; payout_status?: string } }

export function fundingOutcome(result: FundingResult): 'funded' | 'refund_pending' | 'refunded' | 'unknown' {
  if (!result.ok) return 'unknown'
  if (result.status === 'late_payment_refunded' || (result.trade?.status === 'cancelled' && result.trade.payout_status === 'refunded')) return 'refunded'
  if (result.status === 'late_payment_refund_processing' || (result.trade?.status === 'cancelled' && result.trade.payout_status === 'processing')) return 'refund_pending'
  if (result.trade && ['escrow_held', 'pending_release', 'completed', 'complete', 'resolved', 'disputed'].includes(result.trade.status)) return 'funded'
  return 'unknown'
}

export function fundingNotice(result: FundingResult) {
  const outcome = fundingOutcome(result)
  if (outcome === 'refunded') return 'The reservation closed. Your payment has been refunded.'
  if (outcome === 'refund_pending') return 'The reservation closed. Your refund is processing; do not send another payment.'
  if (outcome === 'funded') return 'Payment verified. Track delivery and settlement in your trade.'
  return 'Payment status is not confirmed. Check the trade before taking further action; do not pay again.'
}
