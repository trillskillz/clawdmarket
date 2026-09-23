import 'server-only'
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  keccak256,
  parseUnits,
  type Address,
  type Hash,
  type Hex,
} from 'viem'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, payment_receipts, payout_addresses, settlement_nonces, settlement_transfers, trades, users } from '@/lib/schema'
import { findAcceptedToken, getMppRecipientAddress, getTempoRpcUrl, getTreasuryAddress, requireSettlementSigner } from '@/lib/payment-config'
import { getRpcUrl } from '@/lib/settlement'
import { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } from '@/lib/constants'
import { reportInternalError } from '@/lib/api-error'
import { settlementAccount, settlementChain } from '@/lib/settlement-transaction'

const TRANSFER_EVENT = erc20Abi.find((entry) => entry.type === 'event' && entry.name === 'Transfer')!

export class SettlementError extends Error {
  constructor(message: string, public readonly code: string, public readonly retryable = true) {
    super(message)
    this.name = 'SettlementError'
  }
}

export async function payoutAddressForUser(userId: string): Promise<Address | null> {
  const [configured] = await db.select().from(payout_addresses).where(eq(payout_addresses.user_id, userId)).limit(1)
  if (configured && isAddress(configured.address)) return configured.address as Address

  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1)
  const walletMatch = user?.email?.match(/^wallet_(0x[a-fA-F0-9]{40})@wallet\.local$/)
  if (walletMatch && isAddress(walletMatch[1])) return walletMatch[1] as Address

  const agentId = userId.startsWith('user_agent_') ? userId.slice('user_agent_'.length) : ''
  if (!agentId) return null
  const [agent] = await db.select({ address: agents.owner_address }).from(agents).where(eq(agents.id, agentId)).limit(1)
  return agent?.address && isAddress(agent.address) ? agent.address as Address : null
}

export async function recordPayoutAddress(userId: string, address: Address) {
  const now = new Date()
  await db.insert(payout_addresses).values({ user_id: userId, address: address.toLowerCase(), updated_at: now })
    .onConflictDoUpdate({ target: payout_addresses.user_id, set: { address: address.toLowerCase(), updated_at: now } })
}

export async function verifyIncomingErc20Payment(params: {
  tradeId: string
  chainId: number
  tokenAddress: Address
  txHash: Hash
  treasuryAddress: Address
  buyerAddress: Address
  requiredUsd: number
  notBefore: Date
  requiredTokenAmount: bigint
}) {
  const token = findAcceptedToken(params.chainId, params.tokenAddress)
  if (!token) throw new SettlementError('This token is not enabled for marketplace checkout', 'TOKEN_NOT_ACCEPTED', false)
  const rpcUrl = token.rpcUrl || getRpcUrl(params.chainId)
  if (!rpcUrl) throw new SettlementError('No RPC endpoint is configured for this network', 'RPC_NOT_CONFIGURED', false)
  const client = createPublicClient({ chain: settlementChain(params.chainId, rpcUrl), transport: http(rpcUrl) })
  const receipt = await client.getTransactionReceipt({ hash: params.txHash }).catch(() => {
    throw new SettlementError('Payment transaction is not visible on the configured RPC yet', 'PAYMENT_CONFIRMING')
  })
  if (receipt.status !== 'success') throw new SettlementError('Payment transaction reverted', 'PAYMENT_REVERTED', false)
  const confirmations = await client.getTransactionConfirmations({ transactionReceipt: receipt })
  if (confirmations < token.confirmations) {
    throw new SettlementError(`Payment has ${confirmations} confirmation(s); ${token.confirmations} required`, 'PAYMENT_CONFIRMING')
  }
  const transaction = await client.getTransaction({ hash: params.txHash }).catch(() => {
    throw new SettlementError('Payment transaction details are not available yet', 'PAYMENT_CONFIRMING')
  })
  if (transaction.from.toLowerCase() !== params.buyerAddress.toLowerCase()) {
    throw new SettlementError('Payment sender does not match the connected buyer wallet', 'PAYER_MISMATCH', false)
  }
  const block = await client.getBlock({ blockHash: receipt.blockHash })
  if (block.timestamp < BigInt(Math.floor(params.notBefore.getTime() / 1000))) {
    throw new SettlementError('Payment predates this payment intent', 'PAYMENT_PREDATES_INTENT', false)
  }

  let tokenAmount = 0n
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== params.tokenAddress.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi: [TRANSFER_EVENT], data: log.data, topics: log.topics })
      if (decoded.eventName !== 'Transfer') continue
      const args = decoded.args as { from: Address; to: Address; value: bigint }
      if (args.from.toLowerCase() === params.buyerAddress.toLowerCase() && args.to.toLowerCase() === params.treasuryAddress.toLowerCase()) {
        tokenAmount += args.value
      }
    } catch {
      // Unrelated token log.
    }
  }
  if (tokenAmount <= 0n) throw new SettlementError('No matching ERC-20 transfer to the marketplace treasury was found', 'TRANSFER_NOT_FOUND', false)

  const usdValue = Number(formatUnits(tokenAmount, token.decimals)) * token.fixedUsdPrice
  if (tokenAmount < params.requiredTokenAmount || !Number.isFinite(usdValue) || usdValue + 0.000001 < params.requiredUsd) {
    throw new SettlementError(`Payment value is $${usdValue.toFixed(4)}; $${params.requiredUsd.toFixed(2)} is required`, 'PAYMENT_INSUFFICIENT', false)
  }
  return { receipt, token, tokenAmount, usdValue }
}

