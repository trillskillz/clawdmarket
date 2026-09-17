import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { encodeAbiParameters, encodeEventTopics, erc20Abi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { evmPaymentProofMessage } from '@/lib/evm-payment-proof'

const payer = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const treasury = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const outsider = privateKeyToAccount(`0x${'33'.repeat(32)}`)
const tokenAddress = `0x${'44'.repeat(20)}` as const
const blockHash = `0x${'55'.repeat(32)}`
const chainId = 8453
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let route: typeof import('@/app/api/trades/[id]/fund/evm/intent/route')
let fund: typeof import('@/app/api/trades/[id]/fund/evm/route').POST
let createTrade: typeof import('@/app/api/trades/route').POST
let jwt: typeof import('@/lib/auth').generateJWT
let fixtureDir: string
let server: Server
let rpcCalls = 0
const evidence = new Map<string, { sender?: string; recipient?: string; token?: string; amount?: bigint; timestamp?: number; confirmations?: number; reverted?: boolean }>()

before(async () => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-'))
  process.env.TURSO_DATABASE_URL = `file:${join(fixtureDir, 'payment.db')}`
  process.env.TURSO_AUTH_TOKEN = ''
  process.env.JWT_SECRET = 'local-payment-tests-only'
  process.env.WEBHOOK_SECRET_KEY = 'local-payment-tests-only'
  process.env.TREASURY_ADDRESS = treasury.address
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'22'.repeat(32)}`
  delete process.env.DEV_WALLET_ADDRESS; delete process.env.DEV_FEE_WALLET_ADDRESS
  server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    rpcCalls += 1
    const hash = input.params?.[0]
    const item = evidence.get(hash) || {}
    let result: unknown
    if (input.method === 'eth_getTransactionReceipt') result = {
      transactionHash: hash, blockHash, blockNumber: '0x64', transactionIndex: '0x0',
      from: item.sender || payer.address, to: tokenAddress, status: item.reverted ? '0x0' : '0x1',
      cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null,
      logsBloom: `0x${'00'.repeat(256)}`, type: '0x2',
      logs: [{ address: item.token || tokenAddress, blockHash, blockNumber: '0x64', transactionHash: hash,
        transactionIndex: '0x0', logIndex: '0x0', removed: false,
        topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: (item.sender || payer.address) as `0x${string}`, to: (item.recipient || treasury.address) as `0x${string}` } }),
        data: encodeAbiParameters([{ type: 'uint256' }], [item.amount ?? 1_050_000n]),
      }],
    }
    else if (input.method === 'eth_blockNumber') result = '0x67'
    else if (input.method === 'eth_getTransactionByHash') result = {
      hash, from: item.sender || payer.address, to: tokenAddress, blockHash, blockNumber: '0x64', transactionIndex: '0x0',
      value: '0x0', gas: '0x5208', gasPrice: '0x1', nonce: '0x0', input: '0x', type: '0x2', chainId: '0x2105',
    }
    else if (input.method === 'eth_getBlockByHash') {
      // Tests are sequential; the most recently inserted evidence is the one
      // being verified. No real blockchain or funds are used.
      const latest = [...evidence.values()].at(-1)
      result = { hash: blockHash, number: '0x64', timestamp: `0x${(latest?.timestamp ?? Math.floor(Date.now() / 1000) + 1).toString(16)}`, transactions: [] }
    } else {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, error: { code: -32601, message: `Unexpected method ${input.method}` } }))
      return
    }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ jsonrpc: '2.0', id: input.id, result }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId, chainName: 'Local mock', address: tokenAddress, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: `http://127.0.0.1:${address.port}` }])
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  route = await import('@/app/api/trades/[id]/fund/evm/intent/route')
  fund = (await import('@/app/api/trades/[id]/fund/evm/route')).POST
  createTrade = (await import('@/app/api/trades/route')).POST
  jwt = (await import('@/lib/auth')).generateJWT
})

after(async () => {
  db?.$client.close()
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true })
})

