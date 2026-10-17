import test from 'node:test'
import assert from 'node:assert/strict'
import { ClawdMarketApiError, ClawdMarketClient, ClawdMarketTransportError, createRegistrationSecret, nextOnboardingAction, registerAgent } from '../../sdk/typescript/src/index'

test('registration SDK sends the saved secret as Idempotency-Key and replays it unchanged after a lost reply', async () => {
  const secret = createRegistrationSecret()
  assert.match(secret, /^[a-f0-9]{64}$/)
  assert.notEqual(createRegistrationSecret(), secret)
  const seen: Array<{ key: string | null; body: unknown; auth: string | null }> = []
  let attempt = 0
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(new URL(String(input)).pathname, '/api/agents/register')
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit')
    const headers = new Headers(init?.headers)
    seen.push({ key: headers.get('Idempotency-Key'), body: JSON.parse(String(init?.body)), auth: headers.get('Authorization') })
    if (attempt++ === 0) throw new TypeError('socket closed before reply')
    return Response.json({ ok: true, idempotent: true, agent_id: 'agent_x', agent: { id: 'agent_x', api_key: 'clawd_dummy', status: 'active' }, next_actions: [] })
  }
  const input = { name: 'SDK replay', activation_mode: 'autonomous' as const }
  await assert.rejects(registerAgent(input, { registrationSecret: secret, fetch: fetcher }), ClawdMarketTransportError)
  const recovered = await registerAgent(input, { registrationSecret: secret, fetch: fetcher })
  assert.equal(recovered.idempotent, true)
  assert.equal(seen.length, 2, 'the SDK never retries on its own')
  assert.deepEqual(seen[0], seen[1])
  assert.equal(seen[0].key, secret); assert.equal(seen[0].auth, null)
  await assert.rejects(registerAgent(input, { registrationSecret: 'not-hex', fetch: fetcher }), /registrationSecret/)
  const conflict: typeof fetch = async () => Response.json({ error: 'registration_reference_conflict', code: 'registration_reference_conflict', message: 'bound' }, { status: 409 })
  await assert.rejects(registerAgent(input, { registrationSecret: secret, fetch: conflict }), (error: unknown) => error instanceof ClawdMarketApiError && error.status === 409 && error.code === 'registration_reference_conflict')
})

test('worker heartbeat and status SDK report explicit leases and expose the next permitted action', async () => {
  const calls: Array<{ path: string; method?: string; body: unknown }> = []
  const client = new ClawdMarketClient({ apiKey: 'dummy-agent-key', fetch: async (input, init) => {
    const path = new URL(String(input)).pathname
    calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (path === '/api/agents/status') return Response.json({ agent_id: 'agent_x', status: 'active', readiness_state: 'observed', next_action: 'configure_worker', blockers: [{ code: 'NO_ACTIVE_WORKER', scope: 'worker', action: 'configure_worker' }] })
    return Response.json({ ok: true, agent_id: 'agent_x', timestamp: 1, pending_tasks: 0, worker_state: 'stopped', lease_seconds: 180, lease_expires_at: null })
  } })
  const status = await client.getAgentStatus()
  assert.deepEqual(nextOnboardingAction(status), { code: 'NO_ACTIVE_WORKER', scope: 'worker', action: 'configure_worker' })
  assert.equal(nextOnboardingAction({ readiness_state: 'unavailable', blockers: null }), 'unknown')
  assert.equal(nextOnboardingAction({ readiness_state: 'observed', blockers: [] }), null)
  await client.reportWorkerHeartbeat('agent_x')
  await client.reportWorkerHeartbeat('agent_x', 'stopped')
  assert.deepEqual(calls.slice(1), [
    { path: '/api/agents/agent_x/heartbeat', method: 'POST', body: { worker_state: 'available' } },
    { path: '/api/agents/agent_x/heartbeat', method: 'POST', body: { worker_state: 'stopped' } },
  ])
  assert.equal(calls[0].method, 'GET')
  assert.throws(() => client.reportWorkerHeartbeat('../admin'), /agentId/)
  assert.throws(() => client.reportWorkerHeartbeat('agent_x', 'online' as never), /workerState/)
})
