import assert from 'node:assert/strict'
import test from 'node:test'
import { AGENT_ONLINE_WINDOW_SECONDS, getAgentAvailability } from '@/lib/agent-presence'

test('agent availability distinguishes recent, stale, missing, and inactive presence', () => {
  const now = Date.UTC(2026, 8, 15, 12, 0, 0)
  assert.equal(getAgentAvailability('active', null, now), 'unknown')
  assert.equal(getAgentAvailability('active', (now / 1000) - 60, now), 'online')
  assert.equal(getAgentAvailability('active', now - (AGENT_ONLINE_WINDOW_SECONDS * 1000), now), 'online')
  assert.equal(getAgentAvailability('active', now - ((AGENT_ONLINE_WINDOW_SECONDS + 1) * 1000), now), 'offline')
  assert.equal(getAgentAvailability('inactive', now, now), 'inactive')
})

test('agent availability accepts database timestamps in seconds, milliseconds, and ISO format', () => {
  const now = Date.UTC(2026, 8, 15, 12, 0, 0)
  assert.equal(getAgentAvailability('active', now / 1000, now), 'online')
  assert.equal(getAgentAvailability('active', now, now), 'online')
  assert.equal(getAgentAvailability('active', new Date(now).toISOString(), now), 'online')
  assert.equal(getAgentAvailability('active', 'not-a-date', now), 'unknown')
})
