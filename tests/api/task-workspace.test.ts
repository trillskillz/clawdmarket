import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createLocalTestSchema } from '../helpers/local-schema'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let inbox: typeof import('@/app/api/agents/inbox/route').GET
let selfTest: typeof import('@/app/api/agent/self-test/route').GET
let accept: typeof import('@/app/api/tasks/[id]/accept/[bid_id]/route').POST
let fund: typeof import('@/app/api/tasks/[id]/fund/route').POST
let deliver: typeof import('@/app/api/trades/[id]/delivery/route').POST
let confirm: typeof import('@/app/api/trades/[id]/confirm/route').POST
let dispute: typeof import('@/app/api/trades/[id]/dispute/route').POST
let detail: typeof import('@/app/api/tasks/[id]/route').GET
let patch: typeof import('@/app/api/tasks/[id]/route').PATCH
let usage: typeof import('@/app/api/agents/usage/route').GET
let hashKey: typeof import('@/lib/registered-agent-auth').hashAgentApiKey
let token: (id: string) => string
let fixtureDirectory: string

before(async () => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-'))
  process.env.TURSO_DATABASE_URL = `file:${join(fixtureDirectory, 'workspace.db')}`
  process.env.TURSO_AUTH_TOKEN = ''
  process.env.JWT_SECRET = 'workspace-tests-only-secret'
  process.env.CHAT_ENCRYPTION_KEY = 'workspace-tests-only-chat-secret'
  process.env.WEBHOOK_SECRET_KEY = 'workspace-tests-only-webhook-secret'
  process.env.CLAWDMARKET_LEDGER_ENABLED = 'true'
  process.env.CLAWDMARKET_AGENT_MAX_TRADE_CREDITS = '50'
  process.env.CLAWDMARKET_AGENT_DAILY_SPEND_CREDITS = '200'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  inbox = (await import('@/app/api/agents/inbox/route')).GET
  selfTest = (await import('@/app/api/agent/self-test/route')).GET
  accept = (await import('@/app/api/tasks/[id]/accept/[bid_id]/route')).POST
  fund = (await import('@/app/api/tasks/[id]/fund/route')).POST
  deliver = (await import('@/app/api/trades/[id]/delivery/route')).POST
  confirm = (await import('@/app/api/trades/[id]/confirm/route')).POST
  dispute = (await import('@/app/api/trades/[id]/dispute/route')).POST
  const taskRoute = await import('@/app/api/tasks/[id]/route')
  detail = taskRoute.GET
  patch = taskRoute.PATCH
  usage = (await import('@/app/api/agents/usage/route')).GET
  hashKey = (await import('@/lib/registered-agent-auth')).hashAgentApiKey
  const { generateJWT } = await import('@/lib/auth')
  token = (id) => generateJWT({ userId: id, email: `${id}@test.invalid`, role: 'agent' })
})

after(() => {
  delete process.env.CLAWDMARKET_LEDGER_ENABLED
  db?.$client.close()
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true })
})

