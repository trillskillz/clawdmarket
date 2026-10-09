import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises'
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
import { runBuyerRoute } from '../../scripts/buyer-route-worker.mjs'
import { runBuyerWorkflow } from '../../scripts/buyer-workflow-worker.mjs'
import { runProviderWork } from '../../scripts/provider-worker.mjs'

let directory: string, baseUrl: string, rpcUrl: string
let db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema'), jwt: typeof import('@/lib/auth').generateJWT
const apiServer = createServer(), rpcServer = createServer()
const token = `0x${'44'.repeat(20)}` as const, treasury = privateKeyToAccount(`0x${'99'.repeat(32)}`).address.toLowerCase()
const blockHash = `0x${'55'.repeat(32)}`, requests: string[] = []
const transactions = new Map<string, { raw: `0x${string}`; payer: `0x${string}`; amount: bigint; recipient: `0x${string}`; mined: boolean; nonce: number; timestamp: number }>()
const balances = new Map<string, { token: bigint; native: bigint }>()
let signerIndex = 100, broadcastCalls = 0, loseBroadcastReply = false
let l1Fee = 10_000n, rpcChainId = 8453
let minePayout = true
const operatorFee = 2_000n
let apiHook: ((path: string, response: Response) => Promise<boolean>) | null = null

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-buyer-worker-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'buyer.db')}`
  process.env.JWT_SECRET = 'dummy-buyer-worker-tests-only'
  process.env.TREASURY_ADDRESS = treasury; process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'99'.repeat(32)}`
  process.env.WEBHOOK_SECRET_KEY = 'dummy-webhook-tests-only'
  process.env.CHAT_ENCRYPTION_KEY = 'dummy-route-worker-private-chat-tests-only'
  balances.set(treasury, { token: 10_000_000n, native: 1_000_000_000_000_000n })
  process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED = 'true'
  process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED = 'true'
  process.env.CLAWDMARKET_WORKFLOW_PLANNING_ENABLED = 'true'; process.env.CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED = 'true'
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
          if (payer.toLowerCase() !== treasury) assert.equal(recipient.toLowerCase(), treasury)
          else assert.equal(balances.has(recipient.toLowerCase()), true)
          transactions.set(hash, { raw, payer, amount, recipient, nonce: parsed.nonce!, mined: payer.toLowerCase() !== treasury || minePayout, timestamp: Math.floor(Date.now() / 1000) + 1 })
          const balance = balances.get(payer.toLowerCase())!
          balance.token -= amount; balance.native -= parsed.gas! * parsed.maxFeePerGas! + l1Fee + operatorFee
          if (payer.toLowerCase() === treasury && recipient.toLowerCase() !== treasury) balances.get(recipient.toLowerCase())!.token += amount
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
    } catch { outgoing.statusCode = 500; outgoing.end(JSON.stringify({ mock_error: 'Mock RPC failed' })) }
  })
  await new Promise<void>((done) => rpcServer.listen(0, '127.0.0.1', done))
  rpcUrl = `http://127.0.0.1:${(rpcServer.address() as { port: number }).port}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Dummy Base', address: token, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl }])
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  const mandate = await import('@/app/api/routes/[id]/mandate/route'), execute = await import('@/app/api/routes/[id]/execute/route'), getRoute = await import('@/app/api/routes/[id]/route')
  const intent = await import('@/app/api/trades/[id]/fund/evm/intent/route'), claim = await import('@/app/api/trades/[id]/fund/evm/claim/route'), fund = await import('@/app/api/trades/[id]/fund/evm/route')
  const advance = await import('@/app/api/routes/[id]/advance/route'), work = await import('@/app/api/trades/[id]/work-order/route')
  const retry = await import('@/app/api/routes/[id]/retry/route')
  const attempt = await import('@/app/api/trades/[id]/work-order/attempt/route'), delivery = await import('@/app/api/trades/[id]/delivery/route')
  const result = await import('@/app/api/routes/[id]/result/route'), artifacts = await import('@/app/api/trades/[id]/artifacts/route')
  const download = await import('@/app/api/trades/[id]/artifacts/[artifactId]/route')
  apiServer.on('request', async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString(), path = incoming.url!
      requests.push(`${incoming.method} ${path}`)
      const request = new NextRequest(`${baseUrl}${path}`, { method: incoming.method, headers: incoming.headers as Record<string, string>, ...(body ? { body } : {}) })
      const id = path.split('/')[3], context = { params: Promise.resolve({ id, artifactId: path.split('/')[5] || '', grantId: path.split('/')[5] || '', key: path.split('/')[5] || '' }) }
      const workflowHandler = !path.startsWith('/api/workflows/') ? null : path === '/api/workflows/plan' ? (await import('@/app/api/workflows/plan/route')).POST
        : path.endsWith('/approval') ? (await import('@/app/api/workflows/[id]/approval/route'))[incoming.method as 'GET' | 'POST' | 'DELETE']
        : path.endsWith('/execute') ? (await import('@/app/api/workflows/[id]/execute/route'))[incoming.method as 'GET' | 'POST']
        : path.endsWith('/prepare') ? (await import('@/app/api/workflows/[id]/nodes/[key]/prepare/route')).POST
        : path.endsWith('/reconcile') ? (await import('@/app/api/workflows/[id]/reconcile/route')).POST
        : path.includes('/artifacts/') ? (await import('@/app/api/workflows/[id]/artifacts/[grantId]/route')).GET : null
      const handler = workflowHandler || (path === '/api/mcp' ? (await import('@/app/api/mcp/route')).POST : path === '/api/a2a' ? (await import('@/app/api/a2a/route')).POST : path.endsWith('/mandate') ? mandate[incoming.method as 'GET' | 'DELETE'] : path.endsWith('/execute') ? execute.POST : path.endsWith('/intent') ? intent[incoming.method as 'GET' | 'POST']
        : path.endsWith('/claim') ? claim.POST : path.endsWith('/fund/evm') ? fund.POST : path.endsWith('/retry') ? retry[incoming.method as 'GET' | 'POST'] : path.endsWith('/advance') ? advance[incoming.method as 'GET' | 'POST']
          : path.endsWith('/work-order') ? work.GET : path.endsWith('/attempt') ? attempt.POST : path.endsWith('/delivery') ? delivery.POST
            : path.endsWith('/result') ? result.GET : path.endsWith('/artifacts') ? artifacts.POST : path.includes('/artifacts/') ? download.GET : getRoute.GET)
      const response = await handler(request, context)
      if (apiHook && await apiHook(path, response)) { outgoing.destroy(); return }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()))
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

async function fixture(reuseDummyKey?: `0x${string}`, retryLimits?: { maxAggregate?: string; maxRetry?: string; maxAttempts?: number }, agentParties = false) {
  const id = crypto.randomUUID(), buyerId = agentParties ? `user_agent_${id}` : `buyer-${id}`, sellerId = agentParties ? `user_agent_seller_${id}` : `seller-${id}`, serviceId = crypto.randomUUID()
  const ownerId = agentParties ? `owner-${id}` : buyerId, sellerOwnerId = `provider-owner-${id}`
  const dummyKey = reuseDummyKey ?? `0x${(++signerIndex).toString(16).padStart(64, '0')}` as `0x${string}`, account = privateKeyToAccount(dummyKey)
  if (!balances.has(account.address.toLowerCase())) balances.set(account.address.toLowerCase(), { token: 10_000_000n, native: 1_000_000_000_000_000n })
  await db.insert(schema.users).values([...new Set([buyerId, sellerId, ownerId, ...(agentParties ? [sellerOwnerId] : [])])].map((userId) => ({ id: userId, name: userId, email: `${userId}@test.invalid`, password_hash: 'unused', role: 'human' as const })))
  await db.insert(schema.payout_addresses).values({ user_id: sellerId, address: treasury })
  const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } }
  await db.insert(schema.service_definitions).values({ id: serviceId, seller_id: sellerId, title: 'Buyer worker fixture', description: 'Return a private structured review for explicit buyer acceptance.',
    capabilities: '["code-review"]', price_minor: 100, status: 'active', estimated_latency_seconds: 30, max_concurrency: 1, provider_protocol: 'leased_v1',
    output_schema: '{"type":"object","properties":{"result":{"type":"string"}}}', verification_policy: JSON.stringify(policy) })
  const fallbackSellerId = retryLimits ? `fallback-${id}` : undefined, fallbackServiceId = retryLimits ? crypto.randomUUID() : undefined
  if (fallbackSellerId && fallbackServiceId) {
    await db.insert(schema.users).values({ id: fallbackSellerId, name: fallbackSellerId, email: `${fallbackSellerId}@test.invalid`, password_hash: 'unused', role: 'human' })
    await db.insert(schema.payout_addresses).values({ user_id: fallbackSellerId, address: treasury })
    await db.insert(schema.service_definitions).values({ id: fallbackServiceId, seller_id: fallbackSellerId, title: 'Approved fallback fixture', description: 'Return the same agreed structured review after a fully reconciled provider failure.',
      capabilities: '["code-review"]', price_minor: 110, status: 'active', estimated_latency_seconds: 30, max_concurrency: 1, provider_protocol: 'leased_v1',
      output_schema: '{"type":"object","properties":{"result":{"type":"string"}}}', verification_policy: JSON.stringify(policy) })
  }
  const approvedProviders = fallbackSellerId ? [sellerId, fallbackSellerId] : [sellerId]
  let apiKey = jwt({ userId: buyerId, email: `${buyerId}@test.invalid`, role: 'human' })
  if (agentParties) {
    await db.insert(schema.agents).values([{ id, name: 'Dummy buyer agent', description: 'Private buyer integration fixture for evidence tests.', capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused-buyer' },
      { id: `seller_${id}`, name: 'Dummy provider agent', description: 'Independent-owner provider integration fixture for evidence tests.', capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused-seller' }])
    await db.insert(schema.agent_owners).values([{ agentId: id, userId: ownerId, establishedBy: 'test' }, { agentId: `seller_${id}`, userId: sellerOwnerId, establishedBy: 'test' }])
    const key = await (await import('@/lib/agent-named-credentials')).createNamedAgentCredential({ agentId: id, name: 'Dummy buyer payments', scopes: ['agent:read', 'payments:write', 'marketplace:write'], actorCredentialId: null })
    if (key.kind !== 'created') assert.fail('Dummy agent key unavailable')
    apiKey = key.api_key
  }
  const ownerKey = jwt({ userId: ownerId, email: `${ownerId}@test.invalid`, role: 'human' })
  const request = (path: string, body: unknown) => new NextRequest(`${baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const planned = await (await import('@/app/api/routes/plan/route')).POST(request('/api/routes/plan', { client_reference: `buyer-plan-${id}`, objective: 'Review private code with explicit buyer review',
    required_capabilities: ['code-review'], input: { private_text: 'fixture private source' }, max_budget: { amount: '5.00', currency: 'USD' }, verification: policy,
    provider_requirements: { approved_providers: approvedProviders }, payment_policy: { allowed_rails: ['evm'] },
    ...(retryLimits ? { retry_policy: { max_attempts: retryLimits.maxAttempts ?? 2 }, deadline_seconds: 300 } : {}) }))
  assert.equal(planned.status, 201); const routeId = (await planned.json()).route.id
  const mandateRequest = (path: string, body: unknown) => new NextRequest(`${baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${ownerKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const created = await (await import('@/app/api/routes/[id]/mandate/route')).POST(mandateRequest(`/api/routes/${routeId}/mandate`, { version: 1, client_reference: `buyer-mandate-${id}`,
    max_aggregate: retryLimits?.maxAggregate ?? (retryLimits ? '3.50' : '2.00'), max_per_execution: '2.00', max_retry_budget: retryLimits?.maxRetry ?? (retryLimits ? '1.16' : '0.00'),
    max_attempts: retryLimits?.maxAttempts ?? (retryLimits ? 2 : 1), approved_providers: approvedProviders, max_latency_seconds: 60,
    private_data: 'selected_provider_only', expires_at: new Date(Date.now() + 600_000).toISOString(), payment: { rail: 'evm', chain_id: 8453, token_address: token,
      payer_address: account.address.toLowerCase(), treasury_address: treasury, minimum_token_reserve_units: '5000000', minimum_native_reserve_wei: '1000000', max_gas_cost_wei: '1000000000000' } }), { params: Promise.resolve({ id: routeId }) })
  assert.equal(created.status, 201); const mandate = (await created.json()).mandate
  const approval = { version: 1, origin: baseUrl, route_id: routeId, mandate_id: mandate.id, terms_hash: mandate.terms_hash, chain_id: 8453, rpc_url: rpcUrl }
  const stateDirectory = join(directory, `state-${id}`), adapter = createBuyerEvmAdapter({ chainId: 8453, rpcUrl, account })
  return { approval, apiKey, stateDirectory, account, adapter, dummyKey, buyerId, sellerId, serviceId, ownerId, sellerOwnerId, fallbackSellerId, fallbackServiceId, mandate, routeId }
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

test('buyer route worker drives authorized funding, provider delivery and explicit hash-bound settlement to one backed private receipt', async () => {
  const f = await fixture(), count = broadcastCalls
  const funded = await runBuyerRoute(f); assert.equal(funded.state, 'funded'); assert.equal(broadcastCalls, count + 1)
  const providerKey = jwt({ userId: f.sellerId, email: `${f.sellerId}@test.invalid`, role: 'human' })
  const privateBytes = Buffer.from('Private provider report; keep the contents off receipt and CLI output.')
  const delivered = await runProviderWork({ baseUrl, apiKey: providerKey, tradeId: funded.trade_id!, serviceId: f.serviceId,
    stateFile: join(directory, `${f.routeId}.provider.json`), handler: async () => ({ summary: 'Provider reviewed the private source for explicit acceptance.', artifact: { result: 'private-completed-output' },
      files: [{ name: 'private-report.txt', media_type: 'text/plain', content_base64: privateBytes.toString('base64'), sha256: createHash('sha256').update(privateBytes).digest('hex') }] }) })
  const decision = { version: 1, route_id: f.routeId, decision: 'accept', content_hash: delivered.content_hash }
  await assert.rejects(() => runBuyerRoute({ ...f, decision, fetcher: async (input, init) => {
    const response = await fetch(input, init)
    return String(input).includes('/artifacts/') ? new Response(Buffer.alloc(privateBytes.length), { headers: response.headers }) : response
  } }), /BUYER_ARTIFACT_INTEGRITY_FAILED/)
  assert.equal((await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, funded.trade_id!))).length, 0)
  const waiting = await runBuyerRoute(f); assert.equal(waiting.state, 'awaiting_buyer'); assert.equal(broadcastCalls, count + 1)
  assert.equal(waiting.delivery?.content_hash, delivered.content_hash); assert.equal(waiting.receipt, null)
  assert.ok(waiting.result_file); assert.equal(waiting.artifact_files!.length, 1)
  assert.deepEqual(await readFile(waiting.artifact_files![0].path), privateBytes)
  assert.equal((await stat(waiting.artifact_files![0].path)).mode & 0o777, 0o600)
  assert.equal(JSON.stringify(waiting).includes(privateBytes.toString()), false)
  const wrong = { version: 1, route_id: f.routeId, decision: 'accept', content_hash: 'a'.repeat(64) }
  await assert.rejects(() => runBuyerRoute({ ...f, decision: wrong }), /BUYER_DELIVERY_CHANGED/)
  const outcome = await runBuyerRoute({ ...f, decision }); assert.equal(outcome.state, 'completed', JSON.stringify(outcome))
  assert.equal(broadcastCalls, count + 2); assert.equal(outcome.receipt?.receipt.financial.kind, 'confirmed_external')
  const receipt = outcome.receipt!.receipt
  assert.equal(receipt.verification.semantic_verified, false); assert.equal(receipt.buyer_decision.content_hash, delivered.content_hash)
  assert.equal(receipt.capacity_released, true)
  for (const privateValue of [f.buyerId, f.sellerId, f.account.address.toLowerCase(), treasury, 'fixture private source', 'private-completed-output']) {
    assert.equal(JSON.stringify(receipt).includes(privateValue), false)
  }
  const duplicate = await runBuyerRoute(f); assert.deepEqual(duplicate.receipt, outcome.receipt); assert.equal(broadcastCalls, count + 2)
  const receipts = await db.select().from(schema.route_receipts).where(eq(schema.route_receipts.route_id, f.routeId)); assert.equal(receipts.length, 1)
  const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.serviceId)); assert.equal(service.active_orders, 0)
  const { inspectRouteReceiptHealth } = await import('@/lib/route-receipt-health.mjs')
  assert.equal((await inspectRouteReceiptHealth(db.$client)).receipt_anomaly_count, 0)
  await db.update(schema.route_receipts).set({ receipt_json: '{"invalid":"dummy receipt corruption"}' }).where(eq(schema.route_receipts.route_id, f.routeId))
  const health = await inspectRouteReceiptHealth(db.$client); assert.equal(health.receipt_anomaly_count, 1)
  assert.equal(JSON.stringify(health).includes(f.buyerId), false); assert.equal(JSON.stringify(health).includes(f.account.address), false)
  await db.update(schema.route_receipts).set({ receipt_json: receipts[0].receipt_json }).where(eq(schema.route_receipts.route_id, f.routeId))
  assert.equal((await runProviderWork({ baseUrl, apiKey: providerKey, tradeId: funded.trade_id!, serviceId: f.serviceId,
    stateFile: join(directory, `${f.routeId}.provider.json`), handler: async () => assert.fail('Must recover original provider output') })).idempotent, true)
})

async function routeDelivery(f: Fixture) {
  const funded = await runBuyerRoute(f)
  const providerKey = jwt({ userId: f.sellerId, email: `${f.sellerId}@test.invalid`, role: 'human' })
  const delivery = await runProviderWork({ baseUrl, apiKey: providerKey, tradeId: funded.trade_id!, serviceId: f.serviceId,
    stateFile: join(directory, `${f.routeId}.provider.json`), handler: async () => ({ summary: 'Provider delivered private results for explicit buyer review.', artifact: { result: 'private-route-result' } }) })
  return { funded, delivery, decision: { version: 1, route_id: f.routeId, decision: 'accept', content_hash: delivery.content_hash } }
}

test('pending payout keeps capacity and cannot report completed; original outbox recovery settles once', async () => {
  const f = await fixture(), { funded, decision } = await routeDelivery(f)
  minePayout = false
  let pending: Awaited<ReturnType<typeof runBuyerRoute>>
  try { pending = await runBuyerRoute({ ...f, decision }) } finally { minePayout = true }
  assert.equal(pending.state, 'settling'); assert.equal(pending.receipt, null)
  const [plan] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, f.routeId)); assert.equal(plan.state, 'settling')
  const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.serviceId)); assert.equal(service.active_orders, 1)
  const [outbox] = await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, funded.trade_id!))
  assert.equal(outbox.status, 'submitted'); assert.ok(outbox.tx_hash); transactions.get(outbox.tx_hash!)!.mined = true
  const result = await runBuyerRoute(f); assert.equal(result.state, 'completed'); assert.equal(result.receipt?.receipt.financial.payout.tx_hash, outbox.tx_hash)
  assert.equal((await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, funded.trade_id!))).length, 1)
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.serviceId)))[0].active_orders, 0)
})

test('lost acceptance response replays the saved buyer decision without a new payout or receipt', async () => {
  const f = await fixture(), { decision } = await routeDelivery(f), count = broadcastCalls; let lost = false
  apiHook = async (path, response) => { if (!lost && path.endsWith('/advance') && response.ok && (await response.clone().json()).phase === 'completed') { lost = true; return true } return false }
  try { await assert.rejects(() => runBuyerRoute({ ...f, decision }), /BUYER_REQUEST_UNCERTAIN_RESUME_SAME_ROUTE/) } finally { apiHook = null }
  assert.equal(lost, true); assert.equal(broadcastCalls, count + 1)
  const result = await runBuyerRoute(f); assert.equal(result.state, 'completed'); assert.equal(broadcastCalls, count + 1)
  assert.equal((await db.select().from(schema.route_receipts).where(eq(schema.route_receipts.route_id, f.routeId))).length, 1)
})

test('a separate route worker process recovers SIGKILL after accepted settlement commit with the original decision', async () => {
  const f = await fixture(), { decision } = await routeDelivery(f), approvalFile = join(directory, `${f.routeId}.route-approval.json`), decisionFile = join(directory, `${f.routeId}.decision.json`)
  await writeFile(approvalFile, JSON.stringify(f.approval), { mode: 0o600 }); await writeFile(decisionFile, JSON.stringify(decision), { mode: 0o600 })
  let ready!: () => void, release!: () => void
  const settled = new Promise<void>((done) => { ready = done }), gate = new Promise<void>((done) => { release = done })
  apiHook = async (path, response) => { if (path.endsWith('/advance') && response.ok && (await response.clone().json()).phase === 'completed') { ready(); await gate } return false }
  const args = ['scripts/buyer-route-worker.mjs', approvalFile, f.stateDirectory, decisionFile], environment = { ...process.env,
    CLAWDMARKET_BUYER_PRIVATE_KEY: f.dummyKey, CLAWDMARKET_BUYER_API_KEY: f.apiKey }, count = broadcastCalls
  const child = spawn(process.execPath, args, { cwd: resolve('.'), env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''; child.stderr.on('data', (bytes) => { stderr += bytes.toString() })
  const timer = setTimeout(() => { child.kill('SIGKILL'); release() }, 15_000)
  try {
    await Promise.race([settled, new Promise<never>((_, reject) => child.once('exit', () => reject(new Error(`Dummy route worker exited: ${stderr}`))))])
    const exited = new Promise<void>((done) => child.once('exit', () => done())); child.kill('SIGKILL'); await exited
    apiHook = null; release()
    const output = await promisify(execFile)(process.execPath, args.slice(0, 3), { cwd: resolve('.'), env: environment }), result = JSON.parse(output.stdout)
    assert.equal(result.state, 'completed'); assert.equal(result.receipt.receipt.buyer_decision.content_hash, decision.content_hash)
    assert.equal(broadcastCalls, count + 1); assert.equal((output.stdout + output.stderr).includes(f.dummyKey), false)
    assert.equal((output.stdout + output.stderr).includes(f.apiKey), false)
  } finally { clearTimeout(timer); apiHook = null; release(); child.kill('SIGKILL') }
})

test('completion flags without payout proof never produce a backed route receipt; acceptance is buyer/hash scoped', async () => {
  const f = await fixture(), { funded, delivery } = await routeDelivery(f)
  const path = `${baseUrl}/api/routes/${f.routeId}/advance`, headers = { Authorization: `Bearer ${f.apiKey}`, 'Content-Type': 'application/json' }
  const invalid = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ version: 1, action: 'accept', content_hash: 'b'.repeat(64) }) })
  assert.equal(invalid.status, 409); assert.equal((await invalid.json()).code, 'DELIVERY_CHANGED')
  assert.equal((await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, action: 'observe' }) })).status, 401)
  const stranger = jwt({ userId: f.sellerId, email: `${f.sellerId}@test.invalid`, role: 'human' })
  assert.equal((await fetch(path, { headers: { Authorization: `Bearer ${stranger}` } })).status, 404)
  const { advanceBuyerReview } = await import('@/lib/verification-evidence')
  await db.transaction((tx) => advanceBuyerReview(tx, funded.trade_id!, 'passed', delivery.content_hash))
  await db.update(schema.trades).set({ status: 'completed', payout_status: 'complete', completed_at: new Date() }).where(eq(schema.trades.id, funded.trade_id!))
  const response = await fetch(path, { method: 'POST', headers, body: JSON.stringify({ version: 1, action: 'observe' }) })
  const result = await response.json(); assert.equal(result.phase, 'financial_uncertainty'); assert.equal(result.receipt, null)
  assert.equal((await db.select().from(schema.route_receipts).where(eq(schema.route_receipts.route_id, f.routeId))).length, 0)
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.serviceId)))[0].active_orders, 1)
})

async function refundFailedProvider(f: Fixture, tradeId: string) {
  const [order] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, tradeId))
  const [attempt] = await db.select().from(schema.service_execution_attempts).where(eq(schema.service_execution_attempts.order_id, order.id))
  const sellerKey = jwt({ userId: f.sellerId, email: `${f.sellerId}@test.invalid`, role: 'human' })
  const decline = await fetch(`${baseUrl}/api/trades/${tradeId}/work-order/attempt`, { method: 'POST', headers: { Authorization: `Bearer ${sellerKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ attempt_id: attempt.id, action: 'decline' }) })
  assert.equal(decline.status, 201)
  const request = (path: string, body: unknown) => new NextRequest(`${baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${f.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const disputed = await (await import('@/app/api/trades/[id]/dispute/route')).POST(request(`/api/trades/${tradeId}/dispute`, { reason: 'Provider explicitly declined this funded order.' }), { params: Promise.resolve({ id: tradeId }) })
  assert.equal(disputed.status, 200)
  process.env.ADMIN_USER_IDS = f.buyerId
  try {
    const resolved = await (await import('@/app/api/trades/[id]/resolve/route')).POST(request(`/api/trades/${tradeId}/resolve`, { resolution: 'buyer' }), { params: Promise.resolve({ id: tradeId }) })
    assert.equal(resolved.status, 200, JSON.stringify(await resolved.json()))
  } finally { delete process.env.ADMIN_USER_IDS }
}
async function retryCommand(f: Fixture, tradeId: string, operationId = crypto.randomUUID()) {
  return fetch(`${baseUrl}/api/routes/${f.routeId}/retry`, { method: 'POST', headers: { Authorization: `Bearer ${f.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 1, mandate_id: f.approval.mandate_id, previous_trade_id: tradeId, retry_operation_id: operationId }) })
}

