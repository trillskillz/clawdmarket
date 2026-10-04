import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { encodeFunctionData, keccak256, toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Abis, Account } from 'viem/tempo'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema'), jwt: typeof import('@/lib/auth').generateJWT
let intentApi: typeof import('@/app/api/trades/[id]/fund/mpp/intent/route'), claimApi: typeof import('@/app/api/trades/[id]/fund/mpp/claim/route'), mandates: typeof import('@/app/api/routes/[id]/mandate/route')
let signerIndex = 200
const token = '0x20c0000000000000000000000000000000000000' as const, treasury = privateKeyToAccount(`0x${'99'.repeat(32)}`).address
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-mpp-claims-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'mpp-claims.db')}`
  process.env.JWT_SECRET = 'dummy-mpp-claim-tests-only'; process.env.WEBHOOK_SECRET_KEY = 'dummy-webhook-tests-only'
  process.env.MPP_RECIPIENT_ADDRESS = treasury; process.env.TREASURY_ADDRESS = treasury
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'99'.repeat(32)}`; process.env.MPP_SECRET_KEY = 'dummy-mpp-claim-hmac-secret-for-tests-only'
  process.env.TEMPO_RPC_URL = 'http://127.0.0.1:1' // Any network attempt fails; challenge/claims use no RPC.
  process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED = 'true'; process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED = 'true'; process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED = 'true'
  delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED; delete process.env.MPP_SECRET_KEY_CURRENT
  delete process.env.CLAWDMARKET_CANONICAL_ORIGIN; delete process.env.CLAWDMARKET_PRODUCTION_READINESS; delete process.env.VERCEL_ENV
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  intentApi = await import('@/app/api/trades/[id]/fund/mpp/intent/route'); claimApi = await import('@/app/api/trades/[id]/fund/mpp/claim/route'); mandates = await import('@/app/api/routes/[id]/mandate/route')
})
after(async () => { db?.$client.close(); await rm(directory, { recursive: true, force: true }) })
const context = (id: string) => ({ params: Promise.resolve({ id }) })
function request(path: string, userId: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method, headers: { Authorization: `Bearer ${jwt({ userId, email: `${userId}@test.invalid`, role: 'human' })}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function fixture(account?: ReturnType<typeof Account.fromSecp256k1>, agentBuyer = false) {
  const id = crypto.randomUUID(), ownerId = `owner-${id}`, buyerId = agentBuyer ? `user_agent_${id}` : ownerId, sellerId = `seller-${id}`, serviceId = crypto.randomUUID()
  const signer = account || Account.fromSecp256k1(`0x${(++signerIndex).toString(16).padStart(64, '0')}`)
  await db.insert(schema.users).values([...new Set([ownerId, buyerId, sellerId])].map((userId) => ({ id: userId, name: userId, email: `${userId}@test.invalid`, role: 'human' as const, password_hash: 'unused' })))
  if (agentBuyer) {
    await db.insert(schema.agents).values({ id, name: 'Dummy Tempo buyer', description: 'Local claim fixture', capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused' })
    await db.insert(schema.agent_owners).values({ agentId: id, userId: ownerId, establishedBy: 'test' })
  }
  await db.insert(schema.payout_addresses).values({ user_id: sellerId, address: treasury })
  const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } }
  await db.insert(schema.service_definitions).values({ id: serviceId, seller_id: sellerId, title: 'Tempo claim fixture', description: 'Review bounded private code with explicit buyer acceptance.', capabilities: '["code-review"]',
    price_minor: 100, status: 'active', estimated_latency_seconds: 30, max_concurrency: 1, provider_protocol: 'leased_v1', output_schema: '{"type":"object"}', verification_policy: JSON.stringify(policy) })
  const plan = await (await import('@/app/api/routes/plan/route')).POST(request('/api/routes/plan', buyerId, 'POST', { client_reference: `mpp-plan-${id}`, objective: 'Review private code with explicit buyer acceptance',
    input: {}, required_capabilities: ['code-review'], max_budget: { amount: '5.00', currency: 'USD' }, verification: policy, provider_requirements: { approved_providers: [sellerId] }, payment_policy: { allowed_rails: ['mpp'] } }))
  assert.equal(plan.status, 201); const routeId = (await plan.json()).route.id
  const granted = await mandates.POST(request(`/api/routes/${routeId}/mandate`, ownerId, 'POST', { version: 1, client_reference: `mpp-mandate-${id}`, max_aggregate: '2.00', max_per_execution: '2.00', max_retry_budget: '0.00', max_attempts: 1,
    approved_providers: [sellerId], max_latency_seconds: 60, private_data: 'selected_provider_only', expires_at: new Date(Date.now() + 600_000).toISOString(), payment: { rail: 'mpp', chain_id: 4217,
      token_address: token, payer_address: signer.address, treasury_address: treasury, minimum_token_reserve_units: '1000000', fee_token_address: token, minimum_fee_token_reserve_units: '1000000', max_fee_token_cost_units: '5000' } }), context(routeId))
  assert.equal(granted.status, 201, JSON.stringify(await granted.clone().json())); const mandate = (await granted.json()).mandate
  const reserved = await (await import('@/app/api/routes/[id]/execute/route')).POST(request(`/api/routes/${routeId}/execute`, buyerId, 'POST', { mandate_id: mandate.id }), context(routeId))
  assert.equal(reserved.status, 201); const trade = (await reserved.json()).trade
  return { id, ownerId, buyerId, sellerId, signer, routeId, mandate, trade, operationId: crypto.randomUUID() }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const create = (f: Fixture, operationId = f.operationId) => intentApi.POST(request(`/api/trades/${f.trade.id}/fund/mpp/intent`, f.buyerId, 'POST', { buyer_operation_id: operationId }), context(f.trade.id))
const inspect = (f: Fixture, userId = f.buyerId) => intentApi.GET(request(`/api/trades/${f.trade.id}/fund/mpp/intent`, userId, 'GET'), context(f.trade.id))
async function signed(f: Fixture, intent: any, nonce = 7, changes = {}) {
  const raw = await f.signer.signTransaction({ chainId: 4217, nonce, nonceKey: 0n, gas: 50_000n, maxFeePerGas: 100_000_000_000n, maxPriorityFeePerGas: 0n, feeToken: token,
    validBefore: Math.floor(Date.now() / 1000) + 120, calls: [{ to: token, value: 0n, data: encodeFunctionData({ abi: Abis.tip20, functionName: 'transferWithMemo', args: [treasury, BigInt(intent.token_amount), keccak256(toHex(`clawdmarket:${f.trade.id}`))] }) }], ...changes })
  return { intent_id: intent.id, mandate_id: f.mandate.id, buyer_operation_id: f.operationId, serialized_transaction: raw }
}
const claim = (f: Fixture, body: unknown, userId = f.buyerId) => claimApi.POST(request(`/api/trades/${f.trade.id}/fund/mpp/claim`, userId, 'POST', body), context(f.trade.id))
async function confirm(f: Fixture, hash: string) {
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, f.trade.id))
  const proof = { trade, rail: 'mpp' as const, txHash: hash, externalId: hash, payerAddress: f.signer.address.toLowerCase(), tokenAddress: token, chainId: 4217,
    tokenSymbol: 'pathUSD', tokenDecimals: 6, tokenAmount: 1_050_000n, tokenUsdPrice: 1, usdValue: 1.05 }
  const funding = await import('@/lib/trade-funding')
  if (trade.status === 'cancelled') await funding.recordCancelledExternalFunding(proof)
  else await funding.recordExternalTradeFunding(proof)
}

test('one original Tempo challenge and operation survive replay; exact concurrent claims commit once without RPC', async () => {
  const f = await fixture(), made = await create(f); assert.equal(made.status, 201, JSON.stringify(await made.clone().json()))
  const intent = (await made.json()).intent
  assert.equal(intent.challenge.request.amount, '1050000'); assert.equal(intent.token_amount, '1050000'); assert.equal(intent.buyer_operation_id, f.operationId)
  const replay = await create(f); assert.equal(replay.status, 200); assert.deepEqual((await replay.json()).intent, intent)
  assert.equal((await create(f, crypto.randomUUID())).status, 409)
  assert.equal((await inspect(f, f.sellerId)).status, 403)
  const body = await signed(f, intent), responses = await Promise.all([claim(f, body), claim(f, body), claim(f, body)])
  const results = await Promise.all(responses.map((r) => r.json()))
  for (const [i, result] of results.entries()) { assert.equal(responses[i].status, 200, JSON.stringify(result)); assert.equal(result.send_allowed, true); assert.equal(result.claim.tx_hash, keccak256(body.serialized_transaction)) }
  assert.equal(results.filter((r) => !r.idempotent).length, 1); assert.equal(JSON.stringify(results).includes(body.serialized_transaction), false)
  assert.equal((await claim(f, await signed(f, intent, 8))).status, 409)
  assert.equal((await db.select().from(schema.buyer_mpp_payment_claims).where(eq(schema.buyer_mpp_payment_claims.intent_id, intent.id))).length, 1)
  await confirm(f, keccak256(body.serialized_transaction)) // Trusted fixture proof persistence, not chain evidence.
  assert.equal((await (await inspect(f)).json()).claim.state, 'confirmed')
  assert.equal((await (await claim(f, body)).json()).send_allowed, false)
})

test('claimed Tempo wallet stays held through revocation/cancellation and releases only for its verified original receipt', async () => {
  const f = await fixture(), intent = (await (await create(f)).json()).intent, body = await signed(f, intent)
  assert.equal((await claim(f, body)).status, 200)
  const other = await fixture(f.signer), otherIntent = (await (await create(other)).json()).intent, otherBody = await signed(other, otherIntent, 8)
  let blocked = await claim(other, otherBody); assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, 'BUYER_WALLET_PAYMENT_UNRECONCILED')
  await mandates.DELETE(request(`/api/routes/${f.routeId}/mandate`, f.ownerId, 'DELETE'), context(f.routeId))
  const held = await claim(f, body); assert.equal((await held.json()).send_allowed, false)
  assert.equal((await create(f)).status, 200) // Original intent recovery does not grant a new transfer.
  await db.update(schema.trades).set({ status: 'cancelled', payout_status: 'processing' }).where(eq(schema.trades.id, f.trade.id))
  blocked = await claim(other, otherBody); assert.equal(blocked.status, 409)
  await confirm(f, keccak256(body.serialized_transaction))
  assert.equal((await claim(other, otherBody)).status, 200)
  await confirm(other, keccak256(otherBody.serialized_transaction))
  const third = await fixture(f.signer), thirdIntent = (await (await create(third)).json()).intent
  blocked = await claim(third, await signed(third, thirdIntent, 8)); assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, 'BUYER_WALLET_NONCE_ALREADY_CLAIMED')
})

test('wrong operation, payer, fee, read scope and cookie CSRF cannot mint Tempo send permission', async () => {
  const f = await fixture(undefined, true), intent = (await (await create(f)).json()).intent, body = await signed(f, intent)
  assert.equal((await claim(f, { ...body, buyer_operation_id: crypto.randomUUID() })).status, 409)
  assert.equal((await claim(f, body, f.sellerId)).status, 403)
  assert.equal((await claim(f, await signed(f, intent, 7, { maxFeePerGas: 100_000_000_001n }))).status, 409)
  const badSigner = await fixture(); const stolen = await signed({ ...f, signer: badSigner.signer }, intent)
  assert.equal((await claim(f, stolen)).status, 409)
  const readKey = await (await import('@/lib/agent-named-credentials')).createNamedAgentCredential({ agentId: f.id, name: 'Read only', scopes: ['agent:read'], actorCredentialId: null })
  if (readKey.kind !== 'created') assert.fail('Read key fixture failed')
  const url = `http://localhost/api/trades/${f.trade.id}/fund/mpp/claim`
  assert.equal((await claimApi.POST(new NextRequest(url, { method: 'POST', headers: { Authorization: `Bearer ${readKey.api_key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), context(f.trade.id))).status, 401)
  const cookie = jwt({ userId: f.buyerId, email: `${f.buyerId}@test.invalid`, role: 'human' })
  assert.equal((await claimApi.POST(new NextRequest(url, { method: 'POST', headers: { Cookie: `auth-token=${cookie}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), context(f.trade.id))).status, 403)
  await db.update(schema.agent_owners).set({ userId: f.sellerId }).where(eq(schema.agent_owners.agentId, f.id))
  assert.equal((await claim(f, body)).status, 409)
  assert.equal((await db.select().from(schema.buyer_mpp_payment_claims).where(eq(schema.buyer_mpp_payment_claims.intent_id, intent.id))).length, 0)
})

test('broadcast boundary pins the original challenge/hash and rechecks current permission before recording submission', async () => {
  const f = await fixture(), intent = (await (await create(f)).json()).intent, body = await signed(f, intent), { assertBuyerMppPull } = await import('@/lib/buyer-mpp-payment')
  const pull = { serialized_transaction: body.serialized_transaction, challenge: intent.challenge }
  await assert.rejects(() => assertBuyerMppPull(f.trade.id, f.signer.address, pull, true), /BUYER_ORIGINAL_CREDENTIAL_REQUIRED/)
  await claim(f, body)
  await assert.rejects(() => assertBuyerMppPull(f.trade.id, f.signer.address, { ...pull, challenge: { ...intent.challenge, id: 'another' } }, true), /BUYER_ORIGINAL_CREDENTIAL_REQUIRED/)
  const changed = await signed(f, intent, 8)
  await assert.rejects(() => assertBuyerMppPull(f.trade.id, f.signer.address, { ...pull, serialized_transaction: changed.serialized_transaction }, true), /BUYER_ORIGINAL_CREDENTIAL_REQUIRED/)
  process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED = 'true'
  try { await assert.rejects(() => assertBuyerMppPull(f.trade.id, f.signer.address, pull, true), /NEW_PAYMENTS_PAUSED/) } finally { delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED }
  assert.equal((await (await inspect(f)).json()).claim.first_submission_at, null)
  await assertBuyerMppPull(f.trade.id, f.signer.address, pull, true)
  assert.ok((await (await inspect(f)).json()).claim.first_submission_at)
  await confirm(f, keccak256(body.serialized_transaction))
  await assert.rejects(() => assertBuyerMppPull(f.trade.id, f.signer.address, pull, true), /BUYER_ORIGINAL_CREDENTIAL_REQUIRED/)
  const { inspectRouteFundingHealth } = await import('@/lib/route-funding-health.mjs')
  assert.equal((await inspectRouteFundingHealth(db.$client)).mpp_payment_claim_anomaly_count, 0)
  await db.update(schema.buyer_mpp_payment_claims).set({ state: 'claimed' }).where(eq(schema.buyer_mpp_payment_claims.intent_id, intent.id))
  assert.equal((await inspectRouteFundingHealth(db.$client)).mpp_payment_claim_anomaly_count, 1)
  await db.update(schema.buyer_mpp_payment_claims).set({ state: 'confirmed' }).where(eq(schema.buyer_mpp_payment_claims.intent_id, intent.id))
})

test('lifecycle advancement requires payments scope and cookie CSRF while private reads remain buyer-only', async () => {
  const f = await fixture(undefined, true), lifecycle = await import('@/app/api/routes/[id]/advance/route'), result = await import('@/app/api/routes/[id]/result/route')
  const credential = await (await import('@/lib/agent-named-credentials')).createNamedAgentCredential({ agentId: f.id, name: 'Lifecycle read only', scopes: ['agent:read'], actorCredentialId: null })
  if (credential.kind !== 'created') assert.fail('Read fixture unavailable')
  const url = `http://localhost/api/routes/${f.routeId}/advance`, headers = { Authorization: `Bearer ${credential.api_key}`, 'Content-Type': 'application/json' }
  assert.equal((await lifecycle.GET(new NextRequest(url, { headers }), context(f.routeId))).status, 200)
  assert.equal((await lifecycle.POST(new NextRequest(url, { method: 'POST', headers, body: '{"version":1,"action":"observe"}' }), context(f.routeId))).status, 401)
  const cookie = jwt({ userId: f.buyerId, email: `${f.buyerId}@test.invalid`, role: 'human' })
  assert.equal((await lifecycle.POST(new NextRequest(url, { method: 'POST', headers: { Cookie: `auth-token=${cookie}`, 'Content-Type': 'application/json' }, body: '{"version":1,"action":"observe"}' }), context(f.routeId))).status, 403)
  assert.equal((await result.GET(request(`/api/routes/${f.routeId}/result`, f.sellerId, 'GET'), context(f.routeId))).status, 404)
  const retry = await import('@/app/api/routes/[id]/retry/route'), retryURL = `http://localhost/api/routes/${f.routeId}/retry`
  const retryBody = JSON.stringify({ version: 1, mandate_id: f.mandate.id, previous_trade_id: f.trade.id, retry_operation_id: crypto.randomUUID() })
  assert.equal((await retry.GET(new NextRequest(retryURL, { headers }), context(f.routeId))).status, 200)
  assert.equal((await retry.POST(new NextRequest(retryURL, { method: 'POST', headers, body: retryBody }), context(f.routeId))).status, 401)
  assert.equal((await retry.POST(new NextRequest(retryURL, { method: 'POST', headers: { Cookie: `auth-token=${cookie}`, 'Content-Type': 'application/json' }, body: retryBody }), context(f.routeId))).status, 403)
  assert.equal((await retry.GET(request(`/api/routes/${f.routeId}/retry`, f.sellerId, 'GET'), context(f.routeId))).status, 404)
  assert.equal((await db.select().from(schema.service_execution_attempts).where(eq(schema.service_execution_attempts.order_id, (await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, f.trade.id)))[0].id))).length, 0)
})


