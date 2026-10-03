import 'server-only'
import { normalizedCapabilities, planRoute, type NormalizedRouteRequest } from './route-planning'
import { servicePrice } from './service-definitions'

/** Shared, nonpersistent plan result for read-only agent interfaces. */
export async function previewRoute(input: NormalizedRouteRequest, buyerId: string) {
  const planned = await planRoute(input, buyerId)
  return {
    persisted: false,
    funds_moved: false,
    plan: {
      objective: input.objective,
      required_capabilities: normalizedCapabilities(input.required_capabilities),
      max_budget: { amount: servicePrice(input.max_budget.amount), currency: 'USD' as const },
      deadline_seconds: input.deadline_seconds ?? null,
      verification: input.verification,
      payment_policy: input.payment_policy,
      retry_policy: input.retry_policy,
      provider_requirements: input.provider_requirements,
      candidates: planned.candidates,
    },
    planning: { examined: planned.examined, truncated: planned.truncated, candidate_count: planned.candidates.length },
  }
}
