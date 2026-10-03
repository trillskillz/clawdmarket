import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, erc20Abi, keccak256, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Abis, Account, Transaction } from 'viem/tempo'
import { createLocalTestSchema } from '../helpers/local-schema'
import { runBuyerMppFunding } from '../../scripts/buyer-mpp-worker.mjs'
import { runBuyerRoute } from '../../scripts/buyer-route-worker.mjs'
import { runProviderWork } from '../../scripts/provider-worker.mjs'
import { createBuyerTempoAdapter } from '../../scripts/buyer-tempo-adapter.mjs'

let directory: string, baseUrl: string, rpcUrl: string
let db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema'), jwt: typeof import('@/lib/auth').generateJWT
const apiServer = createServer(), rpcServer = createServer()
const token = '0x20c0000000000000000000000000000000000000' as const, treasury = privateKeyToAccount(`0x${'99'.repeat(32)}`).address.toLowerCase() as Hex
const blockHash = `0x${'55'.repeat(32)}` as Hex, methods: string[] = []
const transactions = new Map<string, { raw: Hex; payer: Hex; amount: bigint; recipient: Hex; memo: Hex | null; mined: boolean; nonce: number; timestamp: number }>()
const balances = new Map<string, bigint>()
let signerIndex = 300, broadcastCalls = 0, loseBroadcastReply = false, mineOnSend = true, rpcChainId = 4217
let simulationHook: (() => Promise<void>) | null = null
let apiHook: ((path: string, response: Response, request: NextRequest) => Promise<boolean>) | null = null
function receipt(hash: string) {
  const t = transactions.get(hash)
  return !t?.mined ? null : { transactionHash: hash, from: t.payer, to: token, blockHash, blockNumber: '0x64', transactionIndex: '0x0', status: '0x1',
    gasUsed: '0xc350', cumulativeGasUsed: '0xc350', effectiveGasPrice: '0x1', logsBloom: `0x${'00'.repeat(256)}`, contractAddress: null, type: '0x76',
    logs: [{ address: token, blockHash, blockNumber: '0x64', transactionHash: hash, transactionIndex: '0x0', logIndex: '0x0', removed: false,
      topics: t.memo ? encodeEventTopics({ abi: Abis.tip20, eventName: 'TransferWithMemo', args: { from: t.payer, to: t.recipient, memo: t.memo } }) : encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: t.payer, to: t.recipient } }),
      data: encodeAbiParameters([{ type: 'uint256' }], [t.amount]) }] }
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-tempo-worker-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'tempo.db')}`
  balances.set(treasury, 10_000_000n)
  process.env.CHAT_ENCRYPTION_KEY = 'dummy-tempo-route-worker-chat-tests-only'
  process.env.JWT_SECRET = 'dummy-tempo-worker-tests-only'; process.env.WEBHOOK_SECRET_KEY = 'dummy-webhook-tests-only'
  process.env.TREASURY_ADDRESS = treasury; process.env.MPP_RECIPIENT_ADDRESS = treasury
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'99'.repeat(32)}`; process.env.MPP_SECRET_KEY = 'dummy-tempo-worker-hmac-secret-for-tests-only'
  delete process.env.MPP_SECRET_KEY_CURRENT; delete process.env.DEV_WALLET_ADDRESS; delete process.env.DEV_FEE_WALLET_ADDRESS
  delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED; delete process.env.CLAWDMARKET_PRODUCTION_READINESS; delete process.env.VERCEL_ENV
  process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED = 'true'; process.env.CLAWDMARKET_ROUTE_PLANNING_ENABLED = 'true'; process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED = 'true'
  rpcServer.on('request', async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk)
      const input = JSON.parse(Buffer.concat(chunks).toString()), p = input.params; methods.push(input.method)
      let result: unknown
      if (input.method === 'eth_chainId') result = `0x${rpcChainId.toString(16)}`
      else if (input.method === 'eth_getCode') result = '0x'
      else if (input.method === 'eth_estimateGas') result = '0xc350'
      else if (input.method === 'eth_maxPriorityFeePerGas' || input.method === 'eth_gasPrice') result = '0x1'
      else if (input.method === 'eth_getTransactionCount') result = `0x${[...transactions.values()].filter((t) => t.payer.toLowerCase() === p[0].toLowerCase()).length.toString(16)}`
      else if (input.method === 'eth_call') {
        if (p[0].data?.slice(0, 10) === '0x313ce567') result = encodeAbiParameters([{ type: 'uint8' }], [6])
        else if (p[0].data?.slice(0, 10) === '0x70a08231') {
          const call = decodeFunctionData({ abi: erc20Abi, data: p[0].data })
          result = encodeAbiParameters([{ type: 'uint256' }], [balances.get(String(call.args![0]).toLowerCase())!])
        } else { await simulationHook?.(); result = '0x' }
      } else if (input.method === 'eth_sendRawTransactionSync' || input.method === 'eth_sendRawTransaction') {
        broadcastCalls++
        const raw = p[0] as `0x76${string}`, parsed = Transaction.deserialize(raw), hash = keccak256(raw)
        if (parsed.type !== 'tempo') throw new Error('Expected dummy Tempo envelope')
        const payer = parsed.from!
        const transfer = decodeFunctionData({ abi: Abis.tip20, data: parsed.calls![0].data! })
        assert.ok(['transferWithMemo', 'transfer'].includes(transfer.functionName))
        const [recipient, amount, memo] = transfer.args! as [Hex, bigint, Hex]
        if (!transactions.has(hash)) {
          assert.equal([...transactions.values()].some((t) => t.payer.toLowerCase() === payer.toLowerCase() && t.nonce === parsed.nonce), false)
          transactions.set(hash, { raw, payer, recipient, amount, memo: memo || null, nonce: parsed.nonce!, mined: mineOnSend, timestamp: Math.floor(Date.now() / 1000) + 1 })
          balances.set(payer.toLowerCase(), balances.get(payer.toLowerCase())! - amount - 1n)
          if (payer.toLowerCase() === treasury && recipient.toLowerCase() !== treasury) balances.set(recipient.toLowerCase(), balances.get(recipient.toLowerCase())! + amount)
        }
        if (loseBroadcastReply || !mineOnSend) { loseBroadcastReply = false; outgoing.destroy(); return }
        result = input.method === 'eth_sendRawTransactionSync' ? receipt(hash) : hash
      } else if (input.method === 'eth_blockNumber') result = '0x67'
      else if (input.method === 'eth_getTransactionReceipt') result = receipt(p[0])
      else if (input.method === 'eth_getTransactionByHash') result = transactions.has(p[0]) ? { hash: p[0] } : null
      else if (input.method === 'eth_getBlockByNumber' || input.method === 'eth_getBlockByHash') result = { hash: blockHash, number: '0x64', timestamp: `0x${(Math.floor(Date.now() / 1000) + 1).toString(16)}`,
        baseFeePerGas: '0x1', gasLimit: '0x1c9c380', gasUsed: '0xc350', transactions: [] }
      else throw new Error('Unsupported fixture method')
      outgoing.setHeader('Content-Type', 'application/json'); outgoing.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }))
    } catch { outgoing.statusCode = 500; outgoing.end(JSON.stringify({ mock_error: 'Mock RPC failed' })) }
  })
  await new Promise<void>((done) => rpcServer.listen(0, '127.0.0.1', done))
  rpcUrl = `http://127.0.0.1:${(rpcServer.address() as { port: number }).port}`; process.env.TEMPO_RPC_URL = rpcUrl
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  const mandate = await import('@/app/api/routes/[id]/mandate/route'), execute = await import('@/app/api/routes/[id]/execute/route'), getRoute = await import('@/app/api/routes/[id]/route')
  const intent = await import('@/app/api/trades/[id]/fund/mpp/intent/route'), claim = await import('@/app/api/trades/[id]/fund/mpp/claim/route'), fund = await import('@/app/api/trades/[id]/fund/mpp/route')
  const retry = await import('@/app/api/routes/[id]/retry/route'), advance = await import('@/app/api/routes/[id]/advance/route'), result = await import('@/app/api/routes/[id]/result/route')
  const work = await import('@/app/api/trades/[id]/work-order/route'), attempt = await import('@/app/api/trades/[id]/work-order/attempt/route'), delivery = await import('@/app/api/trades/[id]/delivery/route')
  apiServer.on('request', async (incoming, outgoing) => {
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString(), path = incoming.url!
      const request = new NextRequest(`${baseUrl}${path}`, { method: incoming.method, headers: incoming.headers as Record<string, string>, ...(body ? { body } : {}) })
      const id = path.split('/')[3], context = { params: Promise.resolve({ id }) }
      const handler = path.endsWith('/mandate') ? mandate[incoming.method as 'GET' | 'DELETE'] : path.endsWith('/execute') ? execute.POST : path.endsWith('/intent') ? intent[incoming.method as 'GET' | 'POST']
        : path.endsWith('/claim') ? claim.POST : path.endsWith('/fund/mpp') ? fund.POST : path.endsWith('/retry') ? retry[incoming.method as 'GET' | 'POST']
          : path.endsWith('/advance') ? advance[incoming.method as 'GET' | 'POST'] : path.endsWith('/result') ? result.GET
            : path.endsWith('/work-order') ? work.GET : path.endsWith('/attempt') ? attempt.POST : path.endsWith('/delivery') ? delivery.POST : getRoute.GET
      const response = await handler(request, context)
      if (apiHook && await apiHook(path, response, request)) { outgoing.destroy(); return }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text())
    } catch { outgoing.statusCode = 500; outgoing.end('{}') }
  })
  await new Promise<void>((done) => apiServer.listen(0, '127.0.0.1', done))
  baseUrl = `http://127.0.0.1:${(apiServer.address() as { port: number }).port}`; process.env.CLAWDMARKET_CANONICAL_ORIGIN = baseUrl
})
after(async () => {
  await Promise.all([new Promise<void>((done) => apiServer.close(() => done())), new Promise<void>((done) => rpcServer.close(() => done()))])
  db?.$client.close(); await rm(directory, { recursive: true, force: true })
})

