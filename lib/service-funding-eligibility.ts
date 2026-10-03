import { payoutAddressForUser } from './external-settlement'
import { ZodError } from 'zod'
import { eq, sql } from 'drizzle-orm'
import { db } from './db'
import { route_plans, service_definitions, service_orders, trades } from './schema'
import { buyerPolicyUsage, checkBuyerPolicyConstraints, loadBuyerSpendPolicy } from './buyer-spend-policy'
import { providerRequirementsSchema, providerRequirementFailure } from './provider-requirements'
import { providerCapabilityEvidence } from './provider-evidence'
import { serviceExecutionContract } from './service-execution-contract'
import { serviceContractReadiness } from './service-contract-readiness'
import { serviceSupportsRoute, storedServiceCapabilities } from './route-service-eligibility'
import { checkServiceInput } from './verification-policy'
import { REFERENCE_FLEET_MARKER } from './reference-fleet-manifest'
import { isolatedVerifierEligibility } from './isolated-verifier-eligibility'
import { mandateFundingEligibility } from './route-payment-mandate'
import { agentFundingPolicyFailure } from './agent-spend-policy'
import { organizationFundingBudgetFailure } from './organization-budgets'

type Source = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function checkProviderRequirements(source: Source, buyerId: string, sellerId: string, capabilities: string[], requirementsJson: string) {
  if (sellerId.startsWith('user_agent_')) {
    const visible = await source.all(sql`SELECT id FROM agents WHERE ('user_agent_' || id) = ${sellerId}
      AND status = 'active' AND visibility = 'public' AND archived_at IS NULL LIMIT 1`)
    if (!visible.length) return 'SERVICE_UNAVAILABLE'
  }
  const requirements = providerRequirementsSchema.parse(JSON.parse(requirementsJson))
  const policy = await loadBuyerSpendPolicy(buyerId, source)
  const evidence = await providerCapabilityEvidence(sellerId, capabilities, source)
  return providerRequirementFailure(requirements, sellerId, evidence)
    || (policy?.policy.provider_requirements ? providerRequirementFailure(policy.policy.provider_requirements, sellerId, evidence) : null)
}

/** New payment permission and verified funding share this check. Proof recovery is always allowed. */
export async function serviceFundingEligibility(trade: typeof trades.$inferSelect, source: Source = db): Promise<string | null> {
  const [linked] = await source.select({ order: service_orders, service: service_definitions }).from(service_orders)
    .leftJoin(service_definitions, eq(service_definitions.id, service_orders.service_id))
    .where(eq(service_orders.trade_id, trade.id)).limit(1)
  if (!linked) return null // Listing/task checkouts retain their existing contract.
  try {
    const mandateReason = await mandateFundingEligibility(trade, source)
    if (mandateReason) return mandateReason
    const deploymentReason = await agentFundingPolicyFailure(trade, source)
    if (deploymentReason) return deploymentReason
    const organizationReason = await organizationFundingBudgetFailure(trade, source)
    if (organizationReason) return organizationReason
    const { order, service } = linked
    if (!service) return 'SERVICE_UNAVAILABLE'
    const agreed = serviceExecutionContract(order, service)
    const capabilities = storedServiceCapabilities(agreed.capabilities)
    if (order.state !== 'awaiting_funding' || !capabilities?.length || service.status !== 'active'
      || service.seller_id !== trade.seller_id || agreed.seller_id !== trade.seller_id) return 'SERVICE_UNAVAILABLE'
    // Editable terms cannot silently replace the accepted execution and verification contract.
    for (const field of ['execution_mode', 'provider_protocol', 'input_schema', 'output_schema', 'verification_policy'] as const) {
      if (service[field] !== agreed[field]) return 'SERVICE_CONTRACT_CHANGED'
    }
    if (!await payoutAddressForUser(trade.seller_id, source)) return 'SELLER_PAYOUT_REQUIRED'
    const offered = storedServiceCapabilities(service.capabilities)
    if (!offered || !capabilities.every((capability) => offered.includes(capability))) return 'SERVICE_CONTRACT_CHANGED'
    const contract = serviceContractReadiness(service)
    if (!contract.ready || checkServiceInput(JSON.parse(order.input_json), contract.inputSchema).status !== 'valid') return 'SERVICE_CONTRACT_CHANGED'
    const verifierFailure = await isolatedVerifierEligibility(contract.verificationPolicy!.isolated_checks, trade.buyer_id, trade.seller_id, source)
    if (verifierFailure) return verifierFailure
    if (trade.seller_id.startsWith('user_agent_')) {
      const visible = await source.all(sql`SELECT id FROM agents WHERE ('user_agent_' || id) = ${trade.seller_id}
        AND status = 'active' AND visibility = 'public' AND archived_at IS NULL AND instr(description, ${REFERENCE_FLEET_MARKER}) = 0 LIMIT 1`)
      if (!visible.length) return 'SERVICE_UNAVAILABLE'
    }
    const [plan] = await source.select().from(route_plans).where(eq(route_plans.service_order_id, order.id)).limit(1)
    if (plan && !serviceSupportsRoute(service, plan)) return 'ROUTE_STALE_PROVIDER'
    const reason = await checkProviderRequirements(source, trade.buyer_id, trade.seller_id, capabilities, order.provider_requirements_json)
    if (reason) return reason
    const policy = await loadBuyerSpendPolicy(trade.buyer_id, source)
    if (policy) {
      const constraint = checkBuyerPolicyConstraints(policy.policy, { totalMinor: Math.round(trade.total_cost * 100), sellerId: trade.seller_id,
        capabilities, paymentRail: order.payment_rail, verificationMethods: contract.verificationPolicy!.methods })
      if (constraint) return constraint
      const usage = await buyerPolicyUsage(trade.buyer_id, new Date(), source)
      // This reservation is already included: funding must not add its exposure twice.
      if (policy.policy.max_daily !== undefined && usage.reserved_or_spent_today_minor > policy.policy.max_daily) return 'BUYER_DAILY_LIMIT'
      if (policy.policy.max_monthly !== undefined && usage.reserved_or_spent_month_minor > policy.policy.max_monthly) return 'BUYER_MONTHLY_LIMIT'
    }
    return null
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) return 'SERVICE_REQUIREMENTS_INVALID'
    throw error
  }
}
