import 'server-only'
import { and, eq, isNull } from 'drizzle-orm'
import { Challenge } from 'mppx'
import { parseUnits } from 'viem'
import { db } from './db'
import { buyer_evm_payment_claims, buyer_mpp_payment_claims, buyer_mpp_payment_intents, route_funding_steps, route_payment_mandates, trades } from './schema'
import { inspectSignedTempoPayment } from './buyer-tempo-transaction.mjs'
import { mandateDto, mandateFundingEligibility } from './route-payment-mandate'
import { serviceFundingEligibility } from './service-funding-eligibility'
import { getNewPaymentControl } from './payment-control'
import { routeExecutionEnabled } from './routing-feature-flags'
import { withKeyedWriteLock } from './service-reservation-lock'
import { canonicalContract } from './structured-verification'

type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
type Trade = typeof trades.$inferSelect
type Intent = typeof buyer_mpp_payment_intents.$inferSelect
type ClaimInput = { intent_id: string; mandate_id: string; buyer_operation_id: string; serialized_transaction: string }
export class BuyerMppPaymentError extends Error {
  constructor(public code: string, public status = 409) { super(code) }
}
function fail(code: string, status = 409): never { throw new BuyerMppPaymentError(code, status) }
function dto(intent: Intent) {
  const { challenge_json, ...fields } = intent
  return { ...fields, challenge: JSON.parse(challenge_json) }
}
async function write<T>(tradeId: string, run: (tx: Source) => Promise<T>): Promise<T> {
  return withKeyedWriteLock(`buyer-mpp-payment:${tradeId}`, async () => {
    for (let attempt = 0; ; attempt++) {
      try { return await db.transaction(run) } catch (error) {
        let cause: unknown = error, busy = false
        for (let depth = 0; cause && typeof cause === 'object' && depth < 6; depth++) {
          const entry = cause as { code?: string; message?: string; cause?: unknown }
          busy ||= String(entry.code || '').startsWith('SQLITE_BUSY') || /SQLITE_BUSY|database is locked/i.test(entry.message || '')
          cause = entry.cause
        }
        if (!busy) throw error
        if (attempt >= 5) fail('BUYER_PAYMENT_STORAGE_BUSY', 503)
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
      }
    }
  })
}
async function ownedTrade(source: Source, tradeId: string, buyerId: string) {
  const [trade] = await source.select().from(trades).where(eq(trades.id, tradeId)).limit(1)
  if (!trade) fail('TRADE_NOT_FOUND', 404)
  if (trade.buyer_id !== buyerId) fail('FORBIDDEN', 403)
  if (trade.payment_rail !== 'mpp') fail('BUYER_PAYMENT_SCOPE_MISMATCH')
  return trade
}
async function scope(source: Source, trade: Trade) {
  const [step] = await source.select().from(route_funding_steps).where(eq(route_funding_steps.trade_id, trade.id)).limit(1)
  const [row] = step ? await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id, step.mandate_id)).limit(1) : []
  if (!step || !row || row.buyer_id !== trade.buyer_id) fail('BUYER_PAYMENT_SCOPE_MISMATCH')
  const mandate = mandateDto(row), payment = mandate.terms.payment
  if (payment.rail !== 'mpp' || !('fee_token_address' in payment) || mandate.terms.fee_token_decimals !== 6
    || mandate.terms_hash !== step.terms_hash || payment.fee_token_address !== payment.token_address) fail('MPP_MANDATE_FEE_TERMS_REQUIRED')
  return { step, mandate, payment }
}
async function permission(source: Source, trade: Trade, intent?: Intent, validBefore?: number) {
  if (trade.status !== 'pending' || !trade.payment_due_at || Date.parse(trade.payment_due_at) <= Date.now()
    || intent && Date.parse(intent.expires_at) <= Date.now() || validBefore !== undefined && validBefore <= Math.floor(Date.now() / 1000)) return 'CHECKOUT_CLOSED'
  if (!routeExecutionEnabled(trade.buyer_id)) return 'ROUTE_EXECUTION_DISABLED'
  if ((await getNewPaymentControl()).paused) return 'NEW_PAYMENTS_PAUSED'
  return await mandateFundingEligibility(trade, source, intent ? { rail: 'mpp', chainId: intent.chain_id,
    tokenAddress: intent.token_address, payerAddress: intent.payer_address, treasuryAddress: intent.treasury_address } : undefined)
    || await serviceFundingEligibility(trade, source)
}

export async function inspectBuyerMppIntent(tradeId: string, buyerId: string) {
  const trade = await ownedTrade(db, tradeId, buyerId)
  const [intent] = await db.select().from(buyer_mpp_payment_intents).where(eq(buyer_mpp_payment_intents.trade_id, tradeId)).limit(1)
  const [claim] = intent ? await db.select().from(buyer_mpp_payment_claims).where(eq(buyer_mpp_payment_claims.intent_id, intent.id)).limit(1) : []
  return { intent: intent ? dto(intent) : null, claim: claim || null, trade: { id: trade.id, status: trade.status, payout_status: trade.payout_status } }
}

