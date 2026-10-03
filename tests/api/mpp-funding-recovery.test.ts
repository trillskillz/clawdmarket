import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { Challenge, Credential } from 'mppx'
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Abis, Account } from 'viem/tempo'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string, rpcUrl: string
let db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema'), jwt: typeof import('@/lib/auth').generateJWT
let fund: typeof import('@/app/api/trades/[id]/fund/mpp/route').POST
let safety: typeof import('@/lib/marketplace-mpp-payment')
const server = createServer(), token = '0x20c0000000000000000000000000000000000000' as const
const treasury = privateKeyToAccount(`0x${'99'.repeat(32)}`).address, payer = Account.fromSecp256k1(`0x${'11'.repeat(32)}`)
const blockHash = `0x${'55'.repeat(32)}` as Hex, receipts = new Map<string, any>(), rpcMethods: string[] = []
let rpcChainId = 4217, simulationHook: (() => void) | null = null
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-mpp-recovery-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'mpp.db')}`
  process.env.JWT_SECRET = 'dummy-mpp-recovery-tests-only'; process.env.WEBHOOK_SECRET_KEY = 'dummy-webhook-tests-only'
  process.env.TREASURY_ADDRESS = treasury; process.env.MPP_RECIPIENT_ADDRESS = treasury
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'99'.repeat(32)}`; process.env.MPP_SECRET_KEY = 'dummy-mpp-recovery-hmac-secret-for-tests-only'
  delete process.env.MPP_SECRET_KEY_CURRENT; delete process.env.DEV_WALLET_ADDRESS; delete process.env.DEV_FEE_WALLET_ADDRESS
  delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED
  process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED = 'true'
  server.on('request', async (incoming, outgoing) => {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk)
    const input = JSON.parse(Buffer.concat(chunks).toString()); rpcMethods.push(input.method)
    let result: unknown
    if (input.method === 'eth_chainId') result = `0x${rpcChainId.toString(16)}`
    else if (input.method === 'eth_getTransactionReceipt') result = receipts.get(input.params[0]) ?? null
    else if (input.method === 'eth_getBlockByNumber') result = { number: '0x64', hash: blockHash, timestamp: `0x${(Math.floor(Date.now() / 1000) + 1).toString(16)}`, transactions: [] }
    else if (input.method === 'eth_call') { simulationHook?.(); result = '0x' }
    else { outgoing.statusCode = 500; outgoing.end(JSON.stringify({ forbidden_test_rpc_method: input.method })); return }
    outgoing.setHeader('Content-Type', 'application/json'); outgoing.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }))
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  rpcUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`; process.env.TEMPO_RPC_URL = rpcUrl
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT; safety = await import('@/lib/marketplace-mpp-payment')
  fund = (await import('@/app/api/trades/[id]/fund/mpp/route')).POST
})
after(async () => { await new Promise<void>((done) => server.close(() => done())); db?.$client.close(); await rm(directory, { recursive: true, force: true }) })

async function fixture() {
  const buyerId = `buyer-${crypto.randomUUID()}`, sellerId = `seller-${crypto.randomUUID()}`
  await db.insert(schema.users).values([buyerId, sellerId].map((id) => ({ id, email: `${id}@test.invalid`, name: id, password_hash: 'unused', role: 'human' as const })))
  const [listing] = await db.insert(schema.listings).values({ seller_id: sellerId, category: 'other', title: 'Dummy MPP checkout', description: 'Isolated checkout', price_bankr: 1, status: 'sold' }).returning()
  const [trade] = await db.insert(schema.trades).values({ buyer_id: buyerId, seller_id: sellerId, listing_id: listing.id, amount: 1, item_price: 1, fee: .05,
    total_cost: 1.05, seller_amount: 1, payment_rail: 'mpp', status: 'pending', payment_due_at: new Date(Date.now() + 600_000).toISOString() }).returning()
  const apiKey = jwt({ userId: buyerId, email: `${buyerId}@test.invalid`, role: 'human' })
  const request = (body?: unknown, credential?: string, headers: Record<string, string> = {}) => new NextRequest(`http://localhost/api/trades/${trade.id}/fund/mpp`, {
    method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(credential ? { 'Payment-Authorization': credential } : {}), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const call = (body?: unknown, credential?: string, headers?: Record<string, string>) => fund(request(body, credential, headers), { params: Promise.resolve({ id: trade.id }) })
  return { trade, buyerId, sellerId, apiKey, request, call }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