function rawAmountForUsd(receipt: typeof payment_receipts.$inferSelect, usdAmount: number) {
  const paidRaw = BigInt(receipt.token_amount || '0')
  const isPathUsd = receipt.chain_id === TEMPO_CHAIN_ID && receipt.token_address?.toLowerCase() === PATHUSD_ADDRESS.toLowerCase()
  const decimals = receipt.token_decimals ?? (isPathUsd ? 6 : null)
  const usdPrice = receipt.token_usd_price ?? (isPathUsd ? 1 : null)
  if (paidRaw <= 0n || decimals == null || usdPrice == null || usdPrice !== 1 || !Number.isFinite(usdAmount) || usdAmount <= 0) {
    throw new SettlementError('Payment receipt cannot be settled', 'INVALID_PAYMENT_RECEIPT', false)
  }
  const raw = parseUnits(usdAmount.toFixed(decimals), decimals)
  if (raw <= 0n) throw new SettlementError('Settlement amount rounds to zero', 'SETTLEMENT_DUST', false)
  if (raw > paidRaw) throw new SettlementError('Settlement amount exceeds the verified payment', 'SETTLEMENT_EXCEEDS_PAYMENT', false)
  return raw
}

async function queueTransfer(input: {
  trade: typeof trades.$inferSelect
  kind: 'seller_payout' | 'buyer_refund'
  recipient: Address
  usdAmount: number
}) {
  const [receipt] = await db.select().from(payment_receipts).where(eq(payment_receipts.trade_id, input.trade.id)).limit(1)
  if (!receipt?.token_address || !receipt.chain_id) throw new SettlementError('Trade payment receipt is missing', 'PAYMENT_RECEIPT_MISSING', false)
  const from = input.trade.payment_rail === 'mpp' ? getMppRecipientAddress() : getTreasuryAddress()
  if (!from) throw new SettlementError('Settlement wallet is not configured', 'SETTLEMENT_WALLET_MISSING', false)
  const tokenAmount = rawAmountForUsd(receipt, input.usdAmount)
  const now = new Date()
  await db.insert(settlement_transfers).values({
    business_key: `${input.trade.id}:${input.kind}`,
    trade_id: input.trade.id,
    kind: input.kind,
    chain_id: receipt.chain_id,
    token_address: receipt.token_address,
    from_address: from.toLowerCase(),
    to_address: input.recipient.toLowerCase(),
    token_amount: tokenAmount.toString(),
    usd_amount: input.usdAmount,
    status: 'pending',
    created_at: now,
    updated_at: now,
  }).onConflictDoNothing()
  const [queued] = await db.select().from(settlement_transfers)
    .where(eq(settlement_transfers.business_key, `${input.trade.id}:${input.kind}`)).limit(1)
  if (!queued) throw new SettlementError('Could not queue settlement transfer', 'OUTBOX_WRITE_FAILED')
  if (queued.to_address.toLowerCase() !== input.recipient.toLowerCase() || queued.token_amount !== tokenAmount.toString()) {
    throw new SettlementError('Existing settlement instruction does not match this resolution', 'SETTLEMENT_CONFLICT', false)
  }
  return queued
}

async function allocateNonce(transfer: typeof settlement_transfers.$inferSelect, networkNonce: number) {
  if (transfer.nonce != null) return transfer.nonce
  const key = `${transfer.chain_id}:${transfer.from_address.toLowerCase()}`
  return db.transaction(async (tx) => {
    const [fresh] = await tx.select().from(settlement_transfers).where(eq(settlement_transfers.id, transfer.id)).limit(1)
    if (fresh.nonce != null) return fresh.nonce
    await tx.insert(settlement_nonces).values({
      key,
      chain_id: transfer.chain_id,
      wallet_address: transfer.from_address.toLowerCase(),
      next_nonce: networkNonce,
      updated_at: new Date(),
    }).onConflictDoUpdate({
      target: settlement_nonces.key,
      set: { next_nonce: sql`MAX(${settlement_nonces.next_nonce}, ${networkNonce})`, updated_at: new Date() },
    })
    const [state] = await tx.select().from(settlement_nonces).where(eq(settlement_nonces.key, key)).limit(1)
    const nonce = Math.max(networkNonce, state.next_nonce)
    await tx.update(settlement_nonces).set({ next_nonce: nonce + 1, updated_at: new Date() }).where(eq(settlement_nonces.key, key))
    await tx.update(settlement_transfers).set({ nonce, updated_at: new Date() }).where(eq(settlement_transfers.id, transfer.id))
    return nonce
  })
}

