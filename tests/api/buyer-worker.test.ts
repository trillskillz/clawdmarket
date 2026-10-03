import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, keccak256, parseTransaction, recoverTransactionAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { runBuyerFunding } from '../../scripts/buyer-worker.mjs'
import { createBuyerEvmAdapter } from '../../scripts/buyer-evm-adapter.mjs'
import { buyerWalletReference, withBuyerWalletLock } from '../../scripts/buyer-wallet-lock.mjs'

let directory: string, baseUrl: string, rpcUrl: string
let db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema'), jwt: typeof import('@/lib/auth').generateJWT
const apiServer = createServer(), rpcServer = createServer()
const token = `0x${'44'.repeat(20)}` as const, treasury = privateKeyToAccount(`0x${'99'.repeat(32)}`).address.toLowerCase()
const blockHash = `0x${'55'.repeat(32)}`, requests: string[] = []
const transactions = new Map<string, { raw: `0x${string}`; payer: `0x${string}`; amount: bigint; recipient: `0x${string}`; mined: boolean; nonce: number; timestamp: number }>()
const balances = new Map<string, { token: bigint; native: bigint }>()
let signerIndex = 100, broadcastCalls = 0, loseBroadcastReply = false
let l1Fee = 10_000n, rpcChainId = 8453
const operatorFee = 2_000n
let apiHook: ((path: string, response: Response) => Promise<boolean>) | null = null

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-buyer-worker-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'buyer.db')}`
  process.env.JWT_SECRET = 'dummy-buyer-worker-tests-only'
  process.env.TREASURY_ADDRESS = treasury; process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'99'.repeat(32)}`
  process.env.WEBHOOK_SECRET_KEY = 'dummy-webhook-tests-only'
  process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED = 'true'
  process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED = 'true'
  process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED = 'true'
  delete process.env.CLAWDMARKET_CANONICAL_ORIGIN; delete process.env.CLAWDMARKET_PRODUCTION_READINESS; delete process.env.VERCEL_ENV
  delete process.env.MPP_SECRET_KEY; delete process.env.MPP_SECRET_KEY_CURRENT
  rpcServer.on('request', async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk)
      const input = JSON.parse(Buffer.concat(chunks).toString()), p = input.params
      let result: unknown
      if (input.method === 'eth_chainId') result = `0x${rpcChainId.toString(16)}`
      else if (input.method === 'eth_estimateGas') result = '0xc350'
      else if (input.method === 'eth_maxPriorityFeePerGas' || input.method === 'eth_gasPrice') result = '0x1'
      else if (input.method === 'eth_getTransactionCount') result = `0x${[...transactions.values()].filter((t) => t.payer.toLowerCase() === p[0].toLowerCase()).length.toString(16)}`
      else if (input.method === 'eth_getBalance') result = `0x${balances.get(p[0].toLowerCase())!.native.toString(16)}`
      else if (input.method === 'eth_call') {
        if (p[0].to.toLowerCase() === token) {
          const call = decodeFunctionData({ abi: erc20Abi, data: p[0].data })
          assert.equal(call.functionName, 'balanceOf')
          result = encodeAbiParameters([{ type: 'uint256' }], [balances.get(String(call.args![0]).toLowerCase())!.token])
        } else result = encodeAbiParameters([{ type: 'uint256' }], [p[0].data.slice(0, 10) === '0x49948e0e' ? l1Fee : operatorFee])
      } else if (input.method === 'eth_sendRawTransaction') {
        broadcastCalls += 1
        const raw = p[0] as `0x${string}`, parsed = parseTransaction(raw), payer = await recoverTransactionAddress({ serializedTransaction: raw as Parameters<typeof recoverTransactionAddress>[0]['serializedTransaction'] }), hash = keccak256(raw)
        const transfer = decodeFunctionData({ abi: erc20Abi, data: parsed.data! })
        assert.equal(parsed.to?.toLowerCase(), token); assert.equal(transfer.functionName, 'transfer')
        if (!transactions.has(hash)) {
          assert.equal([...transactions.values()].some((t) => t.payer === payer && t.nonce === parsed.nonce), false)
          const [recipient, amount] = transfer.args! as [typeof token, bigint]
          assert.equal(recipient.toLowerCase(), treasury)
          transactions.set(hash, { raw, payer, amount, recipient, nonce: parsed.nonce!, mined: true, timestamp: Math.floor(Date.now() / 1000) + 1 })
          const balance = balances.get(payer.toLowerCase())!
          balance.token -= amount; balance.native -= parsed.gas! * parsed.maxFeePerGas! + l1Fee + operatorFee
        }
        if (loseBroadcastReply) { loseBroadcastReply = false; outgoing.destroy(); return }
        result = hash
      } else if (input.method === 'eth_getTransactionReceipt') {
        const t = transactions.get(p[0])
        result = !t?.mined ? null : { transactionHash: p[0], blockHash, blockNumber: '0x64', transactionIndex: '0x0', from: t.payer, to: token,
          status: '0x1', cumulativeGasUsed: '0xc350', gasUsed: '0xc350', effectiveGasPrice: '0x1', contractAddress: null, logsBloom: `0x${'00'.repeat(256)}`, type: '0x2',
          logs: [{ address: token, blockHash, blockNumber: '0x64', transactionHash: p[0], transactionIndex: '0x0', logIndex: '0x0', removed: false,
            topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: t.payer, to: t.recipient } }), data: encodeAbiParameters([{ type: 'uint256' }], [t.amount]) }] }
      } else if (input.method === 'eth_getTransactionByHash') {
        const t = transactions.get(p[0]), parsed = t ? parseTransaction(t.raw) : null
        result = !t ? null : { hash: p[0], from: t.payer, to: token, blockHash: t.mined ? blockHash : null, blockNumber: t.mined ? '0x64' : null,
          transactionIndex: t.mined ? '0x0' : null, value: '0x0', gas: `0x${parsed!.gas!.toString(16)}`, gasPrice: '0x1', nonce: `0x${t.nonce.toString(16)}`, input: parsed!.data, type: '0x2', chainId: '0x2105' }
      } else if (input.method === 'eth_blockNumber') result = '0x67'
      else if (input.method === 'eth_getBlockByNumber' || input.method === 'eth_getBlockByHash') result = { hash: blockHash, number: '0x64', timestamp: `0x${(Math.floor(Date.now() / 1000) + 1).toString(16)}`,
        baseFeePerGas: '0x1', gasLimit: '0x1c9c380', gasUsed: '0xc350', transactions: [] }
      else throw new Error(`Unexpected mock RPC method ${input.method}`)
      outgoing.setHeader('Content-Type', 'application/json'); outgoing.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }))
    } catch (error) { outgoing.statusCode = 500; outgoing.end(JSON.stringify({ mock_error: String(error) })) }
  })
  await new Promise<void>((done) => rpcServer.listen(0, '127.0.0.1', done))
  rpcUrl = `http://127.0.0.1:${(rpcServer.address() as { port: number }).port}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Dummy Base', address: token, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl }])
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  const mandate = await import('@/app/api/routes/[id]/mandate/route'), execute = await import('@/app/api/routes/[id]/execute/route'), getRoute = await import('@/app/api/routes/[id]/route')
  const intent = await import('@/app/api/trades/[id]/fund/evm/intent/route'), claim = await import('@/app/api/trades/[id]/fund/evm/claim/route'), fund = await import('@/app/api/trades/[id]/fund/evm/route')
  apiServer.on('request', async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString(), path = incoming.url!
      requests.push(`${incoming.method} ${path}`)
      const request = new NextRequest(`${baseUrl}${path}`, { method: incoming.method, headers: incoming.headers as Record<string, string>, ...(body ? { body } : {}) })
      const id = path.split('/')[3], context = { params: Promise.resolve({ id }) }
      const handler = path.endsWith('/mandate') ? mandate[incoming.method as 'GET' | 'DELETE'] : path.endsWith('/execute') ? execute.POST : path.endsWith('/intent') ? intent[incoming.method as 'GET' | 'POST']
        : path.endsWith('/claim') ? claim.POST : path.endsWith('/fund/evm') ? fund.POST : getRoute.GET
      const response = await handler(request, context)
      if (apiHook && await apiHook(path, response)) { outgoing.destroy(); return }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text())
    } catch { outgoing.statusCode = 500; outgoing.end('{}') }
  })
  await new Promise<void>((done) => apiServer.listen(0, '127.0.0.1', done))
  baseUrl = `http://127.0.0.1:${(apiServer.address() as { port: number }).port}`
  process.env.CLAWDMARKET_CANONICAL_ORIGIN = baseUrl
})
after(async () => {
  await Promise.all([new Promise<void>((done) => apiServer.close(() => done())), new Promise<void>((done) => rpcServer.close(() => done()))])
  db?.$client.close(); await rm(directory, { recursive: true, force: true })
})

