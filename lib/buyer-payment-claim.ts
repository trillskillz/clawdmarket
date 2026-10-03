import { findTradeFundingStep } from './route-funding-steps'
import { and, eq, isNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { buyer_evm_payment_claims, buyer_mpp_payment_claims, evm_payment_intents, route_payment_mandates, trades } from '@/lib/schema'
import { inspectSignedEvmPayment } from '@/lib/buyer-signed-transaction.mjs'
import { mandateDto, mandateFundingEligibility } from '@/lib/route-payment-mandate'
import { serviceFundingEligibility } from '@/lib/service-funding-eligibility'
import { verifyEvmPaymentProof } from '@/lib/evm-payment-proof'
import { getNewPaymentControl } from '@/lib/payment-control'
import { withKeyedWriteLock } from '@/lib/service-reservation-lock'
import { routeExecutionEnabled } from '@/lib/routing-feature-flags'

export class BuyerPaymentClaimError extends Error {
  constructor(public code: string, public status = 409) { super(code) }
}
export type BuyerPaymentClaimInput = { intent_id: string; mandate_id: string; serialized_transaction: string; payer_signature: string; buyer_operation_id?: string }
function fail(code: string, status = 409): never { throw new BuyerPaymentClaimError(code, status) }

/** This records permission for exact bytes. It never signs, submits or reads the buyer wallet. */
export async function claimBuyerEvmPayment(tradeId: string, buyerId: string, input: BuyerPaymentClaimInput) {
  return withKeyedWriteLock(`buyer-payment-claim:${tradeId}`, async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await db.transaction(async (tx) => {
          const [trade] = await tx.select().from(trades).where(eq(trades.id, tradeId)).limit(1)
          if (!trade) fail('TRADE_NOT_FOUND', 404)
          if (trade.buyer_id !== buyerId) fail('FORBIDDEN', 403)
          const [intent] = await tx.select().from(evm_payment_intents).where(and(eq(evm_payment_intents.id, input.intent_id), eq(evm_payment_intents.trade_id, tradeId))).limit(1)
          const step = await findTradeFundingStep(tx, tradeId)
          if (!intent || !step || step.mandate_id !== input.mandate_id || intent.buyer_id !== buyerId || trade.payment_rail !== 'evm') fail('BUYER_PAYMENT_SCOPE_MISMATCH')
          if (intent.buyer_operation_id && intent.buyer_operation_id !== input.buyer_operation_id
            || input.buyer_operation_id && input.buyer_operation_id !== intent.buyer_operation_id) fail('BUYER_OPERATION_CONFLICT')
          const [row] = await tx.select().from(route_payment_mandates).where(eq(route_payment_mandates.id, step.mandate_id)).limit(1)
          if (!row) fail('MANDATE_CONTRACT_INVALID')
          let mandate, checked
          try {
            mandate = mandateDto(row)
            if (mandate.terms_hash !== step.terms_hash) fail('MANDATE_CONTRACT_INVALID')
            checked = await inspectSignedEvmPayment(input.serialized_transaction, intent, mandate.terms.payment)
          } catch (error) {
            if (error instanceof BuyerPaymentClaimError) throw error
            fail(error instanceof Error && error.message === 'BUYER_TRANSACTION_GAS_LIMIT' ? error.message : 'BUYER_TRANSACTION_SCOPE_MISMATCH')
          }
          if (!await verifyEvmPaymentProof(intent, checked.tx_hash, input.payer_signature)) fail('PAYER_AUTHORIZATION_INVALID', 403)
          const [prior] = await tx.select().from(buyer_evm_payment_claims).where(eq(buyer_evm_payment_claims.intent_id, intent.id)).limit(1)
          if (prior && (prior.tx_hash !== checked.tx_hash || prior.mandate_id !== row.id || prior.terms_hash !== mandate.terms_hash
            || prior.chain_id !== checked.chain_id || prior.payer_address !== checked.payer_address || prior.nonce !== checked.nonce
            || prior.maximum_execution_gas_cost_wei !== checked.maximum_execution_gas_cost_wei
            || !['claimed', 'confirmed'].includes(prior.state))) fail('PAYMENT_TRANSACTION_CONFLICT')
          if (intent.tx_hash && intent.tx_hash !== checked.tx_hash) fail('PAYMENT_TRANSACTION_CONFLICT')
          // Recovery after funding, revocation or expiry retains the hash, but gives no send permission.
          if (prior && (prior.state === 'confirmed' || trade.status !== 'pending' || step.state !== 'reserved')) {
            return { claim: prior, send_allowed: false, idempotent: true, state: 'recover_existing_payment' }
          }
          if (trade.status !== 'pending' || !trade.payment_due_at || Date.parse(trade.payment_due_at) <= Date.now()) {
            if (prior) return { claim: prior, send_allowed: false, idempotent: true, state: 'recover_existing_payment' }
            fail('CHECKOUT_CLOSED')
          }
          const reason = !routeExecutionEnabled(trade.buyer_id) ? 'ROUTE_EXECUTION_DISABLED'
            : await mandateFundingEligibility(trade, tx, { rail: 'evm', chainId: intent.chain_id, tokenAddress: intent.token_address,
              payerAddress: intent.payer_address, treasuryAddress: intent.treasury_address }) || await serviceFundingEligibility(trade, tx)
          if (reason || (await getNewPaymentControl()).paused) {
            if (prior) return { claim: prior, send_allowed: false, idempotent: true, state: 'recover_existing_payment' }
            fail(reason || 'NEW_PAYMENTS_PAUSED')
          }
          if (prior) return { claim: prior, send_allowed: true, idempotent: true, state: 'submit_exact_transaction' }
          // A legacy proof attached without this protocol can only be recovered; never replace it.
          if (intent.tx_hash) fail('PAYMENT_ALREADY_SUBMITTED_RECOVER_ONLY')
          const [active] = await tx.select().from(buyer_evm_payment_claims).where(and(eq(buyer_evm_payment_claims.chain_id, checked.chain_id),
            eq(buyer_evm_payment_claims.payer_address, checked.payer_address), eq(buyer_evm_payment_claims.state, 'claimed'))).limit(1)
          const [mppActive] = await tx.select({ id: buyer_mpp_payment_claims.intent_id }).from(buyer_mpp_payment_claims).where(and(
            eq(buyer_mpp_payment_claims.chain_id, checked.chain_id), eq(buyer_mpp_payment_claims.payer_address, checked.payer_address), eq(buyer_mpp_payment_claims.state, 'claimed'))).limit(1)
          if (active || mppActive) fail('BUYER_WALLET_PAYMENT_UNRECONCILED')
          const [mppNonce] = await tx.select({ id: buyer_mpp_payment_claims.intent_id }).from(buyer_mpp_payment_claims).where(and(
            eq(buyer_mpp_payment_claims.chain_id, checked.chain_id), eq(buyer_mpp_payment_claims.payer_address, checked.payer_address), eq(buyer_mpp_payment_claims.nonce, checked.nonce))).limit(1)
          if (mppNonce) fail('BUYER_WALLET_NONCE_ALREADY_CLAIMED')
          const [claim] = await tx.insert(buyer_evm_payment_claims).values({ intent_id: intent.id, mandate_id: row.id,
            chain_id: checked.chain_id, payer_address: checked.payer_address, nonce: checked.nonce, tx_hash: checked.tx_hash,
            terms_hash: mandate.terms_hash, maximum_execution_gas_cost_wei: checked.maximum_execution_gas_cost_wei,
          }).onConflictDoNothing().returning()
          if (!claim) fail('BUYER_WALLET_NONCE_ALREADY_CLAIMED')
          const [attached] = await tx.update(evm_payment_intents).set({ tx_hash: checked.tx_hash, payer_signature: input.payer_signature })
            .where(and(eq(evm_payment_intents.id, intent.id), or(isNull(evm_payment_intents.tx_hash), eq(evm_payment_intents.tx_hash, checked.tx_hash)))).returning()
          if (!attached) fail('PAYMENT_TRANSACTION_CONFLICT')
          return { claim, send_allowed: true, idempotent: false, state: 'submit_exact_transaction' }
        })
      } catch (error) {
        let cause: unknown = error, busy = false
        for (let depth = 0; cause && typeof cause === 'object' && depth < 6; depth += 1) {
          const entry = cause as { message?: string; cause?: unknown }
          busy ||= /SQLITE_BUSY|database is locked/i.test(entry.message || ''); cause = entry.cause
        }
        if (!busy || attempt >= 5) throw error
        await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
      }
    }
  })
}
