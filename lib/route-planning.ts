import 'server-only'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/lib/db'
import { normalizeCapability } from '@/lib/capabilities'
import { capability_performance_events, service_definitions, route_plans } from '@/lib/schema'
import { jsonObject, money, servicePrice } from '@/lib/service-definitions'
import { getPaymentReadiness } from '@/lib/payment-config'
import { getNewPaymentControl } from '@/lib/payment-control'
import { payoutAddressForUser } from '@/lib/external-settlement'
import { selectMarketplaceRail, type MarketplaceRail } from '@/lib/payment-rail-selection'
import { referenceFleetPaidServicePublicationLocked } from '@/lib/reference-fleet-control'
import { reusableServiceWritesEnabled } from '@/lib/routing-feature-flags'
import { checkServiceInput, supportsVerification, verificationPolicySchema, type VerificationPolicy } from '@/lib/verification-policy'
import { buyerPolicyUsage, checkBuyerPolicyConstraints, loadBuyerSpendPolicy } from '@/lib/buyer-spend-policy'
import { organizationBudgetForAgent, organizationBudgetUsage } from '@/lib/organization-budgets'

export const routePlanInput = z.object({
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
  evidence_level: 'claimed_only' | 'backed_completion_observed'
  capability_evidence: { capability_id: string; accepted_completion_count: number; measured_quality_score: null }[]
  score: number
  score_components: { capability_fit: number; price: number; latency: number; capacity: number; verification: number; backed_execution: number }
  explanation: string[]
}

/** Nonbinding candidate snapshot. Provider claims alone never authorize payment. */
export async function planRoute(input: NormalizedRouteRequest, buyerId: string) {
  const capabilities = normalizedCapabilities(input.required_capabilities)
  if (!reusableServiceWritesEnabled()) return { capabilities, candidates: [] as RouteCandidate[], examined: 0, truncated: false }
  const rows = await db.select().from(service_definitions).where(and(
    eq(service_definitions.status, 'active'),
    sql`(${service_definitions.seller_id} NOT GLOB 'user_agent_*' OR EXISTS (
      SELECT 1 FROM agents a WHERE ('user_agent_' || a.id) = ${service_definitions.seller_id}
      AND a.status = 'active' AND a.visibility = 'public' AND a.archived_at IS NULL))`,
  )).orderBy(service_definitions.id).limit(501)
  const truncated = rows.length > 500
  const agentIds = [...new Set(rows.filter((row) => row.seller_id.startsWith('user_agent_'))
    .map((row) => row.seller_id.slice('user_agent_'.length)))]
  const performanceRows = agentIds.length ? await db.select({ agentId: capability_performance_events.seller_agent_id,
    capabilityId: capability_performance_events.capability_id, count: sql<number>`COUNT(*)` })
    .from(capability_performance_events)
    .where(and(inArray(capability_performance_events.seller_agent_id, agentIds),
      inArray(capability_performance_events.capability_id, capabilities)))
    .groupBy(capability_performance_events.seller_agent_id, capability_performance_events.capability_id) : []
  const backedCounts = new Map(performanceRows.map((row) => [`${row.agentId}:${row.capabilityId}`, Number(row.count)]))
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
    if (service.provider_protocol !== 'manual' && service.provider_protocol !== 'leased_v1') continue
    if (service.seller_id === buyerId) continue
    if (paymentControl.paused || service.active_orders >= service.max_concurrency) continue
    const offered = JSON.parse(service.capabilities) as string[]
    if (!capabilities.every((capability) => offered.includes(capability))) continue
    let inputSchema: unknown
    try { inputSchema = JSON.parse(service.input_schema) } catch { inputSchema = null }
    if (checkServiceInput(input.input, inputSchema).status !== 'valid') continue
    const servicePolicy = verificationPolicySchema.safeParse(JSON.parse(service.verification_policy))
    if (!servicePolicy.success || !supportsVerification(servicePolicy.data, input.verification)) continue
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
      capabilities: offered, paymentRail: rail, verificationMethods: servicePolicy.data.methods })) continue
    const priceScore = Math.max(0, 1 - totalMinor / input.max_budget.amount)
    const latencyScore = service.estimated_latency_seconds && input.deadline_seconds
      ? Math.max(0, 1 - service.estimated_latency_seconds / input.deadline_seconds)
      : 0.5
    const capacityScore = (service.max_concurrency - service.active_orders) / service.max_concurrency
    const agentId = service.seller_id.startsWith('user_agent_') ? service.seller_id.slice('user_agent_'.length) : null
    const capabilityEvidence = capabilities.map((capability) => ({ capability_id: capability,
      accepted_completion_count: agentId ? backedCounts.get(`${agentId}:${capability}`) || 0 : 0,
      measured_quality_score: null as null }))
    const backedCount = Math.min(...capabilityEvidence.map((item) => item.accepted_completion_count))
    const backedExecution = Math.min(backedCount, 5) / 5
    const components = { capability_fit: 1, price: priceScore, latency: latencyScore, capacity: capacityScore,
      verification: 1, backed_execution: backedExecution }
    const score = Math.round((0.4 * components.capability_fit + 0.25 * priceScore + 0.15 * latencyScore
      + 0.1 * capacityScore + 0.05 * components.verification + 0.05 * backedExecution) * 10_000) / 10_000
    candidates.push({
      service_id: service.id, seller_agent_id: agentId,
      pricing: { model: 'fixed', amount: servicePrice(service.price_minor), currency: 'USD', estimated_total: servicePrice(totalMinor) },
      estimated_latency_seconds: service.estimated_latency_seconds, payment_rail: rail,
      verification_methods: servicePolicy.data.methods,
      evidence_level: backedCount > 0 ? 'backed_completion_observed' : 'claimed_only',
      capability_evidence: capabilityEvidence, score,
      score_components: components,
      explanation: ['All required canonical capabilities are claimed', 'Service is currently purchasable',
        backedCount > 0 ? 'Economically backed buyer-accepted completions observed for every required capability; quality remains unmeasured'
          : 'Provider capability is not independently verified'],
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
    retry_policy: JSON.parse(plan.retry_policy), candidates: JSON.parse(plan.candidates_json) as RouteCandidate[],
    state: plan.state, service_order_id: plan.service_order_id, created_at: plan.created_at, expires_at: plan.expires_at,
  }
}
