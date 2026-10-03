import test from 'node:test'
import assert from 'node:assert/strict'
import { assertionsSchema, sourceEvidencePolicySchema, verifyAssertions, verifySourceEvidence } from '@/lib/structured-verification'
import { evaluateVerification, supportsVerification, verificationPolicySchema } from '@/lib/verification-policy'
import { requirementsSchema } from '@/lib/delivery-validation'

const assertions = assertionsSchema.parse({ version: 1, rules: [
  { id: 'state', field: 'state', op: 'equals', value: 'ready' },
  { id: 'category', field: 'category', op: 'one_of', values: ['code', 'analysis'] },
  { id: 'score', field: 'score', op: 'number_range', min: 0.8, max: 1 },
  { id: 'findings', field: 'findings', op: 'length_range', min: 1, max: 5 },
] })
const sourcePolicy = sourceEvidencePolicySchema.parse({ version: 1, minimum_sources: 2, max_age_days: 7 })
const now = new Date('2026-10-02T12:00:00.000Z')
const sources = [{ id: 'a', url: 'https://example.org/private-a', published_at: '2026-10-01T12:00:00.000Z' },
  { id: 'b', url: 'http://127.0.0.1/private-b', published_at: '2026-09-25T12:00:00.000Z' }]
const artifact = { state: 'ready', category: 'code', score: 0.9, findings: ['private finding'], sources,
  claims: [{ id: 'claim', statement: 'Private statement.', source_ids: ['a', 'b'] }] }

test('bounded assertions reject missing, inherited, wrong-type and out-of-range values without leaking values', () => {
  assert.equal(verifyAssertions(artifact, assertions).status, 'passed')
  for (const value of [undefined, {}, { ...artifact, score: '0.9' }, { ...artifact, score: 1.1 }, { ...artifact, findings: [] }, Object.create(artifact)]) {
    assert.equal(verifyAssertions(value, assertions).status, 'failed')
  }
  const evidence = JSON.stringify(verifyAssertions(artifact, assertions))
  assert.equal(evidence.includes('private finding'), false)
  assert.equal(evidence.includes('ready'), false)
  assert.equal(evidence.includes('policy_sha256'), true)
  for (const rule of [{ id: 'bad', field: 'score', op: 'regex', pattern: '.*' }, { id: 'bad', field: 'score', op: 'number_range' },
    { id: 'bad', field: 'score', op: 'number_range', min: 2, max: 1 }, { id: 'bad', field: 'score', op: 'one_of', values: [1, 1] }]) {
    assert.equal(assertionsSchema.safeParse({ version: 1, rules: [rule] }).success, false)
  }
})

test('declared source recency and claim links are bounded and never imply source or semantic truth', () => {
  const result = verifySourceEvidence(artifact, sourcePolicy, now)
  assert.equal(result.status, 'passed')
  assert.equal(result.evidence.urls_fetched, false)
  assert.equal(result.evidence.provenance_verified, false)
  assert.equal(result.evidence.semantic_verified, false)
  assert.equal(verifySourceEvidence(artifact, sourcePolicy, new Date(now.getTime() + 1)).status, 'failed')
  for (const changed of [
    { sources: [sources[0], { ...sources[1], id: 'a' }] },
    { sources: [sources[0], { ...sources[1], url: `${sources[0].url}#duplicate` }] },
    { sources: [sources[0], { ...sources[1], url: 'file:///private' }] },
    { sources: [sources[0], { ...sources[1], url: 'https://user:secret@example.com' }] },
    { sources: [sources[0], { ...sources[1], published_at: '2026-10-03T00:00:00.000Z' }] },
    { sources: [sources[0], { ...sources[1], published_at: '2026-02-30T00:00:00.000Z' }] },
    { claims: [] }, { claims: [{ ...artifact.claims[0], source_ids: ['missing'] }] },
    { claims: [{ ...artifact.claims[0], source_ids: ['a', 'a'] }] },
    { claims: Array(41).fill(artifact.claims[0]) }, { sources: Array(21).fill(sources[0]) },
  ]) assert.equal(verifySourceEvidence({ ...artifact, ...changed }, sourcePolicy, now).status, 'failed', JSON.stringify(changed))
  for (const secret of ['private-a', 'private-b', 'Private statement', '2026-09-25']) assert.equal(JSON.stringify(result).includes(secret), false)
})

