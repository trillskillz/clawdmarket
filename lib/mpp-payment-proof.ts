import 'server-only'
import { createPublicClient, http, parseEventLogs, parseUnits, TransactionReceiptNotFoundError, type Address, type Hash } from 'viem'
import { tempo } from 'viem/chains'
import { Abis } from 'viem/tempo'
import { getPaymentReadiness, getTempoRpcUrl } from '@/lib/payment-config'
import { marketplaceMppMemo } from '@/lib/marketplace-mpp-payment'
import { TradeFundingError } from '@/lib/trade-funding'
import type { trades } from '@/lib/schema'

/** Read-only reconciliation. It never signs, sends, replaces or sponsors a transaction. */
export async function verifyMarketplaceMppHash(trade: typeof trades.$inferSelect, hash: Hash, payer: Address) {
  const ready = getPaymentReadiness().mpp, rpcUrl = getTempoRpcUrl()
  if (!ready.enabled || !ready.recipient || !rpcUrl) throw new TradeFundingError('MPP proof verification is unavailable', 503, 'PAYMENT_RAIL_NOT_CONFIGURED')
  const client = createPublicClient({ chain: tempo, transport: http(rpcUrl, { retryCount: 0, timeout: 10_000, fetchOptions: { redirect: 'error' } }) })
  if (await client.getChainId() !== ready.chainId) throw new TradeFundingError('MPP RPC chain differs from the configured chain', 503, 'MPP_RPC_CHAIN_MISMATCH')
  let receipt
  try { receipt = await client.getTransactionReceipt({ hash }) } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) throw new TradeFundingError('The original payment is not confirmed; do not send a replacement', 409, 'PAYMENT_CONFIRMING')
    throw error
  }
  if (receipt.blockNumber === null || !receipt.blockHash) throw new TradeFundingError('The original payment is not confirmed', 409, 'PAYMENT_CONFIRMING')
  const block = await client.getBlock({ blockNumber: receipt.blockNumber })
  if (!block.hash || block.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) throw new TradeFundingError('The original payment is not canonical yet', 409, 'PAYMENT_CONFIRMING')
  if (Number(block.timestamp) < Math.floor(trade.created_at.getTime() / 1000)) throw new TradeFundingError('MPP payment predates this reservation', 422, 'MPP_PAYMENT_PROOF_INVALID')
  if (receipt.status !== 'success' || receipt.transactionHash.toLowerCase() !== hash.toLowerCase() || receipt.from.toLowerCase() !== payer.toLowerCase()) {
    throw new TradeFundingError('MPP transaction does not match the original payer or successful proof', 422, 'MPP_PAYMENT_PROOF_INVALID')
  }
  const amount = parseUnits(trade.total_cost.toFixed(2), 6), memo = marketplaceMppMemo(trade.id)
  const logs = parseEventLogs({ abi: Abis.tip20, eventName: 'TransferWithMemo', logs: receipt.logs, strict: true })
  if (!logs.some((log) => log.address.toLowerCase() === ready.currency.toLowerCase()
    && log.args.from.toLowerCase() === payer.toLowerCase() && log.args.to.toLowerCase() === ready.recipient!.toLowerCase()
    && log.args.amount === amount && log.args.memo.toLowerCase() === memo)) {
    throw new TradeFundingError('MPP receipt has no exact trade-bound token transfer', 422, 'MPP_PAYMENT_PROOF_INVALID')
  }
  return { payer, hash: receipt.transactionHash, amount }
}
