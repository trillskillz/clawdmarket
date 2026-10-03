import { creditDepositMessage as depositMessage } from './credit-proof'
import 'server-only'
import { and, eq, sql } from 'drizzle-orm'
import { db } from './db'
import { credit_accounts, credit_deposits, credit_entries, payment_receipts, agent_owners, agents } from './schema'
import { explicitRpcUrl, getPaymentReadiness } from './payment-config'
import { SettlementError, verifyIncomingErc20Payment } from './external-settlement'
import { createPublicClient, http, verifyMessage, type Address, type Hash, type Hex } from 'viem'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
export class CreditError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message) }
}
export function creditToken() {
  const readiness = getPaymentReadiness()
  const token = readiness.evm.tokens.find(t => t.chainId === 8453 && t.symbol === 'USDC' && t.decimals === 6)
  if (!readiness.credit.enabled || !token || !readiness.evm.treasury) throw new CreditError('CREDIT_UNAVAILABLE', 'USDC account deposits are unavailable', 503)
  return { token, treasury: readiness.evm.treasury }
}
export async function creditBalance(userId: string, source: Tx | typeof db = db) {
  const [account] = await source.select().from(credit_accounts).where(eq(credit_accounts.user_id, userId)).limit(1)
  return { available_minor: account?.available_minor ?? 0, escrow_minor: account?.escrow_minor ?? 0, currency: 'USD', rail: 'credit' }
}
async function change(tx: Tx, userId: string, reference: string, kind: string, available: number, escrow: number) {
  if (![available, escrow].every(Number.isSafeInteger)) throw new CreditError('INVALID_AMOUNT', 'Credit amounts must be whole cents')
  await tx.insert(credit_accounts).values({ user_id: userId }).onConflictDoNothing()
  const rows = await tx.update(credit_accounts).set({
    available_minor: sql`${credit_accounts.available_minor} + ${available}`,
    escrow_minor: sql`${credit_accounts.escrow_minor} + ${escrow}`,
  }).where(and(eq(credit_accounts.user_id, userId), sql`${credit_accounts.available_minor} + ${available} >= 0`, sql`${credit_accounts.escrow_minor} + ${escrow} >= 0`)).returning()
  if (!rows.length) throw new CreditError('INSUFFICIENT_CREDIT', 'Insufficient deposited account credit', 402)
  await tx.insert(credit_entries).values({ user_id: userId, reference, kind, available_delta: available, escrow_delta: escrow })
}
export async function reserveCredit(tx: Tx, args: { id: string; buyer: string; feeRecipient: string; total: number; seller: number; fee: number }) {
  if (args.total !== args.seller + args.fee || args.seller <= 0 || args.fee < 0) throw new CreditError('INVALID_AMOUNT', 'Invalid credit reservation')
  await change(tx, args.buyer, args.id, 'purchase', -args.total, args.seller)
  if (args.fee) await change(tx, args.feeRecipient, args.id, 'fee', args.fee, 0)
}
export async function settleCredit(tx: Tx, trade: { id: string; buyer_id: string; seller_id: string; amount: number }, buyerMinor = 0) {
  const total = Math.round(trade.amount * 100)
  if (!Number.isSafeInteger(buyerMinor) || buyerMinor < 0 || buyerMinor > total) throw new CreditError('INVALID_AMOUNT', 'Invalid credit distribution')
  const [lock] = await tx.select().from(credit_entries).where(and(eq(credit_entries.user_id, trade.buyer_id), eq(credit_entries.reference, trade.id), eq(credit_entries.kind, 'purchase'))).limit(1)
  if (!lock || lock.escrow_delta !== total) throw new CreditError('CREDIT_ESCROW_MISMATCH', 'Credit reservation does not match trade')
  await change(tx, trade.buyer_id, trade.id, 'settlement', buyerMinor, -total)
  if (total > buyerMinor) await change(tx, trade.seller_id, trade.id, 'sale', total - buyerMinor, 0)
}
export { creditDepositMessage as depositMessage } from './credit-proof'
export function depositView(intent: typeof credit_deposits.$inferSelect, created = false) {
  return { ...intent, created, token_amount: String(BigInt(intent.amount_minor) * 10000n), decimals: 6, symbol: 'USDC', proof_message: intent.tx_hash ? depositMessage(intent, intent.tx_hash) : null }
}
export async function createDeposit(userId: string, input: { amount_minor: number; payer: string; client_reference: string }) {
  const { token, treasury } = creditToken()
  const read = async () => (await db.select().from(credit_deposits).where(and(eq(credit_deposits.user_id, userId), eq(credit_deposits.client_reference, input.client_reference))).limit(1))[0]
  const replay = (prior: typeof credit_deposits.$inferSelect) => {
    if (prior.amount_minor !== input.amount_minor || prior.payer !== input.payer.toLowerCase()) throw new CreditError('REFERENCE_CONFLICT', 'Reference belongs to another deposit')
    return depositView(prior)
  }
  const prior = await read()
  if (prior) return replay(prior)
  const rpc = explicitRpcUrl(token)
  if (!rpc) throw new CreditError('CREDIT_UNAVAILABLE', 'Deposit network is unavailable', 503)
  const client = createPublicClient({ transport: http(rpc, { timeout: 7000, retryCount: 0 }) })
  const [network, code] = await Promise.all([client.getChainId(), client.getCode({ address: input.payer as Address })])
  if (network !== token.chainId) throw new CreditError('DEPOSIT_CHAIN_MISMATCH', 'Deposit network does not match', 503)
  if (code && code !== '0x') throw new CreditError('DEPOSIT_WALLET_UNSUPPORTED', 'Use a standard externally owned wallet for USDC deposits; smart-account deposits are not supported', 400)
  try {
    const [intent] = await db.insert(credit_deposits).values({ user_id: userId, amount_minor: input.amount_minor, client_reference: input.client_reference, payer: input.payer.toLowerCase(), treasury: treasury.toLowerCase(), token: token.address.toLowerCase(), chain_id: token.chainId, expires_at: new Date(Date.now() + 30 * 60_000) }).returning()
    return depositView(intent, true)
  } catch (error) { const raced = await read(); if (raced) return replay(raced); throw error }
}
export async function confirmDeposit(userId: string, input: { id: string; tx_hash: Hash; signature: Hex }) {
  let [intent] = await db.select().from(credit_deposits).where(and(eq(credit_deposits.id, input.id), eq(credit_deposits.user_id, userId))).limit(1)
  if (!intent) throw new CreditError('DEPOSIT_NOT_FOUND', 'Deposit not found', 404)
  const hash = input.tx_hash.toLowerCase() as Hash
  if (intent.tx_hash && intent.tx_hash !== hash) throw new CreditError('DEPOSIT_HASH_CONFLICT', 'Recover this deposit using its original transaction hash')
  if (intent.state === 'confirmed') return depositView(intent)
  if (!await verifyMessage({ address: intent.payer as Address, message: depositMessage(intent, hash), signature: input.signature })) throw new CreditError('INVALID_DEPOSIT_PROOF', 'Deposit signature does not match payer', 403)
  // Claim the hash before RPC work. Timeouts never authorize a replacement transfer.
  await db.update(credit_deposits).set({ tx_hash: hash, payer_signature: input.signature }).where(and(eq(credit_deposits.id, intent.id), sql`(${credit_deposits.tx_hash} IS NULL OR ${credit_deposits.tx_hash} = ${hash})`))
  ;[intent] = await db.select().from(credit_deposits).where(eq(credit_deposits.id, intent.id)).limit(1)
  if (intent.tx_hash !== hash) throw new CreditError('DEPOSIT_HASH_CONFLICT', 'A different transaction was already saved')
  const payment = await verifyIncomingErc20Payment({ tradeId: intent.id, chainId: intent.chain_id, tokenAddress: intent.token as Address, txHash: hash, treasuryAddress: intent.treasury as Address, buyerAddress: intent.payer as Address, requiredUsd: intent.amount_minor / 100, requiredTokenAmount: BigInt(intent.amount_minor) * 10000n, notBefore: intent.created_at })
  if (payment.tokenAmount !== BigInt(intent.amount_minor) * 10000n) throw new CreditError('DEPOSIT_AMOUNT_MISMATCH', 'Transfer must match the exact deposit amount')
  const rpc = explicitRpcUrl(payment.token)
  if (!rpc) throw new CreditError('CREDIT_UNAVAILABLE', 'Deposit network is unavailable', 503)
  const client = createPublicClient({ transport: http(rpc) })
  const [chainId, canonicalBlock, decimals] = await Promise.all([client.getChainId(), client.getBlock({ blockNumber: payment.receipt.blockNumber }), client.readContract({ address: intent.token as Address, abi: [{ type: 'function', name: 'decimals', inputs: [], outputs: [{ type: 'uint8' }], stateMutability: 'view' }], functionName: 'decimals' })])
  if (chainId !== intent.chain_id || canonicalBlock.hash !== payment.receipt.blockHash || decimals !== 6) throw new CreditError('DEPOSIT_CHAIN_MISMATCH', 'Deposit chain, canonical block or token precision does not match')
  return creditWrite(() => db.transaction(async tx => {
    const [current] = await tx.select().from(credit_deposits).where(eq(credit_deposits.id, intent.id)).limit(1)
    if (current.state === 'confirmed') return depositView(current)
    const [used] = await tx.select({ id: payment_receipts.id }).from(payment_receipts).where(eq(payment_receipts.tx_hash, hash)).limit(1)
    if (used) throw new CreditError('DEPOSIT_PROOF_ALREADY_USED', 'This transfer already funds another payment')
    await tx.insert(payment_receipts).values({ route: '/api/wallet/deposits', payment_rail: 'evm', amount: intent.amount_minor / 100, currency: 'USDC', tx_hash: hash, payer_address: intent.payer, token_address: intent.token, chain_id: intent.chain_id, token_symbol: 'USDC', token_decimals: 6, token_amount: payment.tokenAmount.toString(), token_usd_price: 1, usd_value_at_payment: intent.amount_minor / 100, external_id: intent.id })
    await change(tx, userId, intent.id, 'deposit', intent.amount_minor, 0)
    const [updated] = await tx.update(credit_deposits).set({ state: 'confirmed' }).where(and(eq(credit_deposits.id, intent.id), eq(credit_deposits.state, 'pending'))).returning()
    if (!updated) throw new CreditError('DEPOSIT_STATE_CHANGED', 'Recover the original deposit')
    return depositView(updated)
  }))
}
export async function fundOwnedAgent(userId: string, agentId: string, minor: number, clientReference: string) {
  const target = `user_agent_${agentId}`
  const reference = `agent-funding:${userId}:${clientReference}`
  return creditWrite(() => db.transaction(async tx => {
    const [owner] = await tx.select({ id: agent_owners.agentId }).from(agent_owners).innerJoin(agents, eq(agents.id, agent_owners.agentId))
      .where(and(eq(agent_owners.agentId, agentId), eq(agent_owners.userId, userId), sql`${agents.archivedAt} IS NULL`)).limit(1)
    if (!owner) throw new CreditError('AGENT_NOT_OWNED', 'Agent is not owned by this account', 403)
    const [prior] = await tx.select().from(credit_entries).where(and(eq(credit_entries.reference, reference), eq(credit_entries.kind, 'transfer_out'))).limit(1)
    if (prior) {
      const [destination] = await tx.select().from(credit_entries).where(and(eq(credit_entries.reference, reference), eq(credit_entries.kind, 'transfer_in'))).limit(1)
      if (prior.user_id !== userId || prior.available_delta !== -minor || destination?.user_id !== target) throw new CreditError('REFERENCE_CONFLICT', 'Reference belongs to another transfer')
      return { idempotent: true, balance: await creditBalance(target, tx) }
    }
    await change(tx, userId, reference, 'transfer_out', -minor, 0)
    await change(tx, target, reference, 'transfer_in', minor, 0)
    return { idempotent: false, balance: await creditBalance(target, tx) }
  }))
}
export { SettlementError }

async function creditWrite<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation() }
    catch (error) {
      let current: unknown = error; let busy = false
      for (let depth = 0; current && depth < 6; depth++) {
        if (typeof current === 'object' && 'message' in current && /SQLITE_BUSY|database is locked/.test(String(current.message))) { busy = true; break }
        current = typeof current === 'object' && 'cause' in current ? current.cause : null
      }
      if (!busy || attempt >= 4) throw error
      await new Promise(resolve => setTimeout(resolve, 20 * 2 ** attempt))
    }
  }
}
