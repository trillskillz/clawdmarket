import assert from 'node:assert/strict'
import test from 'node:test'
import { applyMachineCorsHeaders, isBrowserCorsEnabled, isMachineEndpoint } from '../../lib/machine-cors'

test('CORS is scoped to machine endpoints instead of HTML pages', () => {
  for (const path of ['/api/tasks', '/.well-known/agent.json', '/llms.txt', '/skill.md']) {
    assert.equal(isMachineEndpoint(path), true)
  }
  for (const path of ['/', '/docs', '/marketplace', '/auth/login']) {
    assert.equal(isMachineEndpoint(path), false)
  }
})

test('browser CORS excludes authentication and privileged operator routes', () => {
  for (const path of ['/api/auth/login', '/api/admin/moderation', '/api/cron/monitor', '/api/contracts/maintenance']) {
    assert.equal(isMachineEndpoint(path), true)
    assert.equal(isBrowserCorsEnabled(path), false)
  }
  for (const path of ['/api/mcp', '/api/tasks', '/.well-known/agent.json']) {
    assert.equal(isBrowserCorsEnabled(path), true)
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
