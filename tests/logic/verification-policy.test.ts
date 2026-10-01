import test from 'node:test'
import assert from 'node:assert/strict'
import { checkServiceInput, outputSchemaV1, verificationPolicySchema, verifyOutputSchema, verifySourceList, supportsVerification } from '@/lib/verification-policy'
import { serviceDefinitionInput } from '@/lib/service-definitions'

const outputSchema = { type: 'object', properties: { findings: { type: 'array' }, score: { type: 'number' } }, required: ['findings'], additionalProperties: false }

test('bounded schema verification checks required keys, types, and extra properties', () => {
  assert.equal(outputSchemaV1.safeParse(outputSchema).success, true)
  assert.equal(verifyOutputSchema({ findings: ['one'], score: 0.9 }, outputSchema).status, 'passed')
  assert.equal(verifyOutputSchema({ score: 0.9 }, outputSchema).failure, 'missing:findings')
  assert.equal(verifyOutputSchema({ findings: 'wrong' }, outputSchema).failure, 'type:findings')
  assert.equal(verifyOutputSchema({ findings: [], extra: true }, outputSchema).failure, 'unexpected:extra')
  assert.equal(outputSchemaV1.safeParse({ ...outputSchema, $ref: 'https://example.invalid/schema' }).success, false)
})

test('service input accepts legacy empty schemas and enforces bounded declared fields', () => {
  const schema = { type: 'object', properties: { revision: { type: 'string' } }, required: ['revision'], additionalProperties: false }
  assert.equal(checkServiceInput({ arbitrary: true }, {}).status, 'valid')
  assert.equal(checkServiceInput({ revision: 'abc123' }, schema).status, 'valid')
  assert.equal(checkServiceInput({}, schema).failure, 'missing:revision')
  assert.equal(checkServiceInput({ revision: 123 }, schema).failure, 'type:revision')
  assert.equal(checkServiceInput({ revision: 'abc123', secret: true }, schema).failure, 'unexpected:secret')
  assert.equal(checkServiceInput({}, { ...schema, $ref: 'https://example.invalid/schema' }).status, 'unsupported')
})

test('source-list checks reject duplicate and malformed URLs without fetching content', () => {
  assert.equal(verifySourceList({ sources: ['https://example.com/a', 'https://example.org/b'] }, 2).status, 'passed')
  const duplicate = verifySourceList({ sources: ['https://example.com/a#one', 'https://example.com/a#two'] }, 2)
  assert.equal(duplicate.status, 'failed')
  assert.equal(duplicate.evidence.duplicate_count, 1)
  assert.equal(duplicate.evidence.urls_fetched, false)
  assert.equal(verifySourceList({ sources: ['file:///etc/passwd'] }, 1).status, 'failed')
})

test('verification policy requires buyer review and rejects unsupported or unsafe methods', () => {
  assert.equal(verificationPolicySchema.safeParse({ required: true, methods: ['schema'] }).success, false)
  assert.equal(verificationPolicySchema.safeParse({ required: true, methods: ['buyer_review', 'unit_tests'] }).success, false)
  assert.equal(verificationPolicySchema.safeParse({ required: true, methods: ['buyer_review', 'evaluator_model'] }).success, false)
  assert.equal(verificationPolicySchema.safeParse({ required: true, methods: ['buyer_review', 'source_urls'] }).success, false)
  const offered = verificationPolicySchema.parse({ required: true, methods: ['buyer_review', 'source_urls'], minimum_sources: 3 })
  const requested = verificationPolicySchema.parse({ required: true, methods: ['buyer_review', 'source_urls'], minimum_sources: 2 })
  assert.equal(supportsVerification(offered, requested), true)
  assert.equal(supportsVerification(requested, offered), false)
})

test('service creation requires a supported output schema when schema verification is selected', () => {
  const base = { title: 'Verification fixture', description: 'Verify structured service output before buyer review.', capabilities: ['code-review'],
    pricing: { model: 'fixed', amount: '1.00', currency: 'USD' }, status: 'active' as const,
    verification_policy: { required: true as const, methods: ['buyer_review', 'schema'] } }
  assert.equal(serviceDefinitionInput.safeParse({ ...base, output_schema: outputSchema }).success, true)
  assert.equal(serviceDefinitionInput.safeParse({ ...base, output_schema: { $ref: 'https://example.invalid/schema' } }).success, false)
  assert.equal(serviceDefinitionInput.safeParse({ ...base, input_schema: { $ref: 'https://example.invalid/schema' } }).success, false)
})
