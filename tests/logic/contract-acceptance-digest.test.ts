import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('acceptance digests compare in constant time and reject malformed stored values', async () => {
  const { sameDigest } = await import('@/lib/contract-exact-acceptance')
  const digest = 'a'.repeat(64)
  assert.equal(sameDigest(digest, digest), true)
  assert.equal(sameDigest('b'.repeat(64), digest), false)
  for (const malformed of [null, undefined, 1, '', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65)]) assert.equal(sameDigest(malformed, digest), false)
  const source = readFileSync('lib/contract-exact-acceptance.ts', 'utf8')
  assert.equal(/request_hash\s*!==/.test(source), false, 'no direct string comparison of stored digests remains')
})