/** Stable operation creates one original challenge; no key, signature, simulation or broadcast. */
export async function createBuyerMppIntent(tradeId: string, buyerId: string, operationId: string, origin: string) {
  return write(tradeId, async (tx) => {
    const trade = await ownedTrade(tx, tradeId, buyerId)
    const [prior] = await tx.select().from(buyer_mpp_payment_intents).where(eq(buyer_mpp_payment_intents.trade_id, tradeId)).limit(1)
    if (prior) {
      if (prior.buyer_operation_id !== operationId || prior.origin !== origin) fail('BUYER_OPERATION_CONFLICT')
      return { intent: dto(prior), created: false, claim_required: true }
    }
    const { step, mandate, payment } = await scope(tx, trade)
    const reason = await permission(tx, trade)
    if (reason) fail(reason)
    const [operation] = await tx.select({ id: buyer_mpp_payment_intents.id }).from(buyer_mpp_payment_intents)
      .where(eq(buyer_mpp_payment_intents.buyer_operation_id, operationId)).limit(1)
    if (operation) fail('BUYER_OPERATION_CONFLICT')
    const { getMarketplaceMppServer } = await import('./mpp')
    const { marketplaceMppCharge } = await import('./marketplace-mpp-payment')
    const server = getMarketplaceMppServer()
    if (!server) fail('PAYMENT_RAIL_NOT_CONFIGURED', 503)
    const challengeResult = await server.charge(marketplaceMppCharge(trade))(new Request(`${origin}/api/trades/${tradeId}/fund/mpp`, { method: 'POST' }))
    if (challengeResult.status !== 402) fail('BUYER_PAYMENT_CHALLENGE_UNAVAILABLE', 503)
    const challenge = Challenge.fromResponse<any>(challengeResult.challenge)
    const serialized = JSON.stringify(challenge)
    const amount = parseUnits(trade.total_cost.toFixed(2), 6).toString()
    if (Buffer.byteLength(serialized) > 16_384 || challenge.request.amount !== amount || challenge.request.externalId !== tradeId
      || challenge.request.currency?.toLowerCase() !== payment.token_address || challenge.request.recipient?.toLowerCase() !== payment.treasury_address
      || !challenge.expires || Date.parse(challenge.expires) > Date.parse(trade.payment_due_at!)) fail('BUYER_PAYMENT_CHALLENGE_SCOPE_MISMATCH')
    const [intent] = await tx.insert(buyer_mpp_payment_intents).values({ id: crypto.randomUUID(), trade_id: tradeId, buyer_id: buyerId,
      buyer_operation_id: operationId, mandate_id: mandate.id, terms_hash: step.terms_hash, origin,
      chain_id: payment.chain_id, payer_address: payment.payer_address, token_address: payment.token_address, treasury_address: payment.treasury_address,
      token_amount: amount, token_decimals: 6, amount_usd: trade.total_cost, expires_at: challenge.expires, challenge_json: serialized }).returning()
    return { intent: dto(intent), created: true, claim_required: true }
  })
}