function paidReceipt(f: Fixture, changes: { sender?: Hex; recipient?: Hex; currency?: Hex; amount?: bigint; memo?: Hex; status?: string } = {}) {
  const hash = keccak256(encodeAbiParameters([{ type: 'string' }], [`dummy-payment-${f.trade.id}`]))
  const sender = changes.sender || payer.address, recipient = changes.recipient || treasury, amount = changes.amount ?? 1_050_000n
  const log = { address: changes.currency || token, blockHash, blockNumber: '0x64', transactionHash: hash, transactionIndex: '0x0', logIndex: '0x0', removed: false,
    topics: encodeEventTopics({ abi: Abis.tip20, eventName: 'TransferWithMemo', args: { from: sender, to: recipient, memo: changes.memo || safety.marketplaceMppMemo(f.trade.id) } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [amount]) }
  receipts.set(hash, { transactionHash: hash, from: sender, to: token, blockHash, blockNumber: '0x64', transactionIndex: '0x0', status: changes.status || '0x1',
    gasUsed: '0xc350', cumulativeGasUsed: '0xc350', effectiveGasPrice: '0x1', logsBloom: `0x${'00'.repeat(256)}`, contractAddress: null, type: '0x76', logs: [log] })
  return hash
}
async function challenge(f: Fixture) {
  const response = await f.call(); assert.equal(response.status, 402)
  const parsed = Challenge.fromResponse<any>(response)
  assert.equal(parsed.request.methodDetails?.memo, safety.marketplaceMppMemo(f.trade.id))
  assert.equal(parsed.request.externalId, f.trade.id); assert.equal(parsed.request.amount, '1050000')
  return parsed
}
function hashCredential(c: ReturnType<typeof Challenge.fromResponse>, hash: Hex) {
  return Credential.serialize({ challenge: c, payload: { type: 'hash', hash }, source: `did:pkh:eip155:4217:${payer.address}` })
}
async function assertOneReceipt(f: Fixture, hash: string) {
  const rows = await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, f.trade.id))
  assert.equal(rows.length, 1); assert.equal(rows[0].tx_hash, hash); assert.equal(rows[0].external_id, hash)
  assert.equal(rows[0].payer_address, payer.address.toLowerCase()); assert.equal(rows[0].token_amount, '1050000')
  assert.equal(rpcMethods.some((method) => /send|sign/i.test(method)), false)
}

test('MPP challenges bind a 32-byte trade memo and dedicated credentials preserve account authentication and actual receipt hash', async () => {
  const f = await fixture(), c = await challenge(f), hash = paidReceipt(f), encoded = hashCredential(c, hash)
  const mpp = (await import('@/lib/mpp')).getMarketplaceMppServer()!
  await mpp.validateCredential(Credential.deserialize(encoded), { capturedRequest: f.request(undefined, encoded), request: safety.marketplaceMppValidationRequest(f.trade) })
  const response = await f.call(undefined, encoded)
  assert.equal(response.status, 200); assert.equal((await response.json()).receipt.payment_reference, hash)
  await assertOneReceipt(f, hash)
  const replay = await f.call(undefined, encoded); assert.equal(replay.status, 200); assert.equal((await replay.json()).idempotent, true)
})

test('legacy credential headers retain cookie authentication and CSRF, while conflicting payment headers fail closed', async () => {
  const f = await fixture(), c = await challenge(f), hash = paidReceipt(f), encoded = hashCredential(c, hash)
  const cookie = `auth-token=${f.apiKey}; csrf-token=dummy-csrf-token`
  const headers = { Authorization: encoded, Cookie: cookie, 'X-CSRF-Token': 'dummy-csrf-token' }
  const conflict = await f.call(undefined, `${encoded}different`, headers)
  assert.equal(conflict.status, 400); assert.equal((await conflict.json()).code, 'MPP_CREDENTIAL_INVALID')
  const response = await f.call(undefined, undefined, headers); assert.equal(response.status, 200)
  await assertOneReceipt(f, hash)
})

test('after MPP consumes a receipt before application commit, hash-only recovery funds the original trade once', async () => {
  const f = await fixture(), c = await challenge(f), hash = paidReceipt(f), encoded = hashCredential(c, hash)
  const mpp = (await import('@/lib/mpp')).getMarketplaceMppServer()!
  const headers = new Headers({ 'Payment-Authorization': encoded })
  const paid = await mpp.charge(safety.marketplaceMppCharge(f.trade))(new Request(f.request().url, { method: 'POST', headers }))
  assert.equal(paid.status, 200)
  assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, f.trade.id))).length, 0)
  const recovered = await f.call({ tx_hash: hash, payer_address: payer.address }); assert.equal(recovered.status, 200)
  await assertOneReceipt(f, hash)
  assert.equal((await f.call({ tx_hash: hash, payer_address: payer.address })).status, 200)
  const other = await fixture(); assert.equal((await other.call({ tx_hash: hash, payer_address: payer.address })).status, 422)
})