test('a declined funded provider is fully reconciled before the buyer worker funds an approved fallback and settles one final receipt', async () => {
  const f = await fixture(undefined, {}), count = broadcastCalls
  const funded = await runBuyerRoute(f)
  const originalDeadline = (await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, f.routeId)))[0].execution_deadline_at
  assert.ok(originalDeadline)
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, funded.trade_id!)))[0].service_id, f.serviceId)
  const early = await retryCommand(f, funded.trade_id!); assert.equal(early.status, 409)
  assert.equal((await early.json()).error_code, 'ROUTE_RETRY_RECONCILIATION_REQUIRED')
  await refundFailedProvider(f, funded.trade_id!)
  const fallback = await runBuyerRoute(f); assert.equal(fallback.state, 'funded', JSON.stringify(fallback)); assert.notEqual(fallback.trade_id, funded.trade_id)
  assert.equal((await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, f.routeId)))[0].execution_deadline_at?.toISOString(), originalDeadline.toISOString())
  const [fallbackOrder] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, fallback.trade_id!))
  assert.equal(fallbackOrder.service_id, f.fallbackServiceId)
  const providerKey = jwt({ userId: f.fallbackSellerId!, email: `${f.fallbackSellerId}@test.invalid`, role: 'human' })
  const delivery = await runProviderWork({ baseUrl, apiKey: providerKey, tradeId: fallback.trade_id!, serviceId: f.fallbackServiceId!, stateFile: join(directory, `${f.routeId}.fallback.json`),
    handler: async () => ({ summary: 'The approved fallback completed the original agreed objective.', artifact: { result: 'fallback-private-output' } }) })
  const result = await runBuyerRoute({ ...f, decision: { version: 1, route_id: f.routeId, decision: 'accept', content_hash: delivery.content_hash } })
  assert.equal(result.state, 'completed', JSON.stringify(result)); assert.equal(broadcastCalls, count + 4)
  const attempts = result.receipt!.receipt.attempts
  assert.equal(attempts.length, 2); assert.equal(attempts[0].failure_code, 'PROVIDER_DECLINED')
  assert.equal(attempts[0].economic.transfers[0].kind, 'buyer_refund'); assert.equal(attempts[0].economic.transfers[0].status, 'confirmed')
  assert.ok(attempts[0].economic.capacity_released_at); assert.ok(attempts[1].economic.capacity_released_at)
  assert.equal((await db.select().from(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.id, f.mandate.id)))[0].reserved_minor, 221)
  assert.equal((await db.select().from(schema.route_funding_steps).where(eq(schema.route_funding_steps.route_id, f.routeId))).length, 1)
  assert.equal((await db.select().from(schema.route_retry_funding_steps).where(eq(schema.route_retry_funding_steps.route_id, f.routeId))).length, 1)
  const health = await (await import('@/lib/route-funding-health.mjs')).inspectRouteFundingHealth(db.$client)
  assert.equal(health.exposure_anomaly_count, 0); assert.equal(health.missing_step_count, 0); assert.equal(health.payment_claim_anomaly_count, 0)
  assert.equal(health.funded_retry_anomaly_count, 0)
  const getMetrics = (await import('@/lib/route-metrics')).getRouteMetrics
  const metricsBefore = await getMetrics(); assert.ok(metricsBefore.economic_outcomes.confirmed_refunds >= 1); assert.ok(metricsBefore.retry.completed_attempts >= 1)
  const [refundRecord] = await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, funded.trade_id!))
  await db.update(schema.settlement_transfers).set({ to_address: treasury }).where(eq(schema.settlement_transfers.id, refundRecord.id))
  const corrupted = await (await import('@/lib/route-funding-health.mjs')).inspectRouteFundingHealth(db.$client)
  assert.equal(corrupted.funded_retry_anomaly_count, 1); assert.equal(JSON.stringify(corrupted).includes(f.account.address), false)
  const metricsAfter = await getMetrics(); assert.equal(metricsAfter.economic_outcomes.confirmed_refunds, metricsBefore.economic_outcomes.confirmed_refunds - 1)
  assert.equal(metricsAfter.economic_outcomes.refunds_awaiting_confirmation, metricsBefore.economic_outcomes.refunds_awaiting_confirmation + 1)
  await db.update(schema.settlement_transfers).set({ to_address: refundRecord.to_address }).where(eq(schema.settlement_transfers.id, refundRecord.id))
  const repeated = await runBuyerRoute(f); assert.deepEqual(repeated.receipt, result.receipt); assert.equal(broadcastCalls, count + 4)
})

