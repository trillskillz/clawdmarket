import 'server-only'
import { and, eq, isNull, or } from 'drizzle-orm'
import { Challenge } from 'mppx'
import { createPublicClient, erc20Abi, http, parseUnits, type Address } from 'viem'
import { db } from './db'
import { buyer_evm_payment_claims, buyer_mpp_payment_claims, organization_spending_payment_claims, organization_spending_mpp_claims,
  organization_listing_payment_claims, organization_listing_mpp_claims, organization_task_payment_claims, organization_task_mpp_intents as intents, organization_task_mpp_claims as claims, payment_receipts } from './schema'
import { originalTaskPayment, taskFundingEligibility } from './organization-task-authorizations'
import { purchasingTransaction, PurchasingError, type PurchasingSource } from './organization-purchasing-transaction'
import { serviceFundingEligibility } from './service-funding-eligibility'
import { inspectSignedTempoPayment } from './buyer-tempo-transaction.mjs'
import { assertBuyerTempoReserve } from './buyer-tempo-fees.mjs'
import { getNewPaymentControl } from './payment-control'
import { getTempoRpcUrl } from './payment-config'
import { canonicalContract } from './structured-verification'

type Intent = typeof intents.$inferSelect
type ClaimInput = { intent_id: string; mandate_id: string; buyer_operation_id: string; serialized_transaction: string }
function fail(code: string, status = 409): never { throw new PurchasingError(code, status) }
function dto(intent: Intent) { const { challenge_json, ...fields } = intent; return { ...fields, challenge: JSON.parse(challenge_json) } }
async function scope(source: PurchasingSource, tradeId: string, buyerId?: string) {
  const original = await originalTaskPayment(source, tradeId)
  if (!original || original.trade.payment_rail !== 'mpp') fail('BUYER_PAYMENT_SCOPE_MISMATCH')
  if (buyerId && original.trade.buyer_id !== buyerId) fail('FORBIDDEN', 403)
  const { payment } = original.terms
  if (payment.rail !== 'mpp' || original.terms.token_decimals !== 6 || original.terms.token_usd_price !== 1
    || original.terms.fee_token_decimals !== 6 || !('fee_token_address' in payment) || payment.fee_token_address !== payment.token_address) fail('TASK_PAYMENT_TERMS_MISMATCH')
  return { ...original, payment }
}
async function permission(source: PurchasingSource, original: Awaited<ReturnType<typeof scope>>, intent?: Intent, validBefore?: number) {
  const { trade } = original
  if (trade.status !== 'pending' || !trade.payment_due_at || Date.parse(trade.payment_due_at) <= Date.now()
    || intent && Date.parse(intent.expires_at) <= Date.now() || validBefore !== undefined && validBefore <= Math.floor(Date.now() / 1000)) return 'CHECKOUT_CLOSED'
  if ((await getNewPaymentControl()).paused) return 'NEW_PAYMENTS_PAUSED'
  return await taskFundingEligibility(trade, source, intent ? { rail: 'mpp', chainId: intent.chain_id,
    tokenAddress: intent.token_address, payerAddress: intent.payer_address, treasuryAddress: intent.treasury_address } : undefined)
    || await serviceFundingEligibility(trade, source)
}
async function reserves(original: Awaited<ReturnType<typeof scope>>, intent: Intent, maximumFee: string) {
  const rpcUrl = getTempoRpcUrl() ?? undefined
  if (!rpcUrl) fail('MPP_CHAIN_UNAVAILABLE', 503)
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0, timeout: 5000, fetchOptions: { redirect: 'error' } }) })
  try {
    if (await client.getChainId() !== original.payment.chain_id) fail('MPP_CHAIN_UNAVAILABLE', 503)
    const [decimals, balance] = await Promise.all([
      client.readContract({ address: intent.token_address as Address, abi: erc20Abi, functionName: 'decimals' }),
      client.readContract({ address: intent.token_address as Address, abi: erc20Abi, functionName: 'balanceOf', args: [intent.payer_address as Address], blockTag: 'pending' }),
    ])
    if (decimals !== 6) fail('BUYER_TEMPO_TOKEN_PRECISION_MISMATCH')
    assertBuyerTempoReserve({ tokenBalance: balance, paymentAmount: BigInt(intent.token_amount), maximumFeeUnits: BigInt(maximumFee), payment: original.payment })
  } catch (error) {
    if (error instanceof PurchasingError) throw error
    fail(error instanceof Error && /^BUYER_[A-Z0-9_]+$/.test(error.message) ? error.message : 'BUYER_WALLET_RESERVE_UNAVAILABLE', 503)
  }
}
export async function inspectTaskTempoIntent(tradeId: string, buyerId: string) {
  const { trade } = await scope(db, tradeId, buyerId)
  const [intent] = await db.select().from(intents).where(eq(intents.trade_id, tradeId)).limit(1)
  const [claim] = intent ? await db.select().from(claims).where(eq(claims.intent_id, intent.id)).limit(1) : []
  return { intent: intent ? dto(intent) : null, claim: claim ?? null, trade: { id: trade.id, status: trade.status, payout_status: trade.payout_status } }
}
export async function createTaskTempoIntent(tradeId: string, buyerId: string, operationId: string, origin: string) {
  return purchasingTransaction(async (tx) => {
    const original = await scope(tx, tradeId, buyerId), { authorization, payment, trade } = original
    const [prior] = await tx.select().from(intents).where(eq(intents.trade_id, tradeId)).limit(1)
    if (prior) {
      if (prior.buyer_operation_id !== operationId || prior.origin !== origin) fail('BUYER_OPERATION_CONFLICT')
      return { intent: dto(prior), created: false, claim_required: true }
    }
    const reason = await permission(tx, original)
    if (reason) fail(reason)
    const [used] = await tx.select({ id: intents.id }).from(intents).where(eq(intents.buyer_operation_id, operationId)).limit(1)
    if (used) fail('BUYER_OPERATION_CONFLICT')
    const { getMarketplaceMppServer } = await import('./mpp'), { marketplaceMppCharge } = await import('./marketplace-mpp-payment')
    const server = getMarketplaceMppServer()
    if (!server) fail('PAYMENT_RAIL_NOT_CONFIGURED', 503)
    const result = await server.charge(marketplaceMppCharge(trade))(new Request(`${origin}/api/trades/${tradeId}/fund/mpp`, { method: 'POST' }))
    if (result.status !== 402) fail('BUYER_PAYMENT_CHALLENGE_UNAVAILABLE', 503)
    const challenge = Challenge.fromResponse<any>(result.challenge), serialized = JSON.stringify(challenge), amount = parseUnits(trade.total_cost.toFixed(2), 6).toString()
    if (Buffer.byteLength(serialized) > 16_384 || challenge.request.amount !== amount || challenge.request.externalId !== tradeId
      || challenge.request.currency?.toLowerCase() !== payment.token_address || challenge.request.recipient?.toLowerCase() !== payment.treasury_address
      || !challenge.expires || Date.parse(challenge.expires) > Date.parse(trade.payment_due_at!)
      || Date.parse(challenge.expires) > Date.parse(original.terms.expires_at)) fail('BUYER_PAYMENT_CHALLENGE_SCOPE_MISMATCH')
    const [intent] = await tx.insert(intents).values({ id: crypto.randomUUID(), trade_id: tradeId, buyer_id: buyerId,
      buyer_operation_id: operationId, authorization_id: authorization.id, authority_hash: authorization.authority_hash, origin,
      chain_id: payment.chain_id, payer_address: payment.payer_address, token_address: payment.token_address, treasury_address: payment.treasury_address,
      token_amount: amount, token_decimals: 6, amount_usd: trade.total_cost, expires_at: challenge.expires, challenge_json: serialized }).returning()
    return { intent: dto(intent), created: true, claim_required: true }
  })
}
async function exact(source: PurchasingSource, tradeId: string, buyerId: string, input: ClaimInput) {
  const original = await scope(source, tradeId, buyerId), { authorization, payment, trade } = original
  const [intent] = await source.select().from(intents).where(and(eq(intents.id, input.intent_id), eq(intents.trade_id, tradeId))).limit(1)
  if (!intent || intent.buyer_id !== buyerId || intent.authorization_id !== authorization.id || input.mandate_id !== authorization.id
    || intent.authority_hash !== authorization.authority_hash || intent.buyer_operation_id !== input.buyer_operation_id
    || intent.chain_id !== payment.chain_id || intent.payer_address !== payment.payer_address || intent.token_address !== payment.token_address
    || intent.treasury_address !== payment.treasury_address || intent.token_decimals !== 6 || Math.round(intent.amount_usd * 100) !== original.terms.total_minor
    || intent.token_amount !== parseUnits(trade.total_cost.toFixed(2), 6).toString()) fail('BUYER_OPERATION_CONFLICT')
  let checked
  try { checked = await inspectSignedTempoPayment(input.serialized_transaction, intent, payment) }
  catch (error) { fail(error instanceof Error && /^BUYER_[A-Z0-9_]+$/.test(error.message) ? error.message : 'BUYER_TEMPO_TRANSACTION_SCOPE_MISMATCH') }
  const [prior] = await source.select().from(claims).where(eq(claims.intent_id, intent.id)).limit(1)
  if (prior && (prior.trade_id !== tradeId || prior.authorization_id !== authorization.id || prior.authority_hash !== authorization.authority_hash
    || prior.tx_hash !== checked.tx_hash || prior.chain_id !== checked.chain_id || prior.payer_address !== checked.payer_address || prior.nonce !== checked.nonce
    || prior.fee_token_address !== checked.fee_token_address || prior.maximum_fee_token_cost_units !== checked.maximum_fee_token_cost_units
    || prior.valid_before !== checked.valid_before || !['claimed', 'confirmed'].includes(prior.state))) fail('PAYMENT_TRANSACTION_CONFLICT')
  return { original, intent, checked, prior }
}
export async function claimTaskTempoPayment(tradeId: string, buyerId: string, input: ClaimInput) {
  return purchasingTransaction(async (tx) => {
    const { original, intent, checked, prior } = await exact(tx, tradeId, buyerId, input)
    const reason = prior?.state === 'confirmed' ? 'PAYMENT_ALREADY_RECONCILED' : await permission(tx, original, intent, checked.valid_before)
    if (reason) {
      if (prior) return { claim: prior, send_allowed: false, idempotent: true, state: 'recover_existing_payment' }
      fail(reason)
    }
    if (!prior) {
      for (const family of [buyer_evm_payment_claims, buyer_mpp_payment_claims, organization_spending_payment_claims,
        organization_spending_mpp_claims, organization_task_payment_claims, organization_listing_payment_claims, organization_listing_mpp_claims, claims] as const) {
        const [other] = await tx.select({ state: family.state }).from(family).where(and(eq(family.chain_id, checked.chain_id),
          eq(family.payer_address, checked.payer_address), or(eq(family.state, 'claimed'), eq(family.nonce, checked.nonce)))).limit(1)
        if (other) fail(other.state === 'claimed' ? 'BUYER_WALLET_PAYMENT_UNRECONCILED' : 'BUYER_WALLET_NONCE_ALREADY_CLAIMED')
      }
    }
    try { await reserves(original, intent, checked.maximum_fee_token_cost_units) }
    catch (error) {
      if (prior) return { claim: prior, send_allowed: false, idempotent: true, state: 'recover_existing_payment' }
      throw error
    }
    if (prior) return { claim: prior, send_allowed: true, idempotent: true, state: 'submit_exact_credential' }
    const [claim] = await tx.insert(claims).values({ intent_id: intent.id, trade_id: tradeId, authorization_id: original.authorization.id,
      authority_hash: original.authorization.authority_hash, chain_id: checked.chain_id, payer_address: checked.payer_address, nonce: checked.nonce,
      tx_hash: checked.tx_hash, fee_token_address: checked.fee_token_address, maximum_fee_token_cost_units: checked.maximum_fee_token_cost_units,
      valid_before: checked.valid_before }).returning()
    return { claim, send_allowed: true, idempotent: false, state: 'submit_exact_credential' }
  })
}
/** Invoked after SDK simulation, immediately before the exact original RPC mutation. */
export async function assertTaskTempoPull(tradeId: string, payer: string | undefined,
  pull: { serialized_transaction: string; challenge: unknown }, markSubmission: boolean) {
  return purchasingTransaction(async (tx) => {
    const initial = await scope(tx, tradeId), [intent] = await tx.select().from(intents).where(eq(intents.trade_id, tradeId)).limit(1)
    if (!intent) fail('MPP_MANDATE_PULL_NOT_READY')
    const { original, checked, prior } = await exact(tx, tradeId, initial.trade.buyer_id, { intent_id: intent.id,
      mandate_id: initial.authorization.id, buyer_operation_id: intent.buyer_operation_id, serialized_transaction: pull.serialized_transaction })
    if (!prior || prior.state !== 'claimed' || payer && payer.toLowerCase() !== intent.payer_address
      || canonicalContract(pull.challenge) !== canonicalContract(JSON.parse(intent.challenge_json))) fail('BUYER_ORIGINAL_CREDENTIAL_REQUIRED')
    const reason = await permission(tx, original, intent, checked.valid_before)
    if (reason) fail(reason)
    if (markSubmission) {
      await reserves(original, intent, checked.maximum_fee_token_cost_units)
      await tx.update(claims).set({ first_submission_at: new Date() }).where(and(eq(claims.intent_id, intent.id), isNull(claims.first_submission_at)))
    }
    return prior
  })
}
/** Hash-only original proof recovery never reopens send permission. */
export async function assertTaskTempoProof(tradeId: string, hash: string, payer: string) {
  const original = await originalTaskPayment(db, tradeId)
  if (!original) return
  const { authorization, terms, trade } = original, payment = terms.payment
  const [intent] = await db.select().from(intents).where(eq(intents.trade_id, tradeId)).limit(1)
  const [claim] = intent ? await db.select().from(claims).where(eq(claims.intent_id, intent.id)).limit(1) : []
  if (payment.rail !== 'mpp' || !('fee_token_address' in payment) || !intent || !claim || !['claimed', 'confirmed'].includes(claim.state)
    || intent.authorization_id !== authorization.id || intent.authority_hash !== authorization.authority_hash
    || claim.authorization_id !== authorization.id || claim.authority_hash !== authorization.authority_hash || claim.trade_id !== tradeId
    || intent.buyer_id !== trade.buyer_id || claim.chain_id !== payment.chain_id || intent.chain_id !== payment.chain_id
    || claim.tx_hash !== hash.toLowerCase() || claim.payer_address !== payer.toLowerCase() || claim.payer_address !== payment.payer_address
    || intent.payer_address !== payment.payer_address || intent.token_address !== payment.token_address || intent.treasury_address !== payment.treasury_address
    || claim.fee_token_address !== payment.fee_token_address || intent.token_decimals !== 6 || Math.round(intent.amount_usd * 100) !== terms.total_minor
    || intent.token_amount !== parseUnits(trade.total_cost.toFixed(2), 6).toString()) fail('BUYER_PAYMENT_CLAIM_REQUIRED')
}
export async function recordTaskTempoPayment(source: PurchasingSource, tradeId: string) {
  const [intent] = await source.select().from(intents).where(eq(intents.trade_id, tradeId)).limit(1)
  const [receipt] = await source.select().from(payment_receipts).where(eq(payment_receipts.trade_id, tradeId)).limit(1)
  if (intent && receipt?.tx_hash && receipt.payment_rail === 'mpp' && receipt.chain_id === intent.chain_id
    && receipt.payer_address?.toLowerCase() === intent.payer_address && receipt.token_address?.toLowerCase() === intent.token_address
    && receipt.token_amount === intent.token_amount) await source.update(claims).set({ state: 'confirmed' })
      .where(and(eq(claims.intent_id, intent.id), eq(claims.tx_hash, receipt.tx_hash), eq(claims.trade_id, tradeId)))
}
