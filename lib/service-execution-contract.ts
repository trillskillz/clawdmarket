import { z } from 'zod'
import type { service_definitions, service_orders } from './schema'

const snapshotSchema = z.object({
  version: z.literal(1), seller_id: z.string(), title: z.string(), capabilities: z.string(),
  execution_mode: z.literal('contracted'), provider_protocol: z.enum(['manual', 'leased_v1']),
  input_schema: z.string(), output_schema: z.string(), verification_policy: z.string(),
  estimated_latency_seconds: z.number().int().positive().nullable(),
}).strict()
type Service = typeof service_definitions.$inferSelect

export function captureServiceExecutionContract(service: Service, capabilities: string[]) {
  return JSON.stringify(snapshotSchema.parse({ version: 1, seller_id: service.seller_id, title: service.title,
    capabilities: JSON.stringify(capabilities), execution_mode: service.execution_mode, provider_protocol: service.provider_protocol,
    input_schema: service.input_schema, output_schema: service.output_schema, verification_policy: service.verification_policy,
    estimated_latency_seconds: service.estimated_latency_seconds }))
}

/** Null denotes a legacy order; a corrupt recorded contract must never fall back to editable terms. */
export function serviceExecutionContract<T extends Partial<Service>>(order: Pick<typeof service_orders.$inferSelect, 'execution_contract_json'>, service: T): T {
  if (order.execution_contract_json === null) return service
  const { version: _version, ...agreed } = snapshotSchema.parse(JSON.parse(order.execution_contract_json))
  return { ...service, ...agreed }
}