test('concurrent retry operations reserve only one fallback and a lost response replays its original order', async () => {
  const f = await fixture(undefined, {}), first = await runBuyerRoute(f); await refundFailedProvider(f, first.trade_id!)
  const operation = crypto.randomUUID(), [left, right] = await Promise.all([retryCommand(f, first.trade_id!, operation), retryCommand(f, first.trade_id!, operation)])
  assert.ok([200, 201].includes(left.status)); assert.ok([200, 201].includes(right.status))
  const leftBody = await left.json(), rightBody = await right.json(); assert.equal(leftBody.trade.id, rightBody.trade.id)
  const other = await retryCommand(f, first.trade_id!); assert.equal(other.status, 409)
  assert.equal((await db.select().from(schema.route_retry_funding_steps).where(eq(schema.route_retry_funding_steps.route_id, f.routeId))).length, 1)
  const response = await retryCommand(f, first.trade_id!, operation); assert.equal(response.status, 200); assert.equal((await response.json()).trade.id, leftBody.trade.id)
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.fallbackServiceId!)))[0].active_orders, 1)
})

test('gross retry budget, remaining objective deadline and current buyer policy reject fallback without new exposure', async () => {
  for (const scenario of ['retry', 'aggregate', 'deadline', 'policy'] as const) {
    const f = await fixture(undefined, scenario === 'retry' ? { maxRetry: '1.15' } : scenario === 'aggregate' ? { maxAggregate: '2.20' } : {})
    const first = await runBuyerRoute(f); await refundFailedProvider(f, first.trade_id!)
    if (scenario === 'deadline') await db.update(schema.route_plans).set({ execution_deadline_at: new Date(Date.now() + 5_000) }).where(eq(schema.route_plans.id, f.routeId))
    if (scenario === 'policy') await db.insert(schema.buyer_spend_policies).values({ buyer_id: f.buyerId, owner_account_id: f.buyerId, policy_json: JSON.stringify({ max_retry_budget: 115 }) })
    const response = await retryCommand(f, first.trade_id!); assert.equal(response.status, 409)
    const code = (await response.json()).error_code
    assert.equal(code, scenario === 'retry' ? 'MANDATE_RETRY_BUDGET_EXCEEDED' : scenario === 'aggregate' ? 'MANDATE_BUDGET_EXCEEDED' : scenario === 'deadline' ? 'ROUTE_RETRY_DEADLINE_EXCEEDED' : 'BUYER_RETRY_BUDGET_EXCEEDED')
    assert.equal((await db.select().from(schema.route_retry_funding_steps).where(eq(schema.route_retry_funding_steps.route_id, f.routeId))).length, 0)
    assert.equal((await db.select().from(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.id, f.mandate.id)))[0].reserved_minor, 105)
    assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.fallbackServiceId!)))[0].active_orders, 0)
  }
})

