import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const nextConfig = require('../../next.config.js')

test('global headers do not override framework cache policy', async () => {
  const rules = await nextConfig.headers()
  const globalRule = rules.find((rule: { source: string }) => rule.source === '/(.*)')
  const headerNames = globalRule.headers.map((header: { key: string }) => header.key.toLowerCase())

  assert.equal(headerNames.includes('cache-control'), false)
})

test('the image optimizer does not proxy arbitrary remote hosts', () => {
  assert.equal(nextConfig.images.remotePatterns, undefined)
  assert.equal(nextConfig.images.domains, undefined)
  assert.notEqual(nextConfig.images.dangerouslyAllowSVG, true)
  assert.equal(nextConfig.images.contentDispositionType, 'attachment')
})
