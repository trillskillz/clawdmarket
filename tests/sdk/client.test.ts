import test from 'node:test'
import assert from 'node:assert/strict'
import { ClawdMarketApiError, ClawdMarketClient, ClawdMarketTransportError } from '../../sdk/typescript/src/index'

const routeId = '00000000-0000-4000-8000-000000000001'

test('buyer payment claim SDK authenticates one canonical claim without signing or broadcasting', async () => {
  const body = { intent_id: routeId, mandate_id: routeId, serialized_transaction: '0xaabb', payer_signature: `0x${'00'.repeat(65)}` }
  const client = new ClawdMarketClient({ apiKey: 'dummy-payments-key', fetch: async (input, init) => {
    assert.equal(new URL(String(input)).pathname, `/api/trades/${routeId}/fund/evm/claim`)
    assert.equal(init?.method, 'POST'); assert.equal(init?.redirect, 'error')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer dummy-payments-key')
    assert.deepEqual(JSON.parse(String(init?.body)), body)
    return Response.json({ claim: { tx_hash: 'dummy-hash' }, send_allowed: false, state: 'recover_existing_payment', idempotent: true })
  } })
  assert.equal((await client.claimBuyerEvmPayment(routeId, body)).send_allowed, false)
  assert.throws(() => client.claimBuyerEvmPayment('../another', body), /trade ID must be a UUID/)
})

test('MPP SDK reconciles the exact known hash with buyer authentication and never requests another payment', async () => {
  const proof = { tx_hash: `0x${'aa'.repeat(32)}`, payer_address: `0x${'11'.repeat(20)}` }, calls: string[] = []
  const client = new ClawdMarketClient({ apiKey: 'dummy-mpp-buyer', fetch: async (input, init) => {
    calls.push(new URL(String(input)).pathname)
    assert.equal(init?.method, 'POST'); assert.deepEqual(JSON.parse(String(init?.body)), proof)
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer dummy-mpp-buyer')
    assert.equal(new Headers(init?.headers).get('Payment-Authorization'), null)
    return Response.json({ ok: true, trade: { id: routeId, status: 'escrow_held' }, receipt: { payment_reference: proof.tx_hash } })
  } })
  assert.equal((await client.verifyBuyerMppFunding(routeId, proof)).receipt?.payment_reference, proof.tx_hash)
  assert.deepEqual(calls, [`/api/trades/${routeId}/fund/mpp`])
  assert.throws(() => client.verifyBuyerMppFunding('../another', proof), /trade ID must be a UUID/)
})

test('buyer operation SDK preserves the same recovery reference and proof on canonical funding paths', async () => {
  const calls: { path: string; method: string; body: unknown }[] = []
  const client = new ClawdMarketClient({ apiKey: 'dummy-buyer-key', fetch: async (input, init) => {
    calls.push({ path: new URL(String(input)).pathname, method: String(init?.method), body: init?.body ? JSON.parse(String(init.body)) : null })
    return Response.json({ intent: { id: routeId }, claim_required: true, created: false, ok: true })
  } })
  const intent = { buyer_operation_id: routeId, chain_id: 8453, token_address: `0x${'44'.repeat(20)}`, payer_address: `0x${'55'.repeat(20)}` }
  const proof = { intent_id: routeId, chain_id: 8453, token_address: intent.token_address, payer_address: intent.payer_address, tx_hash: `0x${'aa'.repeat(32)}` }
  assert.equal((await client.createBuyerEvmPaymentIntent(routeId, intent)).claim_required, true)
  await client.getBuyerEvmPaymentIntent(routeId); await client.verifyBuyerEvmFunding(routeId, proof)
  assert.deepEqual(calls, [{ method: 'POST', path: `/api/trades/${routeId}/fund/evm/intent`, body: intent },
    { method: 'GET', path: `/api/trades/${routeId}/fund/evm/intent`, body: null }, { method: 'POST', path: `/api/trades/${routeId}/fund/evm`, body: proof }])
})