export async function processSettlementTransfer(transferId: string, options: { waitMs?: number } = {}) {
  let [transfer] = await db.select().from(settlement_transfers).where(eq(settlement_transfers.id, transferId)).limit(1)
  if (!transfer) throw new SettlementError('Settlement transfer not found', 'TRANSFER_NOT_FOUND', false)
  if (transfer.status === 'confirmed') return transfer
  if (transfer.status === 'failed') throw new SettlementError(transfer.last_error || 'Settlement transfer failed', 'TRANSFER_FAILED', false)

  const rpcUrl = transfer.chain_id === TEMPO_CHAIN_ID
    ? getTempoRpcUrl()
    : findAcceptedToken(transfer.chain_id, transfer.token_address)?.rpcUrl || getRpcUrl(transfer.chain_id)
  if (!rpcUrl) throw new SettlementError('No RPC endpoint is configured for settlement', 'RPC_NOT_CONFIGURED', false)
  const chain = settlementChain(transfer.chain_id, rpcUrl)
  const client = createPublicClient({ chain, transport: http(rpcUrl) })
  const { privateKey } = requireSettlementSigner(transfer.from_address as Address)
  const account = settlementAccount(transfer.chain_id, privateKey, transfer.from_address as Address)

  if (!transfer.raw_transaction) {
    const [claimed] = await db.update(settlement_transfers).set({
      status: 'signing', attempts: sql`${settlement_transfers.attempts} + 1`, updated_at: new Date(), last_error: null,
    }).where(and(eq(settlement_transfers.id, transfer.id), eq(settlement_transfers.status, 'pending'))).returning()
    if (!claimed) return transfer

    try {
      const networkNonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' })
      const nonce = await allocateNonce(claimed, networkNonce)
      const data = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [claimed.to_address as Address, BigInt(claimed.token_amount)] })
      const request = await client.prepareTransactionRequest({ account, to: claimed.token_address as Address, data, nonce })
      const raw = await account.signTransaction(request as any)
      const hash = keccak256(raw)
      await db.update(settlement_transfers).set({ raw_transaction: raw, tx_hash: hash, status: 'prepared', updated_at: new Date() })
        .where(and(eq(settlement_transfers.id, transfer.id), eq(settlement_transfers.status, 'signing')))
    } catch (error) {
      await db.update(settlement_transfers).set({ status: 'pending', last_error: String(error), updated_at: new Date() })
        .where(eq(settlement_transfers.id, transfer.id))
      throw new SettlementError(`Could not prepare settlement transfer: ${String(error)}`, 'TRANSFER_PREPARE_FAILED')
    }
    ;[transfer] = await db.select().from(settlement_transfers).where(eq(settlement_transfers.id, transfer.id)).limit(1)
  }

  if (!transfer.raw_transaction || !transfer.tx_hash) return transfer
  try {
    await client.sendRawTransaction({ serializedTransaction: transfer.raw_transaction as Hex }).catch(async () => {
      const known = await client.getTransaction({ hash: transfer.tx_hash as Hash }).catch(() => null)
      if (!known) throw new Error('Signed settlement transaction was not accepted by the network')
    })
    await db.update(settlement_transfers).set({ status: 'submitted', updated_at: new Date() }).where(eq(settlement_transfers.id, transfer.id))
    const token = findAcceptedToken(transfer.chain_id, transfer.token_address)
    const receipt = await client.waitForTransactionReceipt({ hash: transfer.tx_hash as Hash, confirmations: token?.confirmations || 3, timeout: options.waitMs ?? 45_000 })
    if (receipt.status !== 'success') {
      await db.update(settlement_transfers).set({ status: 'failed', last_error: 'Settlement transaction reverted', updated_at: new Date() }).where(eq(settlement_transfers.id, transfer.id))
      throw new SettlementError('Settlement transaction reverted', 'TRANSFER_REVERTED', false)
    }
    const [confirmed] = await db.update(settlement_transfers).set({ status: 'confirmed', confirmed_at: new Date(), updated_at: new Date(), last_error: null })
      .where(eq(settlement_transfers.id, transfer.id)).returning()
    return confirmed
  } catch (error) {
    if (error instanceof SettlementError) throw error
    await db.update(settlement_transfers).set({ status: 'submitted', last_error: String(error), updated_at: new Date() }).where(eq(settlement_transfers.id, transfer.id))
    return (await db.select().from(settlement_transfers).where(eq(settlement_transfers.id, transfer.id)).limit(1))[0]
  }
}