async function fixture(reuseDummyKey?: `0x${string}`) {
  const id = crypto.randomUUID(), buyerId = `buyer-${id}`, sellerId = `seller-${id}`, serviceId = crypto.randomUUID()
  const dummyKey = reuseDummyKey ?? `0x${(++signerIndex).toString(16).padStart(64, '0')}` as `0x${string}`, account = privateKeyToAccount(dummyKey)
  if (!balances.has(account.address.toLowerCase())) balances.set(account.address.toLowerCase(), { token: 10_000_000n, native: 1_000_000_000_000_000n })
  await db.insert(schema.users).values([buyerId, sellerId].map((userId) => ({ id: userId, name: userId, email: `${userId}@test.invalid`, password_hash: 'unused', role: 'human' as const })))
  await db.insert(schema.payout_addresses).values({ user_id: sellerId, address: treasury })
  const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } }
  await db.insert(schema.service_definitions).values({ id: serviceId, seller_id: sellerId, title: 'Buyer worker fixture', description: 'Return a private structured review for explicit buyer acceptance.',
    capabilities: '["code-review"]', price_minor: 100, status: 'active', estimated_latency_seconds: 30, max_concurrency: 1, provider_protocol: 'leased_v1',
    output_schema: '{"type":"object","properties":{"result":{"type":"string"}}}', verification_policy: JSON.stringify(policy) })
  const apiKey = jwt({ userId: buyerId, email: `${buyerId}@test.invalid`, role: 'human' })
  const request = (path: string, body: unknown) => new NextRequest(`${baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const planned = await (await import('@/app/api/routes/plan/route')).POST(request('/api/routes/plan', { client_reference: `buyer-plan-${id}`, objective: 'Review private code with explicit buyer review',
    required_capabilities: ['code-review'], input: { private_text: 'fixture private source' }, max_budget: { amount: '5.00', currency: 'USD' }, verification: policy,
    provider_requirements: { approved_providers: [sellerId] }, payment_policy: { allowed_rails: ['evm'] } }))
  assert.equal(planned.status, 201); const routeId = (await planned.json()).route.id
  const created = await (await import('@/app/api/routes/[id]/mandate/route')).POST(request(`/api/routes/${routeId}/mandate`, { version: 1, client_reference: `buyer-mandate-${id}`,
    max_aggregate: '2.00', max_per_execution: '2.00', max_retry_budget: '0.00', max_attempts: 1, approved_providers: [sellerId], max_latency_seconds: 60,
    private_data: 'selected_provider_only', expires_at: new Date(Date.now() + 600_000).toISOString(), payment: { rail: 'evm', chain_id: 8453, token_address: token,
      payer_address: account.address.toLowerCase(), treasury_address: treasury, minimum_token_reserve_units: '5000000', minimum_native_reserve_wei: '1000000', max_gas_cost_wei: '1000000000000' } }), { params: Promise.resolve({ id: routeId }) })
  assert.equal(created.status, 201); const mandate = (await created.json()).mandate
  const approval = { version: 1, origin: baseUrl, route_id: routeId, mandate_id: mandate.id, terms_hash: mandate.terms_hash, chain_id: 8453, rpc_url: rpcUrl }
  const stateDirectory = join(directory, `state-${id}`), adapter = createBuyerEvmAdapter({ chainId: 8453, rpcUrl, account })
  return { approval, apiKey, stateDirectory, account, adapter, dummyKey, buyerId, sellerId, serviceId, mandate, routeId }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function journal(f: Fixture) {
  for (const file of await readdir(f.stateDirectory)) if (file.endsWith('.json')) {
    const value = JSON.parse(await readFile(join(f.stateDirectory, file), 'utf8'))
    if (value.route_id === f.routeId) return { value, path: join(f.stateDirectory, file) }
  }
  assert.fail('Route journal missing')
}
async function assertFundedOnce(f: Fixture, txHash: string) {
  const rows = await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyerId)); assert.equal(rows.length, 1); assert.equal(rows[0].status, 'escrow_held')
  assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, rows[0].id))).length, 1)
  const [order] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, rows[0].id)); assert.equal(order.state, 'funded')
  assert.equal((await db.select().from(schema.service_execution_attempts).where(eq(schema.service_execution_attempts.order_id, order.id))).length, 1)
  const [mandate] = await db.select().from(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.id, f.mandate.id)); assert.equal(mandate.reserved_minor, 105)
  const [claim] = await db.select().from(schema.buyer_evm_payment_claims).where(eq(schema.buyer_evm_payment_claims.mandate_id, f.mandate.id)); assert.equal(claim.state, 'confirmed'); assert.equal(claim.tx_hash, txHash)
  assert.equal([...transactions.values()].filter((t) => t.payer === f.account.address).length, 1)
}

test('buyer worker funds one mandate checkout using exact signed bytes and returns its original receipt on replay', async () => {
  const f = await fixture(), result = await runBuyerFunding(f)
  assert.equal(result.state, 'funded'); await assertFundedOnce(f, result.tx_hash!)
  const before = broadcastCalls, replay = await runBuyerFunding(f); assert.equal(replay.tx_hash, result.tx_hash); assert.equal(broadcastCalls, before)
  const saved = await journal(f); assert.equal(saved.value.submission_started, true); assert.equal(keccak256(saved.value.serialized_transaction), result.tx_hash)
  assert.equal(JSON.stringify(saved.value).includes(f.dummyKey), false); assert.equal(JSON.stringify(saved.value).includes(f.apiKey), false)
})

test('lost intent and claim responses recover their saved operation and signed hash without another economic order', async () => {
  for (const suffix of ['/intent', '/claim']) {
    const f = await fixture(); let lost = false
    apiHook = async (path, response) => { if (!lost && path.endsWith(suffix) && response.ok) { lost = true; return true } return false }
    try { await assert.rejects(() => runBuyerFunding(f), /BUYER_REQUEST_UNCERTAIN_RESUME_SAME_PAYMENT/) } finally { apiHook = null }
    const before = await journal(f), result = await runBuyerFunding(f)
    assert.equal(result.state, 'funded'); await assertFundedOnce(f, result.tx_hash!)
    const after = await journal(f); assert.equal(before.value.operation_id, after.value.operation_id)
    if (suffix === '/claim') assert.equal(before.value.serialized_transaction, after.value.serialized_transaction)
  }
})

test('broadcast and funding responses lost after commit recover the same transfer without signing or submitting again', async () => {
  const broadcast = await fixture(); loseBroadcastReply = true
  await assert.rejects(() => runBuyerFunding(broadcast), /BUYER_BROADCAST_UNCERTAIN_RESUME_SAME_PAYMENT/)
  const saved = await journal(broadcast), count = broadcastCalls
  const recovered = await runBuyerFunding({ ...broadcast, adapter: { ...broadcast.adapter, prepare: async () => assert.fail('must not sign replacement') } })
  assert.equal(recovered.state, 'funded'); assert.equal(recovered.tx_hash, saved.value.tx_hash); assert.equal(broadcastCalls, count); await assertFundedOnce(broadcast, recovered.tx_hash!)
  const funding = await fixture(); let lost = false
  apiHook = async (path, response) => { if (!lost && path.endsWith('/fund/evm') && response.ok) { lost = true; return true } return false }
  try { await assert.rejects(() => runBuyerFunding(funding), /BUYER_REQUEST_UNCERTAIN_RESUME_SAME_PAYMENT/) } finally { apiHook = null }
  const after = broadcastCalls, final = await runBuyerFunding(funding); assert.equal(final.state, 'funded'); assert.equal(broadcastCalls, after); await assertFundedOnce(funding, final.tx_hash!)
})

test('reserve floors, additional rollup fees, wrong chain and missing mandate stop before any broadcast', async () => {
  for (const kind of ['token', 'native', 'fees', 'chain']) {
    const f = await fixture(), count = broadcastCalls, balance = balances.get(f.account.address.toLowerCase())!
    if (kind === 'token') balance.token = 6_049_999n
    if (kind === 'native') balance.native = 1_000_000n
    if (kind === 'fees') l1Fee = 1_000_000_000_000n
    if (kind === 'chain') rpcChainId = 1
    try { await assert.rejects(() => runBuyerFunding(f), /BUYER_(TOKEN_RESERVE_REQUIRED|NATIVE_RESERVE_REQUIRED|WALLET_BOUNDS_INVALID|RPC_CHAIN_MISMATCH)/) }
    finally { l1Fee = 10_000n; rpcChainId = 8453 }
    assert.equal(broadcastCalls, count)
    assert.equal((await db.select().from(schema.buyer_evm_payment_claims).where(eq(schema.buyer_evm_payment_claims.mandate_id, f.mandate.id))).length, 0)
  }
  const f = await fixture(), start = requests.length
  assert.equal((await runBuyerFunding({ approval: { version: 1, origin: baseUrl, route_id: f.routeId }, apiKey: f.apiKey })).state, 'plan_only')
  assert.deepEqual(requests.slice(start), [`GET /api/routes/${f.routeId}`])
})

test('pending confirmation and another route sharing the wallet cannot create a replacement payment', async () => {
  const first = await fixture(), second = await fixture(first.dummyKey), count = broadcastCalls
  await runBuyerFunding({ ...first, prepareOnly: true })
  await assert.rejects(() => runBuyerFunding({ ...second, stateDirectory: first.stateDirectory }), /BUYER_WALLET_PAYMENT_UNRECONCILED/)
  assert.equal(broadcastCalls, count)
  const delayed = { ...first.adapter, broadcast: async (raw: string, signal: AbortSignal) => {
    const hash = await first.adapter.broadcast(raw, signal); transactions.get(hash)!.mined = false; return hash
  } }
  const pending = await runBuyerFunding({ ...first, adapter: delayed }); assert.equal(pending.state, 'awaiting_confirmation')
  const before = broadcastCalls, again = await runBuyerFunding(first); assert.equal(again.state, 'awaiting_confirmation'); assert.equal(again.tx_hash, pending.tx_hash); assert.equal(broadcastCalls, before)
  await assert.rejects(() => runBuyerFunding({ ...second, stateDirectory: first.stateDirectory }), /BUYER_WALLET_PAYMENT_UNRECONCILED/)
  transactions.get(pending.tx_hash!)!.mined = true
  assert.equal((await runBuyerFunding(first)).state, 'funded')
  const next = await runBuyerFunding({ ...second, stateDirectory: first.stateDirectory }); assert.equal(next.state, 'funded')
  const saved = await journal(first); assert.equal(saved.value.tx_hash, pending.tx_hash)
  assert.equal(broadcastCalls, before + 1)
})

test('revocation after a claim response is lost removes broadcast permission but preserves exact recovery state', async () => {
  const f = await fixture(), count = broadcastCalls; let lost = false
  apiHook = async (path, response) => { if (!lost && path.endsWith('/claim') && response.ok) { lost = true; return true } return false }
  try { await assert.rejects(() => runBuyerFunding(f), /BUYER_REQUEST_UNCERTAIN_RESUME_SAME_PAYMENT/) } finally { apiHook = null }
  const saved = await journal(f), revoke = await fetch(`${baseUrl}/api/routes/${f.routeId}/mandate`, { method: 'DELETE', headers: { Authorization: `Bearer ${f.apiKey}` } })
  assert.equal(revoke.status, 200)
  const resumed = await runBuyerFunding(f); assert.equal(resumed.state, 'held_recover_existing_payment'); assert.equal(resumed.tx_hash, saved.value.tx_hash); assert.equal(broadcastCalls, count)
  const [claim] = await db.select().from(schema.buyer_evm_payment_claims).where(eq(schema.buyer_evm_payment_claims.mandate_id, f.mandate.id)); assert.equal(claim.state, 'claimed')
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyerId)); assert.equal(trade.status, 'pending')
  assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, trade.id))).length, 0)
})

test('closing production rollout denies fresh claims and removes send permission from saved claims', async () => {
  const fresh = await fixture(), claimed = await fixture(), count = broadcastCalls
  await runBuyerFunding({ ...fresh, prepareOnly: true })
  let lost = false
  apiHook = async (path, response) => { if (!lost && path.endsWith('/claim') && response.ok) { lost = true; return true } return false }
  try { await assert.rejects(() => runBuyerFunding(claimed), /BUYER_REQUEST_UNCERTAIN_RESUME_SAME_PAYMENT/) } finally { apiHook = null }
  const saved = await journal(claimed)
  const environment = process.env as Record<string, string | undefined>
  const names = ['NODE_ENV', 'CLAWDMARKET_ROUTE_EXECUTION_ENABLED', 'CLAWDMARKET_ROUTE_CANARY_BUYER_ID', 'CLAWDMARKET_ROUTE_CANARY_SELLER_ID']
  const previous = names.map((name) => environment[name])
  environment.NODE_ENV = 'production'
  for (const name of names.slice(1)) delete environment[name]
  try {
    await assert.rejects(() => runBuyerFunding(fresh), /BUYER_HTTP_409/)
    assert.equal((await db.select().from(schema.buyer_evm_payment_claims).where(eq(schema.buyer_evm_payment_claims.mandate_id, fresh.mandate.id))).length, 0)
    const resumed = await runBuyerFunding(claimed)
    assert.equal(resumed.state, 'held_recover_existing_payment'); assert.equal(resumed.tx_hash, saved.value.tx_hash)
    const [claim] = await db.select().from(schema.buyer_evm_payment_claims).where(eq(schema.buyer_evm_payment_claims.mandate_id, claimed.mandate.id))
    assert.equal(claim.state, 'claimed'); assert.equal(broadcastCalls, count)
    assert.equal((await journal(claimed)).value.serialized_transaction, saved.value.serialized_transaction)
  } finally {
    names.forEach((name, index) => { if (previous[index] === undefined) delete environment[name]; else environment[name] = previous[index] })
  }
})

test('operation identity cannot adopt a legacy intent or bypass its mandatory signed claim', async () => {
  const f = await fixture(); await runBuyerFunding({ ...f, prepareOnly: true })
  const saved = (await journal(f)).value, path = `${baseUrl}/api/trades/${saved.trade_id}/fund/evm`
  const headers = { Authorization: `Bearer ${f.apiKey}`, 'Content-Type': 'application/json' }
  const proof = { intent_id: saved.intent.id, chain_id: 8453, token_address: token, payer_address: f.account.address,
    tx_hash: saved.tx_hash, payer_signature: saved.payer_signature }
  const deniedProof = await fetch(path, { method: 'POST', headers, body: JSON.stringify(proof) })
  assert.equal(deniedProof.status, 409); assert.equal((await deniedProof.json()).code, 'BUYER_PAYMENT_CLAIM_REQUIRED')
  const missingOperation = await fetch(`${path}/claim`, { method: 'POST', headers, body: JSON.stringify({ intent_id: saved.intent.id,
    mandate_id: f.mandate.id, serialized_transaction: saved.serialized_transaction, payer_signature: saved.payer_signature }) })
  assert.equal(missingOperation.status, 409); assert.equal((await missingOperation.json()).code, 'BUYER_OPERATION_CONFLICT')
  const conflicting = await fetch(`${path}/intent`, { method: 'POST', headers, body: JSON.stringify({ chain_id: 8453,
    token_address: token, payer_address: f.account.address, buyer_operation_id: crypto.randomUUID() }) })
  assert.equal(conflicting.status, 409); assert.equal((await conflicting.json()).code, 'BUYER_OPERATION_CONFLICT')
  assert.equal((await runBuyerFunding(f)).state, 'funded')
  const legacy = await fixture(), reserved = await fetch(`${baseUrl}/api/routes/${legacy.routeId}/execute`, { method: 'POST',
    headers: { Authorization: `Bearer ${legacy.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ mandate_id: legacy.mandate.id }) })
  const legacyTrade = (await reserved.json()).trade
  const created = await fetch(`${baseUrl}/api/trades/${legacyTrade.id}/fund/evm/intent`, { method: 'POST',
    headers: { Authorization: `Bearer ${legacy.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ chain_id: 8453, token_address: token, payer_address: legacy.account.address }) })
  assert.equal(created.status, 201)
  const count = broadcastCalls
  await assert.rejects(() => runBuyerFunding(legacy), /BUYER_HTTP_409/); assert.equal(broadcastCalls, count)
})

test('SIGKILL after the server claims the durable bytes recovers in a new buyer process without resigning', async () => {
  const f = await fixture(), approvalFile = join(directory, `${f.routeId}.kill-approval.json`)
  await writeFile(approvalFile, JSON.stringify(f.approval), { mode: 0o600 })
  let ready!: () => void, release!: () => void
  const claimed = new Promise<void>((done) => { ready = done }), gate = new Promise<void>((done) => { release = done })
  apiHook = async (path, response) => { if (path.endsWith('/claim') && response.ok) { ready(); await gate } return false }
  const args = ['scripts/buyer-worker.mjs', approvalFile, f.stateDirectory], environment = { ...process.env,
    CLAWDMARKET_BUYER_PRIVATE_KEY: f.dummyKey, CLAWDMARKET_BUYER_API_KEY: f.apiKey }
  const child = spawn(process.execPath, args, { cwd: resolve('.'), env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  const timer = setTimeout(() => { child.kill('SIGKILL'); release() }, 15_000)
  try {
    await claimed
    const saved = await journal(f), count = broadcastCalls
    assert.equal(saved.value.submission_started, false)
    const exited = new Promise<void>((done) => child.once('exit', () => done())); child.kill('SIGKILL'); await exited
    apiHook = null; release()
    const result = JSON.parse((await promisify(execFile)(process.execPath, args, { cwd: resolve('.'), env: environment })).stdout)
    assert.equal(result.state, 'funded'); assert.equal(result.tx_hash, saved.value.tx_hash)
    assert.equal((await journal(f)).value.serialized_transaction, saved.value.serialized_transaction); assert.equal(broadcastCalls, count + 1)
    await assertFundedOnce(f, result.tx_hash)
  } finally { clearTimeout(timer); apiHook = null; release(); child.kill('SIGKILL') }
})

test('a persisted signed payment survives a separate process restart, and secrets stay off output and journals', async () => {
  const f = await fixture(), approvalFile = join(directory, `${f.routeId}.approval.json`)
  await writeFile(approvalFile, JSON.stringify(f.approval), { mode: 0o600 })
  const args = ['scripts/buyer-worker.mjs', approvalFile, f.stateDirectory]
  const cli = (extra: string[] = []) => promisify(execFile)(process.execPath, [...args, ...extra], { cwd: resolve('.'), env: { ...process.env,
    CLAWDMARKET_BUYER_PRIVATE_KEY: f.dummyKey, CLAWDMARKET_BUYER_API_KEY: f.apiKey } })
  const prepared = await cli(['--prepare-only']); assert.equal(JSON.parse(prepared.stdout).state, 'prepared')
  const original = await journal(f); assert.equal(original.value.submission_started, false)
  const funded = await cli(), result = JSON.parse(funded.stdout); assert.equal(result.state, 'funded'); assert.equal(result.tx_hash, original.value.tx_hash)
  const final = await journal(f); assert.equal(final.value.serialized_transaction, original.value.serialized_transaction); await assertFundedOnce(f, result.tx_hash)
  assert.equal((prepared.stdout + prepared.stderr + funded.stdout + funded.stderr).includes(f.dummyKey), false)
  assert.equal((prepared.stdout + prepared.stderr + funded.stdout + funded.stderr).includes(f.apiKey), false)
})

test('shared wallet kernel lock rejects competitors and releases after SIGKILL without permitting a new payment', async () => {
  const f = await fixture()
  await runBuyerFunding({ ...f, prepareOnly: true })
  const locked = await new Promise<{ child: ReturnType<typeof spawn>; output: string }>((done, reject) => {
    const modulePath = new URL('../../scripts/buyer-wallet-lock.mjs', import.meta.url).href
    const code = `import {withBuyerWalletLock} from ${JSON.stringify(modulePath)}; await withBuyerWalletLock(process.argv[1],8453,process.argv[2],async()=>{process.stdout.write('locked\\n'); await new Promise(()=>{});});`
    const child = spawn(process.execPath, ['--input-type=module', '-e', code, f.stateDirectory, f.account.address], { stdio: ['ignore', 'pipe', 'pipe'] })
    child.once('error', reject); child.stdout.once('data', (bytes) => done({ child, output: bytes.toString() }))
  })
  assert.equal(locked.output, 'locked\n')
  try { await assert.rejects(() => runBuyerFunding(f), /BUYER_WALLET_IN_USE/) }
  finally { locked.child.kill('SIGKILL'); await new Promise<void>((done) => locked.child.once('exit', () => done())) }
  let recovered: Awaited<ReturnType<typeof runBuyerFunding>> | undefined
  for (let retry = 0; retry < 10; retry++) {
    try { recovered = await runBuyerFunding(f); break } catch (error) {
      if (!(error instanceof Error) || error.message !== 'BUYER_WALLET_IN_USE') throw error
      await new Promise((done) => setTimeout(done, 30))
    }
  }
  assert.equal(recovered?.state, 'funded'); await assertFundedOnce(f, recovered!.tx_hash!)
  const reference = buyerWalletReference(8453, f.account.address)
  assert.equal((await readdir(f.stateDirectory)).includes(`${reference}.lock`), true)
  await assert.rejects(() => withBuyerWalletLock(f.stateDirectory, 8453, f.account.address, async () => { await runBuyerFunding(f) }), /BUYER_WALLET_IN_USE/)
})
