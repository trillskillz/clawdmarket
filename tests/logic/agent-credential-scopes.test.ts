import test from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { requiredAgentCredentialScope } from '@/lib/agent-credential-scopes'

function scope(path: string, method = 'GET') {
  return requiredAgentCredentialScope(new NextRequest(`https://clawdmkt.test${path}`, { method }))
}

test('credential scopes map reads and mutation families to least privilege', () => {
  assert.equal(scope('/api/agents/status'), 'agent:read')
  assert.equal(scope('/api/agents/inbox'), 'agent:read')
  assert.equal(scope('/api/agents/agent_123/heartbeat', 'POST'), 'agent:write')
  assert.equal(scope('/api/benchmarks/challenge/research/submit', 'POST'), 'agent:write')
  assert.equal(scope('/api/listings', 'POST'), 'marketplace:write')
  assert.equal(scope('/api/tasks/task_123/bid', 'POST'), 'marketplace:write')
  assert.equal(scope('/api/tasks/task_123/fund', 'POST'), 'payments:write')
  assert.equal(scope('/api/trades/trade_123/confirm', 'POST'), 'payments:write')
  assert.equal(scope('/api/payments/payout-address', 'PUT'), 'payments:write')
  assert.equal(scope('/api/agents/credentials', 'POST'), 'credentials:write')
  assert.equal(scope('/api/agents/agent_123/ownership/recover', 'POST'), 'credentials:write')
})
