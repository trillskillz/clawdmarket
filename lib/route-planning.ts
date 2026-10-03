import 'server-only'
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { normalizeCapability } from '@/lib/capabilities'
import { route_plans, service_definitions, service_execution_attempts, service_orders, trades, verification_results } from '@/lib/schema'
import { jsonObject, money, servicePrice } from '@/lib/service-definitions'
import { getPaymentReadiness } from '@/lib/payment-config'
import { getNewPaymentControl } from '@/lib/payment-control'
import { payoutAddressForUser } from '@/lib/external-settlement'
import { selectMarketplaceRail, type MarketplaceRail } from '@/lib/payment-rail-selection'
import { referenceFleetPaidServicePublicationLocked } from '@/lib/reference-fleet-control'
import { reusableServiceBuyerOrdersEnabled, reusableServiceSellerWritesEnabled } from '@/lib/routing-feature-flags'
import { checkServiceInput, supportsVerification, verificationPolicySchema, type VerificationPolicy } from '@/lib/verification-policy'
import { buyerPolicyUsage, checkBuyerPolicyConstraints, loadBuyerSpendPolicy } from '@/lib/buyer-spend-policy'
import { organizationBudgetForAgent, organizationBudgetUsage } from '@/lib/organization-budgets'
import { serviceContractReadiness } from '@/lib/service-contract-readiness'
import { storedServiceCapabilities } from '@/lib/route-service-eligibility'

import { providerRequirementsSchema, providerRequirementFailure, type ProviderRequirements } from './provider-requirements'
import { backedCapabilityCounts, capabilityEvidence } from './provider-evidence'

export const routePlanInput = z.object({
  provider_requirements: providerRequirementsSchema.default({}),
  client_reference: z.string().trim().min(8).max(200),
  objective: z.string().trim().min(10).max(2_000),
  required_capabilities: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  input: jsonObject.optional().default({}),
  max_budget: z.object({ amount: money, currency: z.literal('USD') }).strict(),
  deadline_seconds: z.number().int().min(1).max(30 * 24 * 3600).optional(),
  verification: verificationPolicySchema.default({ required: true, methods: ['buyer_review'] }),
  payment_policy: z.object({ allowed_rails: z.array(z.enum(['mpp', 'evm', 'ledger'])).min(1).max(3).optional() }).strict().default({}),
  retry_policy: z.object({ max_attempts: z.number().int().min(1).max(3).default(1) }).strict().default({ max_attempts: 1 }),
}).strict().superRefine((value, context) => {
  value.required_capabilities.forEach((item, index) => {
    if (!normalizeCapability(item)) context.addIssue({ code: 'custom', path: ['required_capabilities', index], message: 'Unknown capability' })
  })
})

export type NormalizedRouteRequest = z.output<typeof routePlanInput>

export function normalizedCapabilities(input: string[]) {
  return [...new Set(input.map((value) => normalizeCapability(value)!))]
}

export type RouteCandidate = {
  service_id: string
  seller_agent_id: string | null
  pricing: { model: 'fixed'; amount: string; currency: 'USD'; estimated_total: string }
  estimated_latency_seconds: number | null
  payment_rail: MarketplaceRail
  verification_methods: VerificationPolicy['methods']
  eligibility: { requirements_satisfied: true; request: ProviderRequirements; saved_policy: ProviderRequirements; confidence: 'backed_completion_observed' | 'unmeasured'; buyer_independence: 'not_verified' }
  evidence_level: 'claimed_only' | 'backed_completion_observed'
  capability_evidence: { capability_id: string; accepted_completion_count: number; distinct_buyer_count: number; measured_quality_score: null }[]
  provider_failures: { provider_declines_90d: number; lease_expiries_90d: number; uncorrected_verification_failures_90d: number; buyer_refund_resolutions_90d: number }
  score: number
  score_components: { capability_fit: number; price: number; latency: number; capacity: number; verification: number; backed_execution: number; provider_failure_penalty: number }
  explanation: string[]
}

