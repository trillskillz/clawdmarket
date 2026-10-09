import 'server-only'
import { createHash } from 'node:crypto'
import { and, eq, gt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { isAddress } from 'viem'
import { db } from './db'
import { agent_owners, buyer_evm_payment_claims, buyer_mpp_payment_claims, buyer_mpp_payment_intents, evm_payment_intents, payment_receipts, route_funding_steps, route_retry_funding_steps, route_payment_mandates, route_plans, service_definitions, trades } from './schema'
import { findTradeFundingStep, listRouteFundingSteps, updateTradeFundingStep } from './route-funding-steps'
import { getPaymentReadiness, findAcceptedToken } from './payment-config'
import { canonicalContract } from './structured-verification'
import { verificationPolicySchema, supportsVerification } from './verification-policy'
import { withKeyedWriteLock } from './service-reservation-lock'
import { money } from './service-definitions'
import { routeExecutionEnabled } from './routing-feature-flags'

type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
type Plan = typeof route_plans.$inferSelect
type Mandate = typeof route_payment_mandates.$inferSelect
const hash = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
const address = z.string().refine((value) => isAddress(value), 'Invalid EVM address').transform((value) => value.toLowerCase())
const units = z.string().regex(/^(?:0|[1-9][0-9]{0,77})$/)
const paymentFields = { chain_id: z.number().int().positive(), token_address: address, payer_address: address,
  treasury_address: address, minimum_token_reserve_units: units }
const evmFeeFields = { minimum_native_reserve_wei: units, max_gas_cost_wei: units.refine((value) => BigInt(value) > 0n) }
export const routeMandatePaymentInput = z.discriminatedUnion('rail', [
  z.object({ ...paymentFields, rail: z.literal('evm'), ...evmFeeFields }).strict(),
  z.object({ ...paymentFields, rail: z.literal('mpp'), fee_token_address: address,
    minimum_fee_token_reserve_units: units, max_fee_token_cost_units: units.refine((value) => BigInt(value) > 0n) }).strict(),
])
const paymentSchema = routeMandatePaymentInput
// Historical MPP terms remain inspectable with their original fingerprint; they grant no automatic pull permission.
const storedPaymentSchema = z.union([paymentSchema, z.object({ ...paymentFields, rail: z.literal('mpp'), ...evmFeeFields }).strict()])
const storedMandateInput = z.object({ version: z.literal(1), client_reference: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  max_aggregate: money, max_per_execution: money, max_retry_budget: z.union([z.enum(['0', '0.00']).transform(() => 0), money]),
  max_attempts: z.number().int().min(1).max(3), approved_providers: z.array(z.string().min(1).max(200)).min(1).max(20),
  max_latency_seconds: z.number().int().min(1).max(30 * 24 * 3600),
  private_data: z.literal('selected_provider_only'), expires_at: z.iso.datetime({ precision: 3 }),
  payment: storedPaymentSchema,
}).strict().superRefine((value, context) => {
  if (new Set(value.approved_providers).size !== value.approved_providers.length) context.addIssue({ code: 'custom', path: ['approved_providers'], message: 'Duplicate providers' })
  if (value.max_per_execution > value.max_aggregate || value.max_retry_budget > value.max_aggregate) context.addIssue({ code: 'custom', message: 'Execution/retry budget exceeds aggregate mandate' })
})
export const routeMandateInput = storedMandateInput.refine((value) => value.payment.rail !== 'mpp' || 'fee_token_address' in value.payment,
  { path: ['payment'], message: 'Tempo requires explicit fee-token reserve and cost limits' })
type Input = z.output<typeof routeMandateInput>
type Terms = Omit<Input, 'client_reference'> & { token_decimals: number; token_usd_price: number; fee_token_decimals?: number }

export class RouteMandateError extends Error {
  constructor(public code: string, public status = 409) { super(code) }
}

async function retryTransaction<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await run() } catch (error) {
      let cause: unknown = error, busy = false
      for (let depth = 0; cause && typeof cause === 'object' && depth < 6; depth++) {
        if ('code' in cause && String(cause.code).startsWith('SQLITE_BUSY') || 'message' in cause && /SQLITE_BUSY|database is locked/i.test(String(cause.message))) busy = true
        cause = 'cause' in cause ? cause.cause : null
      }
      if (!busy) throw error
      if (attempt >= 5) throw new RouteMandateError('MANDATE_STORAGE_BUSY', 503)
      await new Promise((resolve) => setTimeout(resolve, 20 * 2 ** attempt))
    }
  }
}

