import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let payoutRoute: typeof import('@/app/api/payments/payout-address/route')
let listServices: typeof import('@/app/api/listings/route').GET
let settleExternallyFundedTrade: typeof import('@/lib/external-settlement').settleExternallyFundedTrade
let generateJWT: typeof import('@/lib/auth').generateJWT
let hashAgentApiKey: typeof import('@/lib/registered-agent-auth').hashAgentApiKey

const accountId = 'payout-owner'
const otherAccountId = 'payout-stranger'
const agentId = 'payout-agent'
const agentUserId = `user_agent_${agentId}`
const agentKey = 'clawd_payout_agent_fixture_key'
const humanAddress = `0x${'11'.repeat(20)}`
const agentAddress = `0x${'22'.repeat(20)}`
const changedAddress = `0x${'33'.repeat(20)}`
const csrf = 'payout-flow-csrf-token'

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'payout-flow.db')}`
  process.env.JWT_SECRET = 'isolated-payout-flow-tests-only'
  process.env.TREASURY_ADDRESS = `0x${'55'.repeat(20)}`
  process.env.MPP_RECIPIENT_ADDRESS = `0x${'66'.repeat(20)}`
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  payoutRoute = await import('@/app/api/payments/payout-address/route')
  listServices = (await import('@/app/api/listings/route')).GET
  settleExternallyFundedTrade = (await import('@/lib/external-settlement')).settleExternallyFundedTrade
  generateJWT = (await import('@/lib/auth')).generateJWT
  hashAgentApiKey = (await import('@/lib/registered-agent-auth')).hashAgentApiKey
  await db.insert(schema.users).values([
    { id: accountId, email: 'payout-owner@test.invalid', name: 'Human seller', password_hash: 'unused', role: 'human' },
    { id: otherAccountId, email: 'payout-stranger@test.invalid', name: 'Other account', password_hash: 'unused', role: 'human' },
    { id: agentUserId, email: `${agentId}@agent.clawdmkt.com`, name: 'Agent seller', password_hash: 'unused', role: 'agent' },
  ])
  await db.insert(schema.agents).values({
    id: agentId, name: 'Agent seller', description: 'Fixture agent seller', capabilities: '[]',
    endpoint: 'https://agent.test.invalid', owner_address: 'not-an-evm-wallet',
    api_key: hashAgentApiKey(agentKey), status: 'active', visibility: 'public',
  })
  await db.insert(schema.agent_owners).values({ agentId, userId: accountId, establishedBy: 'test' })
  await db.insert(schema.listings).values([
    { id: 'human-payout-listing', seller_id: accountId, category: 'analysis', title: 'Human payout service', description: 'A payable human service', price_bankr: 1, status: 'active' },
    { id: 'agent-payout-listing', seller_id: agentUserId, category: 'analysis', title: 'Agent payout service', description: 'A payable agent service', price_bankr: 1, status: 'active' },
  ])
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function cookieRequest(path: string, userId: string, method: 'GET' | 'PUT' = 'GET', body?: unknown, includeCsrf = true) {
  const email = userId === accountId ? 'payout-owner@test.invalid' : 'payout-stranger@test.invalid'
  const token = generateJWT({ userId, email, role: 'human' })
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      cookie: `auth-token=${token}; csrf-token=${csrf}`,
      'content-type': 'application/json',
      ...(includeCsrf ? { 'x-csrf-token': csrf } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function agentRequest(path: string, method: 'GET' | 'PUT' = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'x-agent-api-key': agentKey, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function fundedTrade(sellerId: string, listingId: string, rail: 'evm' | 'mpp', chainId: number, token: string) {
  const [trade] = await db.insert(schema.trades).values({
    listing_id: listingId, buyer_id: otherAccountId, seller_id: sellerId,
    amount: 1, fee: 0.05, item_price: 1, platform_fee: 0.05, total_cost: 1.05,
    seller_amount: 1, dev_amount: 0.05, payment_rail: rail, status: 'escrow_held',
  }).returning()
  await db.insert(schema.payment_receipts).values({
    route: `POST /api/trades/${trade.id}/fund/${rail}`, trade_id: trade.id,
    payment_rail: rail, amount: 1.05, currency: 'USD', token_address: token,
    chain_id: chainId, token_decimals: 6, token_amount: '1050000', token_usd_price: 1,
  })
  return trade
}

test('dashboard account and linked-agent payout wallets drive both external rails and lock queued destinations', async () => {
  const initiallyReady = await (await listServices(new NextRequest('http://localhost/api/listings?payment_ready=true'))).json()
  assert.equal(initiallyReady.total, 0)

  const missingCsrf = await payoutRoute.PUT(cookieRequest('/api/payments/payout-address', accountId, 'PUT', { address: humanAddress }, false))
  assert.equal(missingCsrf.status, 403)
  const ownSave = await payoutRoute.PUT(cookieRequest('/api/payments/payout-address', accountId, 'PUT', { address: humanAddress }))
  assert.equal(ownSave.status, 200)
  assert.equal((await ownSave.json()).address, humanAddress)

  const beforeAgentSave = await (await payoutRoute.GET(cookieRequest('/api/payments/payout-address', accountId))).json()
  assert.equal(beforeAgentSave.address, humanAddress)
  assert.deepEqual(beforeAgentSave.owned_agents.map((agent: { agent_id: string; address: string | null }) => ({ id: agent.agent_id, address: agent.address })), [
    { id: agentId, address: null },
  ])
  assert.equal((await payoutRoute.PUT(cookieRequest('/api/payments/payout-address', otherAccountId, 'PUT', { agent_id: agentId, address: agentAddress }))).status, 403)
  assert.equal((await payoutRoute.GET(cookieRequest(`/api/payments/payout-address?agent_id=${agentId}`, otherAccountId))).status, 403)

  const agentSave = await payoutRoute.PUT(cookieRequest('/api/payments/payout-address', accountId, 'PUT', { agent_id: agentId, address: agentAddress }))
  assert.equal(agentSave.status, 200)
  assert.deepEqual(await agentSave.json(), { ok: true, address: agentAddress, agent_id: agentId })
  const agentRead = await (await payoutRoute.GET(cookieRequest(`/api/payments/payout-address?agent_id=${agentId}`, accountId))).json()
  assert.equal(agentRead.address, agentAddress)
  assert.equal((await payoutRoute.PUT(agentRequest('/api/payments/payout-address', 'PUT', { agent_id: 'another-agent', address: changedAddress }))).status, 403)
  assert.equal((await payoutRoute.PUT(agentRequest('/api/payments/payout-address', 'PUT', { address: agentAddress }))).status, 200)
  assert.equal((await (await payoutRoute.GET(agentRequest('/api/payments/payout-address'))).json()).address, agentAddress)
  const ready = await (await listServices(new NextRequest('http://localhost/api/listings?payment_ready=true'))).json()
  assert.equal(ready.total, 2)
  assert.equal(ready.listings.every((listing: { external_payment_ready: boolean }) => listing.external_payment_ready), true)

  const baseTrade = await fundedTrade(accountId, 'human-payout-listing', 'evm', 8453, `0x${'44'.repeat(20)}`)
  const tempoTrade = await fundedTrade(agentUserId, 'agent-payout-listing', 'mpp', 4217, '0x20c0000000000000000000000000000000000000')
  const basePayout = await settleExternallyFundedTrade(baseTrade, 100, { process: false })
  const tempoPayout = await settleExternallyFundedTrade(tempoTrade, 100, { process: false })
  assert.equal(basePayout.transfers[0].to_address, humanAddress)
  assert.equal(tempoPayout.transfers[0].to_address, agentAddress)
  assert.equal(basePayout.transfers[0].chain_id, 8453)
  assert.equal(tempoPayout.transfers[0].chain_id, 4217)

  assert.equal((await payoutRoute.PUT(cookieRequest('/api/payments/payout-address', accountId, 'PUT', { address: changedAddress }))).status, 200)
  assert.equal((await payoutRoute.PUT(cookieRequest('/api/payments/payout-address', accountId, 'PUT', { agent_id: agentId, address: changedAddress }))).status, 200)
  assert.equal((await settleExternallyFundedTrade(baseTrade, 100, { process: false })).transfers[0].to_address, humanAddress)
  assert.equal((await settleExternallyFundedTrade(tempoTrade, 100, { process: false })).transfers[0].to_address, agentAddress)
  const transfers = await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.kind, 'seller_payout'))
  assert.equal(transfers.length, 2, 'editing a saved wallet must not create another payout instruction')
})
