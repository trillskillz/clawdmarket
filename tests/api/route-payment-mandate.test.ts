import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { encodeFunctionData, erc20Abi, keccak256 } from 'viem'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let mandateApi: typeof import('@/app/api/routes/[id]/mandate/route')
let execute: typeof import('@/app/api/routes/[id]/execute/route').POST
let intent: typeof import('@/app/api/trades/[id]/fund/evm/intent/route')
// Fixed dummy signer fixtures; no configured wallet or network is used.
const treasury = privateKeyToAccount(`0x${'99'.repeat(32)}`).address.toLowerCase()
const payer = privateKeyToAccount(`0x${'11'.repeat(32)}`).address.toLowerCase()
const dummySigner = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const tokenAddress = `0x${'44'.repeat(20)}`
const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } }

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-route-mandate-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'mandate.db')}`
  process.env.JWT_SECRET = 'route-mandate-tests-only'
  process.env.TREASURY_ADDRESS = treasury
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'99'.repeat(32)}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Test Base', address: tokenAddress,
    symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: 'https://rpc.example.invalid' }])
  process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED = 'true'
  process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED = 'true'
  process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED = 'true'
  delete process.env.MPP_SECRET_KEY; delete process.env.MPP_SECRET_KEY_CURRENT
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  mandateApi = await import('@/app/api/routes/[id]/mandate/route')
  execute = (await import('@/app/api/routes/[id]/execute/route')).POST
  intent = await import('@/app/api/trades/[id]/fund/evm/intent/route')
})
after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })
function context(id: string) { return { params: Promise.resolve({ id }) } }
function request(path: string, userId: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method,
    headers: { Authorization: `Bearer ${jwt({ userId, email: `${userId}@test.invalid`, role: 'human' })}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function fixture(agentBuyer = false) {
  const id = crypto.randomUUID(), ownerId = `owner-${id}`, buyerId = agentBuyer ? `user_agent_${id}` : ownerId, sellerId = `seller-${id}`, serviceId = crypto.randomUUID()
  await db.insert(schema.users).values([...new Set([ownerId, buyerId, sellerId])].map((userId) => ({ id: userId, name: userId, email: `${userId}@test.invalid`, password_hash: 'unused', role: 'human' as const })))
  if (agentBuyer) {
    await db.insert(schema.agents).values({ id, name: 'Buyer', description: 'Mandate test buyer', capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused' })
    await db.insert(schema.agent_owners).values({ agentId: id, userId: ownerId, establishedBy: 'test' })
  }
  await db.insert(schema.payout_addresses).values({ user_id: sellerId, address: treasury })
  await db.insert(schema.service_definitions).values({ id: serviceId, seller_id: sellerId, title: 'Mandate fixture', description: 'Return bounded structured review findings.',
    capabilities: '["code-review"]', price_minor: 100, status: 'active', estimated_latency_seconds: 30, max_concurrency: 1,
    output_schema: '{"type":"object","properties":{"result":{"type":"string"}}}', verification_policy: JSON.stringify(policy) })
  const planApi = (await import('@/app/api/routes/plan/route')).POST
  const response = await planApi(request('/api/routes/plan', buyerId, 'POST', { client_reference: `mandate-plan-${id}`, objective: 'Review these private code findings', required_capabilities: ['code-review'], input: { private_text: 'do not expose publicly' },
    max_budget: { amount: '5.00', currency: 'USD' }, verification: policy, provider_requirements: { approved_providers: [sellerId] }, payment_policy: { allowed_rails: ['evm'] } }))
  assert.equal(response.status, 201)
  const route = (await response.json()).route
  assert.equal(route.candidates.length, 1)
  const body = { version: 1, client_reference: `mandate-${id}`, max_aggregate: '2.00', max_per_execution: '2.00', max_retry_budget: '0.00', max_attempts: 1,
    approved_providers: [sellerId], max_latency_seconds: 60, private_data: 'selected_provider_only', expires_at: new Date(Date.now() + 600_000).toISOString(),
    payment: { rail: 'evm', chain_id: 8453, token_address: tokenAddress, payer_address: payer, treasury_address: treasury,
      minimum_token_reserve_units: '5000000', minimum_native_reserve_wei: '1000000000000', max_gas_cost_wei: '100000000000000' } }
  return { id, routeId: route.id as string, ownerId, buyerId, sellerId, serviceId, body }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function authorize(f: Fixture, changes = {}) {
  const response = await mandateApi.POST(request(`/api/routes/${f.routeId}/mandate`, f.ownerId, 'POST', { ...f.body, ...changes }), context(f.routeId))
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  return (await response.json()).mandate
}
const run = (f: Fixture, mandateId?: string) => execute(request(`/api/routes/${f.routeId}/execute`, f.buyerId, 'POST', mandateId ? { mandate_id: mandateId } : undefined), context(f.routeId))
const intentRequest = (f: Fixture, tradeId: string, changes = {}) => intent.POST(request(`/api/trades/${tradeId}/fund/evm/intent`, f.buyerId, 'POST', { chain_id: 8453, token_address: tokenAddress, payer_address: payer, ...changes }), context(tradeId))

test('signed transaction claims recover exact bytes, serialize a shared wallet and release only after verified proof', async () => {
  const claimApi = (await import('@/app/api/trades/[id]/fund/evm/claim/route')).POST
  const proofMessage = (await import('@/lib/evm-payment-proof')).evmPaymentProofMessage
  async function checkout() {
    const f = await fixture(), mandate = await authorize(f), { trade } = await (await run(f, mandate.id)).json()
    const paymentIntent = (await (await intentRequest(f, trade.id)).json()).intent
    return { f, mandate, trade, paymentIntent }
  }
  async function body(c: Awaited<ReturnType<typeof checkout>>, nonce: number, amount = 1050000n) {
    const raw = await dummySigner.signTransaction({ chainId: 8453, nonce, to: tokenAddress as `0x${string}`,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [treasury as `0x${string}`, amount] }),
      value: 0n, gas: 50000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, type: 'eip1559' })
    return { intent_id: c.paymentIntent.id, mandate_id: c.mandate.id, serialized_transaction: raw,
      payer_signature: await dummySigner.signMessage({ message: proofMessage(c.paymentIntent, keccak256(raw)) }) }
  }
  const post = (c: Awaited<ReturnType<typeof checkout>>, b: unknown, userId = c.f.buyerId) => claimApi(request(`/api/trades/${c.trade.id}/fund/evm/claim`, userId, 'POST', b), context(c.trade.id))
  async function confirm(c: Awaited<ReturnType<typeof checkout>>, b: Awaited<ReturnType<typeof body>>) {
    const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, c.trade.id))
    const funding = { trade, rail: 'evm' as const, txHash: keccak256(b.serialized_transaction), externalId: keccak256(b.serialized_transaction),
      payerAddress: payer, tokenAddress, chainId: 8453, tokenSymbol: 'USDC', tokenDecimals: 6, tokenAmount: 1050000n, tokenUsdPrice: 1, usdValue: 1.05 }
    const persistence = await import('@/lib/trade-funding')
    if (c === first) await assert.rejects(() => persistence.recordExternalTradeFunding(funding), (error: unknown) => (error as { code?: string }).code === 'PROVIDER_ELIGIBILITY_CHANGED')
    else await persistence.recordExternalTradeFunding(funding)
    const [claim] = await db.select().from(schema.buyer_evm_payment_claims).where(eq(schema.buyer_evm_payment_claims.intent_id, c.paymentIntent.id))
    assert.equal(claim.state, 'confirmed')
  }
  const first = await checkout(), signed = await body(first, 1001)
  assert.equal((await post(first, await body(first, 1001, 1050001n))).status, 409)
  assert.equal((await post(first, { ...signed, payer_signature: `0x${'00'.repeat(65)}` })).status, 403)
  assert.equal((await post(first, signed, first.f.sellerId)).status, 403)
  const responses = await Promise.all([post(first, signed), post(first, signed), post(first, signed)])
  const results = await Promise.all(responses.map((r) => r.json()))
  for (const [i, result] of results.entries()) { assert.equal(responses[i].status, 200); assert.equal(result.send_allowed, true); assert.equal(result.claim.tx_hash, keccak256(signed.serialized_transaction)) }
  assert.equal(results.filter((r) => !r.idempotent).length, 1)
  assert.equal(JSON.stringify(results).includes(signed.serialized_transaction), false)
  assert.equal((await post(first, await body(first, 1002))).status, 409)
  assert.equal((await intent.DELETE(request(`/api/trades/${first.trade.id}/fund/evm/intent`, first.f.buyerId, 'DELETE', { intent_id: first.paymentIntent.id, reason: 'wallet_rejected' }), context(first.trade.id))).status, 200)
  assert.equal((await db.select().from(schema.evm_payment_intents).where(eq(schema.evm_payment_intents.id, first.paymentIntent.id))).length, 1)
  const second = await checkout(), secondBody = await body(second, 1002)
  const blocked = await post(second, secondBody)
  assert.equal(blocked.status, 409); assert.equal((await blocked.json()).code, 'BUYER_WALLET_PAYMENT_UNRECONCILED')
  assert.equal((await db.select().from(schema.evm_payment_intents).where(eq(schema.evm_payment_intents.id, second.paymentIntent.id)))[0].tx_hash, null)
  await mandateApi.DELETE(request(`/api/routes/${first.f.routeId}/mandate`, first.f.ownerId, 'DELETE'), context(first.f.routeId))
  const revoked = await (await post(first, signed)).json(); assert.equal(revoked.send_allowed, false); assert.equal(revoked.claim.state, 'claimed')
  assert.equal((await post(second, secondBody)).status, 409)
  await confirm(first, signed) // Trusted mock-proof boundary, not a real chain transfer.
  const afterProof = await post(second, secondBody)
  assert.equal(afterProof.status, 200, JSON.stringify(await afterProof.clone().json()))
  await confirm(second, secondBody)
  const third = await checkout()
  assert.equal((await post(third, await body(third, 1002))).status, 409) // Confirmed nonce never belongs to another intent.
  const recovered = await (await post(second, secondBody)).json(); assert.equal(recovered.send_allowed, false); assert.equal(recovered.claim.state, 'confirmed')
  const health = await import('@/lib/route-funding-health.mjs')
  assert.equal((await health.inspectRouteFundingHealth(db.$client)).payment_claim_anomaly_count, 0)
  await db.update(schema.buyer_evm_payment_claims).set({ state: 'claimed' }).where(eq(schema.buyer_evm_payment_claims.intent_id, first.paymentIntent.id))
  assert.equal((await health.inspectRouteFundingHealth(db.$client)).payment_claim_anomaly_count, 1)
  await db.update(schema.buyer_evm_payment_claims).set({ state: 'confirmed' }).where(eq(schema.buyer_evm_payment_claims.intent_id, first.paymentIntent.id))
})