export function routeAuthorityHash(plan: Plan) {
  return hash({ kind: 'route-payment-authority-v1', id: plan.id, buyer_id: plan.buyer_id, objective: plan.objective,
    input: JSON.parse(plan.input_json), capabilities: JSON.parse(plan.required_capabilities), max_budget_minor: plan.max_budget_minor,
    deadline_seconds: plan.deadline_seconds, verification: JSON.parse(plan.verification_policy), payment: JSON.parse(plan.payment_policy),
    retry: JSON.parse(plan.retry_policy), providers: JSON.parse(plan.provider_requirements_json) })
}
async function ownerControlsBuyer(ownerId: string, buyerId: string, source: Source) {
  if (buyerId === ownerId && !buyerId.startsWith('user_agent_')) return true
  if (!buyerId.startsWith('user_agent_')) return false
  const [link] = await source.select({ id: agent_owners.agentId }).from(agent_owners)
    .where(and(eq(agent_owners.agentId, buyerId.slice('user_agent_'.length)), eq(agent_owners.userId, ownerId))).limit(1)
  return Boolean(link)
}
function termsOf(row: Mandate): Terms {
  const value = JSON.parse(row.terms_json)
  const { token_decimals, token_usd_price, fee_token_decimals, ...rawTerms } = value
  const parsed = storedMandateInput.parse({ ...rawTerms, client_reference: row.client_reference,
    max_aggregate: (value.max_aggregate / 100).toFixed(2), max_per_execution: (value.max_per_execution / 100).toFixed(2), max_retry_budget: (value.max_retry_budget / 100).toFixed(2),
  })
  if (!Number.isInteger(token_decimals) || token_decimals < 0 || token_decimals > 36 || !Number.isFinite(token_usd_price) || token_usd_price <= 0) throw new RouteMandateError('MANDATE_CONTRACT_INVALID')
  const tempoFees = parsed.payment.rail === 'mpp' && 'fee_token_address' in parsed.payment
  if (tempoFees ? fee_token_decimals !== 6 : fee_token_decimals !== undefined) throw new RouteMandateError('MANDATE_CONTRACT_INVALID')
  if (parsed.max_aggregate !== row.max_aggregate_minor || Date.parse(parsed.expires_at) !== row.expires_at.getTime()
    || row.reserved_minor < 0 || row.reserved_minor > row.max_aggregate_minor) throw new RouteMandateError('MANDATE_CONTRACT_INVALID')
  const { client_reference: _, ...terms } = parsed
  return { ...terms, token_decimals, token_usd_price, ...(tempoFees ? { fee_token_decimals } : {}) }
}
function publicTerms(terms: Terms) {
  return { ...terms, max_aggregate: (terms.max_aggregate / 100).toFixed(2), max_per_execution: (terms.max_per_execution / 100).toFixed(2), max_retry_budget: (terms.max_retry_budget / 100).toFixed(2) }
}
export function mandateDto(row: Mandate) {
  return { id: row.id, route_id: row.route_id, buyer_id: row.buyer_id, client_reference: row.client_reference,
    route_hash: row.route_hash, terms_hash: hash(termsOf(row)), terms: publicTerms(termsOf(row)), state: row.state,
    reserved_amount: (row.reserved_minor / 100).toFixed(2), expires_at: row.expires_at, created_at: row.created_at, revoked_at: row.revoked_at,
    automatic_funded_retry_enabled: termsOf(row).max_attempts > 1 && termsOf(row).max_retry_budget > 0 }
}

