import 'server-only'
import { and, eq } from 'drizzle-orm'
import { db } from './db'
import { private_artifacts, service_definitions, service_orders, trade_deliveries, verification_results } from './schema'
import { serviceExecutionContract } from './service-execution-contract'
import { verificationPolicySchema } from './verification-policy'

type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]
export class AcceptanceError extends Error {
  constructor(public code: 'ACCEPTANCE_CONTRACT_INVALID' | 'REQUIRED_VERIFICATION_MISSING' | 'EXPLICIT_ACCEPTANCE_REQUIRED' | 'DELIVERY_CHANGED') { super(code) }
}

async function agreedAcceptance(tradeId: string, source: Source) {
  const [linked] = await source.select({ execution_contract_json: service_orders.execution_contract_json,
    verification_policy: service_definitions.verification_policy }).from(service_orders)
    .innerJoin(service_definitions, eq(service_definitions.id, service_orders.service_id))
    .where(eq(service_orders.trade_id, tradeId)).limit(1)
  // Historical orders did not agree to a persisted acceptance gate. Definition edits cannot add one.
  if (!linked || linked.execution_contract_json === null) return null
  try {
    const policy = verificationPolicySchema.parse(JSON.parse(serviceExecutionContract(linked, linked).verification_policy))
    return policy.acceptance ? policy : null
  } catch { throw new AcceptanceError('ACCEPTANCE_CONTRACT_INVALID') }
}

async function requiredChecks(tradeId: string, source: Source) {
  const policy = await agreedAcceptance(tradeId, source)
  if (!policy) return null
  const [delivery] = await source.select({ id: trade_deliveries.id, content_hash: trade_deliveries.content_hash })
    .from(trade_deliveries).where(eq(trade_deliveries.trade_id, tradeId)).limit(1)
  if (!delivery) throw new AcceptanceError('REQUIRED_VERIFICATION_MISSING')
  const rows = await source.select({ method: verification_results.method, status: verification_results.status }).from(verification_results)
    .where(and(eq(verification_results.trade_id, tradeId), eq(verification_results.delivery_id, delivery.id), eq(verification_results.content_hash, delivery.content_hash)))
  const passed = (method: string) => rows.some((row) => row.method === method && row.status === 'passed')
  if (!policy.methods.filter((method) => method !== 'buyer_review').every(passed)) throw new AcceptanceError('REQUIRED_VERIFICATION_MISSING')
  const [attachment] = await source.select({ id: private_artifacts.id }).from(private_artifacts).where(eq(private_artifacts.delivery_id, delivery.id)).limit(1)
  if (attachment && !passed('artifact_integrity')) throw new AcceptanceError('REQUIRED_VERIFICATION_MISSING')
  return { policy, passed }
}

/** Run before recording the authenticated buyer's acceptance, in its transaction. */
export async function assertReadyForBuyerAcceptance(tradeId: string, source: Source = db, expectedHash?: string) {
  await requiredChecks(tradeId, source)
  if (expectedHash !== undefined) {
    const [delivery] = await source.select({ content_hash: trade_deliveries.content_hash }).from(trade_deliveries).where(eq(trade_deliveries.trade_id, tradeId)).limit(1)
    if (!delivery || delivery.content_hash !== expectedHash) throw new AcceptanceError('DELIVERY_CHANGED')
  }
}

/** Gate both account-balance completion and the external payout boundary. */
export async function assertTradeReleaseAllowed(tradeId: string, reason: 'buyer_confirm' | 'auto_confirm' | 'seller_payout', source: Source = db) {
  const checks = await requiredChecks(tradeId, source)
  if (checks && (reason === 'auto_confirm' || !checks.passed('buyer_review'))) throw new AcceptanceError('EXPLICIT_ACCEPTANCE_REQUIRED')
}

export async function tradeAcceptanceStatus(tradeId: string, source: Source = db) {
  const policy = await agreedAcceptance(tradeId, source)
  if (!policy) {
    const [review] = await source.select({ status: verification_results.status }).from(verification_results)
      .innerJoin(trade_deliveries, and(eq(trade_deliveries.id, verification_results.delivery_id), eq(trade_deliveries.content_hash, verification_results.content_hash)))
      .where(and(eq(verification_results.trade_id, tradeId), eq(verification_results.method, 'buyer_review'))).limit(1)
    return { mode: 'legacy_settlement' as const, auto_confirm_enabled: true, accepted: review?.status === 'passed', attention_required: false }
  }
  try {
    const checks = await requiredChecks(tradeId, source)
    const accepted = Boolean(checks?.passed('buyer_review'))
    return { mode: 'explicit_buyer' as const, auto_confirm_enabled: false, accepted, attention_required: !accepted }
  } catch (error) {
    if (!(error instanceof AcceptanceError)) throw error
    return { mode: 'explicit_buyer' as const, auto_confirm_enabled: false, accepted: false, attention_required: true, error_code: error.code }
  }
}
