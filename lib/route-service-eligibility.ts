import type { route_plans, service_definitions } from '@/lib/schema'
import { serviceContractReadiness } from '@/lib/service-contract-readiness'
import { supportsVerification, verificationPolicySchema } from '@/lib/verification-policy'

type Service = Pick<typeof service_definitions.$inferSelect,
  'capabilities' | 'estimated_latency_seconds' | 'execution_mode' | 'provider_protocol' | 'input_schema' | 'output_schema' | 'verification_policy'>
type Requirements = Pick<typeof route_plans.$inferSelect, 'required_capabilities' | 'verification_policy' | 'deadline_seconds'>

export function storedServiceCapabilities(value: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : null
  } catch { return null }
}

/** Shared nonbinding preflight and transactional reservation check; malformed stored requirements fail closed. */
export function serviceSupportsRoute(service: Service, plan: Requirements) {
  try {
    const required: unknown = JSON.parse(plan.required_capabilities)
    const offered = storedServiceCapabilities(service.capabilities)
    if (!Array.isArray(required) || !required.length || !required.every((value) => typeof value === 'string')
      || !offered
      || !required.every((value) => offered.includes(value))) return false
    const requested = verificationPolicySchema.safeParse(JSON.parse(plan.verification_policy))
    const contract = serviceContractReadiness(service)
    return contract.ready && requested.success && !!contract.verificationPolicy
      && supportsVerification(contract.verificationPolicy, requested.data)
      && (plan.deadline_seconds === null || !!service.estimated_latency_seconds
        && service.estimated_latency_seconds <= plan.deadline_seconds)
  } catch { return false }
}