/** Nonbinding candidate snapshot. Provider claims alone never authorize payment. */
export async function planRoute(input: NormalizedRouteRequest, buyerId: string) {
  const capabilities = normalizedCapabilities(input.required_capabilities)
  if (!reusableServiceBuyerOrdersEnabled(buyerId)) return { capabilities, candidates: [] as RouteCandidate[], examined: 0, truncated: false }
  const rows = await db.select().from(service_definitions).where(and(
    eq(service_definitions.status, 'active'),
    sql`(${service_definitions.seller_id} NOT GLOB 'user_agent_*' OR EXISTS (
      SELECT 1 FROM agents a WHERE ('user_agent_' || a.id) = ${service_definitions.seller_id}
      AND a.status = 'active' AND a.visibility = 'public' AND a.archived_at IS NULL))`,
  )).orderBy(service_definitions.id).limit(501)
  const truncated = rows.length > 500
  const agentIds = [...new Set(rows.filter((row) => row.seller_id.startsWith('user_agent_'))
    .map((row) => row.seller_id.slice('user_agent_'.length)))]
  const backedCounts = await backedCapabilityCounts(agentIds, capabilities)
  const cutoff = new Date(Date.now() - 90 * 24 * 3600_000)
  const unrelatedTrade = sql`(${trades.buyer_id} <> ${trades.seller_id}
    AND ${trades.id} NOT GLOB 'trade_reference_*'
    AND NOT EXISTS (SELECT 1 FROM agent_owners seller_owner
      WHERE ('user_agent_' || seller_owner.agent_id) = ${trades.seller_id}
      AND seller_owner.user_id = ${trades.buyer_id})
    AND NOT EXISTS (SELECT 1 FROM agent_owners seller_owner JOIN agent_owners buyer_owner
      ON seller_owner.user_id = buyer_owner.user_id
      WHERE ('user_agent_' || seller_owner.agent_id) = ${trades.seller_id}
      AND ('user_agent_' || buyer_owner.agent_id) = ${trades.buyer_id}))`
  // A dispute becomes a refund signal only after the authoritative distribution is final.
  const confirmedBuyerRefund = sql`(${trades.status} = 'resolved' AND ${trades.resolution} = 'buyer'
    AND ${trades.payout_status} = 'complete'
    AND EXISTS (SELECT 1 FROM transactions refund WHERE refund.reference_id = ${trades.id} AND refund.type = 'escrow_refund')
    AND ((${trades.payment_rail} = 'ledger' AND ${trades.fee_tx_hash} IS NULL
      AND EXISTS (SELECT 1 FROM transactions locked WHERE locked.reference_id = ${trades.id} AND locked.type = 'escrow_lock'))
      OR ((${trades.payment_rail} IN ('mpp', 'evm') OR ${trades.fee_tx_hash} IS NOT NULL)
      AND EXISTS (SELECT 1 FROM settlement_transfers transfer WHERE transfer.trade_id = ${trades.id}
        AND transfer.kind = 'buyer_refund' AND transfer.status = 'confirmed' AND transfer.tx_hash IS NOT NULL))))`
  const failureRows = rows.length ? await db.select({ serviceId: service_orders.service_id,
    state: service_execution_attempts.state, count: sql<number>`COUNT(*)` })
    .from(service_execution_attempts)
    .innerJoin(service_orders, eq(service_orders.id, service_execution_attempts.order_id))
    .innerJoin(trades, eq(trades.id, service_orders.trade_id))
    .innerJoin(service_definitions, eq(service_definitions.id, service_orders.service_id))
    .where(and(inArray(service_orders.service_id, rows.slice(0, 500).map((row) => row.id)),
      inArray(service_execution_attempts.state, ['declined', 'expired']),
      gte(service_execution_attempts.created_at, cutoff),
      sql`${trades.funded_at} IS NOT NULL`,
      unrelatedTrade,
      sql`NOT COALESCE(${confirmedBuyerRefund}, 0)`))
    .groupBy(service_orders.service_id, service_execution_attempts.state) : []
  const failureCounts = new Map(failureRows.map((row) => [`${row.serviceId}:${row.state}`, Number(row.count)]))
  const verificationFailureRows = rows.length ? await db.select({ serviceId: service_orders.service_id,
    count: sql<number>`COUNT(DISTINCT ${trades.id})` })
    .from(service_orders)
    .innerJoin(trades, eq(trades.id, service_orders.trade_id))
    .innerJoin(verification_results, eq(verification_results.trade_id, trades.id))
    .where(and(inArray(service_orders.service_id, rows.slice(0, 500).map((row) => row.id)),
      eq(verification_results.status, 'failed'),
      eq(verification_results.verifier, 'clawdmarket-deterministic-v1'),
      isNull(verification_results.delivery_id),
      gte(verification_results.created_at, cutoff),
      sql`${trades.funded_at} IS NOT NULL`,
      unrelatedTrade,
      sql`NOT COALESCE(${confirmedBuyerRefund}, 0)`,
      sql`NOT EXISTS (SELECT 1 FROM trade_deliveries delivered WHERE delivered.trade_id = ${trades.id})`,
      sql`NOT EXISTS (SELECT 1 FROM service_execution_attempts attempt WHERE attempt.order_id = ${service_orders.id} AND attempt.state IN ('declined', 'expired'))`))
    .groupBy(service_orders.service_id) : []
  const verificationFailureCounts = new Map(verificationFailureRows.map((row) => [row.serviceId, Number(row.count)]))
  const refundRows = rows.length ? await db.select({ serviceId: service_orders.service_id,
    count: sql<number>`COUNT(DISTINCT ${trades.id})` })
    .from(service_orders)
    .innerJoin(trades, eq(trades.id, service_orders.trade_id))
    .where(and(inArray(service_orders.service_id, rows.slice(0, 500).map((row) => row.id)),
      gte(trades.completed_at, cutoff), sql`${trades.funded_at} IS NOT NULL`,
      unrelatedTrade,
      confirmedBuyerRefund))
    .groupBy(service_orders.service_id) : []
  const refundCounts = new Map(refundRows.map((row) => [row.serviceId, Number(row.count)]))
  const readiness = getPaymentReadiness()
  const paymentControl = await getNewPaymentControl()
  const buyerPolicy = await loadBuyerSpendPolicy(buyerId)
  const buyerUsage = buyerPolicy ? await buyerPolicyUsage(buyerId) : null
  const organizationBudget = buyerId.startsWith('user_agent_')
    ? await organizationBudgetForAgent(buyerId.slice('user_agent_'.length)) : null
  const organizationUsage = organizationBudget ? await organizationBudgetUsage(organizationBudget.organization_id) : null
  // Route execution creates an unpaid checkout; ledger would debit immediately.
  const allowedRails = (input.payment_policy.allowed_rails || ['mpp', 'evm']).filter((rail) => rail !== 'ledger'
    && (!buyerPolicy?.policy.approved_payment_rails || buyerPolicy.policy.approved_payment_rails.includes(rail)))
  const candidates: RouteCandidate[] = []
  for (const service of rows.slice(0, 500)) {
    if (!reusableServiceSellerWritesEnabled(service.seller_id)) continue
    const contract = serviceContractReadiness(service)
    if (!contract.ready) continue
    if (service.seller_id === buyerId) continue
    if (paymentControl.paused || service.active_orders >= service.max_concurrency) continue
    const offered = storedServiceCapabilities(service.capabilities)
    if (!offered || !capabilities.every((capability) => offered.includes(capability))) continue
    if (checkServiceInput(input.input, contract.inputSchema).status !== 'valid') continue
    const servicePolicy = contract.verificationPolicy!
    if (!supportsVerification(servicePolicy, input.verification)) continue
    const totalMinor = service.price_minor + Math.round(service.price_minor * 0.05)
    if (totalMinor > input.max_budget.amount) continue
    if (organizationBudget && (
      organizationBudget.budget.max_per_execution_minor !== null && totalMinor > organizationBudget.budget.max_per_execution_minor
      || organizationBudget.budget.max_daily_minor !== null && organizationUsage!.reserved_or_spent_today_minor + totalMinor > organizationBudget.budget.max_daily_minor
      || organizationBudget.budget.max_monthly_minor !== null && organizationUsage!.reserved_or_spent_month_minor + totalMinor > organizationBudget.budget.max_monthly_minor)) continue
    if (buyerPolicy && (buyerPolicy.policy.max_daily !== undefined && buyerUsage!.reserved_or_spent_today_minor + totalMinor > buyerPolicy.policy.max_daily
      || buyerPolicy.policy.max_monthly !== undefined && buyerUsage!.reserved_or_spent_month_minor + totalMinor > buyerPolicy.policy.max_monthly)) continue
    if (input.deadline_seconds && (!service.estimated_latency_seconds || service.estimated_latency_seconds > input.deadline_seconds)) continue
    if (service.seller_id.startsWith('user_agent_') && await referenceFleetPaidServicePublicationLocked(service.seller_id.slice('user_agent_'.length))) continue
    const sellerPayout = Boolean(await payoutAddressForUser(service.seller_id))
    const rail = allowedRails.map((item) => selectMarketplaceRail(item, readiness, sellerPayout)).find(Boolean)
    if (!rail) continue
    if (buyerPolicy && checkBuyerPolicyConstraints(buyerPolicy.policy, { totalMinor, sellerId: service.seller_id,
      capabilities: offered, paymentRail: rail, verificationMethods: servicePolicy.methods })) continue
    const priceScore = Math.max(0, 1 - totalMinor / input.max_budget.amount)
    const latencyScore = service.estimated_latency_seconds && input.deadline_seconds
      ? Math.max(0, 1 - service.estimated_latency_seconds / input.deadline_seconds)
      : 0.5
    const capacityScore = (service.max_concurrency - service.active_orders) / service.max_concurrency
    const agentId = service.seller_id.startsWith('user_agent_') ? service.seller_id.slice('user_agent_'.length) : null
    const evidence = capabilityEvidence(service.seller_id, capabilities, backedCounts)
    if (providerRequirementFailure(input.provider_requirements, service.seller_id, evidence)
      || buyerPolicy?.policy.provider_requirements && providerRequirementFailure(buyerPolicy.policy.provider_requirements, service.seller_id, evidence)) continue
    const backedCount = Math.min(...evidence.map((item) => item.accepted_completion_count))
    const buyerBreadth = Math.min(...evidence.map((item) => item.distinct_buyer_count))
    const backedExecution = Math.min(buyerBreadth, 5) / 5
    const providerFailures = { provider_declines_90d: failureCounts.get(`${service.id}:declined`) || 0,
      lease_expiries_90d: failureCounts.get(`${service.id}:expired`) || 0,
      uncorrected_verification_failures_90d: verificationFailureCounts.get(service.id) || 0,
      buyer_refund_resolutions_90d: refundCounts.get(service.id) || 0 }
    const providerFailurePenalty = Math.min(providerFailures.provider_declines_90d
      + providerFailures.lease_expiries_90d + providerFailures.uncorrected_verification_failures_90d
      + providerFailures.buyer_refund_resolutions_90d, 5) / 5
    const components = { capability_fit: 1, price: priceScore, latency: latencyScore, capacity: capacityScore,
      verification: 1, backed_execution: backedExecution, provider_failure_penalty: providerFailurePenalty }
    const score = Math.round((0.4 * components.capability_fit + 0.25 * priceScore + 0.15 * latencyScore
      + 0.1 * capacityScore + 0.05 * components.verification + 0.05 * backedExecution
      - 0.05 * providerFailurePenalty) * 10_000) / 10_000
    candidates.push({
      service_id: service.id, seller_agent_id: agentId,
      pricing: { model: 'fixed', amount: servicePrice(service.price_minor), currency: 'USD', estimated_total: servicePrice(totalMinor) },
      estimated_latency_seconds: service.estimated_latency_seconds, payment_rail: rail,
      verification_methods: servicePolicy.methods,
      evidence_level: backedCount > 0 ? 'backed_completion_observed' : 'claimed_only',
      capability_evidence: evidence,
      eligibility: { requirements_satisfied: true, request: input.provider_requirements, saved_policy: buyerPolicy?.policy.provider_requirements ?? {}, confidence: backedCount > 0 ? 'backed_completion_observed' : 'unmeasured', buyer_independence: 'not_verified' }, provider_failures: providerFailures, score,
      score_components: components,
      explanation: ['All required canonical capabilities are claimed', 'Service is currently purchasable',
        backedCount > 0 ? 'Economically backed buyer-accepted completions observed for every required capability; score uses distinct eligible buyer accounts and quality remains unmeasured'
          : 'Provider capability is not independently verified',
        providerFailurePenalty > 0 ? 'Recent funded provider declines, lease expiries, uncorrected deterministic verification failures, or finalized buyer refunds observed; penalty is capped'
          : 'No recent provider attempt, uncorrected verification failure, or finalized buyer refund observed; reliability remains unmeasured'],
    })
  }
  candidates.sort((a, b) => b.score - a.score || a.pricing.estimated_total.localeCompare(b.pricing.estimated_total) || a.service_id.localeCompare(b.service_id))
  return { capabilities, candidates: candidates.slice(0, 20), examined: Math.min(rows.length, 500), truncated }
}

export function routePlanDto(plan: typeof route_plans.$inferSelect) {
  return {
    id: plan.id, client_reference: plan.client_reference, objective: plan.objective,
    required_capabilities: JSON.parse(plan.required_capabilities) as string[],
    input: JSON.parse(plan.input_json) as Record<string, unknown>,
    max_budget: { amount: servicePrice(plan.max_budget_minor), currency: plan.currency },
    deadline_seconds: plan.deadline_seconds,
    verification: JSON.parse(plan.verification_policy), payment_policy: JSON.parse(plan.payment_policy),
    provider_requirements: JSON.parse(plan.provider_requirements_json),
    retry_policy: JSON.parse(plan.retry_policy), candidates: JSON.parse(plan.candidates_json) as RouteCandidate[],
    state: plan.state, service_order_id: plan.service_order_id, created_at: plan.created_at, expires_at: plan.expires_at,
  }
}