function request(path: string, userId?: string, body?: unknown, key?: string, method = 'POST') {
  return new NextRequest(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : method,
    headers: { ...(userId ? { authorization: `Bearer ${token(userId)}` } : {}), ...(key ? { 'X-Agent-API-Key': key } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })

async function fixture() {
  const suffix = crypto.randomUUID()
  const buyer = `buyer_${suffix}`, seller = `seller_${suffix}`, outsider = `outsider_${suffix}`
  const key = `clawd_${suffix}`, taskId = `task_${suffix}`, bidId = `bid_${suffix}`
  for (const id of [buyer, `user_agent_${seller}`, outsider]) {
    await db.insert(schema.users).values({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'agent' })
    await db.insert(schema.wallets).values({ user_id: id, balance: id === buyer ? 100 : 0, escrow: 0 })
  }
  await db.insert(schema.agents).values({ id: seller, name: 'Fixture Seller', description: 'Research provider', capabilities: '["web-research"]', endpoint: 'https://test.invalid', owner_address: 'test-owner', api_key: hashKey(key), status: 'active' })
  await db.insert(schema.tasks).values({ id: taskId, posterAgentId: buyer, title: 'Research task', description: 'Return research with sources.', budgetUsd: 30, requiredCapabilities: '["web-research"]' })
  return { buyer, seller, outsider, key, taskId, bidId }
}

async function bidAndAccept(f: Awaited<ReturnType<typeof fixture>>) {
  await db.insert(schema.bids).values({ id: f.bidId, taskId: f.taskId, bidderAgentId: f.seller, priceUsd: 25 })
  const result = await accept(request(`/api/tasks/${f.taskId}/accept/${f.bidId}`, f.buyer, {}), { params: Promise.resolve({ id: f.taskId, bid_id: f.bidId }) })
  assert.equal(result.status, 200, JSON.stringify(await result.json()))
}

test('hashed keys work through inbox and self-test; inactive agents and expired work are excluded', async () => {
  const f = await fixture()
  await db.insert(schema.tasks).values({ id: `expired_${f.taskId}`, posterAgentId: f.buyer, title: 'Expired', description: 'Expired task', budgetUsd: 1, expiresAt: '2000-01-01T00:00:00Z' })
  const response = await inbox(request('/api/agents/inbox', undefined, undefined, f.key))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.ok(result.matching_tasks.some((task: any) => task.id === f.taskId))
  assert.ok(!result.matching_tasks.some((task: any) => task.id === `expired_${f.taskId}`))
  const diagnostics = await (await selfTest(request('/api/agent/self-test', undefined, undefined, f.key))).json()
  assert.equal(diagnostics.checks.find((check: any) => check.name === 'inbox').status, 'ok')
  await db.update(schema.agents).set({ status: 'inactive' }).where(eq(schema.agents.id, f.seller))
  assert.equal((await inbox(request('/api/agents/inbox', undefined, undefined, f.key))).status, 401)
})

test('job lifecycle links an accepted quote, one debit, validated private delivery, completion and receipt', async () => {
  const f = await fixture()
  const requirementResponse = await patch(request(`/api/tasks/${f.taskId}`, f.buyer, { action: 'requirements', requirements: { output_format: 'json', required_json_keys: ['summary'], minimum_sources: 2, acceptance_criteria: ['Explain the findings'] } }, undefined, 'PATCH'), params(f.taskId))
  assert.equal(requirementResponse.status, 200)
  await bidAndAccept(f)
  assert.equal((await patch(request(`/api/tasks/${f.taskId}`, f.buyer, { action: 'requirements', requirements: {} }, undefined, 'PATCH'), params(f.taskId))).status, 409)
  assert.equal((await fund(request('', f.outsider, { payment_rail: 'ledger', expected_total: 26.25 }), params(f.taskId))).status, 403)
  assert.equal((await fund(request('', f.buyer, { payment_rail: 'ledger', expected_total: 1 }), params(f.taskId))).status, 409)
  const funded = await fund(request('', f.buyer, { payment_rail: 'ledger', expected_total: 26.25 }), params(f.taskId))
  assert.equal(funded.status, 201)
  const tradeId = (await funded.json()).trade.id
  assert.equal((await fund(request('', f.buyer, { payment_rail: 'ledger', expected_total: 26.25 }), params(f.taskId))).status, 200)
  const [balance] = await db.select().from(schema.wallets).where(eq(schema.wallets.user_id, f.buyer))
  assert.equal(balance.balance, 73.75)
  assert.equal(balance.escrow, 25)
  const [workspace] = await db.select().from(schema.task_workspaces).where(eq(schema.task_workspaces.task_id, f.taskId))
  assert.equal(workspace.trade_id, tradeId)
  assert.equal((await patch(request('', f.buyer, { action: 'complete' }, undefined, 'PATCH'), params(f.taskId))).status, 409)
  assert.equal((await deliver(request('', f.outsider, { summary: 'Unauthorized delivery' }), params(tradeId))).status, 403)
  assert.equal((await deliver(request('', undefined, { summary: 'Missing required artifact' }, f.key), params(tradeId))).status, 422)
  const delivery = { summary: 'Completed research with two sources.', artifact: { summary: 'Private result', sources: ['https://example.com/a', 'https://example.org/b'] } }
  const submitted = await deliver(request('', undefined, delivery, f.key), params(tradeId))
  assert.equal(submitted.status, 201, JSON.stringify(await submitted.json()))
  assert.equal((await deliver(request('', undefined, delivery, f.key), params(tradeId))).status, 409)
  const publicView = await (await detail(request(''), params(f.taskId))).json()
  assert.equal(publicView.workspace.delivery, null)
  assert.equal(publicView.workspace.trade, null)
  const buyerView = await (await detail(request('', f.buyer), params(f.taskId))).json()
  assert.equal(buyerView.workspace.delivery.artifact.summary, 'Private result')
  assert.equal((await confirm(request('', f.outsider, {}), params(tradeId))).status, 403)
  const approved = await confirm(request('', f.buyer, {}), params(tradeId))
  assert.equal(approved.status, 200, JSON.stringify(await approved.json()))
  const [sellerBalance] = await db.select().from(schema.wallets).where(eq(schema.wallets.user_id, `user_agent_${f.seller}`))
  assert.equal(sellerBalance.balance, 25)
  const completed = await (await detail(request('', f.buyer), params(f.taskId))).json()
  assert.equal(completed.status, 'completed')
  assert.equal(completed.workspace.proof_url, `/proof/${tradeId}`)
})

test('a dispute cannot race an external payout after settlement starts', async () => {
  const f = await fixture()
  const [listing] = await db.insert(schema.listings).values({
    seller_id: `user_agent_${f.seller}`,
    category: 'analysis',
    title: 'Externally funded work',
    description: 'A completed delivery waiting for payout.',
    price_bankr: 25,
    status: 'sold',
  }).returning()
  const tradeId = crypto.randomUUID()
  await db.insert(schema.trades).values({
    id: tradeId,
    listing_id: listing.id,
    buyer_id: f.buyer,
    seller_id: `user_agent_${f.seller}`,
    amount: 25,
    fee: 1.25,
    item_price: 25,
    platform_fee: 1.25,
    total_cost: 26.25,
    seller_amount: 25,
    dev_amount: 1.25,
    payment_rail: 'evm',
    payout_status: 'processing',
    status: 'pending_release',
  })

  const response = await dispute(request('', f.buyer, { reason: 'Attempted after payout started' }), params(tradeId))
  assert.equal(response.status, 409)
  assert.match((await response.json()).error, /settlement has started/i)
  const [unchanged] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId))
  assert.equal(unchanged.status, 'pending_release')
})

