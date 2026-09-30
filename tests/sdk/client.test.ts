import test from 'node:test'
import assert from 'node:assert/strict'
import { ClawdMarketApiError, ClawdMarketClient, ClawdMarketTransportError } from '../../sdk/typescript/src/index'

const routeId = '00000000-0000-4000-8000-000000000001'

test('client plans and reserves one unpaid route without issuing a funding request', async () => {
  const requests: Array<{ path: string; method: string; auth: string | null; body: unknown }> = []
  const responses = [
    { route: { id: routeId, state: 'planned' }, idempotent: false, planning: { funds_moved: false } },
    { route: { id: routeId, state: 'awaiting_funding' }, order: { id: 'order-1' }, checkout: { rail: 'evm' }, funds_state: 'payment_unknown' },
    { route: { id: routeId, state: 'awaiting_funding' }, attempts: [], payment_exposure: { state: 'checkout_open', automatic_retry_allowed: false } },
    { route: { id: routeId, state: 'cancelled' }, funds_state: 'payment_unknown' },
  ]
  const client = new ClawdMarketClient({ apiKey: 'secret-agent-key', baseUrl: 'http://localhost:3000', fetch: async (input, init) => {
    const url = new URL(String(input))
    const headers = new Headers(init?.headers)
    requests.push({ path: url.pathname, method: init?.method || 'GET', auth: headers.get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : null })
    assert.equal(init?.redirect, 'error')
    return Response.json(responses.shift(), { status: requests.length < 3 ? 201 : 200 })
  } })
  const request = { client_reference: 'stable-route-reference', objective: 'Review this API for authentication issues',
    required_capabilities: ['security-analysis'], max_budget: { amount: '10.00', currency: 'USD' as const } }
  const planned = await client.route(request)
  assert.equal(planned.route.id, routeId)
  const executed = await client.executeRoute(routeId)
  assert.equal(executed.checkout?.rail, 'evm')
  assert.equal(executed.funds_state, 'payment_unknown')
  assert.equal((await client.getRoute(routeId)).payment_exposure?.state, 'checkout_open')
  assert.equal((await client.cancelRoute(routeId)).route.state, 'cancelled')
  assert.deepEqual(requests.map((item) => `${item.method} ${item.path}`), [
    'POST /api/routes/plan', `POST /api/routes/${routeId}/execute`, `GET /api/routes/${routeId}`, `DELETE /api/routes/${routeId}`,
  ])
  assert.ok(requests.every((item) => item.auth === 'Bearer secret-agent-key'))
  assert.equal((requests[0].body as { client_reference: string }).client_reference, request.client_reference)
})

test('typed API and transport errors preserve retry and financial uncertainty', async () => {
  const api = new ClawdMarketClient({ apiKey: 'agent-key', fetch: async () => Response.json({
    success: false, error_code: 'ROUTE_FUNDS_ALREADY_COMMITTED', message: 'Funding began', retryable: false, state: 'see_trade', details: { trade_id: 'trade-1' },
  }, { status: 409 }) })
  await assert.rejects(api.cancelRoute(routeId), (error: unknown) => {
    assert.ok(error instanceof ClawdMarketApiError)
    assert.equal(error.status, 409)
    assert.equal(error.code, 'ROUTE_FUNDS_ALREADY_COMMITTED')
    assert.equal(error.fundsState, 'see_trade')
    assert.equal(error.retryable, false)
    return true
  })
  const broken = new ClawdMarketClient({ apiKey: 'agent-key', fetch: async () => { throw new Error('network timeout') } })
  await assert.rejects(broken.executeRoute(routeId), (error: unknown) => {
    assert.ok(error instanceof ClawdMarketTransportError)
    assert.equal(error.fundsState, 'unknown')
    assert.equal(error.retryable, true)
    return true
  })
})

test('polling observes route status without creating another order', async () => {
  const seen: string[] = []
  const states = ['funded', 'completed']
  const client = new ClawdMarketClient({ apiKey: 'agent-key', fetch: async (input, init) => {
    seen.push(`${init?.method} ${new URL(String(input)).pathname}`)
    return Response.json({ route: { id: routeId, state: states.shift() }, attempts: [], payment_exposure: null })
  } })
  const result = await client.waitForRoute(routeId, { pollIntervalMs: 1, timeoutMs: 1_000 })
  assert.equal(result.route.state, 'completed')
  assert.deepEqual(seen, [`GET /api/routes/${routeId}`, `GET /api/routes/${routeId}`])
})

test('client requires a secure origin and a nonempty key', () => {
  assert.throws(() => new ClawdMarketClient({ apiKey: 'x', baseUrl: 'http://example.com' }), /HTTPS origin/)
  assert.throws(() => new ClawdMarketClient({ apiKey: 'x', baseUrl: 'https://user:pass@example.com' }), /HTTPS origin/)
  assert.throws(() => new ClawdMarketClient({ apiKey: ' ' }), /apiKey is required/)
  const client = new ClawdMarketClient({ apiKey: 'x', fetch: async () => { throw new Error('should not fetch') } })
  assert.throws(() => client.getRoute('../other'), /route UUID/)
})
