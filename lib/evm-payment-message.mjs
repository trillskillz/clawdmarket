/** Shared immutable attribution message; no RPC, signing key or server imports. */
export const PAYMENT_TX_HASH = /^0x[a-fA-F0-9]{64}$/

export function evmPaymentProofMessage(intent, txHash) {
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