test('failed funding rolls back the private listing and job link', async () => {
  const f = await fixture()
  await bidAndAccept(f)
  await db.update(schema.wallets).set({ balance: 0 }).where(eq(schema.wallets.user_id, f.buyer))
  const result = await fund(request('', f.buyer, { payment_rail: 'ledger', expected_total: 26.25 }), params(f.taskId))
  assert.equal(result.status, 409)
  const [workspace] = await db.select().from(schema.task_workspaces).where(eq(schema.task_workspaces.task_id, f.taskId))
  assert.equal(workspace.trade_id, null)
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.seller_id, `user_agent_${f.seller}`))).length, 0)
})

test('registered-agent funding is stopped by the server-enforced spend policy', async () => {
  const suffix = crypto.randomUUID()
  const buyerAgent = `buyer_agent_${suffix}`
  const sellerAgent = `seller_agent_${suffix}`
  const buyerKey = `clawd_buyer_${suffix}`
  const taskId = `spend_task_${suffix}`
  const bidId = `spend_bid_${suffix}`
  for (const id of [`user_agent_${buyerAgent}`, `user_agent_${sellerAgent}`]) {
    await db.insert(schema.users).values({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'agent' })
    await db.insert(schema.wallets).values({ user_id: id, balance: id.includes(buyerAgent) ? 500 : 0, escrow: 0 })
  }
  await db.insert(schema.agents).values([
    { id: buyerAgent, name: 'Autonomous Buyer', description: 'Buys work', capabilities: '[]', endpoint: 'https://buyer.invalid', owner_address: 'buyer', api_key: hashKey(buyerKey), status: 'active' },
    { id: sellerAgent, name: 'Autonomous Seller', description: 'Does work', capabilities: '[]', endpoint: 'https://seller.invalid', owner_address: 'seller', api_key: hashKey(`seller_${suffix}`), status: 'active' },
  ])
  await db.insert(schema.tasks).values({ id: taskId, posterAgentId: buyerAgent, title: 'Oversized autonomous purchase', description: 'Must require explicit human funding.', budgetUsd: 100 })
  await db.insert(schema.bids).values({ id: bidId, taskId, bidderAgentId: sellerAgent, priceUsd: 60 })

  const accepted = await accept(request('', undefined, {}, buyerKey), { params: Promise.resolve({ id: taskId, bid_id: bidId }) })
  assert.equal(accepted.status, 200)
  const result = await fund(request('', undefined, { payment_rail: 'ledger', expected_total: 63 }, buyerKey), params(taskId))
  assert.equal(result.status, 409)
  const body = await result.json()
  assert.equal(body.code, 'AGENT_PER_TRADE_LIMIT')
  assert.equal(body.spending_policy.per_trade_limit, 50)
  const [workspace] = await db.select().from(schema.task_workspaces).where(eq(schema.task_workspaces.task_id, taskId))
  assert.equal(workspace.trade_id, null)
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.seller_id, `user_agent_${sellerAgent}`))).length, 0)

  const policy = await (await usage(request('', undefined, undefined, buyerKey))).json()
  assert.equal(policy.spending.enforcement, 'server_transaction')
  assert.equal(policy.spending.daily_limit, 200)
  assert.equal(policy.spending.spent_today, 0)
})

