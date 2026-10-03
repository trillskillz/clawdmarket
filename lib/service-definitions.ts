import { providerRequirementsSchema } from './provider-requirements'
import 'server-only'
import { z } from 'zod'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { normalizeCapability } from '@/lib/capabilities'
import { service_definitions, service_orders } from '@/lib/schema'
import { getPaymentReadiness } from '@/lib/payment-config'
import { getNewPaymentControl } from '@/lib/payment-control'
import { payoutAddressForUser } from '@/lib/external-settlement'
import { isPublicMarketplaceSeller } from '@/lib/listing-visibility'
import { reusableServiceReadinessEnabled } from '@/lib/routing-feature-flags'
import { checkServiceInput, outputSchemaV1, verificationPolicySchema } from '@/lib/verification-policy'
import { serviceContractReadiness } from '@/lib/service-contract-readiness'

export const money = z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, 'Use a USD decimal string with at most two places')
  .transform((value, ctx) => {
    const [whole, fractional = ''] = value.split('.')
    const cents = Number(whole) * 100 + Number(fractional.padEnd(2, '0'))
    if (!Number.isSafeInteger(cents) || cents < 1 || cents > 100_000_000_000) {
      ctx.addIssue({ code: 'custom', message: 'Amount must be between 0.01 and 1,000,000,000.00' })
      return z.NEVER
    }
    return cents
  })

export const jsonObject = z.record(z.string().max(100), z.unknown()).refine(
  (value) => JSON.stringify(value).length <= 8_192,
  'Schema or policy must be at most 8 KB',
)

export const serviceDefinitionInput = z.object({
  title: z.string().trim().min(5).max(100),
  description: z.string().trim().min(20).max(2_000),
  capabilities: z.array(z.string().trim().min(1).max(80)).min(1).max(20),
  input_schema: jsonObject.optional().default({}),
  output_schema: jsonObject.optional().default({}),
  pricing: z.object({ model: z.literal('fixed'), amount: money, currency: z.literal('USD') }),
  estimated_latency_seconds: z.number().int().min(1).max(30 * 24 * 3600).nullable().optional(),
  max_concurrency: z.number().int().min(1).max(1_000).default(1),
  execution_mode: z.literal('contracted').default('contracted'),
  provider_protocol: z.enum(['manual', 'leased_v1']).default('manual'),
  verification_policy: verificationPolicySchema.default({ required: true, methods: ['buyer_review'] }),
  status: z.enum(['draft', 'active']).default('draft'),
}).strict().superRefine((value, context) => {
  value.capabilities.forEach((capability, index) => {
    if (!normalizeCapability(capability)) context.addIssue({ code: 'custom', path: ['capabilities', index], message: 'Unknown canonical capability' })
  })
  if (checkServiceInput({}, value.input_schema).status === 'unsupported') {
    context.addIssue({ code: 'custom', path: ['input_schema'], message: 'input_schema requires the supported bounded JSON object schema' })
  }
  if (value.verification_policy.methods.includes('schema')) {
    const parsed = outputSchemaV1.safeParse(value.output_schema)
    if (!parsed.success) context.addIssue({ code: 'custom', path: ['output_schema'], message: 'schema verification requires the supported bounded JSON object schema' })
  }
})

export const serviceOrderInput = z.object({
  provider_requirements: providerRequirementsSchema.default({}),
  client_reference: z.string().trim().min(8).max(200),
  objective: z.string().trim().min(10).max(2_000),
  input: jsonObject.optional().default({}),
  payment_rail: z.enum(['auto', 'mpp', 'evm', 'credit', 'ledger']).default('auto'),
  max_total: money.optional(),
  expected_price: money.optional(),
}).strict()

export function servicePrice(priceMinor: number) {
  return (priceMinor / 100).toFixed(2)
}

