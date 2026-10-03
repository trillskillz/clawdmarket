import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { NextRequest } from 'next/server'
import { and, eq, sql } from 'drizzle-orm'
import { encodeAbiParameters, encodeEventTopics, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { creditDepositMessage } from '@/lib/credit-proof'

const payer = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const treasury = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const outsider = privateKeyToAccount(`0x${'33'.repeat(32)}`)
const token = `0x${'44'.repeat(20)}` as const
const blockHash = `0x${'55'.repeat(32)}`
let directory: string, server: Server
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let deposits: typeof import('@/app/api/wallet/deposits/route')
let credit: typeof import('@/lib/account-credit')
let wallet: typeof import('@/app/api/wallet/route').GET
let transfers: typeof import('@/app/api/wallet/transfers/route').POST
let balances: typeof import('@/app/api/wallet/balances/route').GET
let buy: typeof import('@/app/api/trades/route').POST
let jwt: typeof import('@/lib/auth').generateJWT
let complete: typeof import('@/lib/trade-escrow').finalizeTradeCompletion
let dispute: typeof import('@/lib/trade-dispute').finalizeTradeDispute
let rpcChain = 8453, precision = 6, canonical = blockHash, currentBlock = '0x67'
const native = '0x1000000000000'
const evidence = new Map<string, { sender?: string; recipient?: string; token?: string; amount?: bigint; timestamp?: number; reverted?: boolean }>()
let currentEvidence: { timestamp?: number } = {}

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-credit-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'credit.db')}`, TURSO_AUTH_TOKEN: '', JWT_SECRET: 'credit-test-only', WEBHOOK_SECRET_KEY: 'credit-test-only', CHAT_ENCRYPTION_KEY: 'credit-test-only', TREASURY_ADDRESS: treasury.address, EVM_SETTLEMENT_PRIVATE_KEY: `0x${'22'.repeat(32)}` })
  delete process.env.DEV_WALLET_ADDRESS; delete process.env.DEV_FEE_WALLET_ADDRESS; delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED
  server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk
    const input = JSON.parse(body), hash = input.params?.[0]
    const item = evidence.get(hash) || {}; let result: unknown
    if (input.method === 'eth_getTransactionReceipt') { currentEvidence = item; result = {
      transactionHash: hash, blockHash, blockNumber: '0x64', transactionIndex: '0x0', from: item.sender || payer.address, to: token, status: item.reverted ? '0x0' : '0x1', cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null, logsBloom: `0x${'00'.repeat(256)}`, type: '0x2',
      logs: [{ address: item.token || token, blockHash, blockNumber: '0x64', transactionHash: hash, transactionIndex: '0x0', logIndex: '0x0', removed: false, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: (item.sender || payer.address) as `0x${string}`, to: (item.recipient || treasury.address) as `0x${string}` } }), data: encodeAbiParameters([{ type: 'uint256' }], [item.amount ?? 1_000_000n]) }],
    } }
    else if (input.method === 'eth_blockNumber') result = currentBlock
    else if (input.method === 'eth_chainId') result = `0x${rpcChain.toString(16)}`
    else if (input.method === 'eth_call') result = encodeAbiParameters([{ type: 'uint256' }], [BigInt(input.params[0].data.startsWith('0x313ce567') ? precision : 1_234_567)])
    else if (input.method === 'eth_getCode') result = '0x'
    else if (input.method === 'eth_getBalance') result = native
    else if (input.method === 'eth_getTransactionByHash') result = { hash, from: item.sender || payer.address, to: token, blockHash, blockNumber: '0x64', transactionIndex: '0x0', value: '0x0', gas: '0x5208', gasPrice: '0x1', nonce: '0x0', input: '0x', type: '0x2', chainId: '0x2105' }
    else if (['eth_getBlockByHash', 'eth_getBlockByNumber'].includes(input.method)) result = { hash: input.method.endsWith('Number') ? canonical : blockHash, number: '0x64', timestamp: `0x${(currentEvidence.timestamp ?? Math.floor(Date.now() / 1000) + 1).toString(16)}`, transactions: [] }
    else { response.end(JSON.stringify({ id: input.id, jsonrpc: '2.0', error: { code: -32601, message: input.method } })); return }
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ id: input.id, jsonrpc: '2.0', result }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Base fixture', address: token, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}` }])
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  deposits = await import('@/app/api/wallet/deposits/route'); credit = await import('@/lib/account-credit'); wallet = (await import('@/app/api/wallet/route')).GET
  transfers = (await import('@/app/api/wallet/transfers/route')).POST; balances = (await import('@/app/api/wallet/balances/route')).GET
  buy = (await import('@/app/api/trades/route')).POST; jwt = (await import('@/lib/auth')).generateJWT
  complete = (await import('@/lib/trade-escrow')).finalizeTradeCompletion; dispute = (await import('@/lib/trade-dispute')).finalizeTradeDispute
})
after(async () => { db?.$client.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (directory) rmSync(directory, { recursive: true, force: true }) })
async function user() { const id = crypto.randomUUID(); await db.insert(schema.users).values({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' }); return id }
function request(path: string, userId: string, method = 'GET', body?: unknown) { return new NextRequest(`http://localhost${path}`, { method, headers: { 'Content-Type': 'application/json', authorization: `Bearer ${jwt({ userId, email: `${userId}@test.invalid`, role: 'human' })}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
async function intent(userId: string, minor = 100) {
  const response = await deposits.POST(request('/api/wallet/deposits', userId, 'POST', { amount_minor: minor, payer: payer.address, client_reference: crypto.randomUUID() }))
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); return (await response.json()).deposit
}
async function proof(deposit: Awaited<ReturnType<typeof intent>>, mutation: Parameters<typeof evidence.set>[1] = {}) { const hash = `0x${crypto.randomUUID().replaceAll('-', '').repeat(2)}` as `0x${string}`; evidence.set(hash, mutation); const signature = await payer.signMessage({ message: creditDepositMessage(deposit, hash) }); return { id: deposit.id, tx_hash: hash, signature } }
async function deposit(userId: string, minor = 100) { const input = await proof(await intent(userId, minor), { amount: BigInt(minor) * 10000n }); const response = await deposits.PUT(request('/api/wallet/deposits', userId, 'PUT', input)); assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); return (await response.json()).deposit }
async function listing(seller: string, price = 1) { return (await db.insert(schema.listings).values({ seller_id: seller, title: 'Credit fixture', description: 'Test purchase', category: 'other', price_bankr: price }).returning())[0] }
async function buyCredit(buyer: string, item: Awaited<ReturnType<typeof listing>>, reference = crypto.randomUUID()) { return buy(request('/api/trades', buyer, 'POST', { listing_id: item.id, amount: 1, payment_rail: 'credit', client_reference: reference })) }
async function liability() { const [row] = await db.select({ total: sql<number>`coalesce(sum(${schema.credit_accounts.available_minor} + ${schema.credit_accounts.escrow_minor}), 0)` }).from(schema.credit_accounts); return Number(row.total) }

test('concurrent deposit intent creation grants one send and immutable reference replay', async () => {
  const id = await user(), input = { amount_minor: 100, payer: payer.address, client_reference: crypto.randomUUID() }
  const values = await Promise.all([deposits.POST(request('/api/wallet/deposits', id, 'POST', input)), deposits.POST(request('/api/wallet/deposits', id, 'POST', input))])
  const bodies = await Promise.all(values.map(v => v.json())); assert.equal(bodies.filter(b => b.deposit.created).length, 1); assert.equal(bodies[0].deposit.id, bodies[1].deposit.id)
  assert.equal((await deposits.POST(request('/api/wallet/deposits', id, 'POST', { ...input, amount_minor: 200 }))).status, 409)
  assert.equal((await credit.creditBalance(id)).available_minor, 0)
})
test('payer signature and authoritative receipt are required; original hash remains locked', async () => {
  const id = await user(), d = await intent(id), input = await proof(d, { amount: 900000n })
  const wrong = await outsider.signMessage({ message: creditDepositMessage(d, input.tx_hash) })
  assert.equal((await deposits.PUT(request('/api/wallet/deposits', id, 'PUT', { ...input, signature: wrong }))).status, 403)
  assert.equal((await deposits.PUT(request('/api/wallet/deposits', id, 'PUT', input))).status, 409)
  assert.equal((await deposits.PUT(request('/api/wallet/deposits', id, 'PUT', await proof(d)))).status, 409)
  assert.equal((await credit.creditBalance(id)).available_minor, 0)
})
test('receipt sender, recipient, asset, exact amount, timestamp, status and canonical network are checked', async () => {
  for (const mutation of [{ sender: outsider.address }, { recipient: outsider.address }, { token: outsider.address }, { amount: 1000001n }, { timestamp: 1 }, { reverted: true }]) {
    const id = await user(), input = await proof(await intent(id), mutation)
    assert.equal((await deposits.PUT(request('/api/wallet/deposits', id, 'PUT', input))).status, 409); assert.equal((await credit.creditBalance(id)).available_minor, 0)
  }
  for (const mode of ['chain', 'canonical', 'decimals', 'confirmations']) {
    const id = await user(), input = await proof(await intent(id))
    if (mode === 'chain') rpcChain = 1; if (mode === 'canonical') canonical = `0x${'aa'.repeat(32)}`; if (mode === 'decimals') precision = 18; if (mode === 'confirmations') currentBlock = '0x64'
    const response = await deposits.PUT(request('/api/wallet/deposits', id, 'PUT', input)); assert.equal(response.status, mode === 'confirmations' ? 202 : 409)
    assert.equal((await credit.creditBalance(id)).available_minor, 0); rpcChain = 8453; canonical = blockHash; precision = 6; currentBlock = '0x67'
  }
})
test('confirmed deposit is credited once across concurrent recovery, expiry and payment pause', async () => {
  const id = await user(), d = await intent(id), input = await proof(d), initial = await liability()
  await db.update(schema.credit_deposits).set({ expires_at: new Date(0) }).where(eq(schema.credit_deposits.id, d.id))
  process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED = 'true'
  assert.equal((await deposits.POST(request('/api/wallet/deposits', id, 'POST', { amount_minor: 1, payer: payer.address, client_reference: crypto.randomUUID() }))).status, 503)
  const responses = await Promise.all([deposits.PUT(request('/api/wallet/deposits', id, 'PUT', input)), deposits.PUT(request('/api/wallet/deposits', id, 'PUT', input))]); assert.deepEqual(responses.map(r => r.status), [200, 200])
  delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED
  assert.equal((await credit.creditBalance(id)).available_minor, 100); assert.equal(await liability(), initial + 100)
  const entries = await db.select().from(schema.credit_entries).where(and(eq(schema.credit_entries.user_id, id), eq(schema.credit_entries.kind, 'deposit'))); assert.equal(entries.length, 1)
  const stranger = await user(); assert.equal((await deposits.PUT(request('/api/wallet/deposits', stranger, 'PUT', input))).status, 404)
})
test('a transfer receipt used by a trade cannot mint account credit', async () => {
  const id = await user(), d = await intent(id), input = await proof(d)
  await db.insert(schema.payment_receipts).values({ route: '/api/trades/test/fund/evm', amount: 1, currency: 'USDC', tx_hash: input.tx_hash, payment_rail: 'evm' })
  assert.notEqual((await deposits.PUT(request('/api/wallet/deposits', id, 'PUT', input))).status, 200); assert.equal((await credit.creditBalance(id)).available_minor, 0)
})
test('historical balances cannot buy; backed credit purchases reserve cents and settle once with fee conservation', async () => {
  const buyer = await user(), seller = await user(), item = await listing(seller)
  await db.insert(schema.wallets).values({ user_id: buyer, balance: 100000, escrow: 0 })
  assert.equal((await buyCredit(buyer, item)).status, 402)
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, item.id)))[0].status, 'active')
  await deposit(buyer, 105); const total = await liability(), reference = crypto.randomUUID()
  const response = await buyCredit(buyer, item, reference); assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  const trade = (await response.json()).trade; assert.equal(trade.payment_rail, 'credit'); assert.equal(trade.status, 'escrow_held')
  assert.deepEqual(await credit.creditBalance(buyer), { available_minor: 0, escrow_minor: 100, currency: 'USD', rail: 'credit' }); assert.equal(await liability(), total)
  assert.equal((await buyCredit(buyer, item, reference)).status, 200)
  const held = (await wallet(request('/api/wallet', buyer))).json(); assert.equal((await held).available, 0)
  const [ready] = await db.update(schema.trades).set({ status: 'pending_release' }).where(eq(schema.trades.id, trade.id)).returning()
  await complete(ready, 'buyer_confirm'); await assert.rejects(complete(ready, 'buyer_confirm'), /TRADE_NOT_PENDING_RELEASE/)
  assert.equal((await credit.creditBalance(seller)).available_minor, 100); assert.equal((await credit.creditBalance(buyer)).escrow_minor, 0); assert.equal(await liability(), total)
  assert.equal((await db.select().from(schema.wallets).where(eq(schema.wallets.user_id, buyer)))[0].balance, 100000)
})
test('dispute split releases exact escrow once; different purchases cannot overspend concurrently', async () => {
  const buyer = await user(), seller = await user(); await deposit(buyer, 105)
  const items = await Promise.all([listing(seller), listing(seller)])
  const responses = await Promise.all(items.map(i => buyCredit(buyer, i))); assert.deepEqual(responses.map(r => r.status).sort(), [201, 402])
  const body = await responses.find(r => r.status === 201)!.json(); const [trade] = await db.update(schema.trades).set({ status: 'disputed' }).where(eq(schema.trades.id, body.trade.id)).returning()
  const total = await liability(); await dispute(trade, 'split', 33); assert.equal(await dispute(trade, 'split', 33), null)
  assert.equal((await credit.creditBalance(buyer)).available_minor, 67); assert.equal((await credit.creditBalance(seller)).available_minor, 33); assert.equal(await liability(), total)
})
test('owners fund agent credit idempotently; a different owner or destination cannot reuse the reference', async () => {
  const owner = await user(), stranger = await user(), agentId = crypto.randomUUID(), synthetic = `user_agent_${agentId}`
  await db.insert(schema.agents).values({ id: agentId, name: 'Credit agent', description: 'Test agent', capabilities: '[]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused' })
  await db.insert(schema.users).values({ id: synthetic, email: `${agentId}@agent.invalid`, name: 'Agent', password_hash: 'unused', role: 'agent' })
  await db.insert(schema.agent_owners).values({ agentId, userId: owner, establishedBy: 'owner_claim' })
  await deposit(owner); const total = await liability(), input = { agent_id: agentId, amount_minor: 75, client_reference: crypto.randomUUID() }
  assert.equal((await transfers(request('/api/wallet/transfers', stranger, 'POST', input))).status, 403)
  for (let i = 0; i < 2; i++) assert.equal((await transfers(request('/api/wallet/transfers', owner, 'POST', input))).status, 200)
  assert.equal((await credit.creditBalance(owner)).available_minor, 25); assert.equal((await credit.creditBalance(synthetic)).available_minor, 75); assert.equal(await liability(), total)
  assert.equal((await transfers(request('/api/wallet/transfers', owner, 'POST', { ...input, amount_minor: 70 }))).status, 409)
  assert.equal((await wallet(request(`/api/wallet?agent_id=${agentId}`, stranger))).status, 403)
  assert.equal((await wallet(request(`/api/wallet?agent_id=${agentId}`, owner))).status, 200)
  await db.update(schema.agent_owners).set({ userId: stranger }).where(eq(schema.agent_owners.agentId, agentId))
  assert.equal((await transfers(request('/api/wallet/transfers', owner, 'POST', input))).status, 403)
})
test('connected wallet balance reads report actual decimals and unavailable RPC states', async () => {
  const id = await user(), path = `/api/wallet/balances?address=${payer.address}`
  const data = await (await balances(request(path, id))).json(); assert.equal(data.balances[0].amount, '1.234567'); assert.equal(data.balances[0].native_balance_wei, BigInt(native).toString())
  rpcChain = 1; const unavailable = await (await balances(request(path, id))).json(); assert.equal(unavailable.balances[0].status, 'unavailable'); assert.equal(unavailable.balances[0].amount, null); rpcChain = 8453
})
test('deposit cookie authentication requires CSRF and agent read credentials cannot authorize wallet writes', async () => {
  const id = await user(), tokenJwt = jwt({ userId: id, email: `${id}@test.invalid`, role: 'human' })
  const cookie = new NextRequest('http://localhost/api/wallet/deposits', { method: 'POST', headers: { cookie: `auth-token=${tokenJwt}`, 'content-type': 'application/json' }, body: JSON.stringify({ amount_minor: 100, payer: payer.address, client_reference: crypto.randomUUID() }) })
  assert.equal((await deposits.POST(cookie)).status, 403)
  const { requiredAgentCredentialScope } = await import('@/lib/agent-credential-scopes')
  for (const path of ['/api/wallet/deposits', '/api/wallet/transfers']) assert.equal(requiredAgentCredentialScope(new NextRequest(`http://localhost${path}`, { method: 'POST' })), 'payments:write')
  assert.equal(requiredAgentCredentialScope(new NextRequest('http://localhost/api/wallet/balances')), 'agent:read')
})

test('registered agents can deposit and spend backed credit; scoped read keys cannot pay and spend limits hold', async () => {
  const agentId = crypto.randomUUID(), synthetic = `user_agent_${agentId}`
  const { hashAgentApiKey } = await import('@/lib/registered-agent-auth')
  const { createNamedAgentCredential } = await import('@/lib/agent-named-credentials')
  await db.insert(schema.agents).values({ id: agentId, name: 'Paying agent', description: 'Agent payment fixture', capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: hashAgentApiKey(`clawdmarket-test-${agentId}`), status: 'active' })
  const read = await createNamedAgentCredential({ agentId, name: 'Read only', scopes: ['agent:read'], actorCredentialId: null })
  const pay = await createNamedAgentCredential({ agentId, name: 'Spend credit', scopes: ['agent:read', 'payments:write'], actorCredentialId: null })
  assert.equal(read.kind, 'created'); assert.equal(pay.kind, 'created')
  if (read.kind !== 'created' || pay.kind !== 'created') return
  function agentRequest(path: string, key: string, method = 'GET', body?: unknown) { return new NextRequest(`http://localhost${path}`, { method, headers: { 'X-ClawdMarket-Agent-Key': key, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) }
  const input = { amount_minor: 105, payer: payer.address, client_reference: crypto.randomUUID() }
  assert.equal((await deposits.POST(agentRequest('/api/wallet/deposits', read.api_key, 'POST', input))).status, 401)
  const created = await deposits.POST(agentRequest('/api/wallet/deposits', pay.api_key, 'POST', input)); assert.equal(created.status, 200)
  const d = (await created.json()).deposit, signed = await proof(d, { amount: 1050000n })
  assert.equal((await deposits.PUT(agentRequest('/api/wallet/deposits', read.api_key, 'PUT', signed))).status, 401)
  assert.equal((await deposits.PUT(agentRequest('/api/wallet/deposits', pay.api_key, 'PUT', signed))).status, 200)
  assert.equal((await (await wallet(agentRequest('/api/wallet', read.api_key))).json()).available, 1.05)
  const seller = await user(), item = await listing(seller), order = { listing_id: item.id, amount: 1, payment_rail: 'credit', client_reference: crypto.randomUUID() }
  assert.equal((await buy(agentRequest('/api/trades', read.api_key, 'POST', order))).status, 401)
  process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD = '0.50'
  assert.equal((await buy(agentRequest('/api/trades', pay.api_key, 'POST', order))).status, 409)
  assert.equal((await credit.creditBalance(synthetic)).available_minor, 105)
  delete process.env.CLAWDMARKET_AGENT_MAX_TRADE_USD
  const purchase = await buy(agentRequest('/api/trades', pay.api_key, 'POST', order)); assert.equal(purchase.status, 201, JSON.stringify(await purchase.clone().json()))
  assert.equal((await credit.creditBalance(synthetic)).available_minor, 0); assert.equal((await credit.creditBalance(synthetic)).escrow_minor, 100)
  const { archiveAgent, inspectAgentArchiveBlockers } = await import('@/lib/agent-lifecycle')
  assert.equal((await inspectAgentArchiveBlockers(agentId)).nonzero_wallet > 0, true)
  assert.equal((await archiveAgent({ agentId, reason: 'Test archive', actorType: 'self' })).kind, 'blocked')
})

test('credit-funded reusable orders dispatch immediately, replay without new exposure and release capacity after settlement', async () => {
  process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED = 'true'
  const seller = await user(), buyer = await user()
  await deposit(buyer, 105)
  const [offered] = await db.insert(schema.service_definitions).values({ id: crypto.randomUUID(), seller_id: seller, title: 'Reusable review', description: 'Review input and deliver findings', capabilities: '["code-review"]', price_minor: 100, status: 'active', max_concurrency: 1 }).returning()
  const post = (await import('@/app/api/services/[id]/orders/route')).POST
  const path = `/api/services/${offered.id}/orders`, input = { client_reference: crypto.randomUUID(), objective: 'Review the attached code', payment_rail: 'credit', input: {}, max_total: '1.05' }
  const context = { params: Promise.resolve({ id: offered.id }) }
  const response = await post(request(path, buyer, 'POST', input), context); assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  const body = await response.json(); assert.equal(body.order.state, 'funded'); assert.equal(body.checkout.rail, 'credit')
  assert.equal((await post(request(path, buyer, 'POST', input), context)).status, 200)
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id)))[0].active_orders, 1)
  const [trade] = await db.update(schema.trades).set({ status: 'pending_release' }).where(eq(schema.trades.id, body.trade.id)).returning()
  await complete(trade, 'buyer_confirm')
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, offered.id)))[0].active_orders, 0)
  assert.equal((await credit.creditBalance(seller)).available_minor, 100)
  delete process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED
})

