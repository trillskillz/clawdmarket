import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let register: typeof import('@/app/api/agents/register/route').POST
let briefing: typeof import('@/app/api/agents/briefing/route').GET
let hashAgentApiKey: typeof import('@/lib/registered-agent-auth').hashAgentApiKey
let seller: { id: string; key: string }
let other: { id: string; key: string }
let opportunityId: string
let assignedId: string
let counterOfferId: string
let tradeId: string

function request(path: string, key?: string) {
  return new NextRequest(`https://clawdmkt.test${path}`, {
    headers: key ? { 'X-ClawdMarket-Agent-Key': key } : {},
  })
}

async function registerAgent(name: string) {
  const response = await register(new NextRequest('https://clawdmkt.test/api/agents/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${Math.floor(Math.random() * 200) + 1}` },
    body: JSON.stringify({ name, description: 'Isolated briefing test agent', capabilities: ['web-research'], activation_mode: 'autonomous' }),
  }))
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  const result = await response.json()
  return { id: String(result.agent.id), key: String(result.agent.api_key) }
}

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'briefing.db')}`
  process.env.JWT_SECRET = 'isolated-agent-briefing-tests-only'
  process.env.WEBHOOK_SECRET_KEY = 'isolated-agent-briefing-tests-only'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  register = (await import('@/app/api/agents/register/route')).POST
  briefing = (await import('@/app/api/agents/briefing/route')).GET
  hashAgentApiKey = (await import('@/lib/registered-agent-auth')).hashAgentApiKey
  seller = await registerAgent(`Briefing Seller ${randomUUID().slice(0, 8)}`)
  other = await registerAgent(`Briefing Other ${randomUUID().slice(0, 8)}`)

  opportunityId = `task_${randomUUID()}`
  assignedId = `task_${randomUUID()}`
  counterOfferId = `task_${randomUUID()}`
  const future = new Date(Date.now() + 86_400_000).toISOString()
  for (const [id, status, assignedAgentId] of [
    [opportunityId, 'open', null],
    [assignedId, 'assigned', seller.id],
    [counterOfferId, 'open', null],
  ] as const) {
    await db.insert(schema.tasks).values({
      id, posterAgentId: other.id, title: `Briefing task ${id.slice(-8)}`, description: 'An isolated task for agent briefing tests.',
      requiredCapabilities: JSON.stringify(['web-research']), budgetUsd: 10,
      status, assignedAgentId, expiresAt: future,
    })
  }
  await db.insert(schema.bids).values({
    id: `bid_${randomUUID()}`, taskId: counterOfferId, bidderAgentId: seller.id,
    priceUsd: 8, status: 'pending', counterOfferStatus: 'pending', counterOfferPrice: 9,
  })
  const [listing] = await db.insert(schema.listings).values({
    seller_id: `user_agent_${seller.id}`, category: 'analysis', title: 'Briefing seller listing',
    description: 'An isolated listing for agent briefing tests.', price_bankr: 10, status: 'sold',
  }).returning()
  const [trade] = await db.insert(schema.trades).values({
    listing_id: listing.id, buyer_id: `user_agent_${other.id}`, seller_id: `user_agent_${seller.id}`,
    amount: 10, fee: .5, item_price: 10, total_cost: 10.5, seller_amount: 10,
    payment_rail: 'evm', status: 'escrow_held',
  }).returning()
  tradeId = trade.id
})

after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

test('briefing rejects missing, invalid, and unscoped credentials', async () => {
  assert.equal((await briefing(request('/api/agents/briefing'))).status, 401)
  assert.equal((await briefing(request('/api/agents/briefing', 'clawd_invalid'))).status, 401)
  const noReadKey = `clawd_${randomUUID().replaceAll('-', '')}`
  await db.insert(schema.agent_credentials).values({
    id: `agc_${randomUUID()}`, agentId: seller.id, name: 'Write only', keyHash: hashAgentApiKey(noReadKey),
    keyPrefix: noReadKey.slice(0, 12), scopes: JSON.stringify(['marketplace:write']), createdByType: 'test',
  })
  const noRead = await briefing(request('/api/agents/briefing', noReadKey))
  assert.equal(noRead.status, 403)
  assert.equal((await noRead.json()).required_scope, 'agent:read')
})

test('briefing prioritizes funded seller work, counter-offers, assignments, then unbid opportunities', async () => {
  const response = await briefing(request('/api/agents/briefing', seller.key))
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()))
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  const data = await response.json()
  assert.equal(data.version, 1)
  assert.equal(data.agent.id, seller.id)
  assert.equal(data.read_only, true)
  assert.deepEqual(data.action_items.map((item: any) => item.kind), [
    'seller_trade', 'counter_offer', 'assigned_task', 'task_opportunity',
  ])
  assert.equal(data.action_items[0].id, `trade:${tradeId}`)
  assert.equal(data.action_items[2].id, `assigned-task:${assignedId}`)
  assert.equal(data.action_items[3].id, `opportunity:${opportunityId}`)
  assert.ok(data.action_items.every((item: any) => item.inspect.method === 'GET' && item.automatic_execution === false))
  assert.equal(data.action_items.some((item: any) => item.id === `opportunity:${counterOfferId}`), false)
  assert.equal(data.links.payment_config, '/api/payments/config')
})

test('briefing isolates other agents and reports bounded output', async () => {
  const otherResponse = await briefing(request('/api/agents/briefing', other.key))
  assert.equal(otherResponse.status, 200)
  const otherData = await otherResponse.json()
  assert.equal(otherData.action_items.some((item: any) => item.id === `trade:${tradeId}`), false)
  assert.equal(otherData.action_items.some((item: any) => item.id === `assigned-task:${assignedId}`), false)
  const limited = await briefing(request('/api/agents/briefing?limit=1', seller.key))
  assert.equal(limited.status, 200)
  const limitedData = await limited.json()
  assert.equal(limitedData.action_items.length, 1)
  assert.equal(limitedData.summary.truncated, true)
  assert.equal((await briefing(request('/api/agents/briefing?limit=0', seller.key))).status, 400)
  assert.equal((await briefing(request('/api/agents/briefing?limit=51', seller.key))).status, 400)
})

test('repeated briefing reads do not create trades or payment receipts', async () => {
  const beforeTrades = await db.select().from(schema.trades)
  const beforeReceipts = await db.select().from(schema.payment_receipts)
  const beforeWallets = await db.select().from(schema.wallets)
  assert.equal((await briefing(request('/api/agents/briefing', seller.key))).status, 200)
  assert.equal((await briefing(request('/api/agents/briefing', seller.key))).status, 200)
  assert.equal((await db.select().from(schema.trades)).length, beforeTrades.length)
  assert.equal((await db.select().from(schema.payment_receipts)).length, beforeReceipts.length)
  assert.deepEqual(await db.select().from(schema.wallets), beforeWallets)
})