test('client uses canonical mandate paths and keeps authorization separate from reservation', async () => {
  const calls: Array<{ path: string; method: string; body: unknown }> = []
  const client = new ClawdMarketClient({ apiKey: 'dummy-owner-account-token', baseUrl: 'http://localhost', fetch: async (input, init) => {
    calls.push({ path: new URL(String(input)).pathname, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null })
    assert.equal(init?.redirect, 'error')
    return Response.json({ mandate: { id: routeId }, route: { id: routeId }, funding_step: null })
  } })
  const input = { version: 1 as const, client_reference: 'fixed-mandate-reference', max_aggregate: '1.00', max_per_execution: '1.00', max_retry_budget: '0.00', max_attempts: 1,
    approved_providers: ['approved-seller'], max_latency_seconds: 30, private_data: 'selected_provider_only' as const, expires_at: '2027-01-01T00:00:00.000Z',
    payment: { rail: 'evm' as const, chain_id: 8453, token_address: `0x${'44'.repeat(20)}`, payer_address: `0x${'11'.repeat(20)}`, treasury_address: `0x${'99'.repeat(20)}`,
      minimum_token_reserve_units: '1000000', minimum_native_reserve_wei: '100000', max_gas_cost_wei: '20000' } }
  await client.createRouteMandate(routeId, input)
  await client.getRouteMandate(routeId)
  await client.executeAuthorizedRoute(routeId, routeId)
  await client.revokeRouteMandate(routeId)
  assert.deepEqual(calls, [{ path: `/api/routes/${routeId}/mandate`, method: 'POST', body: input }, { path: `/api/routes/${routeId}/mandate`, method: 'GET', body: null },
    { path: `/api/routes/${routeId}/execute`, method: 'POST', body: { mandate_id: routeId } }, { path: `/api/routes/${routeId}/mandate`, method: 'DELETE', body: null }])
})

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

test('SDK verifier job operations keep approved suite and report on authenticated canonical paths', async () => {
  const seen: { method: string; path: string; body: unknown }[] = []
  const client = new ClawdMarketClient({ apiKey: 'verifier-test-key', fetch: async (input, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer verifier-test-key')
    seen.push({ method: String(init?.method), path: new URL(String(input)).pathname, body: init?.body ? JSON.parse(String(init.body)) : null })
    return Response.json({ job: { id: routeId }, idempotent: false })
  } })
  const input = { client_reference: 'suite-reference', artifact_id: routeId, test_suite: { version: 1 as const, cases: [{ id: 'echo', args: [1], expected: 1 }] } }
  await client.createVerificationJob(routeId, input)
  await client.getVerificationJob(routeId)
  await client.cancelVerificationJob(routeId)
  assert.deepEqual(seen.map((row) => `${row.method} ${row.path}`), [`POST /api/trades/${routeId}/verification-jobs`, `GET /api/verification-jobs/${routeId}`, `DELETE /api/verification-jobs/${routeId}`])
  assert.deepEqual(seen[0].body, input)
  assert.throws(() => client.getVerificationJob('../another'), /job ID must be a UUID/)
})

test('private artifact SDK authenticates relative downloads and independently verifies hash and bounded size', async () => {
  const { createHash } = await import('node:crypto')
  const content = 'Private SDK artifact bytes'
  const artifact = { id: routeId, trade_id: routeId, order_id: null, route_id: null, delivery_id: null,
    uploader_id: 'seller', name: 'result.txt', media_type: 'text/plain', size_bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'),
    provenance: { kind: 'provider_declared' as const, recorded_by: 'seller', verified: false as const }, created_at: '', retention_expires_at: '', retention_hold: true, purged_at: null,
    download_path: 'https://attacker.invalid/do-not-follow' }
  const seen: string[] = []
  let corrupt = false
  const client = new ClawdMarketClient({ apiKey: 'private-key', baseUrl: 'http://localhost:3000', fetch: async (input, init) => {
    const url = new URL(String(input))
    seen.push(`${init?.method} ${url.pathname}`)
    assert.equal(url.origin, 'http://localhost:3000')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer private-key')
    assert.equal(init?.redirect, 'error')
    if (url.pathname.endsWith(`/${routeId}`)) return new Response(corrupt ? 'x'.repeat(content.length) : content, { headers: { 'Content-Length': String(artifact.size_bytes), 'X-Artifact-SHA256': artifact.sha256 } })
    if (init?.method === 'POST') return Response.json({ artifact, idempotent: false }, { status: 201 })
    return Response.json({ artifacts: [artifact], limits: {} })
  } })
  await client.uploadArtifact(routeId, { client_reference: 'sdk-artifact', name: artifact.name, media_type: 'text/plain', content_base64: Buffer.from(content).toString('base64'), sha256: artifact.sha256 })
  assert.equal((await client.listArtifacts(routeId)).artifacts.length, 1)
  assert.equal(Buffer.from(await client.downloadArtifact(artifact)).toString(), content)
  corrupt = true
  await assert.rejects(client.downloadArtifact(artifact), /integrity check failed/)
  assert.equal(seen.every((value) => value.includes('/artifacts')), true)
})