export function paymentContract(payment: Input['payment']) {
  const ready = getPaymentReadiness()
  if (payment.rail === 'evm') {
    const token = findAcceptedToken(payment.chain_id, payment.token_address)
    if (!ready.evm.enabled || !token || ready.evm.treasury?.toLowerCase() !== payment.treasury_address) throw new RouteMandateError('MANDATE_PAYMENT_RAIL_UNAVAILABLE')
    return { token_decimals: token.decimals, token_usd_price: token.fixedUsdPrice }
  }
  if (!ready.mpp.enabled || ready.mpp.chainId !== payment.chain_id || ready.mpp.currency.toLowerCase() !== payment.token_address
    || ready.mpp.recipient?.toLowerCase() !== payment.treasury_address) throw new RouteMandateError('MANDATE_PAYMENT_RAIL_UNAVAILABLE')
  if ('fee_token_address' in payment) {
    // Start with the configured six-decimal payment token; no swap, sponsor or mutable wallet fee preference.
    if (payment.fee_token_address !== ready.mpp.currency.toLowerCase()) throw new RouteMandateError('MANDATE_FEE_TOKEN_UNAVAILABLE')
    return { token_decimals: 6, token_usd_price: 1, fee_token_decimals: 6 }
  }
  return { token_decimals: 6, token_usd_price: 1 }
}

export async function createRouteMandate(routeId: string, ownerId: string, raw: unknown) {
  const parsed = routeMandateInput.safeParse(raw)
  if (!parsed.success) throw new RouteMandateError('INVALID_ROUTE_MANDATE', 400)
  const input = parsed.data, requestHash = hash(input)
  return withKeyedWriteLock(`route-authority:${routeId}`, () => retryTransaction(() => db.transaction(async (tx) => {
    const [plan] = await tx.select().from(route_plans).where(eq(route_plans.id, routeId)).limit(1)
    if (!plan || !await ownerControlsBuyer(ownerId, plan.buyer_id, tx)) throw new RouteMandateError('ROUTE_NOT_FOUND', 404)
    const [prior] = await tx.select().from(route_payment_mandates).where(or(eq(route_payment_mandates.route_id, routeId),
      and(eq(route_payment_mandates.owner_account_id, ownerId), eq(route_payment_mandates.client_reference, input.client_reference)))).limit(1)
    if (prior) {
      if (prior.route_id !== routeId || prior.owner_account_id !== ownerId || prior.request_hash !== requestHash) throw new RouteMandateError('MANDATE_IDEMPOTENCY_CONFLICT')
      return { mandate: mandateDto(prior), idempotent: true }
    }
    if (!routeExecutionEnabled(plan.buyer_id)) throw new RouteMandateError('ROUTE_EXECUTION_DISABLED', 503)
    const now = new Date(), expiry = new Date(Math.floor(Date.parse(input.expires_at) / 1000) * 1000)
    if (plan.state !== 'planned' || plan.service_order_id || plan.expires_at <= now) throw new RouteMandateError('ROUTE_NOT_AUTHORIZABLE')
    if (expiry <= now || expiry.getTime() > now.getTime() + 86_400_000) throw new RouteMandateError('MANDATE_EXPIRY_INVALID', 400)
    if (input.max_per_execution > plan.max_budget_minor) throw new RouteMandateError('MANDATE_EXCEEDS_ROUTE_BUDGET', 400)
    const policy = verificationPolicySchema.parse(JSON.parse(plan.verification_policy))
    if (policy.acceptance?.mode !== 'explicit_buyer') throw new RouteMandateError('MANDATE_EXPLICIT_ACCEPTANCE_REQUIRED', 400)
    const allowedRails = JSON.parse(plan.payment_policy).allowed_rails ?? ['mpp', 'evm']
    if (!allowedRails.includes(input.payment.rail)) throw new RouteMandateError('MANDATE_PAYMENT_RAIL_BLOCKED')
    const { client_reference, ...terms } = input
    const contract = { ...terms, expires_at: expiry.toISOString(), ...paymentContract(input.payment) }
    const [row] = await tx.insert(route_payment_mandates).values({ id: crypto.randomUUID(), route_id: routeId, buyer_id: plan.buyer_id,
      owner_account_id: ownerId, client_reference, request_hash: requestHash, route_hash: routeAuthorityHash(plan),
      terms_json: JSON.stringify(contract), max_aggregate_minor: input.max_aggregate, expires_at: expiry, created_at: now }).returning()
    return { mandate: mandateDto(row), idempotent: false }
  })))
}

