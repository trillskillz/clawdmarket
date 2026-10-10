import test from 'node:test'
import assert from 'node:assert/strict'
import { ClawdMarketClient, ClawdMarketTransportError, ClawdMarketApiError, SDK_CONTRACT } from '../../sdk/typescript/src/index'

const org = '00000000-0000-4000-8000-000000000001', trade = '00000000-0000-4000-8000-000000000002', key = `cmos_${'ab'.repeat(32)}`

test('enterprise SDK binds generated operations to one organization and preserves original approval, operations, bytes and proof', async () => {
  const seen: Array<{ path: string; method: string; body: unknown; credential: string | null }> = []
  const client = new ClawdMarketClient({ apiKey: key, fetch: async (url, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${key}`)
    assert.equal(init?.redirect, 'error'); assert.equal(init?.credentials, 'omit')
    seen.push({ path: new URL(String(url)).pathname + new URL(String(url)).search, method: String(init?.method), body: init?.body ? JSON.parse(String(init.body)) : null, credential: new Headers(init?.headers).get('Payment-Authorization') })
    return Response.json({ send_allowed: false, created: false, claim_required: true, status: 'late_payment_refund_processing' }, { status: 202 })
  } })
  const scoped = client.organizationSpending(org)
  const order = { service_id: trade, order: { client_reference: 'saved-checkout-reference', objective: 'Review this exact approved private input', payment_rail: 'mpp' as const, purchasing_approval_id: trade } }
  const evm = { buyer_operation_id: trade, chain_id: 1 as const, token_address: `0x${'11'.repeat(20)}`, payer_address: `0x${'22'.repeat(20)}` }
  const claim = { intent_id: trade, mandate_id: org, buyer_operation_id: trade, serialized_transaction: '0x76aabb' }
  const proof = { tx_hash: `0x${'33'.repeat(32)}`, payer_address: evm.payer_address }
  await scoped.orderService(order); await scoped.getOrder(trade)
  await scoped.createEvmPaymentIntent(trade, evm); await scoped.getEvmPaymentIntent(trade)
  await scoped.claimEvmPayment(trade, { ...claim, serialized_transaction: '0x02aabb', payer_signature: 'original-signature' })
  await scoped.verifyEvmFunding(trade, { ...proof, intent_id: trade, chain_id: 1, token_address: evm.token_address, payer_signature: 'original-signature' })
  await scoped.createTempoPaymentIntent(trade, { buyer_operation_id: trade }); await scoped.getTempoPaymentIntent(trade)
  await scoped.claimTempoPayment(trade, claim)
  assert.equal((await scoped.verifyTempoFunding(trade, proof)).status, 'late_payment_refund_processing')
  await scoped.submitOriginalTempoCredential(trade, 'Payment original.saved.credential')
  const operations = ['spending_account_service_order', 'inspect_spending_account_order', 'spending_evm_intent', 'recover_spending_evm_intent', 'spending_evm_claim', 'spending_evm_proof', 'spending_mpp_intent', 'recover_spending_mpp_intent', 'spending_mpp_claim', 'spending_mpp_proof', 'spending_mpp_proof'] as const
  assert.deepEqual(seen.map(({ path, method }) => ({ path, method })), operations.map((operation, index) => ({ method: SDK_CONTRACT.operations[operation].method, path: SDK_CONTRACT.operations[operation].path.replace('{id}', org).replace('{tradeId}', trade) + (index === 1 ? `?order_id=${trade}` : '') })))
  assert.deepEqual(seen[0].body, order); assert.deepEqual(seen[2].body, evm); assert.deepEqual(seen[8].body, claim); assert.deepEqual(seen[9].body, proof)
  assert.ok(seen.slice(0, 10).every(({ credential }) => credential === null))
  assert.equal(seen[10].credential, 'Payment original.saved.credential'); assert.equal(seen[10].body, null)
  assert.equal('confirmTrade' in scoped, false); assert.equal('executeRoute' in scoped, false); assert.equal('createSpendingAccount' in scoped, false)
})

test('owner SDK preserves reviewed grant and exact original-reference lookup without issuing another secret', async () => {
  const seen: Array<{ url: URL; body: unknown; method: string }> = []
  const client = new ClawdMarketClient({ apiKey: 'dummy-current-owner-jwt', fetch: async (url, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer dummy-current-owner-jwt')
    seen.push({ url: new URL(String(url)), body: init?.body ? JSON.parse(String(init.body)) : null, method: String(init?.method) })
    return Response.json({ api_key: null, idempotent: true, account: { id: trade }, spending_accounts: [] })
  } })
  const input = { version: 1 as const, client_reference: 'saved-reviewed-credit-grant', name: 'Approved service purchases', buyer_agent_id: 'original-buyer', team_id: null, cost_center: 'review', allowed_services: [{ service_id: trade, provider_share_id: null }], expires_at: '2026-10-11T00:00:00.000Z', max_purchase: '1.05', max_daily: '1.05', max_monthly: '1.05', max_lifetime: '1.05' }
  const reference = 'original/?&= £ reference'
  await client.inspectSpendingAccounts(org); await client.inspectSpendingAccounts(org, reference)
  assert.equal((await client.createSpendingAccount(org, input)).api_key, null)
  await client.revokeSpendingAccount(org, trade)
  assert.equal(seen[1].url.searchParams.get('client_reference'), reference); assert.equal(seen[1].url.pathname, `/api/organizations/${org}/spending-accounts`)
  assert.deepEqual(seen[2].body, input); assert.deepEqual(seen[3].body, { account_id: trade })
  assert.deepEqual(seen.map(({ method }) => method), ['GET', 'GET', 'POST', 'DELETE'])
})

test('enterprise SDK rejects scope substitution and malformed credentials before HTTP', async () => {
  let calls = 0
  const client = new ClawdMarketClient({ apiKey: key, fetch: async () => { calls++; throw Error('Unexpected request') } })
  const scoped = client.organizationSpending(org)
  for (const wrongKey of ['cmo_read_only', 'ordinary-buyer-key', `cmos_${'ab'.repeat(31)}`]) {
    assert.throws(() => new ClawdMarketClient({ apiKey: wrongKey }).organizationSpending(org), /distinct cmos_/)
  }
  assert.throws(() => new ClawdMarketClient({ apiKey: key + '\n' }), /single line/)
  assert.throws(() => client.organizationSpending('../another'), /UUID/)
  assert.throws(() => scoped.getOrder('../foreign'), /UUID/)
  assert.throws(() => scoped.getTempoPaymentIntent('../foreign'), /UUID/)
  for (const credential of ['', 'Bearer another-key', 'Payment x\r\ny', 'Payment ' + 'a'.repeat(16_384)]) assert.throws(() => scoped.submitOriginalTempoCredential(trade, credential), /bounded single-line/)
  assert.throws(() => client.inspectSpendingAccounts(org, ' short '), /client_reference/)
  assert.throws(() => client.revokeSpendingAccount(org, '../foreign'), /UUID/)
  assert.equal(calls, 0)
})

test('enterprise SDK does not retry a lost mutation or grant replacement permission after revocation', async () => {
  let lost = true, revoked = false
  const bodies: unknown[] = []
  const client = new ClawdMarketClient({ apiKey: key, fetch: async (_url, init) => {
    bodies.push(init?.body ? JSON.parse(String(init.body)) : null)
    if (lost) { lost = false; throw new Error('Reply lost after commit') }
    if (revoked) return Response.json({ error_code: 'SPENDING_ACCOUNT_INACTIVE', state: 'payment_unknown', retryable: false }, { status: 401 })
    return Response.json({ intent: { id: trade, buyer_operation_id: org }, claim_required: true, created: false })
  } })
  const scoped = client.organizationSpending(org), original = { buyer_operation_id: org }
  await assert.rejects(scoped.createTempoPaymentIntent(trade, original), (error: unknown) => error instanceof ClawdMarketTransportError && error.fundsState === 'unknown')
  assert.equal(bodies.length, 1)
  await scoped.getTempoPaymentIntent(trade)
  assert.equal((await scoped.createTempoPaymentIntent(trade, original)).created, false)
  assert.deepEqual(bodies, [original, null, original])
  revoked = true
  await assert.rejects(scoped.getTempoPaymentIntent(trade), (error: unknown) => error instanceof ClawdMarketApiError && error.status === 401 && !error.retryable)
  assert.equal(bodies.length, 4)
})
