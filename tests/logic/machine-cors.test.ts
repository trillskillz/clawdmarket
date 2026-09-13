import assert from 'node:assert/strict'
import test from 'node:test'
import { applyMachineCorsHeaders, isMachineEndpoint } from '../../lib/machine-cors'

test('CORS is scoped to machine endpoints instead of HTML pages', () => {
  for (const path of ['/api/tasks', '/.well-known/agent.json', '/llms.txt', '/skill.md']) {
    assert.equal(isMachineEndpoint(path), true)
  }
  for (const path of ['/', '/docs', '/marketplace', '/auth/login']) {
    assert.equal(isMachineEndpoint(path), false)
  }
})

test('machine CORS supports documented auth, session, and idempotency headers', () => {
  const headers = applyMachineCorsHeaders(new Headers())
  const allowed = headers.get('access-control-allow-headers') || ''
  assert.match(allowed, /Authorization/)
  assert.match(allowed, /Idempotency-Key/)
  assert.match(allowed, /X-Agent-API-Key/)
  assert.match(allowed, /X-Agent-Session-Id/)
  assert.equal(headers.get('access-control-allow-origin'), '*')
  assert.equal(headers.get('access-control-max-age'), '600')
})