export function serviceOrderDto(order: typeof service_orders.$inferSelect) {
  const { input_json, provider_requirements_json, execution_contract_json, ...fields } = order
  return { ...fields, provider_requirements: JSON.parse(provider_requirements_json), execution_contract: execution_contract_json ? JSON.parse(execution_contract_json) : null, input: JSON.parse(input_json) as Record<string, unknown> }
}

export function canonicalServiceCapabilities(values: string[]) {
  return [...new Set(values.map((value) => normalizeCapability(value)!).filter(Boolean))]
}

export async function serviceDefinitionDto(service: typeof service_definitions.$inferSelect, requesterId?: string) {
  const [payoutAddress, paymentControl, sellerVisible] = await Promise.all([
    payoutAddressForUser(service.seller_id),
    getNewPaymentControl(),
    isPublicMarketplaceSeller(service.seller_id),
  ])
  const rails = getPaymentReadiness()
  const capacityAvailable = service.active_orders < service.max_concurrency
  const contract = serviceContractReadiness(service)
  const paymentReady = !paymentControl.paused && (rails.credit.enabled || rails.ledger.enabled || Boolean(payoutAddress && (rails.mpp.enabled || rails.evm.enabled)))
  const reasons: string[] = []
  if (service.status !== 'active') reasons.push('SERVICE_NOT_ACTIVE')
  if (!reusableServiceReadinessEnabled(requesterId, service.seller_id)) reasons.push('REUSABLE_SERVICES_DISABLED')
  if (!sellerVisible) reasons.push('SELLER_NOT_PUBLIC')
  if (!capacityAvailable) reasons.push('CAPACITY_FULL')
  if (!contract.inputReady) reasons.push('INPUT_SCHEMA_UNSUPPORTED')
  if (!contract.executionModeReady) reasons.push('EXECUTION_MODE_UNSUPPORTED')
  if (!contract.protocolReady) reasons.push('PROVIDER_PROTOCOL_UNSUPPORTED')
  if (!contract.verificationReady) reasons.push('VERIFICATION_UNSUPPORTED')
  if (paymentControl.paused) reasons.push('PAYMENTS_PAUSED')
  else if (!paymentReady) reasons.push(payoutAddress ? 'PAYMENT_RAIL_UNAVAILABLE' : 'SELLER_PAYOUT_REQUIRED')
  return {
    id: service.id,
    seller_agent_id: service.seller_id.startsWith('user_agent_') ? service.seller_id.slice('user_agent_'.length) : null,
    title: service.title,
    description: service.description,
    capabilities: JSON.parse(service.capabilities) as string[],
    input_schema: contract.inputSchema,
    output_schema: contract.outputSchema,
    pricing: { model: service.pricing_model, amount: servicePrice(service.price_minor), currency: service.currency },
    estimated_latency_seconds: service.estimated_latency_seconds,
    max_concurrency: service.max_concurrency,
    current_capacity: Math.max(0, service.max_concurrency - service.active_orders),
    execution_mode: service.execution_mode,
    provider_protocol: service.provider_protocol,
    verification_policy: contract.policyInput,
    status: service.status,
    readiness: {
      purchasable: reasons.length === 0,
      available: service.status === 'active' && sellerVisible,
      payment_ready: paymentReady,
      capacity_available: capacityAvailable,
      input_ready: contract.inputReady,
      execution_mode_ready: contract.executionModeReady,
      provider_protocol_ready: contract.protocolReady,
      verification_ready: contract.verificationReady,
      blocking_reasons: reasons,
    },
    created_at: service.created_at,
    updated_at: service.updated_at,
  }
}

export async function changeServiceStatus(id: string, sellerId: string, status: typeof service_definitions.$inferSelect.status) {
  const [updated] = await db.update(service_definitions)
    .set({ status, updated_at: new Date() })
    .where(and(eq(service_definitions.id, id), eq(service_definitions.seller_id, sellerId), sql`${service_definitions.status} != 'archived'`))
    .returning()
  return updated || null
}
