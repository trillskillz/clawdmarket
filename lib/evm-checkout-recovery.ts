import { evmPaymentProofMessage, PAYMENT_TX_HASH, type EvmPaymentIntent } from './evm-payment-proof'

export type SavedEvmPayment = { intentId: string; txHash: string | null; signature?: string }

export function readSavedPayment(value: string | null): SavedEvmPayment | null {
  if (!value) return null
  const record = JSON.parse(value) as SavedEvmPayment
  if (!record || typeof record.intentId !== 'string' || (record.txHash !== null && !PAYMENT_TX_HASH.test(record.txHash))) {
    throw new Error('Saved payment recovery data is invalid. Check your wallet history; do not pay again.')
  }
  return record
}

export function isExplicitWalletRejection(error: unknown): boolean {
  let current = error
  for (let depth = 0; current && typeof current === 'object' && depth < 8; depth += 1) {
    const entry = current as { code?: unknown; cause?: unknown }
    if (entry.code === 4001 || entry.code === '4001') return true
    current = entry.cause
  }
  return false
}

// Injected dependencies let us test disconnect/refresh/retry without moving funds.
export async function runRecoverableEvmPayment<T>(options: {
  saved: SavedEvmPayment | null
  recoveryHash?: string
  reserve: () => Promise<{ intent: EvmPaymentIntent; created: boolean }>
  persist: (record: SavedEvmPayment | null) => void
  broadcast: (intent: EvmPaymentIntent) => Promise<string>
  releaseRejected: (intent: EvmPaymentIntent) => Promise<boolean>
  sign: (message: string, payer: string) => Promise<string>
  verify: (intent: EvmPaymentIntent, txHash: string, signature: string) => Promise<T>
}) {
  const { intent, created } = await options.reserve()
  const saved = options.saved?.intentId === intent.id ? options.saved : null
  const manualHash = options.recoveryHash?.trim().toLowerCase()
  if (manualHash && !PAYMENT_TX_HASH.test(manualHash)) throw new Error('Enter the full transaction hash from your wallet history.')
  if (intent.tx_hash && saved?.txHash && intent.tx_hash.toLowerCase() !== saved.txHash.toLowerCase()) throw new Error('Payment recovery records disagree. Contact support; do not pay again.')
  let txHash = intent.tx_hash || saved?.txHash || manualHash || null
  if (!txHash) {
    if (!created) throw new Error('A wallet payment was already started. Recover its transaction hash from your wallet history; do not send another payment.')
    options.persist({ intentId: intent.id, txHash: null })
    try {
      txHash = await options.broadcast(intent)
    } catch (error) {
      if (isExplicitWalletRejection(error) && await options.releaseRejected(intent).catch(() => false)) options.persist(null)
      throw error
    }
    if (!PAYMENT_TX_HASH.test(txHash)) throw new Error('Wallet returned no valid transaction hash. Check wallet history; do not pay again.')
    try { options.persist({ intentId: intent.id, txHash }) }
    catch { throw new Error(`Payment sent: ${txHash}. Could not save recovery data. Copy this hash and resume verification; do not pay again.`) }
  }
  const signature = intent.payer_signature || (saved?.txHash?.toLowerCase() === txHash.toLowerCase() ? saved.signature : null)
    || await options.sign(evmPaymentProofMessage(intent, txHash), intent.payer_address)
  options.persist({ intentId: intent.id, txHash, signature })
  return options.verify(intent, txHash, signature)
}