const context = (id: string) => ({ params: Promise.resolve({ id }) })
function request(id: string, user: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  return new NextRequest(`http://localhost/api/trades/${id}/fund/evm`, {
    method, headers: { 'Content-Type': 'application/json', authorization: `Bearer ${jwt({ userId: user, email: `${user}@test.invalid`, role: 'human' })}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function fixture() {
  const suffix = crypto.randomUUID(), buyer = `buyer_${suffix}`, seller = `seller_${suffix}`
  for (const id of [buyer, seller]) await db.insert(schema.users).values({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' })
  const [listing] = await db.insert(schema.listings).values({ seller_id: seller, category: 'other', title: 'Test service', description: 'Isolated fixture', price_bankr: 1, status: 'sold' }).returning()
  const [trade] = await db.insert(schema.trades).values({ buyer_id: buyer, seller_id: seller, listing_id: listing.id, amount: 1, fee: .05, item_price: 1, total_cost: 1.05, seller_amount: 1, payment_rail: 'evm', payment_due_at: new Date(Date.now() + 60_000).toISOString(), client_reference: `ref_${suffix}` }).returning()
  return { trade, buyer, seller, listing }
}
async function reserve(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await route.POST(request(f.trade.id, f.buyer, { chain_id: chainId, token_address: tokenAddress, payer_address: payer.address }), context(f.trade.id))
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  return (await response.json()).intent
}
async function proof(f: Awaited<ReturnType<typeof fixture>>, mutation: Parameters<typeof evidence.set>[1] = {}) {
  const intent = await reserve(f)
  const hash = `0x${crypto.randomUUID().replaceAll('-', '').repeat(2)}`
  evidence.set(hash, mutation)
  const signature = await payer.signMessage({ message: evmPaymentProofMessage(intent, hash) })
  return { intent_id: intent.id, chain_id: chainId, token_address: tokenAddress, payer_address: payer.address, tx_hash: hash, payer_signature: signature }
}

test('only the buyer can create/read a payment intent, and concurrent starts grant one send', async () => {
  const f = await fixture()
  assert.equal((await route.GET(request(f.trade.id, f.seller), context(f.trade.id))).status, 403)
  const body = { chain_id: chainId, token_address: tokenAddress, payer_address: payer.address }
  const results = await Promise.all([route.POST(request(f.trade.id, f.buyer, body), context(f.trade.id)), route.POST(request(f.trade.id, f.buyer, body), context(f.trade.id))])
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201])
  const values = await Promise.all(results.map((r) => r.json()))
  assert.equal(values[0].intent.id, values[1].intent.id)
  assert.equal(values.filter((v) => v.created).length, 1)
})

test('an older transfer on a cancelled reservation can be recovered without authorizing another send', async () => {
  const f = await fixture()
  await db.update(schema.trades).set({ status: 'cancelled' }).where(eq(schema.trades.id, f.trade.id))
  const recoveryHash = `0x${'ab'.repeat(32)}`
  const body = { chain_id: chainId, token_address: tokenAddress, payer_address: payer.address, recovery_tx_hash: recoveryHash }
  const response = await route.POST(request(f.trade.id, f.buyer, body), context(f.trade.id))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.created, false)
  assert.equal(new Date(result.intent.created_at).getTime(), f.trade.created_at.getTime())
  assert.equal(result.intent.tx_hash, null)
  const repeated = await route.POST(request(f.trade.id, f.buyer, body), context(f.trade.id))
  assert.equal((await repeated.json()).created, false)
})

test('missing or forged payer authorization fails before RPC and before receipt creation', async () => {
  const f = await fixture(), body = await proof(f)
  const beforeCalls = rpcCalls
  const challenge = await fund(request(f.trade.id, f.buyer, { ...body, payer_signature: undefined }), context(f.trade.id))
  assert.equal(challenge.status, 428)
  const { message } = await challenge.json()
  const forged = await outsider.signMessage({ message })
  assert.equal((await fund(request(f.trade.id, f.buyer, { ...body, payer_signature: forged }), context(f.trade.id))).status, 403)
  assert.equal(rpcCalls, beforeCalls)
  const receipts = await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, f.trade.id))
  assert.equal(receipts.length, 0)
})

test('valid signed payment is funded once and its proof is recoverable by the buyer', async () => {
  const f = await fixture(), body = await proof(f)
  const response = await fund(request(f.trade.id, f.buyer, body), context(f.trade.id))
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
  assert.equal((await response.json()).trade.status, 'escrow_held')
  const recovered = await (await route.GET(request(f.trade.id, f.buyer), context(f.trade.id))).json()
  assert.equal(recovered.intent.tx_hash, body.tx_hash)
  const repeated = await fund(request(f.trade.id, f.buyer, body), context(f.trade.id))
  assert.equal(repeated.status, 200)
  assert.equal((await repeated.json()).idempotent, true)
  assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, f.trade.id))).length, 1)
  assert.equal((await route.DELETE(request(f.trade.id, f.buyer, { intent_id: body.intent_id, reason: 'wallet_rejected' }, 'DELETE'), context(f.trade.id))).status, 200)
  assert.ok((await (await route.GET(request(f.trade.id, f.buyer), context(f.trade.id))).json()).intent)
})

test('historical, wrong-sender, wrong-recipient, wrong-token, insufficient and reverted transfers are rejected', async () => {
  for (const [mutation, code] of [
    [{ timestamp: 1 }, 'PAYMENT_PREDATES_INTENT'], [{ sender: outsider.address }, 'PAYER_MISMATCH'],
    [{ recipient: outsider.address }, 'TRANSFER_NOT_FOUND'], [{ token: outsider.address }, 'TRANSFER_NOT_FOUND'],
    [{ amount: 1n }, 'PAYMENT_INSUFFICIENT'], [{ reverted: true }, 'PAYMENT_REVERTED'],
  ] as const) {
    const f = await fixture(), body = await proof(f, mutation)
    const response = await fund(request(f.trade.id, f.buyer, body), context(f.trade.id))
    assert.equal(response.status, 402)
    assert.equal((await response.json()).code, code)
    assert.equal((await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, f.trade.id))).length, 0)
  }
})

test('signed proof cannot be replayed onto another trade, even with a new signature a receipt is consumed once', async () => {
  const first = await fixture(), body = await proof(first)
  assert.equal((await fund(request(first.trade.id, first.buyer, body), context(first.trade.id))).status, 200)
  const second = await fixture(), intent = await reserve(second)
  const secondBody = { ...body, intent_id: intent.id }
  assert.equal((await fund(request(second.trade.id, second.buyer, secondBody), context(second.trade.id))).status, 403)
  secondBody.payer_signature = await payer.signMessage({ message: evmPaymentProofMessage(intent, body.tx_hash) })
  const response = await fund(request(second.trade.id, second.buyer, secondBody), context(second.trade.id))
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'PAYMENT_PROOF_REUSED')
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, second.trade.id))
  assert.equal(trade.status, 'pending')
})

test('reusing an idempotency key with another rail or quantity is rejected', async () => {
  const f = await fixture()
  for (const change of [{ payment_rail: 'ledger' }, { amount: 2 }, { allow_partial_fill: true }]) {
    const response = await createTrade(request(f.trade.id, f.buyer, { listing_id: f.listing.id, amount: 1, payment_rail: 'evm', client_reference: f.trade.client_reference, ...change }))
    assert.equal(response.status, 409, JSON.stringify(await response.clone().json()))
    assert.equal((await response.json()).code, 'IDEMPOTENCY_CONFLICT')
  }
})