test('registered-agent daily spend includes earlier same-day settlements', async () => {
  const suffix = crypto.randomUUID()
  const buyerAgent = `daily_buyer_${suffix}`
  const sellerAgent = `daily_seller_${suffix}`
  const buyerId = `user_agent_${buyerAgent}`
  const sellerId = `user_agent_${sellerAgent}`
  const buyerKey = `clawd_daily_${suffix}`
  const taskId = `daily_task_${suffix}`
  const bidId = `daily_bid_${suffix}`
  process.env.CLAWDMARKET_AGENT_DAILY_SPEND_CREDITS = '50'
  try {
    for (const id of [buyerId, sellerId]) {
      await db.insert(schema.users).values({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'agent' })
      await db.insert(schema.wallets).values({ user_id: id, balance: id === buyerId ? 500 : 0, escrow: 0 })
    }
    await db.insert(schema.agents).values([
      { id: buyerAgent, name: 'Daily Buyer', description: 'Buys work', capabilities: '[]', endpoint: 'https://buyer.invalid', owner_address: 'buyer', api_key: hashKey(buyerKey), status: 'active' },
      { id: sellerAgent, name: 'Daily Seller', description: 'Does work', capabilities: '[]', endpoint: 'https://seller.invalid', owner_address: 'seller', api_key: hashKey(`seller_${suffix}`), status: 'active' },
    ])
    const [earlierListing] = await db.insert(schema.listings).values({ seller_id: sellerId, category: 'analysis', title: 'Earlier purchase', description: 'Counts toward daily autonomous spend.', price_bankr: 40, status: 'sold' }).returning()
    await db.insert(schema.trades).values({ listing_id: earlierListing.id, buyer_id: buyerId, seller_id: sellerId, amount: 40, fee: 0, item_price: 40, total_cost: 40, seller_amount: 40, status: 'completed' })
    await db.insert(schema.tasks).values({ id: taskId, posterAgentId: buyerAgent, title: 'Purchase above remaining daily allowance', description: 'The total is individually allowed but exceeds the daily cap.', budgetUsd: 20 })
    await db.insert(schema.bids).values({ id: bidId, taskId, bidderAgentId: sellerAgent, priceUsd: 10 })

    assert.equal((await accept(request('', undefined, {}, buyerKey), { params: Promise.resolve({ id: taskId, bid_id: bidId }) })).status, 200)
    const result = await fund(request('', undefined, { payment_rail: 'ledger', expected_total: 10.5 }, buyerKey), params(taskId))
    assert.equal(result.status, 409)
    const body = await result.json()
    assert.equal(body.code, 'AGENT_DAILY_SPEND_LIMIT')
    assert.equal(body.spending_policy.spent_today, 40)
    assert.equal(body.spending_policy.remaining_today, 10)
    const [workspace] = await db.select().from(schema.task_workspaces).where(eq(schema.task_workspaces.task_id, taskId))
    assert.equal(workspace.trade_id, null)
  } finally {
    process.env.CLAWDMARKET_AGENT_DAILY_SPEND_CREDITS = '200'
  }
})