test('task credit funding accepts a seller without external payout setup and enforces the exact quote', async () => {
  const buyer = await user(), agentId = crypto.randomUUID(), taskId = `task_${crypto.randomUUID()}`, bidId = `bid_${crypto.randomUUID()}`
  await db.insert(schema.agents).values({ id: agentId, name: 'Task credit seller', description: 'Task fixture', capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused', status: 'active' })
  await db.insert(schema.tasks).values({ id: taskId, posterAgentId: buyer, title: 'Credit-funded task', description: 'Review a code change', budgetUsd: 1, requiredCapabilities: '["code-review"]' })
  await db.insert(schema.bids).values({ id: bidId, taskId, bidderAgentId: agentId, priceUsd: 1 })
  const accept = (await import('@/app/api/tasks/[id]/accept/[bid_id]/route')).POST
  const accepted = await accept(request(`/api/tasks/${taskId}/accept/${bidId}`, buyer, 'POST', {}), { params: Promise.resolve({ id: taskId, bid_id: bidId }) })
  assert.equal(accepted.status, 200, JSON.stringify(await accepted.clone().json()))
  await deposit(buyer, 105)
  const fund = (await import('@/app/api/tasks/[id]/fund/route')).POST, context = { params: Promise.resolve({ id: taskId }) }, path = `/api/tasks/${taskId}/fund`
  const input = { payment_rail: 'credit', expected_total: 1.05, client_reference: crypto.randomUUID() }
  assert.equal((await fund(request(path, buyer, 'POST', { ...input, expected_total: 1 }), context)).status, 409)
  const funded = await fund(request(path, buyer, 'POST', input), context); assert.equal(funded.status, 201, JSON.stringify(await funded.clone().json()))
  assert.equal((await funded.json()).trade.status, 'escrow_held')
  assert.equal((await fund(request(path, buyer, 'POST', input), context)).status, 200)
  assert.equal((await credit.creditBalance(buyer)).available_minor, 0); assert.equal((await credit.creditBalance(buyer)).escrow_minor, 100)
})

test('credit audit reconciles deposits, account deltas, escrow and shared receipts and detects unbacked edits', async () => {
  const { inspectCreditHealth } = await import('@/lib/credit-health.mjs')
  assert.equal((await inspectCreditHealth(db.$client)).healthy, true)
  const id = await user(); await db.insert(schema.credit_accounts).values({ user_id: id, available_minor: 1 })
  const bad = await inspectCreditHealth(db.$client); assert.equal(bad.healthy, false); assert.equal(bad.account_anomalies, 1)
  await db.delete(schema.credit_accounts).where(eq(schema.credit_accounts.user_id, id))
  assert.equal((await inspectCreditHealth(db.$client)).healthy, true)
})