export async function claimBuyerMppPayment(tradeId: string, buyerId: string, input: ClaimInput) {
  return write(tradeId, async (tx) => {
    const trade = await ownedTrade(tx, tradeId, buyerId)
    const [intent] = await tx.select().from(buyer_mpp_payment_intents).where(and(eq(buyer_mpp_payment_intents.id, input.intent_id), eq(buyer_mpp_payment_intents.trade_id, tradeId))).limit(1)
    if (!intent || intent.buyer_id !== buyerId || intent.buyer_operation_id !== input.buyer_operation_id || intent.mandate_id !== input.mandate_id) fail('BUYER_OPERATION_CONFLICT')
    const { step, mandate, payment } = await scope(tx, trade)
    if (step.mandate_id !== input.mandate_id || intent.terms_hash !== mandate.terms_hash) fail('BUYER_PAYMENT_SCOPE_MISMATCH')
    let checked
    try { checked = await inspectSignedTempoPayment(input.serialized_transaction, intent, payment) } catch (error) {
      fail(error instanceof Error && error.message === 'BUYER_TEMPO_TRANSACTION_FEE_LIMIT' ? error.message : 'BUYER_TEMPO_TRANSACTION_SCOPE_MISMATCH')
    }
    const [prior] = await tx.select().from(buyer_mpp_payment_claims).where(eq(buyer_mpp_payment_claims.intent_id, intent.id)).limit(1)
    if (prior && (prior.tx_hash !== checked.tx_hash || prior.terms_hash !== intent.terms_hash || prior.mandate_id !== intent.mandate_id
      || prior.chain_id !== checked.chain_id || prior.payer_address !== checked.payer_address || prior.nonce !== checked.nonce
      || prior.fee_token_address !== checked.fee_token_address || prior.maximum_fee_token_cost_units !== checked.maximum_fee_token_cost_units
      || prior.valid_before !== checked.valid_before || !['claimed', 'confirmed'].includes(prior.state))) fail('PAYMENT_TRANSACTION_CONFLICT')
    const reason = prior?.state === 'confirmed' || step.state !== 'reserved' ? 'PAYMENT_ALREADY_RECONCILED' : await permission(tx, trade, intent, checked.valid_before)
    if (reason) {
      if (prior) return { claim: prior, send_allowed: false, idempotent: true, state: 'recover_existing_payment' }
      fail(reason)
    }
    if (prior) return { claim: prior, send_allowed: true, idempotent: true, state: 'submit_exact_credential' }
    const [mppActive] = await tx.select({ id: buyer_mpp_payment_claims.intent_id }).from(buyer_mpp_payment_claims)
      .where(and(eq(buyer_mpp_payment_claims.chain_id, checked.chain_id), eq(buyer_mpp_payment_claims.payer_address, checked.payer_address), eq(buyer_mpp_payment_claims.state, 'claimed'))).limit(1)
    const [evmActive] = await tx.select({ id: buyer_evm_payment_claims.intent_id }).from(buyer_evm_payment_claims)
      .where(and(eq(buyer_evm_payment_claims.chain_id, checked.chain_id), eq(buyer_evm_payment_claims.payer_address, checked.payer_address), eq(buyer_evm_payment_claims.state, 'claimed'))).limit(1)
    if (mppActive || evmActive) fail('BUYER_WALLET_PAYMENT_UNRECONCILED')
    const [evmNonce] = await tx.select({ id: buyer_evm_payment_claims.intent_id }).from(buyer_evm_payment_claims)
      .where(and(eq(buyer_evm_payment_claims.chain_id, checked.chain_id), eq(buyer_evm_payment_claims.payer_address, checked.payer_address), eq(buyer_evm_payment_claims.nonce, checked.nonce))).limit(1)
    if (evmNonce) fail('BUYER_WALLET_NONCE_ALREADY_CLAIMED')
    const [claim] = await tx.insert(buyer_mpp_payment_claims).values({ intent_id: intent.id, mandate_id: intent.mandate_id,
      terms_hash: intent.terms_hash, chain_id: checked.chain_id, payer_address: checked.payer_address, nonce: checked.nonce,
      tx_hash: checked.tx_hash, fee_token_address: checked.fee_token_address, maximum_fee_token_cost_units: checked.maximum_fee_token_cost_units,
      valid_before: checked.valid_before }).onConflictDoNothing().returning()
    if (!claim) fail('BUYER_WALLET_NONCE_ALREADY_CLAIMED')
    return { claim, send_allowed: true, idempotent: false, state: 'submit_exact_credential' }
  })
}

/** Called at the actual SDK broadcast boundary, after authenticated credential validation. */
export async function assertBuyerMppPull(tradeId: string, payer: string | undefined,
  pull: { serialized_transaction: string; challenge: unknown }, markSubmission: boolean) {
  return write(tradeId, async (tx) => {
    const [intent] = await tx.select().from(buyer_mpp_payment_intents).where(eq(buyer_mpp_payment_intents.trade_id, tradeId)).limit(1)
    if (!intent) fail('MPP_MANDATE_PULL_NOT_READY')
    const trade = await ownedTrade(tx, tradeId, intent.buyer_id), { step, payment } = await scope(tx, trade)
    const [claim] = await tx.select().from(buyer_mpp_payment_claims).where(eq(buyer_mpp_payment_claims.intent_id, intent.id)).limit(1)
    if (!claim || claim.state !== 'claimed' || claim.mandate_id !== step.mandate_id || claim.terms_hash !== step.terms_hash
      || payer && payer.toLowerCase() !== intent.payer_address || canonicalContract(pull.challenge) !== canonicalContract(JSON.parse(intent.challenge_json))) fail('BUYER_ORIGINAL_CREDENTIAL_REQUIRED')
    let checked
    try { checked = await inspectSignedTempoPayment(pull.serialized_transaction, intent, payment) } catch { fail('BUYER_ORIGINAL_CREDENTIAL_REQUIRED') }
    if (checked.tx_hash !== claim.tx_hash || checked.payer_address !== claim.payer_address) fail('BUYER_ORIGINAL_CREDENTIAL_REQUIRED')
    const reason = step.state !== 'reserved' ? 'PAYMENT_ALREADY_RECONCILED' : await permission(tx, trade, intent, checked.valid_before)
    if (reason) fail(reason)
    if (markSubmission) await tx.update(buyer_mpp_payment_claims).set({ first_submission_at: new Date() })
      .where(and(eq(buyer_mpp_payment_claims.intent_id, intent.id), isNull(buyer_mpp_payment_claims.first_submission_at)))
    return claim
  })
}
