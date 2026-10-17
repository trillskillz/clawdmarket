import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_ONLINE_WINDOW_SECONDS, AGENT_WORKER_LEASE_SECONDS, agentWorkerPresence, getAgentAvailability } from '@/lib/agent-presence'

test('agent availability distinguishes recent, stale, missing, and inactive presence', () => {
  const now = Date.UTC(2026, 8, 15, 12, 0, 0)
  assert.equal(getAgentAvailability('active', null, now), 'unknown')
  assert.equal(getAgentAvailability('active', (now / 1000) - 60, now), 'online')
  assert.equal(getAgentAvailability('active', now - (AGENT_ONLINE_WINDOW_SECONDS * 1000), now), 'online')
  assert.equal(getAgentAvailability('active', now - ((AGENT_ONLINE_WINDOW_SECONDS + 1) * 1000), now), 'offline')
  assert.equal(getAgentAvailability('inactive', now, now), 'inactive')
})

test('worker availability requires an explicit fresh report; API activity, registration and invalid dates never fabricate a lease', () => {
  const now = Date.UTC(2026, 9, 16, 12)
  assert.equal(agentWorkerPresence('active', null, null, now).available, null)
  assert.equal(agentWorkerPresence('active', 'available', now, now).available, true)
  assert.equal(agentWorkerPresence('active', 'busy', now, now).state, 'busy')
  assert.equal(agentWorkerPresence('active', 'busy', now, now).available, false)
  assert.equal(agentWorkerPresence('active', 'stopped', now, now).lease_expires_at, null)
  assert.equal(agentWorkerPresence('active', 'available', now - AGENT_WORKER_LEASE_SECONDS * 1000, now).state, 'offline')
  assert.equal(agentWorkerPresence('inactive', 'available', now, now).state, 'inactive')
  assert.equal(agentWorkerPresence('active', 'available', now + 60_000, now).available, false)
  assert.equal(agentWorkerPresence('active', 'available', 'invalid', now).available, null)
})

test('agent availability accepts database timestamps in seconds, milliseconds, and ISO format', () => {
  const now = Date.UTC(2026, 8, 15, 12, 0, 0)
  assert.equal(getAgentAvailability('active', now / 1000, now), 'online')
  assert.equal(getAgentAvailability('active', now, now), 'online')
  assert.equal(getAgentAvailability('active', new Date(now).toISOString(), now), 'online')
  assert.equal(getAgentAvailability('active', 'not-a-date', now), 'unknown')
})
