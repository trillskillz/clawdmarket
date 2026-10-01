import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let createOrganization: typeof import('@/app/api/organizations/route').POST
let assignAgent: typeof import('@/app/api/organizations/[id]/agents/route').PUT
let unassignAgent: typeof import('@/app/api/organizations/[id]/agents/route').DELETE
let getBudget: typeof import('@/app/api/organizations/[id]/budget/route').GET
let setBudget: typeof import('@/app/api/organizations/[id]/budget/route').PUT
let purchase: typeof import('@/app/api/trades/route').POST

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-org-budgets-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'budgets.db')}`
  process.env.JWT_SECRET = 'organization-budget-test-secret'
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'true'
  const treasury = privateKeyToAccount(`0x${'77'.repeat(32)}`)
  process.env.TREASURY_ADDRESS = treasury.address
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'77'.repeat(32)}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Test Base',
    address: `0x${'44'.repeat(20)}`, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1,
    confirmations: 3, rpcUrl: 'https://rpc.example.invalid' }])
  delete process.env.DEV_WALLET_ADDRESS
  delete process.env.DEV_FEE_WALLET_ADDRESS
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  createOrganization = (await import('@/app/api/organizations/route')).POST
  ;({ PUT: assignAgent, DELETE: unassignAgent } = await import('@/app/api/organizations/[id]/agents/route'))
  ;({ GET: getBudget, PUT: setBudget } = await import('@/app/api/organizations/[id]/budget/route'))
  purchase = (await import('@/app/api/trades/route')).POST
  await db.insert(schema.users).values([
    { id: 'budget-owner', email: 'budget-owner@test.invalid', name: 'Owner', password_hash: 'unused' },
    { id: 'budget-outsider', email: 'budget-outsider@test.invalid', name: 'Outsider', password_hash: 'unused' },
    { id: 'budget-seller', email: 'budget-seller@test.invalid', name: 'Seller', password_hash: 'unused' },
    { id: 'budget-fee', email: 'budget-fee@test.invalid', name: 'Fee', password_hash: 'unused' },
    { id: 'user_agent_budget-a', email: 'budget-a@test.invalid', name: 'A', password_hash: 'unused', role: 'agent' },
    { id: 'user_agent_budget-b', email: 'budget-b@test.invalid', name: 'B', password_hash: 'unused', role: 'agent' },
  ])
  await db.insert(schema.agents).values([
    { id: 'budget-a', name: 'A', description: 'Budget buyer A', capabilities: '[]', endpoint: 'https://test.invalid', owner_address: '', api_key: 'unused' },
    { id: 'budget-b', name: 'B', description: 'Budget buyer B', capabilities: '[]', endpoint: 'https://test.invalid', owner_address: '', api_key: 'unused' },
  ])
  await db.insert(schema.agent_owners).values([
    { agentId: 'budget-a', userId: 'budget-owner', establishedBy: 'test' },
    { agentId: 'budget-b', userId: 'budget-owner', establishedBy: 'test' },
  ])
  await db.insert(schema.wallets).values([
    { user_id: 'user_agent_budget-a', balance: 100, escrow: 0 },
    { user_id: 'user_agent_budget-b', balance: 100, escrow: 0 },
    { user_id: 'budget-fee', balance: 0, escrow: 0 },
  ])
  await db.insert(schema.payout_addresses).values({ user_id: 'budget-seller', address: treasury.address })
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function request(path: string, method: string, userId?: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(userId ? { Authorization: `Bearer ${jwt({ userId, email: `${userId}@test.invalid`, role: 'human' })}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) })
}