test('hash proof validation fails closed on pending, chain, payer, recipient, currency, amount, memo and reverted mismatches', async () => {
  const f = await fixture(), proof = (hash: Hex) => ({ tx_hash: hash, payer_address: payer.address })
  const missing = `0x${'aa'.repeat(32)}` as Hex
  const pending = await f.call(proof(missing)); assert.equal(pending.status, 409); assert.equal((await pending.json()).retryable, true)
  const hash = paidReceipt(f); rpcChainId = 1
  try { assert.equal((await f.call(proof(hash))).status, 503) } finally { rpcChainId = 4217 }
  for (const changes of [{ sender: treasury }, { recipient: payer.address }, { currency: treasury }, { amount: 1n }, { memo: blockHash }, { status: '0x0' }]) {
    assert.equal((await f.call(proof(paidReceipt(f, changes)))).status, 422)
  }
  assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, f.trade.id))).length, 0)
  assert.equal((await f.call(proof(paidReceipt(f)))).status, 200); await assertOneReceipt(f, hash)
})

test('pull permission is rechecked after SDK simulation, and cancelled or expired checkouts cannot trigger broadcast', async () => {
  const f = await fixture(), c = await challenge(f)
  const raw = await payer.signTransaction({ chainId: 4217, nonce: 0, nonceKey: 1n, gas: 60_000n, maxFeePerGas: 20_000_000_000n,
    maxPriorityFeePerGas: 0n, feeToken: token, validBefore: Math.floor(Date.now() / 1000) + 25,
    calls: [{ to: token, value: 0n, data: encodeFunctionData({ abi: Abis.tip20, functionName: 'transferWithMemo', args: [treasury, 1_050_000n, safety.marketplaceMppMemo(f.trade.id)] }) }] })
  const encoded = Credential.serialize({ challenge: c, payload: { type: 'transaction', signature: raw }, source: `did:pkh:eip155:4217:${payer.address}` })
  const mpp = (await import('@/lib/mpp')).getMarketplaceMppServer()!
  const validated = await mpp.validateCredential(Credential.deserialize(encoded), { capturedRequest: f.request(undefined, encoded), request: safety.marketplaceMppValidationRequest(f.trade) })
  assert.equal(validated.details.sender.toLowerCase(), payer.address.toLowerCase())
  simulationHook = () => { process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED = 'true' }
  try {
    const response = await f.call(undefined, encoded)
    assert.equal(response.status, 503); assert.equal((await response.json()).details.code, 'NEW_PAYMENTS_PAUSED'); assert.equal(rpcMethods.some((method) => /send|sign/i.test(method)), false)
  } finally { simulationHook = null; delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED }
  await db.update(schema.trades).set({ status: 'cancelled' }).where(eq(schema.trades.id, f.trade.id))
  const cancelled = await f.call(undefined, encoded); assert.equal(cancelled.status, 409); assert.equal((await cancelled.json()).code, 'MPP_BROADCAST_NOT_ALLOWED')
  await db.update(schema.trades).set({ status: 'pending', payment_due_at: new Date(Date.now() - 1_000).toISOString() }).where(eq(schema.trades.id, f.trade.id))
  assert.equal((await f.call(undefined, encoded)).status, 409)
  assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, f.trade.id))).length, 0)
})

test('late hash proof while payments are paused preserves the receipt and queues one full refund without RPC sending', async () => {
  const f = await fixture(), hash = paidReceipt(f)
  await db.update(schema.trades).set({ status: 'cancelled' }).where(eq(schema.trades.id, f.trade.id))
  process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED = 'true'
  try {
    for (let i = 0; i < 2; i++) {
      const response = await f.call({ tx_hash: hash, payer_address: payer.address }); assert.equal(response.status, 202)
      assert.equal((await response.json()).status, 'late_payment_refund_processing')
    }
  } finally { delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED }
  await assertOneReceipt(f, hash)
  const refunds = await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, f.trade.id))
  assert.equal(refunds.length, 1); assert.equal(refunds[0].kind, 'buyer_refund'); assert.equal(refunds[0].token_amount, '1050000')
  assert.equal(refunds[0].status, 'pending'); assert.equal(refunds[0].raw_transaction, null)
})