export async function inspectRouteMandate(routeId: string, userId: string) {
  const [row] = await db.select().from(route_payment_mandates).where(eq(route_payment_mandates.route_id, routeId)).limit(1)
  if (!row || userId !== row.buyer_id && !await ownerControlsBuyer(userId, row.buyer_id, db)) throw new RouteMandateError('MANDATE_NOT_FOUND', 404)
  const steps = await listRouteFundingSteps(db, routeId)
  const [plan] = await db.select().from(route_plans).where(eq(route_plans.id, routeId)).limit(1)
  return { mandate: mandateDto(row), funding_step: steps.find((step) => step.order_id === plan?.service_order_id) ?? null, funding_steps: steps }
}
export async function revokeRouteMandate(routeId: string, ownerId: string) {
  return withKeyedWriteLock(`route-authority:${routeId}`, () => retryTransaction(() => db.transaction(async (tx) => {
    const [row] = await tx.select().from(route_payment_mandates).where(eq(route_payment_mandates.route_id, routeId)).limit(1)
    if (!row || !await ownerControlsBuyer(ownerId, row.buyer_id, tx)) throw new RouteMandateError('MANDATE_NOT_FOUND', 404)
    if (row.state === 'revoked') return { mandate: mandateDto(row), idempotent: true }
    const [revoked] = await tx.update(route_payment_mandates).set({ state: 'revoked', revoked_at: new Date() }).where(eq(route_payment_mandates.id, row.id)).returning()
    // Existing external intents/proofs may already have been sent. Do not erase economic exposure.
    return { mandate: mandateDto(revoked), idempotent: false }
  })))
}

async function activeMandate(source: Source, row: Mandate, plan: Plan) {
  if (row.state !== 'active' || row.expires_at <= new Date()) throw new RouteMandateError('MANDATE_INACTIVE')
  if (!await ownerControlsBuyer(row.owner_account_id, row.buyer_id, source)) throw new RouteMandateError('MANDATE_OWNER_CHANGED')
  if (row.buyer_id !== plan.buyer_id || row.route_hash !== routeAuthorityHash(plan)) throw new RouteMandateError('MANDATE_ROUTE_CHANGED')
  const terms = termsOf(row), current = paymentContract(terms.payment)
  if (current.token_decimals !== terms.token_decimals || current.token_usd_price !== terms.token_usd_price
    || current.fee_token_decimals !== terms.fee_token_decimals) throw new RouteMandateError('MANDATE_TOKEN_TERMS_CHANGED')
  return terms
}

export async function validateRouteMandate(mandateId: string, plan: Plan, source: Source = db) {
  const [row] = await source.select().from(route_payment_mandates).where(and(eq(route_payment_mandates.id, mandateId), eq(route_payment_mandates.route_id, plan.id),
    eq(route_payment_mandates.buyer_id, plan.buyer_id))).limit(1)
  if (!row) throw new RouteMandateError('MANDATE_NOT_FOUND', 404)
  if (plan.service_order_id) {
    const step = (await listRouteFundingSteps(source, plan.id)).find((value) => value.order_id === plan.service_order_id)
    if (!step || step.mandate_id !== row.id || step.order_id !== plan.service_order_id) throw new RouteMandateError('MANDATE_ORDER_CONFLICT')
    return termsOf(row) // Receipt recovery never grants fresh payment permission.
  }
  return activeMandate(source, row, plan)
}

export async function freshRouteRetryTerms(mandateId: string, plan: Plan, source: Source = db) {
  const [row] = await source.select().from(route_payment_mandates).where(and(eq(route_payment_mandates.id, mandateId), eq(route_payment_mandates.route_id, plan.id))).limit(1)
  if (!row) throw new RouteMandateError('MANDATE_NOT_FOUND', 404)
  return activeMandate(source, row, plan)
}

