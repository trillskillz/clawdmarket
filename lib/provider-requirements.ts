import { z } from 'zod'

/** Buyer choices are requirements, never evidence or payment authority. */
export const providerRequirementsSchema = z.object({
  approved_providers: z.array(z.string().trim().min(1).max(200)).min(1).max(100).optional(),
  minimum_accepted_completions: z.number().int().min(1).max(100_000).optional(),
  minimum_distinct_buyers: z.number().int().min(1).max(100_000).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.approved_providers && new Set(value.approved_providers).size !== value.approved_providers.length) {
    ctx.addIssue({ code: 'custom', path: ['approved_providers'], message: 'Duplicate providers are not allowed' })
  }
})
export type ProviderRequirements = z.output<typeof providerRequirementsSchema>
export type CapabilityEvidence = { capability_id: string; accepted_completion_count: number; distinct_buyer_count: number; measured_quality_score: null }

export function providerMatches(items: string[], sellerId: string) {
  return items.includes(sellerId) || sellerId.startsWith('user_agent_') && items.includes(sellerId.slice('user_agent_'.length))
}

export function providerRequirementFailure(requirements: ProviderRequirements, sellerId: string, evidence: CapabilityEvidence[]): string | null {
  if (requirements.approved_providers && !providerMatches(requirements.approved_providers, sellerId)) return 'PROVIDER_NOT_APPROVED'
  if (requirements.minimum_accepted_completions !== undefined || requirements.minimum_distinct_buyers !== undefined) {
    if (!evidence.length || evidence.some((item) => item.accepted_completion_count < (requirements.minimum_accepted_completions ?? 1)
      || item.distinct_buyer_count < (requirements.minimum_distinct_buyers ?? 1))) return 'PROVIDER_EVIDENCE_REQUIRED'
  }
  return null
}
