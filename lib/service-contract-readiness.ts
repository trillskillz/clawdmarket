import type { service_definitions } from '@/lib/schema'
import { checkServiceInput, outputSchemaV1, verificationPolicySchema } from '@/lib/verification-policy'

type ServiceContract = Pick<typeof service_definitions.$inferSelect,
  'execution_mode' | 'provider_protocol' | 'input_schema' | 'output_schema' | 'verification_policy'>

function storedJson(value: string): unknown {
  try { return JSON.parse(value) } catch { return null }
}

/** Discovery and reservation must agree on which stored contracts can execute. */
export function serviceContractReadiness(service: ServiceContract) {
  const inputSchema = storedJson(service.input_schema)
  const outputSchema = storedJson(service.output_schema)
  const policyInput = storedJson(service.verification_policy)
  const parsedPolicy = verificationPolicySchema.safeParse(policyInput)
  const executionModeReady = service.execution_mode === 'contracted'
  const protocolReady = service.provider_protocol === 'manual' || service.provider_protocol === 'leased_v1'
  const inputReady = checkServiceInput({}, inputSchema).status !== 'unsupported'
  const outputObject = outputSchema !== null && typeof outputSchema === 'object' && !Array.isArray(outputSchema)
  const verificationReady = parsedPolicy.success && outputObject
    && (!parsedPolicy.data.methods.includes('schema') || outputSchemaV1.safeParse(outputSchema).success)
  return {
    inputSchema, outputSchema, policyInput,
    verificationPolicy: parsedPolicy.success ? parsedPolicy.data : null,
    executionModeReady, protocolReady, inputReady, verificationReady,
    ready: executionModeReady && protocolReady && inputReady && verificationReady,
  }
}