export async function reserveMandateExposure(source: Source, input: { mandateId: string; plan: Plan; service: typeof service_definitions.$inferSelect; rail: string; totalMinor: number; orderId: string; tradeId: string;
  retry?: { operationId: string; previousTradeId: string; attemptId: string } }) {
  const [row] = await source.select().from(route_payment_mandates).where(and(eq(route_payment_mandates.id, input.mandateId), eq(route_payment_mandates.route_id, input.plan.id))).limit(1)
  if (!row) throw new RouteMandateError('MANDATE_NOT_FOUND', 404)
  const terms = await activeMandate(source, row, input.plan)
  const previous = await listRouteFundingSteps(source, input.plan.id)
  if (previous.length && !input.retry || !previous.length && input.retry) throw new RouteMandateError('MANDATE_ORDER_CONFLICT')
  if (previous.length >= terms.max_attempts) throw new RouteMandateError('MANDATE_ATTEMPTS_EXHAUSTED')
  const retryMinor = previous.slice(1).reduce((sum, step) => sum + step.amount_minor, 0) + (input.retry ? input.totalMinor : 0)
  if (retryMinor > terms.max_retry_budget) throw new RouteMandateError('MANDATE_RETRY_BUDGET_EXCEEDED')
  if (terms.payment.rail !== input.rail || !terms.approved_providers.includes(input.service.seller_id)) throw new RouteMandateError('MANDATE_PROVIDER_OR_RAIL_BLOCKED')
  if (input.totalMinor > terms.max_per_execution || input.totalMinor > row.max_aggregate_minor - row.reserved_minor) throw new RouteMandateError('MANDATE_BUDGET_EXCEEDED')
  if (!input.service.estimated_latency_seconds || input.service.estimated_latency_seconds > terms.max_latency_seconds) throw new RouteMandateError('MANDATE_LATENCY_EXCEEDED')
  const requested = verificationPolicySchema.parse(JSON.parse(input.plan.verification_policy)), offered = verificationPolicySchema.parse(JSON.parse(input.service.verification_policy))
  if (!supportsVerification(offered, requested) || offered.acceptance?.mode !== 'explicit_buyer') throw new RouteMandateError('MANDATE_VERIFICATION_REQUIRED')
  const [reserved] = await source.update(route_payment_mandates).set({ reserved_minor: sql`${route_payment_mandates.reserved_minor} + ${input.totalMinor}` })
    .where(and(eq(route_payment_mandates.id, row.id), eq(route_payment_mandates.state, 'active'), gt(route_payment_mandates.expires_at, new Date()),
      sql`${route_payment_mandates.reserved_minor} + ${input.totalMinor} <= ${route_payment_mandates.max_aggregate_minor}`)).returning()
  if (!reserved) throw new RouteMandateError('MANDATE_BUDGET_OR_STATE_CHANGED')
  const step = { id: crypto.randomUUID(), mandate_id: row.id, route_id: input.plan.id,
    order_id: input.orderId, trade_id: input.tradeId, amount_minor: input.totalMinor, terms_hash: hash(terms) }
  if (input.retry) await source.insert(route_retry_funding_steps).values({ ...step, retry_operation_id: input.retry.operationId,
    previous_trade_id: input.retry.previousTradeId, attempt_id: input.retry.attemptId })
  else await source.insert(route_funding_steps).values(step)
}

