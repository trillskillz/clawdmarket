import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { VerificationResult } from './verification-policy'

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const primitive = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()])
const base = { id: identifier, field: z.string().min(1).max(100) }
const range = (value: { min?: number; max?: number }) => (value.min !== undefined || value.max !== undefined)
  && (value.min === undefined || value.max === undefined || value.min <= value.max)
export const assertionRuleSchema = z.discriminatedUnion('op', [
  z.object({ ...base, op: z.literal('equals'), value: primitive }).strict(),
  z.object({ ...base, op: z.literal('one_of'), values: z.array(primitive).min(1).max(20).refine((values) => new Set(values.map((value) => JSON.stringify(value))).size === values.length, 'Values must be distinct') }).strict(),
  z.object({ ...base, op: z.literal('number_range'), min: z.number().finite().optional(), max: z.number().finite().optional() }).strict().refine(range, 'An ordered min or max is required'),
  z.object({ ...base, op: z.literal('length_range'), min: z.number().int().min(0).max(10_000).optional(), max: z.number().int().min(0).max(10_000).optional() }).strict().refine(range, 'An ordered min or max is required'),
])
export const assertionsSchema = z.object({ version: z.literal(1), rules: z.array(assertionRuleSchema).min(1).max(20)
  .refine((rules) => new Set(rules.map((rule) => rule.id)).size === rules.length, 'Rule IDs must be distinct') }).strict()
export const sourceEvidencePolicySchema = z.object({ version: z.literal(1), minimum_sources: z.number().int().min(1).max(20),
  max_age_days: z.number().int().min(1).max(3650), require_claim_links: z.boolean().default(true) }).strict()

export type Assertions = z.output<typeof assertionsSchema>
export type SourceEvidencePolicy = z.output<typeof sourceEvidencePolicySchema>

/** Canonical bounded contract fingerprint; private output is never hashed into evidence here. */
export function canonicalContract(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalContract).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalContract(entry)}`).join(',')}}`
  return JSON.stringify(value)
}
function result(method: 'assertions' | 'source_evidence', contract: unknown, passed: boolean, evidence: Record<string, unknown>): VerificationResult {
  return { method, verifier: 'clawdmarket-deterministic-v1', version: '1', status: passed ? 'passed' : 'failed', score: passed ? 1 : 0,
    evidence: { policy_sha256: createHash('sha256').update(canonicalContract(contract)).digest('hex'), ...evidence }, failure: passed ? null : `${method}_validation_failed` }
}

export function verifyAssertions(artifact: Record<string, unknown> | undefined, contract: Assertions) {
  const rules = contract.rules.map((rule) => {
    const present = Boolean(artifact && Object.hasOwn(artifact, rule.field))
    const value = present ? artifact![rule.field] : undefined
    let passed = false
    switch (rule.op) {
      case 'equals': passed = present && value === rule.value; break
      case 'one_of': passed = present && rule.values.some((expected) => value === expected); break
      case 'number_range': passed = typeof value === 'number' && Number.isFinite(value) && (rule.min === undefined || value >= rule.min) && (rule.max === undefined || value <= rule.max); break
      case 'length_range': {
        const length = typeof value === 'string' || Array.isArray(value) ? value.length : null
        passed = length !== null && (rule.min === undefined || length >= rule.min) && (rule.max === undefined || length <= rule.max)
        break
      }
    }
    // Only public rule identity and the result, never actual or expected private values.
    return { id: rule.id, op: rule.op, status: passed ? 'passed' : 'failed' }
  })
  return result('assertions', contract, rules.every((rule) => rule.status === 'passed'), { contract_version: 1, rules, semantic_verified: false, code_executed: false })
}

const utcTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine((value) => {
  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.toISOString() === value
}, 'Use a real UTC ISO timestamp including milliseconds')
const sourceSchema = z.object({ id: identifier, url: z.string().min(1).max(2000), published_at: utcTimestamp }).strict()
const claimSchema = z.object({ id: identifier, statement: z.string().trim().min(1).max(2000), source_ids: z.array(identifier).min(1).max(20) }).strict()

export function verifySourceEvidence(artifact: Record<string, unknown> | undefined, contract: SourceEvidencePolicy, now: Date) {
  const parsedSources = z.array(sourceSchema).min(1).max(20).safeParse(artifact?.sources)
  const parsedClaims = z.array(claimSchema).max(40).safeParse(artifact?.claims ?? [])
  const urls = new Set<string>(), ids = new Set<string>(), claimIds = new Set<string>()
  let invalid = parsedSources.success ? 0 : 1, duplicates = 0, stale = 0, future = 0, invalidLinks = 0, links = 0
  if (parsedSources.success) for (const source of parsedSources.data) {
    if (ids.has(source.id)) duplicates++
    ids.add(source.id)
    try {
      const url = new URL(source.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) { invalid++; continue }
      url.hash = ''
      if (urls.has(url.href)) duplicates++
      urls.add(url.href)
    } catch { invalid++ }
    const age = now.getTime() - new Date(source.published_at).getTime()
    if (age < 0) future++
    if (age > contract.max_age_days * 86_400_000) stale++
  }
  if (!parsedClaims.success) invalidLinks++
  else for (const claim of parsedClaims.data) {
    if (claimIds.has(claim.id) || new Set(claim.source_ids).size !== claim.source_ids.length) invalidLinks++
    claimIds.add(claim.id)
    for (const id of claim.source_ids) { links++; if (!ids.has(id)) invalidLinks++ }
  }
  const claims = parsedClaims.success ? parsedClaims.data.length : 0
  const passed = Number.isFinite(now.getTime()) && urls.size >= contract.minimum_sources && !invalid && !duplicates && !stale && !future && !invalidLinks && (!contract.require_claim_links || claims > 0)
  return result('source_evidence', contract, passed, { contract_version: 1, checked_at: now.toISOString(), minimum_sources: contract.minimum_sources,
    max_age_days: contract.max_age_days, require_claim_links: contract.require_claim_links, distinct_url_count: urls.size, claim_count: claims,
    link_count: links, invalid_count: invalid, duplicate_count: duplicates, stale_count: stale, future_count: future, invalid_link_count: invalidLinks,
    dates_provider_declared: true, urls_fetched: false, provenance_verified: false, semantic_verified: false })
}

/** Preserve older workspace source-count requirements when a structured contract is selected. */
export function sourceEvidenceUrls(artifact: Record<string, unknown> | undefined) {
  return artifact ? { ...artifact, sources: Array.isArray(artifact.sources) ? artifact.sources.map((source) => source && typeof source === 'object' ? source.url : undefined) : [] } : undefined
}