test('late funding after cancelled checkout blocks fallback until its exact original refund confirms', async () => {
  const f = await fixture(undefined, {}), prepared = await runBuyerFunding({ ...f, prepareOnly: true })
  const saved = await journal(f)
  const claimed = await fetch(`${baseUrl}/api/trades/${prepared.trade_id}/fund/evm/claim`, { method: 'POST', headers: { Authorization: `Bearer ${f.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent_id: saved.value.intent.id, mandate_id: f.mandate.id, buyer_operation_id: saved.value.operation_id,
      serialized_transaction: saved.value.serialized_transaction, payer_signature: saved.value.payer_signature }) })
  assert.ok(claimed.ok, JSON.stringify(await claimed.json()))
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, prepared.trade_id!))
  const { expireTradePayment } = await import('@/lib/trade-funding')
  await expireTradePayment(trade)
  const unknown = await retryCommand(f, trade.id); assert.equal(unknown.status, 409); assert.equal((await unknown.json()).error_code, 'ROUTE_RETRY_PAYMENT_UNKNOWN')
  await f.adapter.broadcast(saved.value.serialized_transaction)
  const proofBody = { intent_id: saved.value.intent.id, chain_id: 8453, token_address: token, payer_address: f.account.address,
    tx_hash: saved.value.tx_hash, payer_signature: saved.value.payer_signature }
  minePayout = false
  let proof: Response
  try { proof = await fetch(`${baseUrl}/api/trades/${trade.id}/fund/evm`, { method: 'POST', headers: { Authorization: `Bearer ${f.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(proofBody) }) }
  finally { minePayout = true }
  assert.ok([200, 202].includes(proof.status), JSON.stringify(await proof.json()))
  const pending = await retryCommand(f, trade.id); assert.equal(pending.status, 409)
  assert.equal((await db.select().from(schema.route_retry_funding_steps).where(eq(schema.route_retry_funding_steps.route_id, f.routeId))).length, 0)
  const { refundCancelledExternalTrade } = await import('@/lib/external-settlement')
  const [pendingRefund] = await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, trade.id))
  transactions.get(pendingRefund.tx_hash!)!.mined = true
  const [cancelled] = await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id))
  const refunded = await refundCancelledExternalTrade(cancelled, { waitMs: 100 }); assert.equal(refunded.complete, true)
  const retry = await retryCommand(f, trade.id); assert.equal(retry.status, 201)
  const repeatedProof = await fetch(`${baseUrl}/api/trades/${trade.id}/fund/evm`, { method: 'POST', headers: { Authorization: `Bearer ${f.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(proofBody) })
  assert.equal(repeatedProof.status, 200)
  assert.equal((await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, trade.id))).length, 1)
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.serviceId)))[0].active_orders, 0)
})

test('refund flags, wrong destination, pending confirmation and any seller payout cannot authorize funded fallback', async () => {
  const f = await fixture(undefined, {}), first = await runBuyerRoute(f); await refundFailedProvider(f, first.trade_id!)
  const [refund] = await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, first.trade_id!))
  for (const change of [{ status: 'submitted' as const, confirmed_at: null }, { to_address: treasury }, { token_amount: '1' }]) {
    await db.update(schema.settlement_transfers).set(change).where(eq(schema.settlement_transfers.id, refund.id))
    const response = await retryCommand(f, first.trade_id!); assert.equal(response.status, 409); assert.equal((await response.json()).error_code, 'ROUTE_RETRY_REFUND_EVIDENCE_MISSING')
    await db.update(schema.settlement_transfers).set(refund).where(eq(schema.settlement_transfers.id, refund.id))
  }
  await db.insert(schema.settlement_transfers).values({ ...refund, id: crypto.randomUUID(), business_key: `${first.trade_id}:seller_payout`, kind: 'seller_payout', status: 'failed' })
  const collided = await retryCommand(f, first.trade_id!); assert.equal(collided.status, 409); assert.equal((await collided.json()).error_code, 'ROUTE_RETRY_PAYOUT_CONFLICT')
  assert.equal((await db.select().from(schema.route_retry_funding_steps).where(eq(schema.route_retry_funding_steps.route_id, f.routeId))).length, 0)
})

test('a killed buyer process after retry reservation resumes the saved operation and never recreates the original failed order', async () => {
  const f = await fixture(undefined, {}), first = await runBuyerRoute(f); await refundFailedProvider(f, first.trade_id!)
  const approvalFile = join(directory, `${f.routeId}.retry-approval.json`); await writeFile(approvalFile, JSON.stringify(f.approval), { mode: 0o600 })
  let ready!: () => void, release!: () => void
  const committed = new Promise<void>((done) => { ready = done }), gate = new Promise<void>((done) => { release = done })
  apiHook = async (path, response) => { if (path.endsWith('/retry') && response.status === 201) { ready(); await gate } return false }
  const args = ['scripts/buyer-route-worker.mjs', approvalFile, f.stateDirectory], environment = { ...process.env,
    CLAWDMARKET_BUYER_PRIVATE_KEY: f.dummyKey, CLAWDMARKET_BUYER_API_KEY: f.apiKey }
  const child = spawn(process.execPath, args, { cwd: resolve('.'), env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''; child.stderr.on('data', (bytes) => { stderr += bytes.toString() })
  const timer = setTimeout(() => { child.kill('SIGKILL'); release() }, 15_000)
  try {
    await Promise.race([committed, new Promise<never>((_, reject) => child.once('exit', () => reject(new Error(`Dummy retry worker exited: ${stderr}`))))])
    const exited = new Promise<void>((done) => child.once('exit', () => done())); child.kill('SIGKILL'); await exited; apiHook = null; release()
    const [saved] = await db.select().from(schema.route_retry_funding_steps).where(eq(schema.route_retry_funding_steps.route_id, f.routeId))
    const output = await promisify(execFile)(process.execPath, args, { cwd: resolve('.'), env: environment }), result = JSON.parse(output.stdout)
    assert.equal(result.state, 'funded'); assert.equal(result.trade_id, saved.trade_id)
    assert.equal((await db.select().from(schema.route_retry_funding_steps).where(eq(schema.route_retry_funding_steps.route_id, f.routeId))).length, 1)
    assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyerId))).length, 2)
  } finally { clearTimeout(timer); apiHook = null; release(); child.kill('SIGKILL') }
})

test('concurrent buyer route workers cannot replace the durable retry operation in a shared journal', async () => {
  const f = await fixture(undefined, {}), first = await runBuyerRoute(f); await refundFailedProvider(f, first.trade_id!)
  let ready!: () => void, release!: () => void
  const entered = new Promise<void>((done) => { ready = done }), gate = new Promise<void>((done) => { release = done })
  let held = false
  apiHook = async (path, response) => { if (!held && path.endsWith('/retry') && response.status === 200) { held = true; ready(); await gate } return false }
  const worker = runBuyerRoute(f)
  try {
    await entered
    await assert.rejects(() => runBuyerRoute(f), /BUYER_WALLET_IN_USE/)
  } finally { apiHook = null; release() }
  const funded = await worker; assert.equal(funded.state, 'funded')
  assert.equal((await runBuyerRoute(f)).trade_id, funded.trade_id)
  assert.equal((await db.select().from(schema.route_retry_funding_steps).where(eq(schema.route_retry_funding_steps.route_id, f.routeId))).length, 1)
})

test('first agent acceptance records durable automation evidence while nonproduction and retrospective manual decisions remain excluded', async () => {
  const f = await fixture(undefined, undefined, true), { funded, delivery, decision } = await routeDelivery(f)
  const [origin] = await db.select().from(schema.route_origins).where(eq(schema.route_origins.route_id, f.routeId))
  assert.equal(origin.channel, 'authenticated_agent'); assert.equal(origin.cohort, 'nonproduction')
  const metrics = (await import('@/lib/route-metrics')).getRouteMetrics
  assert.equal((await metrics()).autonomously_routed_gmv, '0.00')
  // Reclassify this disposable fixture before acceptance to exercise the production projection; this is not live proof.
  await db.update(schema.route_origins).set({ cohort: 'production' }).where(eq(schema.route_origins.route_id, f.routeId))
  const result = await runBuyerRoute({ ...f, decision }); assert.equal(result.state, 'completed', JSON.stringify(result))
  const [agentDecision] = await db.select().from(schema.route_agent_decisions).where(eq(schema.route_agent_decisions.trade_id, funded.trade_id!))
  assert.equal(agentDecision.delivery_hash, delivery.content_hash)
  assert.equal(result.receipt!.receipt.automation.durable_buyer_funding, true)
  assert.equal(result.receipt!.receipt.automation.authenticated_agent_decision, true)
  const eligible = await metrics(); assert.equal(eligible.autonomously_routed_gmv, '1.00'); assert.equal(eligible.autonomously_settled_routes, 1)
  assert.ok(eligible.funnel.backed_receipts >= 1)
  const serialized = JSON.stringify(eligible)
  for (const secret of [f.buyerId, f.sellerId, f.account.address, f.ownerId, f.apiKey, 'private-route-result']) assert.equal(serialized.includes(secret), false)
  for (const cohort of ['canary', 'demo', 'reference', 'nonproduction'] as const) {
    await db.update(schema.route_origins).set({ cohort }).where(eq(schema.route_origins.route_id, f.routeId))
    assert.equal((await metrics()).autonomously_routed_gmv, '0.00')
  }
  await db.update(schema.route_origins).set({ cohort: 'production' }).where(eq(schema.route_origins.route_id, f.routeId))
  await db.update(schema.agent_owners).set({ userId: f.ownerId }).where(eq(schema.agent_owners.agentId, f.sellerId.slice('user_agent_'.length)))
  assert.equal((await metrics()).autonomously_routed_gmv, '0.00')
  await db.update(schema.agent_owners).set({ userId: f.sellerOwnerId }).where(eq(schema.agent_owners.agentId, f.sellerId.slice('user_agent_'.length)))
  const [payout] = (await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, funded.trade_id!))).filter((row) => row.kind === 'seller_payout')
  await db.update(schema.settlement_transfers).set({ status: 'submitted' }).where(eq(schema.settlement_transfers.id, payout.id))
  assert.equal((await metrics()).autonomously_routed_gmv, '0.00')
  await db.update(schema.settlement_transfers).set({ status: 'confirmed' }).where(eq(schema.settlement_transfers.id, payout.id))
  const [receiptRow] = await db.select().from(schema.route_receipts).where(eq(schema.route_receipts.route_id, f.routeId))
  const corrupt = JSON.parse(receiptRow.receipt_json); corrupt.automation.authenticated_agent_decision = false
  await db.update(schema.route_receipts).set({ receipt_json: JSON.stringify(corrupt) }).where(eq(schema.route_receipts.route_id, f.routeId))
  assert.equal((await metrics()).autonomously_routed_gmv, '0.00')
  await db.update(schema.route_receipts).set({ receipt_json: receiptRow.receipt_json }).where(eq(schema.route_receipts.route_id, f.routeId))
  await db.delete(schema.route_agent_decisions).where(eq(schema.route_agent_decisions.trade_id, funded.trade_id!))
  const replay = await runBuyerRoute({ ...f, decision }); assert.equal(replay.state, 'completed')
  assert.equal((await db.select().from(schema.route_agent_decisions).where(eq(schema.route_agent_decisions.trade_id, funded.trade_id!))).length, 0)
  assert.equal((await metrics()).autonomously_routed_gmv, '0.00')
})

test('a nonproduction receipt cannot be retrospectively promoted by changing route origin', async () => {
  const f = await fixture(undefined, undefined, true), { decision } = await routeDelivery(f)
  const result = await runBuyerRoute({ ...f, decision }); assert.equal(result.state, 'completed')
  assert.equal(result.receipt!.receipt.automation.origin.cohort, 'nonproduction')
  await db.update(schema.route_origins).set({ cohort: 'production' }).where(eq(schema.route_origins.route_id, f.routeId))
  assert.equal((await (await import('@/lib/route-metrics')).getRouteMetrics()).autonomously_routed_gmv, '0.00')
})


async function routingHold() {
  const control = await import('@/lib/route-control')
  await control.setRouteControl({ paused: true, expectedRevision: (await control.getRouteControl()).revision, actorUserId: 'dummy-operator' })
}
async function clearRoutingHold() { await db.delete(schema.route_control_events); await db.delete(schema.route_controls) }

test('routing hold rejects fresh EVM claims, removes saved send permission and recovers the exact pending on-chain payment', async () => {
  const fresh = await fixture(), claimed = await fixture(), paid = await fixture()
  await runBuyerFunding({ ...fresh, prepareOnly: true })
  let lost = false
  apiHook = async (path, reply) => { if (!lost && path.endsWith('/claim') && reply.ok) { lost = true; return true } return false }
  try { await assert.rejects(() => runBuyerFunding(claimed), /BUYER_REQUEST_UNCERTAIN_RESUME_SAME_PAYMENT/) } finally { apiHook = null }
  const pending = await runBuyerFunding({ ...paid, adapter: { ...paid.adapter, broadcast: async (raw: string, signal: AbortSignal) => {
    const hash = await paid.adapter.broadcast(raw, signal); transactions.get(hash)!.mined = false; return hash
  } } })
  assert.equal(pending.state, 'awaiting_confirmation'); const count = broadcastCalls
  await routingHold()
  try {
    let rejection: string | undefined
    apiHook = async (path, reply) => { if (path.endsWith('/claim') && !reply.ok) rejection = (await reply.clone().json()).code; return false }
    try { await assert.rejects(() => runBuyerFunding(fresh), /BUYER_HTTP_409/) } finally { apiHook = null }
    assert.equal(rejection, 'ROUTE_EXECUTION_PAUSED')
    assert.equal((await runBuyerFunding(claimed)).state, 'held_recover_existing_payment')
    assert.equal(broadcastCalls, count)
    transactions.get(pending.tx_hash!)!.mined = true
    const recovered = await runBuyerFunding(paid)
    assert.equal(recovered.state, 'funded'); assert.equal(recovered.tx_hash, pending.tx_hash)
    assert.equal(broadcastCalls, count); await assertFundedOnce(paid, pending.tx_hash!)
    assert.equal((await db.select().from(schema.buyer_evm_payment_claims).where(eq(schema.buyer_evm_payment_claims.mandate_id, fresh.mandate.id))).length, 0)
  } finally { await clearRoutingHold() }
})

test('routing hold preserves provider delivery, explicit review, pending payout recovery and exactly-once capacity release', async () => {
  const f = await fixture(), funded = await runBuyerRoute(f)
  await routingHold()
  try {
    const providerKey = jwt({ userId: f.sellerId, email: `${f.sellerId}@test.invalid`, role: 'human' })
    const delivery = await runProviderWork({ baseUrl, apiKey: providerKey, tradeId: funded.trade_id!, serviceId: f.serviceId,
      stateFile: join(directory, `${f.routeId}.provider.json`), handler: async () => ({ summary: 'Delivery while new routes held', artifact: { result: 'private output' } }) })
    minePayout = false
    try { assert.equal((await runBuyerRoute({ ...f, decision: { version: 1, route_id: f.routeId, decision: 'accept', content_hash: delivery.content_hash } })).state, 'settling') }
    finally { minePayout = true }
    const [outbox] = await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, funded.trade_id!))
    transactions.get(outbox.tx_hash!)!.mined = true
    assert.equal((await runBuyerRoute(f)).state, 'completed')
    assert.equal((await runBuyerRoute(f)).state, 'completed')
    assert.equal((await db.select().from(schema.route_receipts).where(eq(schema.route_receipts.route_id, f.routeId))).length, 1)
    assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.serviceId)))[0].active_orders, 0)
  } finally { await clearRoutingHold() }
})

test('routing hold allows the original refund but rejects a fresh funded fallback without adding exposure', async () => {
  const f = await fixture(undefined, {}), first = await runBuyerRoute(f)
  await routingHold()
  try {
    await refundFailedProvider(f, first.trade_id!)
    const blocked = await retryCommand(f, first.trade_id!); assert.equal(blocked.status, 503, JSON.stringify(await blocked.clone().json()))
    assert.equal((await blocked.json()).error_code, 'ROUTE_EXECUTION_PAUSED')
    assert.equal((await db.select().from(schema.route_retry_funding_steps).where(eq(schema.route_retry_funding_steps.route_id, f.routeId))).length, 0)
    assert.equal((await db.select().from(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.id, f.mandate.id)))[0].reserved_minor, 105)
    assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.fallbackServiceId!)))[0].active_orders, 0)
  } finally { await clearRoutingHold() }
})


test('A2A task follows canonical funding and settlement, rejects funded cancellation and returns the original private backed receipt', async () => {
  const f = await fixture(undefined, undefined, true), count = broadcastCalls
  const input = { role: 'ROLE_USER', messageId: crypto.randomUUID(), parts: [{ data: { action: 'route_work', route_id: f.routeId, mandate_id: f.mandate.id }, mediaType: 'application/json' }] }
  async function rpc(method: string, params: unknown) {
    const response = await fetch(`${baseUrl}/api/a2a`, { method: 'POST', headers: { Authorization: `Bearer ${f.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    return { status: response.status, body: await response.json() }
  }
  const started = await rpc('SendMessage', { message: input }); assert.equal(started.status, 200, JSON.stringify(started.body))
  const task = started.body.result.task; assert.equal(task.status.state, 'TASK_STATE_INPUT_REQUIRED'); assert.equal(broadcastCalls, count)
  const continuation = { ...input, messageId: crypto.randomUUID(), taskId: task.id, contextId: task.contextId }
  assert.equal((await rpc('SendMessage', { message: continuation })).status, 200)
  const { funded, decision } = await routeDelivery(f)
  const live = await rpc('GetTask', { id: task.id }); assert.equal(live.body.result.status.state, 'TASK_STATE_INPUT_REQUIRED')
  assert.equal(live.body.result.artifacts[0].parts[0].data.lifecycle.phase, 'awaiting_buyer')
  const cancel = await rpc('CancelTask', { id: task.id }); assert.equal(cancel.status, 409); assert.equal(cancel.body.error.code, -32002)
  const [held] = await db.select().from(schema.trades).where(eq(schema.trades.id, funded.trade_id!)); assert.equal(held.status, 'pending_release')
  const outcome = await runBuyerRoute({ ...f, decision }); assert.equal(outcome.state, 'completed')
  const completed = await rpc('GetTask', { id: task.id }); assert.equal(completed.body.result.status.state, 'TASK_STATE_COMPLETED')
  const data = completed.body.result.artifacts[0].parts[0].data
  assert.deepEqual(data.lifecycle.receipt, outcome.receipt); assert.equal(data.result.delivery.content_hash, decision.content_hash)
  assert.equal(data.result.content.artifact.result, 'private-route-result')
  const replay = await rpc('SendMessage', { message: input }); assert.equal(replay.body.result.task.id, task.id); assert.equal(replay.body.result.task.status.state, 'TASK_STATE_COMPLETED')
  assert.equal((await rpc('SendMessage', { message: continuation })).body.result.task.status.state, 'TASK_STATE_COMPLETED')
  assert.equal((await rpc('SendMessage', { message: { ...continuation, messageId: crypto.randomUUID() } })).status, 409)
  assert.equal(broadcastCalls, count + 2)
  assert.equal((await db.select().from(schema.route_receipts).where(eq(schema.route_receipts.route_id, f.routeId))).length, 1)
  // Corrupted financial proof cannot be hidden by saved completion flags or the earlier A2A result.
  await db.update(schema.settlement_transfers).set({ status: 'pending' }).where(eq(schema.settlement_transfers.trade_id, funded.trade_id!))
  const uncertain = await rpc('GetTask', { id: task.id }); assert.notEqual(uncertain.body.result.status.state, 'TASK_STATE_COMPLETED')
  assert.equal(uncertain.body.result.artifacts[0].parts[0].data.lifecycle.receipt, null)
})

test('MCP Tasks return one private backed result after canonical funding and reject output without current payout proof', async () => {
  const f = await fixture(undefined, undefined, true), count = broadcastCalls
  const input = { name: 'route_work', arguments: { client_reference: `mcp-financial-${crypto.randomUUID()}`, route_id: f.routeId, mandate_id: f.mandate.id }, task: {} }
  async function rpc(method: string, params: unknown) {
    const response = await fetch(`${baseUrl}/api/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${f.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
    return { status: response.status, body: await response.json() }
  }
  const started = await rpc('tools/call', input)
  assert.equal(started.status, 200, JSON.stringify(started.body))
  const task = started.body.result.task
  assert.equal(task.status, 'input_required'); assert.equal(broadcastCalls, count)
  const { funded, decision } = await routeDelivery(f)
  const inspection = await rpc('tools/call', { name: 'get_route_task', arguments: { task_id: task.taskId } })
  assert.equal(inspection.body.result.structuredContent.lifecycle.phase, 'awaiting_buyer')
  assert.equal((await rpc('tasks/cancel', { taskId: task.taskId })).status, 409)
  const outcome = await runBuyerRoute({ ...f, decision }); assert.equal(outcome.state, 'completed')
  const result = await rpc('tasks/result', { taskId: task.taskId })
  assert.equal(result.status, 200); assert.equal(result.body.result.isError, false)
  const data = result.body.result.structuredContent
  assert.deepEqual(data.lifecycle.receipt, outcome.receipt)
  assert.equal(data.result.delivery.content_hash, decision.content_hash)
  assert.equal(data.result.content.artifact.result, 'private-route-result')
  assert.equal((await rpc('tools/call', input)).body.result.task.taskId, task.taskId)
  assert.deepEqual((await rpc('tasks/result', { taskId: task.taskId })).body.result, result.body.result)
  assert.equal(broadcastCalls, count + 2)
  assert.equal((await db.select().from(schema.route_receipts).where(eq(schema.route_receipts.route_id, f.routeId))).length, 1)
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.serviceId)))[0].active_orders, 0)
  await db.update(schema.settlement_transfers).set({ status: 'pending' }).where(eq(schema.settlement_transfers.trade_id, funded.trade_id!))
  assert.equal((await rpc('tasks/get', { taskId: task.taskId })).body.result.status, 'completed')
  const uncertain = await rpc('tasks/result', { taskId: task.taskId })
  assert.equal(uncertain.status, 503); assert.equal(uncertain.body.error.message, 'MCP_RESULT_BACKING_UNAVAILABLE')
  assert.equal(JSON.stringify(uncertain.body).includes('private-route-result'), false)
})

test('workflow HTTP loop pays and settles two exact dependent nodes across buyer/provider process death without duplicate economic work', async () => {
  const f = await fixture(), count = broadcastCalls
  const headers = { Authorization: `Bearer ${f.apiKey}`, 'Content-Type': 'application/json' }
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${baseUrl}${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) })
    const value = await response.json()
    assert.ok(response.ok, `${path}: ${response.status}: ${JSON.stringify(value)}`)
    return value
  }
  const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } }
  const { workflow } = await api('POST', '/api/workflows/plan', { client_reference: `paid-workflow-${f.routeId}`,
    objective: 'Review the private upstream result and settle the bounded objective', max_budget: { amount: '2.10', currency: 'USD' }, deadline_seconds: 600,
    nodes: [{ key: 'source', objective: 'Produce a private structured upstream review', required_capabilities: ['code-review'], budget: { amount: '1.05', currency: 'USD' }, deadline_seconds: 300 },
      { key: 'review', objective: 'Review the exact approved private upstream attachment', required_capabilities: ['code-review'], budget: { amount: '1.05', currency: 'USD' }, deadline_seconds: 600, depends_on: ['source'] }] })
  const { approval } = await api('POST', `/api/workflows/${workflow.id}/approval`, { version: 1, client_reference: `paid-review-${f.routeId}`, plan_hash: workflow.plan_hash,
    expires_at: new Date(Math.floor(Date.now() / 1000) * 1000 + 900_000).toISOString(), max_gross_minor: 210, max_chain_fee_units: '2000000000000',
    private_data: 'selected_provider_only', payment: { rail: 'evm', chain_id: 8453, token_address: token, payer_address: f.account.address.toLowerCase(),
      treasury_address: treasury, minimum_token_reserve_units: '5000000', minimum_native_reserve_wei: '1000000', max_gas_cost_wei: '1000000000000' },
    nodes: ['source', 'review'].map((key) => ({ key, static_input: { private_text: `private-${key}-input` }, provider_requirements: { approved_providers: [f.sellerId] },
      verification: policy, max_per_attempt_minor: 105, max_retry_minor: 0, max_attempts: 1, max_latency_seconds: 60,
      max_chain_fee_per_attempt_units: '1000000000000', dependency_inputs: key === 'review' ? [{ source_node: 'source', artifact_index: 0, target_field: 'upstream' }] : [] })) })
  const command = { version: 1, client_reference: `paid-execution-${f.routeId}`, approval_id: approval.id, contract_hash: approval.contract_hash, authorize_spending: true }
  const activated = await api('POST', `/api/workflows/${workflow.id}/execute`, command), run = activated.run
  const root = await api('POST', `/api/workflows/${workflow.id}/nodes/source/prepare`, { version: 1, run_id: run.id })
  const workflowApproval = { version: 1, origin: baseUrl, workflow_id: workflow.id, run_id: run.id,
    contract_hash: approval.contract_hash, chain_id: 8453, rpc_url: rpcUrl }
  const rootFile = join(directory, `${run.id}.workflow-approval.json`), stateDirectory = join(directory, `${run.id}.workflow-state`)
  await writeFile(rootFile, JSON.stringify(workflowApproval), { mode: 0o600 })
  const options = { approval: workflowApproval, apiKey: f.apiKey, stateDirectory, account: f.account, adapter: f.adapter }
  // An expanded server response cannot enlarge the reviewed mandate or reach a wallet.
  await assert.rejects(runBuyerWorkflow({ ...options, fetcher: async (input, init) => {
    const response = await fetch(input, init)
    if (String(input).endsWith('/nodes/source/prepare')) {
      const child = await response.json(); child.mandate.terms.max_aggregate = '99.00'
      return Response.json(child)
    }
    return response
  } }), /BUYER_WORKFLOW_CONTRACT_EXPANSION/)
  assert.equal(broadcastCalls, count)
  // A successful prepare whose response is lost must resume its original child.
  await assert.rejects(runBuyerWorkflow({ ...options, fetcher: async (input, init) => {
    const response = await fetch(input, init)
    if (String(input).endsWith('/nodes/source/prepare')) { await response.arrayBuffer(); throw Error('simulated lost prepare response') }
    return response
  } }), /BUYER_WORKFLOW_REQUEST_UNCERTAIN_RESUME_ORIGINAL_RUN/)
  const original = await api('POST', `/api/workflows/${workflow.id}/nodes/source/prepare`, { version: 1, run_id: run.id })
  assert.equal(original.route.id, root.route.id); assert.equal(original.mandate.id, root.mandate.id)
  assert.equal(broadcastCalls, count)
  const buyerEnvironment = { ...process.env, CLAWDMARKET_BUYER_PRIVATE_KEY: f.dummyKey, CLAWDMARKET_BUYER_API_KEY: f.apiKey }
  let release!: () => void, ready!: () => void
  const claimed = new Promise<void>((done) => { ready = done }), claimGate = new Promise<void>((done) => { release = done })
  apiHook = async (path, response) => { if (path.endsWith('/claim') && response.ok) { ready(); await claimGate } return false }
  const buyer = spawn(process.execPath, ['scripts/buyer-workflow-worker.mjs', rootFile, stateDirectory],
    { cwd: resolve('.'), env: buyerEnvironment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let buyerError = ''; buyer.stderr.on('data', (value) => { buyerError += value.toString() })
  const buyerExit = new Promise<void>((done) => buyer.once('exit', () => done()))
  const buyerTimeout = setTimeout(() => { if (buyer.pid) process.kill(-buyer.pid, 'SIGKILL'); release() }, 20_000)
  try {
    await Promise.race([claimed, buyerExit.then(() => { throw Error(`Workflow buyer exited: ${buyerError}`) })])
    if (buyer.pid) process.kill(-buyer.pid, 'SIGKILL'); await buyerExit
    assert.equal(broadcastCalls, count)
  } finally { clearTimeout(buyerTimeout); apiHook = null; release(); if (buyer.exitCode === null && buyer.signalCode === null && buyer.pid) { process.kill(-buyer.pid, 'SIGKILL'); await buyerExit } }
  const restartedBuyer = await promisify(execFile)(process.execPath, ['scripts/buyer-workflow-worker.mjs', rootFile, stateDirectory],
    { cwd: resolve('.'), env: buyerEnvironment, timeout: 30_000 })
  const restartedWorkflow = JSON.parse(restartedBuyer.stdout), fundedRoot = restartedWorkflow.nodes.find((node: { node_key: string }) => node.node_key === 'source')
  assert.equal(restartedWorkflow.state, 'incomplete'); assert.equal(fundedRoot.state, 'funded'); assert.equal(broadcastCalls, count + 1)
  const providerKey = jwt({ userId: f.sellerId, email: `${f.sellerId}@test.invalid`, role: 'human' })
  const handlerFile = join(directory, `${run.id}.provider-handler.mjs`), providerDirectory = join(directory, `${run.id}.provider-state`)
  await writeFile(handlerFile, `import {createHash} from 'node:crypto';
    export default async function(work) {
      if(work.input.upstream){const ref=work.dependency_artifacts[0];
        if(!ref || ref.binding_id!==work.input.upstream.binding_id || ref.sha256!==work.input.upstream.sha256) throw Error('DEPENDENCY_BINDING_INVALID');
        const response=await fetch(new URL(ref.download_path,process.env.BASE_URL),{redirect:'error',headers:{Authorization:'Bearer '+process.env.CLAWDMARKET_PROVIDER_API_KEY}});
        if(!response.ok) throw Error('DEPENDENCY_UNAVAILABLE'); const bytes=Buffer.from(await response.arrayBuffer());
        if(createHash('sha256').update(bytes).digest('hex')!==ref.sha256 || bytes.length!==ref.size_bytes) throw Error('DEPENDENCY_HASH_INVALID');
        return {summary:'The separate provider reviewed the exact approved private upstream bytes.',artifact:{result:JSON.parse(bytes.toString()).result+'-reviewed'}};
      }
      const bytes=Buffer.from(JSON.stringify({result:'workflow-private-upstream'}));
      return {summary:'Separate provider produced the private structured upstream attachment.',artifact:{result:'workflow-private-upstream'},
        files:[{name:'upstream.json',media_type:'application/json',content_base64:bytes.toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')}]};
    }`, { mode: 0o600 })
  const providerArgs = ['scripts/provider-worker.mjs', '--trade-id', fundedRoot.trade_id, '--service-id', f.serviceId, '--handler', handlerFile, '--state-dir', providerDirectory]
  const providerEnvironment = { ...process.env, BASE_URL: baseUrl, CLAWDMARKET_PROVIDER_API_KEY: providerKey }
  let deliveryReady!: () => void, deliveryRelease!: () => void
  const delivered = new Promise<void>((done) => { deliveryReady = done }), deliveryGate = new Promise<void>((done) => { deliveryRelease = done })
  apiHook = async (path, response) => { if (path.endsWith('/delivery') && response.ok) { deliveryReady(); await deliveryGate } return false }
  const provider = spawn(process.execPath, providerArgs, { cwd: resolve('.'), env: providerEnvironment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let providerError = ''; provider.stderr.on('data', (value) => { providerError += value.toString() })
  const providerExit = new Promise<void>((done) => provider.once('exit', () => done()))
  const providerTimeout = setTimeout(() => { if (provider.pid) process.kill(-provider.pid, 'SIGKILL'); deliveryRelease() }, 20_000)
  try {
    await Promise.race([delivered, providerExit.then(() => { throw Error(`Workflow provider exited: ${providerError}`) })])
    if (provider.pid) process.kill(-provider.pid, 'SIGKILL'); await providerExit
  } finally { clearTimeout(providerTimeout); apiHook = null; deliveryRelease(); if (provider.exitCode === null && provider.signalCode === null && provider.pid) { process.kill(-provider.pid, 'SIGKILL'); await providerExit } }
  const recoveredProvider = await promisify(execFile)(process.execPath, providerArgs, { cwd: resolve('.'), env: providerEnvironment, timeout: 30_000 })
  const firstDelivery = JSON.parse(recoveredProvider.stdout)
  const decisions = { version: 1, workflow_id: workflow.id, run_id: run.id,
    decisions: [{ node_key: 'source', decision: 'accept', content_hash: firstDelivery.content_hash }] }
  const progressed = await runBuyerWorkflow({ ...options, decisions })
  assert.equal(progressed.nodes.find((node: {node_key:string}) => node.node_key === 'source')?.state, 'completed', JSON.stringify(progressed))
  const fundedChild = progressed.nodes.find((node: {node_key:string}) => node.node_key === 'review')!
  assert.equal(fundedChild.state, 'funded', JSON.stringify(progressed)); assert.equal(broadcastCalls, count + 3)
  const partial = await api('POST', `/api/workflows/${workflow.id}/reconcile`, { version: 1, run_id: run.id })
  assert.equal(partial.completed, false); assert.equal(partial.receipt_persisted, false)
  assert.equal(partial.receipt.totals.unresolved_buyer_minor, 105)
  await assert.rejects(runBuyerWorkflow({ ...options, decisions: { ...decisions, decisions: [{ ...decisions.decisions[0], content_hash: '00'.repeat(32) }] } }), /BUYER_WORKFLOW_DECISION_CONFLICT/)
  const downstream = await promisify(execFile)(process.execPath, ['scripts/provider-worker.mjs', '--trade-id', fundedChild.trade_id!, '--service-id', f.serviceId,
    '--handler', handlerFile, '--state-dir', providerDirectory], { cwd: resolve('.'), env: providerEnvironment, timeout: 30_000 })
  const secondDelivery = JSON.parse(downstream.stdout)
  const decisionFile = join(directory, `${run.id}.workflow-decisions.json`)
  await writeFile(decisionFile, JSON.stringify({ ...decisions,
    decisions: [...decisions.decisions, { node_key: 'review', decision: 'accept', content_hash: secondDelivery.content_hash }] }), { mode: 0o600 })
  let receiptReady!: () => void, receiptRelease!: () => void
  const receiptSaved = new Promise<void>((done) => { receiptReady = done }), receiptGate = new Promise<void>((done) => { receiptRelease = done })
  apiHook = async (path, response) => { if (path.endsWith('/reconcile') && response.ok) { receiptReady(); await receiptGate } return false }
  const finalBuyer = spawn(process.execPath, ['scripts/buyer-workflow-worker.mjs', rootFile, stateDirectory, decisionFile],
    { cwd: resolve('.'), env: buyerEnvironment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let finalError = ''; finalBuyer.stderr.on('data', (value) => { finalError += value.toString() })
  const finalExit = new Promise<void>((done) => finalBuyer.once('exit', () => done()))
  const finalTimeout = setTimeout(() => { if (finalBuyer.pid) process.kill(-finalBuyer.pid, 'SIGKILL'); receiptRelease() }, 20_000)
  try {
    await Promise.race([receiptSaved, finalExit.then(() => { throw Error(`Final workflow buyer exited: ${finalError}`) })])
    if (finalBuyer.pid) process.kill(-finalBuyer.pid, 'SIGKILL'); await finalExit
  } finally { clearTimeout(finalTimeout); apiHook = null; receiptRelease(); if (finalBuyer.exitCode === null && finalBuyer.signalCode === null && finalBuyer.pid) { process.kill(-finalBuyer.pid, 'SIGKILL'); await finalExit } }
  const completed = await runBuyerWorkflow(options)
  assert.equal(completed.state, 'completed', JSON.stringify(completed))
  const outcome = await api('POST', `/api/workflows/${workflow.id}/reconcile`, { version: 1, run_id: run.id })
  assert.equal(outcome.completed, true); assert.equal(outcome.receipt_persisted, true)
  assert.equal(outcome.receipt.nodes.length, 2); assert.equal(outcome.receipt.attempts.length, 2)
  assert.equal(outcome.receipt.totals.gross_buyer_minor, 210); assert.equal(outcome.receipt.totals.confirmed_seller_payout_minor, 200)
  assert.equal(outcome.receipt.totals.unresolved_buyer_minor, 0); assert.equal(broadcastCalls, count + 4)
  const replay = await api('POST', `/api/workflows/${workflow.id}/execute`, command)
  assert.equal(replay.run.id, run.id); assert.equal(replay.run.started_at, run.started_at)
  const completedReplay = await api('POST', `/api/workflows/${workflow.id}/reconcile`, { version: 1, run_id: run.id })
  assert.equal(completedReplay.content_hash, outcome.content_hash);
  const workflowReplay = await promisify(execFile)(process.execPath, ['scripts/buyer-workflow-worker.mjs', rootFile, stateDirectory], { cwd: resolve('.'), env: buyerEnvironment, timeout: 30_000 })
  assert.equal(JSON.parse(workflowReplay.stdout).receipt.content_hash, outcome.content_hash); assert.equal(broadcastCalls, count + 4); assert.equal(completedReplay.idempotent, true)
  assert.equal((await db.select().from(schema.workflow_artifact_grants).where(eq(schema.workflow_artifact_grants.trade_id, fundedChild.trade_id!))).length, 1)
  assert.equal((await db.select().from(schema.workflow_receipts).where(eq(schema.workflow_receipts.run_id, run.id))).length, 1)
  const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.serviceId))
  assert.equal(service.active_orders, 0)
})
