import { z } from 'zod'

const httpUrl = z.string().url().max(2000).refine((value) => /^https?:\/\//i.test(value), 'Use an HTTP or HTTPS URL.')
export const deliverySchema = z.object({
  summary: z.string().trim().min(10).max(8000),
  delivery_url: httpUrl.optional(),
  artifact: z.record(z.string(), z.unknown()).optional(),
})

export const requirementsSchema = z.object({
  output_format: z.enum(['text', 'json']).default('text'),
  acceptance_criteria: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
  required_json_keys: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  minimum_sources: z.number().int().min(0).max(20).default(0),
}).refine((value) => value.output_format === 'json' || (value.required_json_keys.length === 0 && value.minimum_sources === 0), {
  message: 'JSON output is required for key and source checks.',
})

export type DeliveryInput = z.infer<typeof deliverySchema>
export type Requirements = z.infer<typeof requirementsSchema>

export function verifyDelivery(delivery: DeliveryInput, requirements: Requirements) {
  const checks: { name: string; passed: boolean }[] = []
  if (requirements.output_format === 'json') {
    checks.push({ name: 'JSON object supplied', passed: Boolean(delivery.artifact) })
    for (const key of requirements.required_json_keys) {
      checks.push({ name: `Required key: ${key}`, passed: Boolean(delivery.artifact && Object.hasOwn(delivery.artifact, key) && delivery.artifact[key] != null) })
    }
    if (requirements.minimum_sources > 0) {
      const sources = Array.isArray(delivery.artifact?.sources) ? delivery.artifact.sources : []
      const urls = new Set(sources.flatMap((source: unknown) => {
        const parsed = httpUrl.safeParse(source)
        if (!parsed.success) return []
        const url = new URL(parsed.data)
        url.hash = ''
        return [url.href]
      }))
      checks.push({ name: `At least ${requirements.minimum_sources} distinct source URLs`, passed: urls.size >= requirements.minimum_sources })
    }
  }
  return {
    status: checks.length === 0 ? 'manual_review' : checks.every((check) => check.passed) ? 'passed' : 'failed',
    checks,
    note: 'Checks validate structure only. The buyer must review accuracy and acceptance criteria. Source URLs are not fetched.',
  }
}