export async function settleExternallyFundedTrade(
  trade: typeof trades.$inferSelect,
  sellerPercent = 100,
  options: { process?: boolean; waitMs?: number } = {},
) {
  if (!['mpp', 'evm'].includes(trade.payment_rail)) return { complete: true, transfers: [] }
  if (sellerPercent < 0 || sellerPercent > 100) throw new SettlementError('Invalid seller distribution', 'INVALID_DISTRIBUTION', false)
  const sellerUsd = Math.round(trade.seller_amount * (sellerPercent / 100) * 100) / 100
  const buyerUsd = Math.round((trade.seller_amount - sellerUsd) * 100) / 100
  const queued: (typeof settlement_transfers.$inferSelect)[] = []
  if (sellerUsd > 0) {
    const address = await payoutAddressForUser(trade.seller_id)
    if (!address) throw new SettlementError('Seller must configure a payout wallet before settlement', 'SELLER_PAYOUT_ADDRESS_MISSING', false)
    queued.push(await queueTransfer({ trade, kind: 'seller_payout', recipient: address, usdAmount: sellerUsd }))
  }
  if (buyerUsd > 0) {
    const [receipt] = await db.select().from(payment_receipts).where(eq(payment_receipts.trade_id, trade.id)).limit(1)
    if (!receipt?.payer_address || !isAddress(receipt.payer_address)) throw new SettlementError('Buyer refund address is missing from the payment receipt', 'BUYER_REFUND_ADDRESS_MISSING', false)
    queued.push(await queueTransfer({ trade, kind: 'buyer_refund', recipient: receipt.payer_address as Address, usdAmount: buyerUsd }))
  }
  const processed = []
  for (const transfer of queued) {
    processed.push(options.process === false ? transfer : await processSettlementTransfer(transfer.id, { waitMs: options.waitMs }))
  }
  return { complete: processed.every((item) => item.status === 'confirmed'), transfers: processed }
}

export async function refundCancelledExternalTrade(
  trade: typeof trades.$inferSelect,
  options: { process?: boolean; waitMs?: number } = {},
) {
  if (!['mpp', 'evm'].includes(trade.payment_rail) || trade.status !== 'cancelled') {
    throw new SettlementError('Only a cancelled externally funded reservation can use this refund path', 'INVALID_REFUND_STATE', false)
  }
  const [receipt] = await db.select().from(payment_receipts).where(eq(payment_receipts.trade_id, trade.id)).limit(1)
  if (!receipt?.payer_address || !isAddress(receipt.payer_address)) {
    throw new SettlementError('Buyer refund address is missing from the payment receipt', 'BUYER_REFUND_ADDRESS_MISSING', false)
  }
  const refundUsd = Number(receipt.usd_value_at_payment || receipt.amount)
  const queued = await queueTransfer({ trade, kind: 'buyer_refund', recipient: receipt.payer_address as Address, usdAmount: refundUsd })
  const transfer = options.process === false ? queued : await processSettlementTransfer(queued.id, { waitMs: options.waitMs })
  const complete = transfer.status === 'confirmed'
  if (complete) await db.update(trades).set({ payout_status: 'refunded' }).where(and(eq(trades.id, trade.id), eq(trades.status, 'cancelled')))
  return { complete, transfers: [transfer] }
}

export async function processPendingSettlementTransfers(limit = 20, waitMs = 5_000) {
  const stale = new Date(Date.now() - 5 * 60_000)
  await db.update(settlement_transfers).set({ status: 'pending', updated_at: new Date() })
    .where(and(eq(settlement_transfers.status, 'signing'), sql`${settlement_transfers.updated_at} < ${stale}`))
  const rows = await db.select().from(settlement_transfers)
    .where(inArray(settlement_transfers.status, ['pending', 'prepared', 'submitted'])).limit(limit)
  const summary = { attempted: rows.length, confirmed: 0, pending: 0, failed: 0 }
  for (const row of rows) {
    try {
      const result = await processSettlementTransfer(row.id, { waitMs })
      if (result.status === 'confirmed') summary.confirmed += 1
      else if (result.status === 'failed') summary.failed += 1
      else summary.pending += 1
    } catch (error) {
      summary.failed += 1
      reportInternalError('Pending settlement transfer processing failed', error, {
        transfer_id: row.id,
        trade_id: row.trade_id,
      })
    }
  }
  return summary
}