test('policy configurations are strict, versioned, bounded and offered terms must cover requested terms', () => {
  const policy = verificationPolicySchema.parse({ methods: ['buyer_review', 'assertions', 'source_evidence'], assertions, source_evidence: sourcePolicy })
  assert.equal(supportsVerification(policy, policy), true)
  const weaker = verificationPolicySchema.parse({ ...policy, assertions: { version: 1, rules: assertions.rules.slice(0, 1) }, source_evidence: { ...sourcePolicy, max_age_days: 8 } })
  assert.equal(supportsVerification(weaker, policy), false)
  assert.equal(supportsVerification(policy, weaker), true)
  assert.equal(supportsVerification(policy, verificationPolicySchema.parse({ ...policy, assertions: { version: 1, rules: [{ ...assertions.rules[0], value: 'different' }] } })), false)
  for (const changed of [{ assertions: undefined }, { source_evidence: undefined }, { methods: ['buyer_review'], assertions },
    { source_evidence: { ...sourcePolicy, version: 2 } }, { methods: [...policy.methods, 'source_urls'], minimum_sources: 1 },
    { assertions: { version: 1, rules: Array.from({ length: 20 }, (_, i) => ({ id: `rule${i}`, field: 'state', op: 'equals', value: 'x'.repeat(500) })) } }]) {
    assert.equal(verificationPolicySchema.safeParse({ ...policy, ...changed }).success, false)
  }
  const evaluated = evaluateVerification({ policy, outputSchema: {}, delivery: { summary: 'A structured report.', artifact },
    legacyRequirements: requirementsSchema.parse({ output_format: 'json', minimum_sources: 2 }), now })
  assert.equal(evaluated.some((row) => row.status === 'failed'), false)
  assert.equal(evaluated.find((row) => row.method === 'buyer_review')?.status, 'pending')
})

test('explicit acceptance is versioned and route requests cannot select a legacy release policy', () => {
  const legacy = verificationPolicySchema.parse({ methods: ['buyer_review'] })
  const explicit = verificationPolicySchema.parse({ ...legacy, acceptance: { version: 1, mode: 'explicit_buyer' } })
  assert.equal(supportsVerification(legacy, explicit), false)
  assert.equal(supportsVerification(explicit, legacy), true)
  assert.equal(supportsVerification(explicit, explicit), true)
  for (const acceptance of [{ version: 2, mode: 'explicit_buyer' }, { version: 1, mode: 'model_score' }, { version: 1, mode: 'explicit_buyer', auto_release: true }]) {
    assert.equal(verificationPolicySchema.safeParse({ ...legacy, acceptance }).success, false)
  }
})

test('isolated policy requires explicit review and exact approved verifier, suite and adapter', () => {
  const config = { version: 1, adapter: 'javascript_tests_v1', verifier_agent_id: '12345678-1234-4234-8234-123456789abc', suite_sha256: 'a'.repeat(64), max_runtime_seconds: 5 }
  const input = { methods: ['buyer_review', 'isolated_checks'], acceptance: { version: 1, mode: 'explicit_buyer' }, isolated_checks: config }
  const offered = verificationPolicySchema.parse(input)
  assert.equal(supportsVerification(offered, offered), true)
  assert.equal(verificationPolicySchema.safeParse({ ...input, acceptance: undefined }).success, false)
  for (const changed of [{ suite_sha256: 'b'.repeat(64) }, { verifier_agent_id: '87654321-1234-4234-8234-123456789abc' }, { adapter: 'javascript_static_v1' }, { max_runtime_seconds: 1 }]) {
    assert.equal(supportsVerification(offered, verificationPolicySchema.parse({ ...input, isolated_checks: { ...config, ...changed } })), false)
  }
})