test('owner budget is versioned and enforces aggregate assigned-agent reservations atomically', async () => {
  const created = await createOrganization(request('/api/organizations', 'POST', 'budget-owner',
    { client_reference: 'budget-org', name: 'Budget Org' }))
  const id = (await created.json()).organization.id as string
  const params = { params: Promise.resolve({ id }) }
  const budgetPath = `/api/organizations/${id}/budget`
  const assignPath = `/api/organizations/${id}/agents`
  for (const agent_id of ['budget-a', 'budget-b']) assert.equal((await assignAgent(request(assignPath, 'PUT', 'budget-owner', {
    agent_id, cost_center: agent_id === 'budget-a' ? 'ENGINEERING' : 'RESEARCH',
  }), params)).status, 200)
  const input = { expected_version: 0, max_per_execution: '1.00', max_daily: '1.50', max_monthly: '5.00' }
  assert.equal((await setBudget(request(budgetPath, 'PUT', 'budget-outsider', input), params)).status, 404)
  assert.equal((await getBudget(request(budgetPath, 'GET', 'budget-outsider'), params)).status, 404)
  assert.equal((await setBudget(request(budgetPath, 'PUT', undefined, input), params)).status, 401)
  assert.equal((await setBudget(request(budgetPath, 'PUT', 'budget-owner', { ...input, max_daily: 1.5 }), params)).status, 400)
  const first = await setBudget(request(budgetPath, 'PUT', 'budget-owner', input), params)
  assert.equal(first.status, 200, JSON.stringify(await first.clone().json()))
  assert.equal((await first.json()).budget.version, 1)
  assert.equal((await (await setBudget(request(budgetPath, 'PUT', 'budget-owner', input), params)).json()).idempotent, true)
  assert.equal((await setBudget(request(budgetPath, 'PUT', 'budget-owner', { ...input, max_daily: '2.00' }), params)).status, 409)
  const { createLedgerTrade } = await import('@/lib/settlement')
  const makeTrade = async (agentId: string, price = 0.8) => db.transaction(async (tx) => {
    const [listing] = await tx.insert(schema.listings).values({ seller_id: 'budget-seller', category: 'skills',
      title: 'Test work', description: 'Budgeted test work', price_bankr: price, status: 'active' }).returning()
    return createLedgerTrade(tx, listing, `user_agent_${agentId}`, 'budget-fee', { agentId })
  })
  const firstTrade = await makeTrade('budget-a')
  const [attribution] = await db.select().from(schema.organization_trade_attributions)
    .where(eq(schema.organization_trade_attributions.trade_id, firstTrade.id))
  assert.equal(attribution.total_minor, 84)
  assert.equal(attribution.cost_center, 'ENGINEERING')
  const before = (await db.select().from(schema.trades)).length
  await assert.rejects(() => makeTrade('budget-b'), (error: unknown) => (error as { code?: string }).code === 'ORGANIZATION_DAILY_LIMIT')
  assert.equal((await db.select().from(schema.trades)).length, before)
  assert.equal((await db.select().from(schema.organization_trade_attributions)).length, 1)
  const read = await getBudget(request(budgetPath, 'GET', 'budget-owner'), params)
  assert.equal((await read.json()).usage.reserved_or_spent_today, '0.84')
  assert.equal((await unassignAgent(request(assignPath, 'DELETE', 'budget-owner', { agent_id: 'budget-a' }), params)).status, 200)
  assert.equal((await (await getBudget(request(budgetPath, 'GET', 'budget-owner'), params)).json()).usage.reserved_or_spent_today, '0.84')
  const higher = { ...input, expected_version: 1, max_daily: '2.00' }
  assert.equal((await setBudget(request(budgetPath, 'PUT', 'budget-owner', higher), params)).status, 200)
  await makeTrade('budget-b')
  assert.equal((await (await getBudget(request(budgetPath, 'GET', 'budget-owner'), params)).json()).usage.reserved_or_spent_today, '1.68')
  await assert.rejects(() => makeTrade('budget-b', 1.0), (error: unknown) => (error as { code?: string }).code === 'ORGANIZATION_PER_EXECUTION_LIMIT')
  assert.equal((await db.select().from(schema.organization_budget_events)).length, 2)
  assert.equal((await db.select().from(schema.organization_trade_attributions)).length, 2)
  assert.equal((await setBudget(request(budgetPath, 'PUT', 'budget-owner', { ...input, expected_version: 2,
    max_daily: '1.80' }), params)).status, 200)
  assert.equal((await assignAgent(request(assignPath, 'PUT', 'budget-owner', { agent_id: 'budget-a', cost_center: 'ENGINEERING' }), params)).status, 200)
  const listings = await db.insert(schema.listings).values([0, 1].map((n) => ({ seller_id: 'budget-seller',
    title: `Cross-agent ${n}`, description: 'Organization-wide race', price_bankr: 0.1, status: 'active' as const,
    category: 'skills' as const }))).returning()
  const attempts = await Promise.all(listings.map((listing, index) => purchase(request('/api/trades', 'POST',
    index === 0 ? 'user_agent_budget-a' : 'user_agent_budget-b', {
      listing_id: listing.id, amount: 1, payment_rail: 'evm', client_reference: `budget-cross-agent-${index}`,
    }))))
  assert.deepEqual(attempts.map((response) => response.status).sort(), [201, 409],
    JSON.stringify(await Promise.all(attempts.map((response) => response.clone().json()))))
  assert.equal((await (await getBudget(request(budgetPath, 'GET', 'budget-owner'), params)).json()).usage.reserved_or_spent_today, '1.79')
  assert.equal((await unassignAgent(request(assignPath, 'DELETE', 'budget-owner', { agent_id: 'budget-a' }), params)).status, 200)
})

