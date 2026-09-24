import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let adminGet: typeof import('@/app/api/admin/payments/pause/route').GET
let adminPost: typeof import('@/app/api/admin/payments/pause/route').POST
let createTrade: typeof import('@/app/api/trades/route').POST
let mppFund: typeof import('@/app/api/trades/[id]/fund/mpp/route').POST
let intent: typeof import('@/app/api/trades/[id]/fund/evm/intent/route')
let paymentConfig: typeof import('@/app/api/payments/config/route').GET
let walletGet: typeof import('@/app/api/wallet/route').GET
let createContract: typeof import('@/app/api/contracts/route').POST
let jwt: typeof import('@/lib/auth').generateJWT
let adminToken: string
let buyerToken: string
let buyerId: string
let sellerId: string
let listingId: string
let mppTradeId: string
let evmTradeId: string
const payerAddress = `0x${'11'.repeat(20)}`
const treasuryAddress = privateKeyToAccount(`0x${'22'.repeat(32)}`).address
const tokenAddress = `0x${'33'.repeat(20)}`

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'payment-pause.db')}`
  process.env.JWT_SECRET = 'isolated-payment-pause-tests-only'
  process.env.WEBHOOK_SECRET_KEY = 'isolated-payment-pause-tests-only'
  process.env.TREASURY_ADDRESS = treasuryAddress
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'22'.repeat(32)}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Test Base', address: tokenAddress, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: 'http://127.0.0.1:1' }])
  delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED
  buyerId = `buyer_${crypto.randomUUID()}`
  sellerId = `seller_${crypto.randomUUID()}`
  const adminId = `admin_${crypto.randomUUID()}`
  process.env.ADMIN_USER_IDS = adminId
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  adminGet = (await import('@/app/api/admin/payments/pause/route')).GET
  adminPost = (await import('@/app/api/admin/payments/pause/route')).POST
  createTrade = (await import('@/app/api/trades/route')).POST
  mppFund = (await import('@/app/api/trades/[id]/fund/mpp/route')).POST
  intent = await import('@/app/api/trades/[id]/fund/evm/intent/route')
  paymentConfig = (await import('@/app/api/payments/config/route')).GET
  walletGet = (await import('@/app/api/wallet/route')).GET
  createContract = (await import('@/app/api/contracts/route')).POST
  for (const id of [buyerId, sellerId, adminId]) await db.insert(schema.users).values({ id, email: `${id}@test.invalid`, name: id, password_hash: 'unused', role: 'human' })
  const [listing] = await db.insert(schema.listings).values({ seller_id: sellerId, category: 'other', title: 'Test listing', description: 'Isolated listing', price_bankr: 1, status: 'active' }).returning()
  listingId = listing.id
  const [mppTrade] = await db.insert(schema.trades).values({ listing_id: listingId, buyer_id: buyerId, seller_id: sellerId, amount: 1, fee: .05, item_price: 1, total_cost: 1.05, seller_amount: 1, payment_rail: 'mpp', payment_due_at: new Date(Date.now() + 60_000).toISOString(), status: 'pending' }).returning()
  const [evmTrade] = await db.insert(schema.trades).values({ listing_id: listingId, buyer_id: buyerId, seller_id: sellerId, amount: 1, fee: .05, item_price: 1, total_cost: 1.05, seller_amount: 1, payment_rail: 'evm', payment_due_at: new Date(Date.now() + 60_000).toISOString(), status: 'pending' }).returning()
  mppTradeId = mppTrade.id
  evmTradeId = evmTrade.id
  adminToken = jwt({ userId: adminId, email: `${adminId}@test.invalid`, role: 'human' })
  buyerToken = jwt({ userId: buyerId, email: `${buyerId}@test.invalid`, role: 'human' })
})

after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

function request(path: string, method: 'GET' | 'POST', token: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

test('only an admin can pause or resume, with a durable reason and audit trail', async () => {
  const path = '/api/admin/payments/pause'
  assert.equal((await adminGet(request(path, 'GET', buyerToken))).status, 403)
  assert.equal((await adminPost(request(path, 'POST', buyerToken, { paused: true, reason: 'Security incident' }))).status, 403)
  assert.equal((await adminPost(request(path, 'POST', adminToken, { paused: true, reason: 'short' }))).status, 400)
  const pause = await adminPost(request(path, 'POST', adminToken, { paused: true, reason: 'Isolated payment incident' }))
  assert.equal(pause.status, 200)
  assert.equal((await pause.json()).control.paused, true)
  const state = await adminGet(request(path, 'GET', adminToken))
  assert.equal(state.headers.get('cache-control'), 'no-store')
  const data = await state.json()
  assert.equal(data.events[0].actor_user_id.startsWith('admin_'), true)
  assert.equal(data.events[0].reason, 'Isolated payment incident')
  assert.equal(data.control.reason, 'Isolated payment incident')
})

test('pause blocks new trades and payment challenges but preserves EVM recovery', async () => {
  const config = await paymentConfig()
  const availability = await config.json()
  assert.equal(availability.new_payments_paused, true)
  assert.equal(availability.payment_pause_reason.includes('Isolated payment incident'), false)
  assert.deepEqual(availability.supported_protocols, [])
  assert.equal(availability.ledger_enabled, false)
  assert.equal(availability.erc20_configured, false)

  const trade = await createTrade(request('/api/trades', 'POST', buyerToken, { listing_id: listingId, amount: 1, payment_rail: 'evm' }))
  assert.equal(trade.status, 503)
  assert.equal((await trade.json()).code, 'NEW_PAYMENTS_PAUSED')

  const mpp = await mppFund(request(`/api/trades/${mppTradeId}/fund/mpp`, 'POST', buyerToken), { params: Promise.resolve({ id: mppTradeId }) })
  assert.equal(mpp.status, 503)
  assert.equal((await mpp.json()).code, 'NEW_PAYMENTS_PAUSED')

  const context = { params: Promise.resolve({ id: evmTradeId }) }
  const newIntent = await intent.POST(request(`/api/trades/${evmTradeId}/fund/evm/intent`, 'POST', buyerToken, { chain_id: 8453, token_address: tokenAddress, payer_address: payerAddress }), context)
  assert.equal(newIntent.status, 503)
  assert.equal((await newIntent.json()).code, 'NEW_PAYMENTS_PAUSED')
  const recovery = await intent.POST(request(`/api/trades/${evmTradeId}/fund/evm/intent`, 'POST', buyerToken, { chain_id: 8453, token_address: tokenAddress, payer_address: payerAddress, recovery_tx_hash: `0x${'ab'.repeat(32)}` }), context)
  assert.equal(recovery.status, 200)
  assert.equal((await recovery.json()).created, false)
  assert.equal((await intent.GET(request(`/api/trades/${evmTradeId}/fund/evm/intent`, 'GET', buyerToken), context)).status, 200)
})

test('resuming is audited and the environment override cannot be cleared through the API', async () => {
  const path = '/api/admin/payments/pause'
  const resume = await adminPost(request(path, 'POST', adminToken, { paused: false, reason: 'Canary review completed' }))
  assert.equal(resume.status, 200)
  assert.equal((await resume.json()).control.paused, false)
  const data = await (await adminGet(request(path, 'GET', adminToken))).json()
  assert.equal(data.events.length, 2)
  process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED = 'true'
  try {
    const override = await adminPost(request(path, 'POST', adminToken, { paused: false, reason: 'Attempted API override' }))
    assert.equal(override.status, 409)
    assert.equal((await override.json()).code, 'ENVIRONMENT_PAYMENT_PAUSE')
    assert.equal((await paymentConfig().then((result) => result.json())).new_payments_paused, true)
  } finally { delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED }
})

test('internal credit balance excludes pending external trades', async () => {
  const response = await walletGet(request('/api/wallet', 'GET', buyerToken))
  assert.equal(response.status, 200)
  const wallet = await response.json()
  assert.equal(wallet.ticker, 'USD_CREDIT')
  assert.equal(wallet.available, 0)
  assert.equal(wallet.escrow, 0)
})

test('disabled internal credit cannot create an unfundable standalone contract', async () => {
  const previous = process.env.CLAWDMARKET_LEDGER_ENABLED
  process.env.CLAWDMARKET_LEDGER_ENABLED = 'false'
  try {
    const response = await createContract(request('/api/contracts', 'POST', buyerToken, {}))
    assert.equal(response.status, 503)
    assert.equal((await response.json()).code, 'CONTRACT_FUNDING_UNAVAILABLE')
    const contracts = await db.select().from(schema.contracts)
    assert.equal(contracts.length, 0)
  } finally {
    if (previous === undefined) delete process.env.CLAWDMARKET_LEDGER_ENABLED
    else process.env.CLAWDMARKET_LEDGER_ENABLED = previous
  }
})