test('Tempo intent and exact claim SDK preserve the original operation on canonical private paths', async () => {
  const calls: { path: string; method: string; body: unknown }[] = []
  const client = new ClawdMarketClient({ apiKey: 'dummy-tempo-key', fetch: async (input, init) => {
    calls.push({ path: new URL(String(input)).pathname, method: String(init?.method), body: init?.body ? JSON.parse(String(init.body)) : null })
    assert.equal(init?.redirect, 'error'); assert.equal(new Headers(init?.headers).get('Payment-Authorization'), null)
    return Response.json({ claim_required: true, created: false, send_allowed: false })
  } })
  const operation = { buyer_operation_id: routeId }, claim = { ...operation, intent_id: routeId, mandate_id: routeId, serialized_transaction: '0x76aabb' }
  assert.equal((await client.createBuyerMppPaymentIntent(routeId, operation)).claim_required, true)
  await client.getBuyerMppPaymentIntent(routeId); assert.equal((await client.claimBuyerMppPayment(routeId, claim)).send_allowed, false)
  assert.deepEqual(calls, [{ path: `/api/trades/${routeId}/fund/mpp/intent`, method: 'POST', body: operation },
    { path: `/api/trades/${routeId}/fund/mpp/intent`, method: 'GET', body: null }, { path: `/api/trades/${routeId}/fund/mpp/claim`, method: 'POST', body: claim }])
  assert.throws(() => client.createBuyerMppPaymentIntent('../other', operation), /trade ID must be a UUID/)
  assert.throws(() => client.getBuyerMppPaymentIntent('../other'), /trade ID must be a UUID/)
  assert.throws(() => client.claimBuyerMppPayment('../other', claim), /trade ID must be a UUID/)
})

test('SDK lifecycle observation, hash-bound acceptance and private result share canonical owned route paths', async () => {
  const calls: { path: string; method: string; body: unknown }[] = []
  const client = new ClawdMarketClient({ apiKey: 'dummy-route-payments-key', fetch: async (input, init) => {
    calls.push({ path: new URL(String(input)).pathname, method: String(init?.method), body: init?.body ? JSON.parse(String(init.body)) : null })
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer dummy-route-payments-key')
    assert.equal(init?.redirect, 'error'); return Response.json({ phase: 'awaiting_buyer' })
  } })
  await client.inspectRouteLifecycle(routeId); await client.advanceRoute(routeId, { version: 1, action: 'observe' })
  const decision = { version: 1 as const, action: 'accept' as const, content_hash: 'a'.repeat(64) }
  await client.advanceRoute(routeId, decision); await client.getRouteResult(routeId)
  assert.deepEqual(calls, [{ path: `/api/routes/${routeId}/advance`, method: 'GET', body: null },
    { path: `/api/routes/${routeId}/advance`, method: 'POST', body: { version: 1, action: 'observe' } },
    { path: `/api/routes/${routeId}/advance`, method: 'POST', body: decision }, { path: `/api/routes/${routeId}/result`, method: 'GET', body: null }])
  assert.throws(() => client.advanceRoute('../another', decision), /routeId must be a route UUID/)
})

test('SDK retry inspection and reservation preserve the original mandate, previous trade and stable operation', async () => {
  const calls: { path: string; method: string; body: unknown }[] = []
  const client = new ClawdMarketClient({ apiKey: 'dummy-retry-key', fetch: async (input, init) => {
    calls.push({ path: new URL(String(input)).pathname, method: String(init?.method), body: init?.body ? JSON.parse(String(init.body)) : null })
    assert.equal(init?.redirect, 'error'); return Response.json({ idempotent: true })
  } })
  const command = { version: 1 as const, mandate_id: routeId, previous_trade_id: routeId, retry_operation_id: routeId }
  await client.inspectRouteRetry(routeId); await client.retryRoute(routeId, command)
  assert.deepEqual(calls, [{ path: `/api/routes/${routeId}/retry`, method: 'GET', body: null }, { path: `/api/routes/${routeId}/retry`, method: 'POST', body: command }])
})