async function fixture(reuseDummyKey?: `0x${string}`, withRetry = false) {
  const id = crypto.randomUUID(), buyerId = `buyer-${id}`, sellerId = `seller-${id}`, serviceId = crypto.randomUUID()
  const dummyKey = reuseDummyKey ?? `0x${(++signerIndex).toString(16).padStart(64, '0')}` as `0x${string}`, account = Account.fromSecp256k1(dummyKey)
  if (!balances.has(account.address.toLowerCase())) balances.set(account.address.toLowerCase(), 10_000_000n)
  await db.insert(schema.users).values([buyerId, sellerId].map((userId) => ({ id: userId, name: userId, email: `${userId}@test.invalid`, password_hash: 'unused', role: 'human' as const })))
  await db.insert(schema.payout_addresses).values({ user_id: sellerId, address: treasury })
  const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } }
  await db.insert(schema.service_definitions).values({ id: serviceId, seller_id: sellerId, title: 'Buyer worker fixture', description: 'Return a private structured review for explicit buyer acceptance.',
    capabilities: '["code-review"]', price_minor: 100, status: 'active', estimated_latency_seconds: 30, max_concurrency: 1, provider_protocol: 'leased_v1',
    output_schema: '{"type":"object","properties":{"result":{"type":"string"}}}', verification_policy: JSON.stringify(policy) })
  const fallbackSellerId = withRetry ? `fallback-${id}` : undefined, fallbackServiceId = withRetry ? crypto.randomUUID() : undefined
  if (fallbackSellerId && fallbackServiceId) {
    await db.insert(schema.users).values({ id: fallbackSellerId, name: fallbackSellerId, email: `${fallbackSellerId}@test.invalid`, password_hash: 'unused', role: 'human' })
    await db.insert(schema.payout_addresses).values({ user_id: fallbackSellerId, address: treasury })
    await db.insert(schema.service_definitions).values({ id: fallbackServiceId, seller_id: fallbackSellerId, title: 'Approved Tempo fallback', description: 'Return the same agreed review after confirmed original refund.',
      capabilities: '["code-review"]', price_minor: 110, status: 'active', estimated_latency_seconds: 30, max_concurrency: 1, provider_protocol: 'leased_v1',
      output_schema: '{"type":"object","properties":{"result":{"type":"string"}}}', verification_policy: JSON.stringify(policy) })
  }
  const approvedProviders = fallbackSellerId ? [sellerId, fallbackSellerId] : [sellerId]
  const apiKey = jwt({ userId: buyerId, email: `${buyerId}@test.invalid`, role: 'human' })
  const request = (path: string, body: unknown) => new NextRequest(`${baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const planned = await (await import('@/app/api/routes/plan/route')).POST(request('/api/routes/plan', { client_reference: `buyer-plan-${id}`, objective: 'Review private code with explicit buyer review',
    required_capabilities: ['code-review'], input: { private_text: 'fixture private source' }, max_budget: { amount: '5.00', currency: 'USD' }, verification: policy,
    provider_requirements: { approved_providers: approvedProviders }, payment_policy: { allowed_rails: ['mpp'] }, ...(withRetry ? { retry_policy: { max_attempts: 2 }, deadline_seconds: 300 } : {}) }))
  assert.equal(planned.status, 201); const routeId = (await planned.json()).route.id
  const created = await (await import('@/app/api/routes/[id]/mandate/route')).POST(request(`/api/routes/${routeId}/mandate`, { version: 1, client_reference: `buyer-mandate-${id}`,
    max_aggregate: withRetry ? '3.50' : '2.00', max_per_execution: '2.00', max_retry_budget: withRetry ? '1.16' : '0.00', max_attempts: withRetry ? 2 : 1, approved_providers: approvedProviders, max_latency_seconds: 60,
    private_data: 'selected_provider_only', expires_at: new Date(Date.now() + 600_000).toISOString(), payment: { rail: 'mpp', chain_id: 4217, token_address: token,
      payer_address: account.address.toLowerCase(), treasury_address: treasury, minimum_token_reserve_units: '5000000', fee_token_address: token, minimum_fee_token_reserve_units: '5000000', max_fee_token_cost_units: '10000' } }), { params: Promise.resolve({ id: routeId }) })
  assert.equal(created.status, 201); const mandate = (await created.json()).mandate
  const approval = { version: 1, origin: baseUrl, route_id: routeId, mandate_id: mandate.id, terms_hash: mandate.terms_hash, chain_id: 4217, rpc_url: rpcUrl }
  const stateDirectory = join(directory, `state-${id}`), adapter = createBuyerTempoAdapter({ chainId: 4217, rpcUrl, account })
  return { approval, apiKey, stateDirectory, account, adapter, dummyKey, buyerId, sellerId, serviceId, fallbackSellerId, fallbackServiceId, mandate, routeId }
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
  const [claim] = await db.select().from(schema.buyer_mpp_payment_claims).where(eq(schema.buyer_mpp_payment_claims.mandate_id, f.mandate.id)); assert.equal(claim.state, 'confirmed'); assert.equal(claim.tx_hash, txHash)
  assert.equal([...transactions.values()].filter((t) => t.payer.toLowerCase() === f.account.address.toLowerCase()).length, 1)
}

test('original Tempo pull funds once through real SDK broadcast and existing escrow; replay cannot add exposure', async () => {
  const f = await fixture(), count = broadcastCalls
  const result = await runBuyerMppFunding(f); assert.equal(result.state, 'funded'); assert.equal(broadcastCalls, count + 1)
  await assertFundedOnce(f, result.tx_hash!)
  assert.equal((await runBuyerMppFunding(f)).tx_hash, result.tx_hash); assert.equal(broadcastCalls, count + 1)
  const saved = await journal(f); assert.equal((await stat(saved.path)).mode & 0o777, 0o600)
  assert.equal(JSON.stringify(saved.value).includes(f.dummyKey), false); assert.equal(JSON.stringify(saved.value).includes(f.apiKey), false)
  assert.equal(methods.some((method) => /sign|fill|sendTransaction$/i.test(method)), false, JSON.stringify(methods))
})

test('lost execute, intent and claim replies retain the original operation and signed credential', async () => {
  for (const suffix of ['/execute', '/intent', '/claim']) {
    const f = await fixture(), count = broadcastCalls; let lost = false
    apiHook = async (path, response, request) => {
      if (!lost && request.method === 'POST' && path.endsWith(suffix) && response.ok) { lost = true; return true } return false
    }
    try { await assert.rejects(() => runBuyerMppFunding(f), /BUYER_REQUEST_UNCERTAIN/) } finally { apiHook = null }
    assert.equal(lost, true); const original = (await journal(f)).value
    assert.equal(broadcastCalls, count)
    const result = await runBuyerMppFunding(f); assert.equal(result.state, 'funded'); assert.equal(broadcastCalls, count + 1)
    const saved = (await journal(f)).value; assert.equal(saved.operation_id, original.operation_id)
    if (original.credential) assert.equal(saved.credential, original.credential)
    await assertFundedOnce(f, result.tx_hash!)
  }
})

test('accepted broadcast with a lost RPC response recovers original hash without another credential submission', async () => {
  const f = await fixture(), count = broadcastCalls; loseBroadcastReply = true
  await assert.rejects(() => runBuyerMppFunding(f), /BUYER_HTTP_/)
  const original = (await journal(f)).value; assert.equal(original.submission_started, true); assert.equal(broadcastCalls, count + 1)
  const result = await runBuyerMppFunding(f); assert.equal(result.state, 'funded'); assert.equal(result.tx_hash, original.tx_hash)
  assert.equal(broadcastCalls, count + 1); await assertFundedOnce(f, result.tx_hash!)
})

test('lost funding response recovers authoritative receipt; a known pending transaction never resubmits', async () => {
  const f = await fixture(), count = broadcastCalls; let lost = false
  apiHook = async (path, response, request) => {
    if (!lost && path.endsWith('/fund/mpp') && request.headers.has('Payment-Authorization') && response.ok) { lost = true; return true } return false
  }
  try { await assert.rejects(() => runBuyerMppFunding(f), /BUYER_REQUEST_UNCERTAIN/) } finally { apiHook = null }
  assert.equal((await runBuyerMppFunding(f)).state, 'funded'); assert.equal(broadcastCalls, count + 1)
  const pending = await fixture(), pendingCount = broadcastCalls; mineOnSend = false
  try { await assert.rejects(() => runBuyerMppFunding(pending), /BUYER_HTTP_/) } finally { mineOnSend = true }
  const original = (await journal(pending)).value
  assert.equal((await runBuyerMppFunding(pending)).state, 'awaiting_confirmation'); assert.equal(broadcastCalls, pendingCount + 1)
  transactions.get(original.tx_hash)!.mined = true
  assert.equal((await runBuyerMppFunding(pending)).state, 'funded'); assert.equal(broadcastCalls, pendingCount + 1)
})

test('revocation during the final SDK simulation stops actual RPC submission and retains exact recovery state', async () => {
  const f = await fixture(), count = broadcastCalls
  await runBuyerMppFunding({ ...f, prepareOnly: true })
  let simulations = 0
  simulationHook = async () => {
    if (++simulations === 5) await db.update(schema.route_payment_mandates).set({ state: 'revoked' }).where(eq(schema.route_payment_mandates.id, f.mandate.id))
  }
  try { await assert.rejects(() => runBuyerMppFunding(f), /BUYER_HTTP_/) } finally { simulationHook = null }
  assert.equal(simulations, 5); assert.equal(broadcastCalls, count)
  const original = (await journal(f)).value
  const [claim] = await db.select().from(schema.buyer_mpp_payment_claims).where(eq(schema.buyer_mpp_payment_claims.mandate_id, f.mandate.id))
  assert.equal(claim.first_submission_at, null)
  assert.equal((await runBuyerMppFunding(f)).state, 'held_recover_existing_payment')
  assert.equal((await journal(f)).value.credential, original.credential); assert.equal(broadcastCalls, count)
})

test('chain mismatch, reserve floor and fee cap fail before any server submission', async () => {
  const f = await fixture(), count = broadcastCalls
  rpcChainId = 1
  try { await assert.rejects(() => runBuyerMppFunding(f), /BUYER_RPC_CHAIN_MISMATCH/) } finally { rpcChainId = 4217 }
  balances.set(f.account.address.toLowerCase(), 6_050_000n) // Payment leaves the exact floor; even one fee unit violates it.
  await assert.rejects(() => runBuyerMppFunding(f), /BUYER_.*RESERVE/)
  balances.set(f.account.address.toLowerCase(), 10_000_000n)
  await assert.rejects(() => runBuyerMppFunding({ ...f, adapter: { ...f.adapter,
    prepare: async (intent: any) => {
      const original = Transaction.deserialize(await f.adapter.prepare(intent, undefined))
      if (original.type !== 'tempo') throw new Error('Expected dummy Tempo envelope')
      return f.account.signTransaction({ ...original, from: undefined, signature: undefined, maxFeePerGas: 1_000_000_000_000n })
    } } }), /BUYER_TEMPO_.*FEE|BUYER_PAYMENT_SCOPE_MISMATCH/)
  assert.equal(broadcastCalls, count)
})

test('one unreconciled wallet blocks a different route; no mandate plans only', async () => {
  const f = await fixture(); await runBuyerMppFunding({ ...f, prepareOnly: true })
  const other = await fixture(f.dummyKey), count = broadcastCalls
  await assert.rejects(() => runBuyerMppFunding({ ...other, stateDirectory: f.stateDirectory }), /BUYER_WALLET_PAYMENT_UNRECONCILED/)
  const result = await runBuyerMppFunding({ approval: { version: 1, origin: baseUrl, route_id: other.routeId }, apiKey: other.apiKey,
    stateDirectory: undefined, account: undefined, adapter: undefined })
  assert.equal(result.state, 'plan_only'); assert.equal(result.funds_moved, false); assert.equal(broadcastCalls, count)
})

test('SIGKILL after durable claim resumes the same credential in a new buyer process', async () => {
  const f = await fixture(), approvalFile = join(directory, `${f.routeId}.approval.json`), count = broadcastCalls
  await writeFile(approvalFile, JSON.stringify(f.approval), { mode: 0o600 })
  let ready!: () => void, release!: () => void
  const claimed = new Promise<void>((done) => { ready = done }), gate = new Promise<void>((done) => { release = done })
  apiHook = async (path, response) => { if (path.endsWith('/claim') && response.ok) { ready(); await gate } return false }
  const args = ['scripts/buyer-mpp-worker.mjs', approvalFile, f.stateDirectory], environment = { ...process.env,
    CLAWDMARKET_BUYER_PRIVATE_KEY: f.dummyKey, CLAWDMARKET_BUYER_API_KEY: f.apiKey }
  const child = spawn(process.execPath, args, { cwd: resolve('.'), env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''; child.stderr.on('data', (bytes) => { stderr += bytes.toString() })
  const timer = setTimeout(() => { child.kill('SIGKILL'); release() }, 15_000)
  try {
    await Promise.race([claimed, new Promise<never>((_, reject) => child.once('exit', () => reject(new Error(`Dummy worker exited: ${stderr}`))))])
    const original = (await journal(f)).value
    assert.equal(original.submission_started, false)
    const exited = new Promise<void>((done) => child.once('exit', () => done())); child.kill('SIGKILL'); await exited
    apiHook = null; release()
    const output = await promisify(execFile)(process.execPath, args, { cwd: resolve('.'), env: environment }), result = JSON.parse(output.stdout)
    assert.equal(result.state, 'funded'); assert.equal(result.tx_hash, original.tx_hash)
    assert.equal((await journal(f)).value.credential, original.credential); assert.equal(broadcastCalls, count + 1)
    assert.equal((output.stdout + output.stderr).includes(f.dummyKey), false); assert.equal((output.stdout + output.stderr).includes(f.apiKey), false)
    await assertFundedOnce(f, result.tx_hash)
  } finally { clearTimeout(timer); apiHook = null; release(); child.kill('SIGKILL') }
})

test('SDK-consumed original receipt before application commit is recovered after restart without a second pull', async () => {
  const f = await fixture(), count = broadcastCalls
  await runBuyerMppFunding({ ...f, prepareOnly: true }); const original = (await journal(f)).value
  const headers = { Authorization: `Bearer ${f.apiKey}`, 'Content-Type': 'application/json' }
  const claim = await fetch(`${baseUrl}/api/trades/${original.trade_id}/fund/mpp/claim`, { method: 'POST', headers,
    body: JSON.stringify({ intent_id: original.intent.id, mandate_id: f.mandate.id, buyer_operation_id: original.operation_id, serialized_transaction: original.serialized_transaction }) })
  assert.equal(claim.status, 200)
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, original.trade_id))
  const { getMarketplaceMppServer } = await import('@/lib/mpp'), { marketplaceMppCharge } = await import('@/lib/marketplace-mpp-payment')
  const paid = await getMarketplaceMppServer()!.charge(marketplaceMppCharge(trade))(new Request(`${baseUrl}/api/trades/${trade.id}/fund/mpp`, {
    method: 'POST', headers: { 'Payment-Authorization': original.credential } }))
  assert.equal(paid.status, 200); assert.equal(broadcastCalls, count + 1)
  assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, trade.id))).length, 0)
  const result = await runBuyerMppFunding(f); assert.equal(result.state, 'funded'); assert.equal(result.tx_hash, original.tx_hash)
  assert.equal(broadcastCalls, count + 1); await assertFundedOnce(f, result.tx_hash!)
})

test('late original paid hash after mandate revocation enters one refund and clears only its verified claim', async () => {
  const f = await fixture(), count = broadcastCalls; loseBroadcastReply = true
  await assert.rejects(() => runBuyerMppFunding(f), /BUYER_HTTP_/)
  await db.update(schema.route_payment_mandates).set({ state: 'revoked' }).where(eq(schema.route_payment_mandates.id, f.mandate.id))
  const result = await runBuyerMppFunding(f); assert.equal(result.state, 'refund_pending'); assert.equal(broadcastCalls, count + 1)
  const [claim] = await db.select().from(schema.buyer_mpp_payment_claims).where(eq(schema.buyer_mpp_payment_claims.mandate_id, f.mandate.id))
  assert.equal(claim.state, 'confirmed'); assert.equal(claim.tx_hash, result.tx_hash)
  const refunds = await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, result.trade_id!))
  assert.equal(refunds.length, 1); assert.equal(refunds[0].kind, 'buyer_refund'); assert.equal(refunds[0].token_amount, '1050000')
  assert.equal(refunds[0].raw_transaction, null); assert.equal((await runBuyerMppFunding(f)).state, 'refund_pending')
})

test('independent buyer processes with the same payer/nonce cannot claim and pay different orders', async () => {
  const f = await fixture(), other = await fixture(f.dummyKey), count = broadcastCalls
  await runBuyerMppFunding({ ...f, prepareOnly: true }); await runBuyerMppFunding({ ...other, prepareOnly: true })
  const results = await Promise.allSettled([runBuyerMppFunding(f), runBuyerMppFunding(other)])
  assert.equal(results.filter((r) => r.status === 'fulfilled' && r.value.state === 'funded').length, 1)
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1); assert.equal(broadcastCalls, count + 1)
  assert.equal([...transactions.values()].filter((t) => t.payer.toLowerCase() === f.account.address.toLowerCase()).length, 1)
})

test('Tempo original refund, fresh retry intent and guarded pull settle one approved fallback receipt', async () => {
  const f = await fixture(undefined, true), original = await runBuyerRoute(f)
  const [order] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, original.trade_id!))
  assert.equal(order.service_id, f.serviceId)
  const [attempt] = await db.select().from(schema.service_execution_attempts).where(eq(schema.service_execution_attempts.order_id, order.id))
  const sellerKey = jwt({ userId: f.sellerId, email: `${f.sellerId}@test.invalid`, role: 'human' })
  const declined = await fetch(`${baseUrl}/api/trades/${original.trade_id}/work-order/attempt`, { method: 'POST', headers: { Authorization: `Bearer ${sellerKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ attempt_id: attempt.id, action: 'decline' }) }); assert.equal(declined.status, 201)
  const request = (path: string, body: unknown) => new NextRequest(`${baseUrl}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${f.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const context = { params: Promise.resolve({ id: original.trade_id! }) }
  const disputed = await (await import('@/app/api/trades/[id]/dispute/route')).POST(request(`/api/trades/${original.trade_id}/dispute`, { reason: 'Provider declined; require exact existing buyer refund.' }), context)
  assert.equal(disputed.status, 200)
  process.env.ADMIN_USER_IDS = f.buyerId
  try {
    const resolved = await (await import('@/app/api/trades/[id]/resolve/route')).POST(request(`/api/trades/${original.trade_id}/resolve`, { resolution: 'buyer' }), context)
    assert.equal(resolved.status, 200, JSON.stringify(await resolved.json()))
  } finally { delete process.env.ADMIN_USER_IDS }
  const funded = await runBuyerRoute(f); assert.equal(funded.state, 'funded', JSON.stringify(funded)); assert.notEqual(funded.trade_id, original.trade_id)
  const providerKey = jwt({ userId: f.fallbackSellerId!, email: `${f.fallbackSellerId}@test.invalid`, role: 'human' })
  const delivered = await runProviderWork({ baseUrl, apiKey: providerKey, tradeId: funded.trade_id!, serviceId: f.fallbackServiceId!, stateFile: join(directory, `${f.routeId}.fallback.json`),
    handler: async () => ({ summary: 'The approved Tempo fallback completed the original objective.', artifact: { result: 'private-tempo-fallback' } }) })
  const result = await runBuyerRoute({ ...f, decision: { version: 1, route_id: f.routeId, decision: 'accept', content_hash: delivered.content_hash } })
  assert.equal(result.state, 'completed', JSON.stringify(result)); assert.equal(result.receipt!.receipt.payment_rail, 'mpp')
  assert.equal(result.receipt!.receipt.attempts.length, 2); assert.equal(result.receipt!.receipt.gross_attempt_total, '2.21')
  assert.equal((await db.select().from(schema.buyer_mpp_payment_claims).where(eq(schema.buyer_mpp_payment_claims.mandate_id, f.mandate.id))).filter((entry) => entry.state === 'confirmed').length, 2)
  assert.equal((await db.select().from(schema.route_retry_funding_steps).where(eq(schema.route_retry_funding_steps.route_id, f.routeId))).length, 1)
})