test('MPP mandates fail closed for automatic pull, revoked authority cannot broadcast, and the original paid hash enters refund reconciliation', async () => {
  const f = await fixture(), serviceId = crypto.randomUUID()
  const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } }
  await db.insert(schema.payout_addresses).values({ user_id: f.sellerId, address: treasury })
  await db.insert(schema.service_definitions).values({ id: serviceId, seller_id: f.sellerId, title: 'Dummy MPP routed review', description: 'Review private code with explicit acceptance.',
    capabilities: '["code-review"]', price_minor: 100, status: 'active', estimated_latency_seconds: 30, max_concurrency: 1, provider_protocol: 'leased_v1',
    output_schema: '{"type":"object"}', verification_policy: JSON.stringify(policy) })
  const request = (path: string, body?: unknown, method = 'POST') => new NextRequest(`http://localhost${path}`, { method,
    headers: { Authorization: `Bearer ${f.apiKey}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const planned = await (await import('@/app/api/routes/plan/route')).POST(request('/api/routes/plan', { client_reference: `mpp-plan-${serviceId}`,
    objective: 'Review private code with explicit buyer review', required_capabilities: ['code-review'], max_budget: { amount: '5.00', currency: 'USD' },
    input: { private_text: 'dummy source' }, verification: policy, provider_requirements: { approved_providers: [f.sellerId] }, payment_policy: { allowed_rails: ['mpp'] } }))
  assert.equal(planned.status, 201); const routeId = (await planned.json()).route.id
  const mandateApi = await import('@/app/api/routes/[id]/mandate/route'), context = { params: Promise.resolve({ id: routeId }) }
  const created = await mandateApi.POST(request(`/api/routes/${routeId}/mandate`, { version: 1, client_reference: `mpp-mandate-${serviceId}`,
    max_aggregate: '2.00', max_per_execution: '2.00', max_retry_budget: '0.00', max_attempts: 1, approved_providers: [f.sellerId], max_latency_seconds: 60,
    private_data: 'selected_provider_only', expires_at: new Date(Date.now() + 600_000).toISOString(), payment: { rail: 'mpp', chain_id: 4217, token_address: token,
      payer_address: payer.address, treasury_address: treasury, minimum_token_reserve_units: '1000000', minimum_native_reserve_wei: '0', max_gas_cost_wei: '1' } }), context)
  assert.equal(created.status, 201); const mandate = (await created.json()).mandate
  const executed = await (await import('@/app/api/routes/[id]/execute/route')).POST(request(`/api/routes/${routeId}/execute`, { mandate_id: mandate.id }), context)
  assert.equal(executed.status, 201); const reserved = await executed.json()
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, reserved.trade.id)), fundingContext = { params: Promise.resolve({ id: trade.id }) }
  const url = `/api/trades/${trade.id}/fund/mpp`
  const held = await fund(request(url), fundingContext); assert.equal(held.status, 409); assert.equal((await held.json()).code, 'MPP_MANDATE_PULL_NOT_READY')
  await mandateApi.DELETE(request(`/api/routes/${routeId}/mandate`, undefined, 'DELETE'), context)
  await assert.rejects(() => safety.assertMarketplaceMppPullAllowed(trade.id, payer.address), (error: any) => error.code === 'MANDATE_INACTIVE')
  const hash = paidReceipt({ ...f, trade })
  const recovered = await fund(request(url, { tx_hash: hash, payer_address: payer.address }), fundingContext)
  assert.equal(recovered.status, 202); assert.equal((await recovered.json()).status, 'late_payment_refund_processing')
  const [step] = await db.select().from(schema.route_funding_steps).where(eq(schema.route_funding_steps.trade_id, trade.id)); assert.equal(step.state, 'rejected')
  const [order] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, trade.id)); assert.equal(order.state, 'cancelled')
  assert.equal((await db.select().from(schema.service_execution_attempts).where(eq(schema.service_execution_attempts.order_id, order.id))).length, 0)
  await assertOneReceipt({ ...f, trade }, hash)
})

test('MPP credentials are bounded, conflict checked, and malformed or mixed proof forms cannot reach RPC', async () => {
  const f = await fixture(), start = rpcMethods.length
  assert.equal((await f.call(undefined, 'Payment malformed')).status, 400)
  assert.equal((await f.call(undefined, `Payment ${'x'.repeat(16_384)}`)).status, 413)
  assert.equal((await f.call([])).status, 400)
  assert.equal((await f.call({ tx_hash: 'invalid', payer_address: payer.address })).status, 400)
  const encoded = hashCredential(await challenge(f), paidReceipt(f))
  assert.equal((await f.call({ tx_hash: blockHash, payer_address: payer.address }, encoded)).status, 400)
  const forged = Credential.deserialize<any>(encoded); forged.challenge.request.amount = '1'
  assert.equal((await f.call(undefined, Credential.serialize(forged))).status, 402)
  const cookie = new NextRequest(f.request().url, { method: 'POST', headers: { Cookie: `auth-token=${f.apiKey}`, 'Payment-Authorization': encoded } })
  assert.equal((await fund(cookie, { params: Promise.resolve({ id: f.trade.id }) })).status, 403)
  assert.equal(rpcMethods.length, start)
})