test('stale original Tempo claims trigger a durable routing hold and their verified proof remains recoverable', async () => {
  const f = await fixture(), intent = (await (await create(f)).json()).intent, body = await signed(f, intent)
  await claim(f, body)
  await db.update(schema.buyer_mpp_payment_claims).set({ created_at: new Date(Date.now() - 901_000) }).where(eq(schema.buyer_mpp_payment_claims.intent_id, intent.id))
  const control = await import('@/lib/route-control')
  try {
    const financial = await control.inspectRouteFinancialHealth()
    assert.ok(financial.alerts.some((alert) => alert.code === 'ROUTE_PAYMENT_UNCONFIRMED' && alert.count === 1))
    assert.equal((await control.monitorRouteAdmission()).control.paused, true)
    const held = await claim(f, body); assert.equal(held.status, 200); assert.equal((await held.json()).send_allowed, false)
    assert.equal((await inspect(f)).status, 200)
    await confirm(f, keccak256(body.serialized_transaction))
    assert.equal((await db.select().from(schema.buyer_mpp_payment_claims).where(eq(schema.buyer_mpp_payment_claims.intent_id, intent.id)))[0].state, 'confirmed')
    assert.equal((await control.inspectRouteFinancialHealth()).alerts.some((alert) => alert.code === 'ROUTE_PAYMENT_UNCONFIRMED'), false)
    assert.equal((await control.monitorRouteAdmission()).control.paused, true, 'proof recovery cannot skip the healthy recovery window')
  } finally { await db.delete(schema.route_control_events); await db.delete(schema.route_controls) }
})