test('concurrent owner changes produce one version; disabled creation cannot alter budget', async () => {
  const created = await createOrganization(request('/api/organizations', 'POST', 'budget-owner',
    { client_reference: 'budget-race', name: 'Race' }))
  const id = (await created.json()).organization.id as string
  const params = { params: Promise.resolve({ id }) }
  const path = `/api/organizations/${id}/budget`
  const base = { expected_version: 0, max_per_execution: null, max_daily: '3.00', max_monthly: null }
  const responses = await Promise.all([
    setBudget(request(path, 'PUT', 'budget-owner', base), params),
    setBudget(request(path, 'PUT', 'budget-owner', { ...base, max_daily: '4.00' }), params),
  ])
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'false'
  try {
    assert.equal((await getBudget(request(path, 'GET', 'budget-owner'), params)).status, 200)
    assert.equal((await setBudget(request(path, 'PUT', 'budget-owner', { ...base, expected_version: 1 }), params)).status, 503)
  } finally { process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'true' }
  assert.equal((await db.select().from(schema.organization_budget_events).where(eq(schema.organization_budget_events.organization_id, id))).length, 1)
})

test('legacy external checkouts remain charged after cancellation until refund confirmation', async () => {
  const created = await createOrganization(request('/api/organizations', 'POST', 'budget-owner',
    { client_reference: 'budget-legacy', name: 'Legacy' }))
  const id = (await created.json()).organization.id as string
  const params = { params: Promise.resolve({ id }) }
  assert.equal((await assignAgent(request(`/api/organizations/${id}/agents`, 'PUT', 'budget-owner', {
    agent_id: 'budget-a', cost_center: 'LEGACY',
  }), params)).status, 200)
  const [listing] = await db.insert(schema.listings).values({ seller_id: 'budget-seller', category: 'skills', title: 'Old checkout',
    description: 'Old unpaid checkout', price_bankr: 0.4, status: 'sold' }).returning()
  const [legacy] = await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: 'user_agent_budget-a',
    seller_id: 'budget-seller', amount: 0.4, fee: 0.02, total_cost: 0.42, payment_rail: 'evm', status: 'pending' }).returning()
  const path = `/api/organizations/${id}/budget`
  assert.equal((await (await getBudget(request(path, 'GET', 'budget-owner'), params)).json()).usage.reserved_or_spent_today, '0.42')
  assert.equal((await setBudget(request(path, 'PUT', 'budget-owner', { expected_version: 0,
    max_per_execution: null, max_daily: '0.50', max_monthly: null }), params)).status, 200)
  const [item] = await db.insert(schema.listings).values({ seller_id: 'budget-seller', category: 'skills',
    title: 'New work', description: 'Small new work', price_bankr: 0.1, status: 'active' }).returning()
  const buy = () => purchase(request('/api/trades', 'POST', 'user_agent_budget-a', {
    listing_id: item.id, amount: 1, payment_rail: 'evm', client_reference: 'budget-checkout-001',
  }))
  const rejected = await buy()
  assert.equal(rejected.status, 409, JSON.stringify(await rejected.clone().json()))
  const rejection = await rejected.json()
  assert.equal(rejection.code || rejection.error_code, 'ORGANIZATION_DAILY_LIMIT', JSON.stringify(rejection))
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.listing_id, item.id))).length, 0)
  await db.update(schema.trades).set({ status: 'cancelled' }).where(eq(schema.trades.id, legacy.id))
  assert.equal((await (await getBudget(request(path, 'GET', 'budget-owner'), params)).json()).usage.reserved_or_spent_today, '0.42')
  assert.equal((await buy()).status, 409)
  await db.update(schema.trades).set({ payout_status: 'refunded' }).where(eq(schema.trades.id, legacy.id))
  const accepted = await buy()
  assert.equal(accepted.status, 201, JSON.stringify(await accepted.clone().json()))
  const trade = (await accepted.json()).trade
  assert.equal((await (await getBudget(request(path, 'GET', 'budget-owner'), params)).json()).usage.reserved_or_spent_today, '0.11')
  assert.equal((await db.select().from(schema.organization_trade_attributions).where(eq(schema.organization_trade_attributions.trade_id, trade.id))).length, 1)
  assert.equal((await setBudget(request(path, 'PUT', 'budget-owner', { expected_version: 1,
    max_per_execution: null, max_daily: '0.25', max_monthly: null }), params)).status, 200)
  const items = await db.insert(schema.listings).values([0, 1].map((n) => ({ seller_id: 'budget-seller',
    title: `Concurrent work ${n}`, description: 'Concurrency budget check', price_bankr: 0.1, status: 'active' as const,
    category: 'skills' as const }))).returning()
  const attempts = await Promise.all(items.map((listing, index) => purchase(request('/api/trades', 'POST', 'user_agent_budget-a', {
    listing_id: listing.id, amount: 1, payment_rail: 'evm', client_reference: `budget-concurrent-${index}`,
  }))))
  assert.deepEqual(attempts.map((response) => response.status).sort(), [201, 409],
    JSON.stringify(await Promise.all(attempts.map((response) => response.clone().json()))))
  assert.equal((await (await getBudget(request(path, 'GET', 'budget-owner'), params)).json()).usage.reserved_or_spent_today, '0.22')
})
