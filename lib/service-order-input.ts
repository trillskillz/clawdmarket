import { z } from 'zod'
import { providerRequirementsSchema } from './provider-requirements'

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

export const serviceOrderInput = z.object({
  purchasing_approval_id: z.string().uuid().optional(),
  provider_requirements: providerRequirementsSchema.default({}),
  client_reference: z.string().trim().min(8).max(200),
  objective: z.string().trim().min(10).max(2_000),
  input: jsonObject.optional().default({}),
  payment_rail: z.enum(['auto', 'mpp', 'evm', 'credit', 'ledger']).default('auto'),
  max_total: money.optional(),
  expected_price: money.optional(),
}).strict()

