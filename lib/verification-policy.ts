import { z } from 'zod'
import type { DeliveryInput, Requirements } from './delivery-validation'

const fieldSchema = z.object({ type: z.enum(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']) }).strict()

/** Deliberately bounded JSON Schema subset: no $ref, remote resolution, or executable keywords. */
export const outputSchemaV1 = z.object({
  type: z.literal('object'),
  properties: z.record(z.string().min(1).max(100), fieldSchema).default({}),
  required: z.array(z.string().min(1).max(100)).max(30).default([]),
  additionalProperties: z.boolean().optional(),
}).strict().superRefine((schema, context) => {
  for (const key of schema.required) if (!Object.hasOwn(schema.properties, key)) {
    context.addIssue({ code: 'custom', path: ['required'], message: `Required property ${key} needs a type declaration` })
  }
})

const method = z.enum(['buyer_review', 'schema', 'source_urls'])
export const verificationPolicySchema = z.object({
  required: z.literal(true).default(true),
  methods: z.array(method).min(1).max(3).default(['buyer_review']),
  minimum_sources: z.number().int().min(1).max(20).optional(),
}).strict().superRefine((policy, context) => {
  if (new Set(policy.methods).size !== policy.methods.length) context.addIssue({ code: 'custom', path: ['methods'], message: 'Verification methods must be unique' })
  if (!policy.methods.includes('buyer_review')) context.addIssue({ code: 'custom', path: ['methods'], message: 'Buyer review is required before release' })
  if (policy.methods.includes('source_urls') !== (policy.minimum_sources !== undefined)) context.addIssue({ code: 'custom', path: ['minimum_sources'], message: 'minimum_sources is required exactly when source_urls is selected' })
})

export type VerificationPolicy = z.output<typeof verificationPolicySchema>
export type VerificationMethod = 'buyer_review' | 'schema' | 'source_urls' | 'structure'
export type VerificationResult = {
  method: VerificationMethod
  verifier: 'clawdmarket-deterministic-v1' | 'buyer'
  version: '1'
  status: 'passed' | 'failed' | 'pending'
  score: number | null
  evidence: Record<string, unknown>
  failure: string | null
}

export function supportsVerification(servicePolicy: VerificationPolicy, requested: VerificationPolicy) {
  return requested.methods.every((method) => servicePolicy.methods.includes(method))
    && (!requested.minimum_sources || (servicePolicy.minimum_sources || 0) >= requested.minimum_sources)
}

function matchesType(value: unknown, type: z.infer<typeof fieldSchema>['type']) {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return typeof value === 'number' && Number.isSafeInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
    case 'array': return Array.isArray(value)
    case 'null': return value === null
  }
}

export function verifyOutputSchema(artifact: Record<string, unknown> | undefined, schemaInput: unknown): VerificationResult {
  const schema = outputSchemaV1.parse(schemaInput)
  const failures: string[] = []
  if (!artifact) failures.push('artifact_required')
  else {
    for (const key of schema.required) if (!Object.hasOwn(artifact, key)) failures.push(`missing:${key}`)
    for (const [key, value] of Object.entries(artifact)) {
      const definition = schema.properties[key]
      if (!definition) {
        if (schema.additionalProperties === false) failures.push(`unexpected:${key}`)
      } else if (!matchesType(value, definition.type)) failures.push(`type:${key}`)
    }
  }
  return {
    method: 'schema', verifier: 'clawdmarket-deterministic-v1', version: '1',
    status: failures.length ? 'failed' : 'passed', score: failures.length ? 0 : 1,
    evidence: { schema_kind: 'bounded-json-schema-v1', checked_properties: Object.keys(schema.properties).length },
    failure: failures.length ? failures.join(',') : null,
  }
}

export function verifySourceList(artifact: Record<string, unknown> | undefined, minimumSources: number): VerificationResult {
  const sources = Array.isArray(artifact?.sources) ? artifact.sources : []
  const canonical = new Set<string>()
  let invalid = 0
  let duplicates = 0
  for (const entry of sources) {
    if (typeof entry !== 'string' || entry.length > 2_000) { invalid += 1; continue }
    try {
      const url = new URL(entry)
      if (!['http:', 'https:'].includes(url.protocol)) { invalid += 1; continue }
      url.hash = ''
      if (canonical.has(url.href)) duplicates += 1
      canonical.add(url.href)
    } catch { invalid += 1 }
  }
  const passed = canonical.size >= minimumSources && invalid === 0 && duplicates === 0
  return {
    method: 'source_urls', verifier: 'clawdmarket-deterministic-v1', version: '1',
    status: passed ? 'passed' : 'failed', score: Math.min(1, canonical.size / minimumSources),
    evidence: { distinct_url_count: canonical.size, minimum_sources: minimumSources, invalid_count: invalid, duplicate_count: duplicates, urls_fetched: false },
    failure: passed ? null : 'source_list_invalid_or_insufficient',
  }
}

export function evaluateVerification(input: { policy: VerificationPolicy; outputSchema: unknown; delivery: DeliveryInput; legacyRequirements?: Requirements }) {
  const results: VerificationResult[] = []
  if (input.legacyRequirements?.output_format === 'json') {
    const requirements = input.legacyRequirements
    const missing = requirements.required_json_keys.filter((key) => !input.delivery.artifact || !Object.hasOwn(input.delivery.artifact, key) || input.delivery.artifact[key] == null)
    const hasArtifact = Boolean(input.delivery.artifact)
    results.push({ method: 'structure', verifier: 'clawdmarket-deterministic-v1', version: '1', status: hasArtifact && !missing.length ? 'passed' : 'failed', score: hasArtifact && !missing.length ? 1 : 0,
      evidence: { required_keys: requirements.required_json_keys, artifact_present: hasArtifact }, failure: !hasArtifact ? 'artifact_required' : missing.length ? 'required_keys_missing' : null })
  }
  if (input.policy.methods.includes('schema')) results.push(verifyOutputSchema(input.delivery.artifact, input.outputSchema))
  if (input.policy.methods.includes('source_urls')) results.push(verifySourceList(input.delivery.artifact, input.policy.minimum_sources!))
  if (input.legacyRequirements?.minimum_sources && !input.policy.methods.includes('source_urls')) results.push(verifySourceList(input.delivery.artifact, input.legacyRequirements.minimum_sources))
  results.push({ method: 'buyer_review', verifier: 'buyer', version: '1', status: 'pending', score: null, evidence: {}, failure: null })
  return results
}