test('only current buyer owner grants immutable bounded authority; scoped keys cannot mint mandates', async () => {
  const f = await fixture(true)
  assert.equal((await mandateApi.POST(request(`/api/routes/${f.routeId}/mandate`, f.buyerId, 'POST', f.body), context(f.routeId))).status, 401)
  assert.equal((await mandateApi.POST(request(`/api/routes/${f.routeId}/mandate`, f.sellerId, 'POST', f.body), context(f.routeId))).status, 404)
  const credential = await (await import('@/lib/agent-named-credentials')).createNamedAgentCredential({ agentId: f.id, name: 'Read only', scopes: ['agent:read'], actorCredentialId: null })
  if (credential.kind !== 'created') assert.fail('Named credential fixture failed')
  const named = (path: string, method: string, body?: unknown) => new NextRequest(`http://localhost${path}`, { method, headers: { Authorization: `Bearer ${credential.api_key}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  assert.equal((await execute(named(`/api/routes/${f.routeId}/execute`, 'POST'), context(f.routeId))).status, 401)
  assert.equal((await mandateApi.POST(named(`/api/routes/${f.routeId}/mandate`, 'POST', f.body), context(f.routeId))).status, 401)
  const m = await authorize(f)
  assert.equal((await mandateApi.GET(named(`/api/routes/${f.routeId}/mandate`, 'GET'), context(f.routeId))).status, 200)
  assert.equal((await mandateApi.POST(request(`/api/routes/${f.routeId}/mandate`, f.ownerId, 'POST', f.body), context(f.routeId))).status, 200)
  assert.equal((await mandateApi.POST(request(`/api/routes/${f.routeId}/mandate`, f.ownerId, 'POST', { ...f.body, max_aggregate: '3.00' }), context(f.routeId))).status, 409)
  assert.equal(m.reserved_amount, '0.00'); assert.equal(m.terms.payment.minimum_token_reserve_units, '5000000')
  assert.equal(JSON.stringify(m).includes('do not expose publicly'), false)
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyerId))).length, 0)
})

test('economic order, mandate exposure and durable funding step commit once before intent permission', async () => {
  const f = await fixture(), m = await authorize(f)
  const noMandate = await run(f)
  assert.equal(noMandate.status, 409)
  // A denied attempt must not prevent recovery with the actual mandate.
  const responses = await Promise.all([run(f, m.id), run(f, m.id), run(f, m.id)])
  for (const response of responses) assert.ok([200, 201].includes(response.status), JSON.stringify(await response.clone().json()))
  const trades = await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyerId)), orders = await db.select().from(schema.service_orders).where(eq(schema.service_orders.buyer_id, f.buyerId))
  assert.equal(trades.length, 1); assert.equal(orders.length, 1); assert.equal(trades[0].status, 'pending')
  const saved = await mandateApi.GET(request(`/api/routes/${f.routeId}/mandate`, f.buyerId, 'GET'), context(f.routeId)), body = await saved.json()
  assert.equal(body.mandate.reserved_amount, '1.05'); assert.equal(body.funding_step.trade_id, trades[0].id); assert.equal(body.funding_step.state, 'reserved')
  assert.equal((await intentRequest(f, trades[0].id, { payer_address: treasury })).status, 409)
  assert.equal((await db.select().from(schema.evm_payment_intents).where(eq(schema.evm_payment_intents.trade_id, trades[0].id))).length, 0)
  const allowed = await intentRequest(f, trades[0].id)
  assert.equal(allowed.status, 201); assert.equal((await allowed.json()).intent.token_amount, '1050000')
  const replay = await intentRequest(f, trades[0].id)
  assert.equal((await replay.json()).created, false)
  assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, trades[0].id))).length, 0)
  const health = await (await import('@/lib/route-funding-health.mjs')).inspectRouteFundingHealth(db.$client)
  assert.equal(health.exposure_anomaly_count, 0); assert.equal(health.missing_step_count, 0); assert.equal(health.proof_state_anomaly_count, 0)
  await db.update(schema.route_payment_mandates).set({ reserved_minor: 0 }).where(eq(schema.route_payment_mandates.id, m.id))
  assert.equal((await (await import('@/lib/route-funding-health.mjs')).inspectRouteFundingHealth(db.$client)).exposure_anomaly_count, 1)
  await db.update(schema.route_payment_mandates).set({ reserved_minor: 105 }).where(eq(schema.route_payment_mandates.id, m.id))
})

test('mandate budget, provider, latency and saved route mutations roll back economic reservation', async () => {
  for (const changes of [{ max_aggregate: '0.50', max_per_execution: '0.50' }, { approved_providers: ['unapproved-provider'] }, { max_latency_seconds: 1 }]) {
    const f = await fixture(), m = await authorize(f, changes)
    assert.equal((await run(f, m.id)).status, 409)
    assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyerId))).length, 0)
    const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.serviceId)); assert.equal(service.active_orders, 0)
    const [mandate] = await db.select().from(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.id, m.id)); assert.equal(mandate.reserved_minor, 0)
  }
  const f = await fixture(), m = await authorize(f)
  await db.update(schema.route_plans).set({ input_json: '{"changed":true}' }).where(eq(schema.route_plans.id, f.routeId))
  const response = await run(f, m.id); assert.equal(response.status, 409); assert.equal((await response.json()).error_code, 'MANDATE_ROUTE_CHANGED')
})

test('revocation prevents new send permission, preserves late proof and does not free mandate exposure', async () => {
  const f = await fixture(), m = await authorize(f), response = await run(f, m.id), { trade } = await response.json()
  assert.equal((await mandateApi.DELETE(request(`/api/routes/${f.routeId}/mandate`, f.ownerId, 'DELETE'), context(f.routeId))).status, 200)
  assert.equal((await intentRequest(f, trade.id)).status, 409)
  const funding = await import('@/lib/trade-funding')
  const [current] = await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id))
  const proof = { trade: current, rail: 'evm' as const, txHash: `0x${'aa'.repeat(32)}`, externalId: `0x${'aa'.repeat(32)}`, payerAddress: payer, tokenAddress,
    chainId: 8453, tokenSymbol: 'USDC', tokenDecimals: 6, tokenAmount: 1050000n, tokenUsdPrice: 1, usdValue: 1.05 }
  // Trusted verified-proof persistence boundary; no chain/RPC or wallet transaction.
  await assert.rejects(() => funding.recordExternalTradeFunding(proof), (error: unknown) => (error as { code?: string }).code === 'PROVIDER_ELIGIBILITY_CHANGED')
  const [cancelled] = await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id)); assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.payout_status, 'processing')
  await funding.recordCancelledExternalFunding({ ...proof, trade: cancelled })
  assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, trade.id))).length, 1)
  const saved = await (await mandateApi.GET(request(`/api/routes/${f.routeId}/mandate`, f.buyerId, 'GET'), context(f.routeId))).json()
  assert.equal(saved.funding_step.state, 'rejected'); assert.equal(saved.mandate.reserved_amount, '1.05')
  assert.equal((await run(f, m.id)).status, 200)
})

test('matching verified funding commits the original step and receipt once; a mismatched payer holds for refund', async () => {
  for (const wrongPayer of [false, true]) {
    const f = await fixture(), m = await authorize(f), { trade } = await (await run(f, m.id)).json()
    assert.equal((await intentRequest(f, trade.id)).status, 201)
    const [current] = await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id))
    const txHash = `0x${crypto.randomUUID().replaceAll('-', '').repeat(2)}`
    const proof = { trade: current, rail: 'evm' as const, txHash, externalId: txHash, payerAddress: wrongPayer ? treasury : payer, tokenAddress,
      chainId: 8453, tokenSymbol: 'USDC', tokenDecimals: 6, tokenAmount: 1050000n, tokenUsdPrice: 1, usdValue: 1.05 }
    const funding = await import('@/lib/trade-funding')
    if (wrongPayer) await assert.rejects(() => funding.recordExternalTradeFunding(proof), (error: unknown) => (error as { code?: string }).code === 'PROVIDER_ELIGIBILITY_CHANGED')
    else {
      const funded = await funding.recordExternalTradeFunding(proof)
      assert.equal(funded.status, 'escrow_held')
      assert.equal((await funding.recordExternalTradeFunding({ ...proof, trade: funded })).id, funded.id)
    }
    const saved = await (await mandateApi.GET(request(`/api/routes/${f.routeId}/mandate`, f.buyerId, 'GET'), context(f.routeId))).json()
    assert.equal(saved.funding_step.state, wrongPayer ? 'rejected' : 'funded')
    assert.equal(saved.mandate.reserved_amount, '1.05')
    assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, trade.id))).length, 1)
    const [order] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, trade.id))
    assert.equal(order.state, wrongPayer ? 'cancelled' : 'funded')
  }
})

test('cookie grants require CSRF and malformed bounds cannot create authority', async () => {
  const f = await fixture()
  const cookie = jwt({ userId: f.ownerId, email: `${f.ownerId}@test.invalid`, role: 'human' })
  const browser = new NextRequest(`http://localhost/api/routes/${f.routeId}/mandate`, { method: 'POST', headers: { Cookie: `auth-token=${cookie}`, Authorization: 'Bearer invalid', 'Content-Type': 'application/json' }, body: JSON.stringify(f.body) })
  assert.equal((await mandateApi.POST(browser, context(f.routeId))).status, 403)
  assert.equal((await mandateApi.POST(request(`/api/routes/${f.routeId}/mandate`, f.ownerId, 'POST', { ...f.body, payment: { ...f.body.payment, max_gas_cost_wei: '0' } }), context(f.routeId))).status, 400)
  assert.equal((await db.select().from(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.route_id, f.routeId))).length, 0)
})

test('changed buyer owner and expiry fail before fresh funding intent', async () => {
  for (const reason of ['owner', 'expiry']) {
    const f = await fixture(true), m = await authorize(f), { trade } = await (await run(f, m.id)).json()
    if (reason === 'owner') await db.delete(schema.agent_owners).where(eq(schema.agent_owners.agentId, f.id))
    else await db.update(schema.route_payment_mandates).set({ expires_at: new Date(0) }).where(eq(schema.route_payment_mandates.id, m.id))
    assert.equal((await intentRequest(f, trade.id)).status, 409)
  }
})

test('current deployment and immutable organization ceilings are rechecked at funding', async () => {
  const f = await fixture(true), m = await authorize(f), { trade } = await (await run(f, m.id)).json()
  const previous = process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD
  process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD = '0.5'
  try { assert.equal((await intentRequest(f, trade.id)).status, 409) }
  finally { if (previous === undefined) delete process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD; else process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD = previous }
  const orgId = crypto.randomUUID()
  await db.insert(schema.organizations).values({ id: orgId, owner_account_id: f.ownerId, client_reference: `org-${orgId}`, name: 'Mandate org', created_at: new Date(), updated_at: new Date() })
  await db.insert(schema.organization_trade_attributions).values({ trade_id: trade.id, organization_id: orgId, agent_id: f.id, total_minor: 105, cost_center: 'test', created_at: new Date() })
  await db.insert(schema.organization_spend_budgets).values({ organization_id: orgId, max_per_execution_minor: 50, version: 1, created_at: new Date(), updated_at: new Date() })
  assert.equal((await intentRequest(f, trade.id)).status, 409)
  assert.equal((await db.select().from(schema.evm_payment_intents).where(eq(schema.evm_payment_intents.trade_id, trade.id))).length, 0)
})