export async function mandateFundingEligibility(trade: typeof trades.$inferSelect, source: Source = db,
  actual?: { rail: string; chainId: number; tokenAddress: string; payerAddress: string; treasuryAddress?: string; txHash?: string | null }) {
  const step = await findTradeFundingStep(source, trade.id)
  if (!step) {
    const [plan] = await source.select({ mandate: route_payment_mandates.id }).from(route_plans)
      .innerJoin(route_payment_mandates, eq(route_payment_mandates.route_id, route_plans.id))
      .where(sql`${route_plans.service_order_id} IN (SELECT id FROM service_orders WHERE trade_id = ${trade.id})`).limit(1)
    return plan ? 'MANDATE_CONTRACT_INVALID' : null // Historical/manual orders have no mandate.
  }
  try {
    const [row] = await source.select().from(route_payment_mandates).where(eq(route_payment_mandates.id, step.mandate_id)).limit(1)
    const [plan] = await source.select().from(route_plans).where(eq(route_plans.id, step.route_id)).limit(1)
    if (!row || !plan || step.state !== 'reserved' || row.reserved_minor < step.amount_minor
      || step.amount_minor !== Math.round(trade.total_cost * 100) || plan.service_order_id !== step.order_id) return 'MANDATE_CONTRACT_INVALID'
    const terms = await activeMandate(source, row, plan)
    if (hash(terms) !== step.terms_hash || terms.payment.rail !== trade.payment_rail || !terms.approved_providers.includes(trade.seller_id)) return 'MANDATE_CONTRACT_INVALID'
    if (actual && (actual.rail !== terms.payment.rail || actual.chainId !== terms.payment.chain_id
      || actual.tokenAddress.toLowerCase() !== terms.payment.token_address || actual.payerAddress.toLowerCase() !== terms.payment.payer_address
      || actual.treasuryAddress && actual.treasuryAddress.toLowerCase() !== terms.payment.treasury_address)) return 'MANDATE_PAYMENT_TERMS_MISMATCH'
    if (actual?.rail === 'mpp' && actual.txHash) {
      const [intent] = await source.select().from(buyer_mpp_payment_intents).where(eq(buyer_mpp_payment_intents.trade_id, trade.id)).limit(1)
      if (intent) {
        const [claim] = await source.select().from(buyer_mpp_payment_claims).where(eq(buyer_mpp_payment_claims.intent_id, intent.id)).limit(1)
        if (!claim || claim.tx_hash !== actual.txHash.toLowerCase() || claim.terms_hash !== step.terms_hash) return 'MANDATE_PAYMENT_CLAIM_MISMATCH'
      }
    }
    return null
  } catch (error) { return error instanceof RouteMandateError ? error.code : 'MANDATE_CONTRACT_INVALID' }
}

export async function recordMandateFunding(source: Source, tradeId: string, state: 'funded' | 'rejected') {
  await updateTradeFundingStep(source, tradeId, state)
  // Both transitions follow trusted receipt verification, including late/refunded transfers.
  // Plain cancellation, expiry and HTTP errors never release the wallet claim.
  const [intent] = await source.select().from(evm_payment_intents).where(eq(evm_payment_intents.trade_id, tradeId)).limit(1)
  const [receipt] = await source.select().from(payment_receipts).where(eq(payment_receipts.trade_id, tradeId)).limit(1)
  if (intent?.tx_hash && receipt?.tx_hash === intent.tx_hash && receipt.payment_rail === 'evm'
    && receipt.chain_id === intent.chain_id && receipt.payer_address?.toLowerCase() === intent.payer_address) await source.update(buyer_evm_payment_claims).set({ state: 'confirmed' })
    .where(and(eq(buyer_evm_payment_claims.intent_id, intent.id), eq(buyer_evm_payment_claims.tx_hash, intent.tx_hash)))
  const [mppIntent] = await source.select().from(buyer_mpp_payment_intents).where(eq(buyer_mpp_payment_intents.trade_id, tradeId)).limit(1)
  if (mppIntent && receipt?.tx_hash && receipt.payment_rail === 'mpp' && receipt.chain_id === mppIntent.chain_id
    && receipt.payer_address?.toLowerCase() === mppIntent.payer_address && receipt.token_address?.toLowerCase() === mppIntent.token_address
    && receipt.token_amount === mppIntent.token_amount) await source.update(buyer_mpp_payment_claims).set({ state: 'confirmed' })
    .where(and(eq(buyer_mpp_payment_claims.intent_id, mppIntent.id), eq(buyer_mpp_payment_claims.tx_hash, receipt.tx_hash)))
}
