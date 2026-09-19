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
let register: typeof import('@/app/api/agents/register/route').POST
let status: typeof import('@/app/api/agents/status/route').GET
let heartbeat: typeof import('@/app/api/agents/[id]/heartbeat/route').POST
let claim: typeof import('@/app/api/claim/route')
let listing: typeof import('@/app/api/listings/route').POST
let selfTest: typeof import('@/app/api/agent/self-test/route').GET
let payout: typeof import('@/app/api/payments/payout-address/route').PUT
let usage: typeof import('@/app/api/agents/usage/route').GET
let inbox: typeof import('@/app/api/agents/inbox/route').GET
let tasks: typeof import('@/app/api/tasks/route')
let bid: typeof import('@/app/api/tasks/[id]/bid/route').POST
let accept: typeof import('@/app/api/tasks/[id]/accept/[bid_id]/route').POST
let bids: typeof import('@/app/api/agents/bids/route').GET
let work: typeof import('@/app/api/work/route').GET
let webhookDeliveries: typeof import('@/app/api/webhooks/deliveries/route').GET
let ipSequence = 10

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'agent-onboarding.db')}`
  process.env.JWT_SECRET = 'isolated-agent-onboarding-tests-only'
  process.env.WEBHOOK_SECRET_KEY = 'isolated-agent-onboarding-tests-only'
  process.env.NEXT_PUBLIC_BASE_URL = 'https://clawdmkt.test'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  register = (await import('@/app/api/agents/register/route')).POST
  status = (await import('@/app/api/agents/status/route')).GET
  heartbeat = (await import('@/app/api/agents/[id]/heartbeat/route')).POST
  claim = await import('@/app/api/claim/route')
  listing = (await import('@/app/api/listings/route')).POST
  selfTest = (await import('@/app/api/agent/self-test/route')).GET
  payout = (await import('@/app/api/payments/payout-address/route')).PUT
  usage = (await import('@/app/api/agents/usage/route')).GET
  inbox = (await import('@/app/api/agents/inbox/route')).GET
  tasks = await import('@/app/api/tasks/route')
  bid = (await import('@/app/api/tasks/[id]/bid/route')).POST
  accept = (await import('@/app/api/tasks/[id]/accept/[bid_id]/route')).POST
  bids = (await import('@/app/api/agents/bids/route')).GET
  work = (await import('@/app/api/work/route')).GET
  webhookDeliveries = (await import('@/app/api/webhooks/deliveries/route')).GET
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function request(path: string, method = 'GET', body?: unknown, key?: string, keyHeader = 'x-agent-api-key') {
  ipSequence += 1
  return new NextRequest(`https://clawdmkt.test${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `198.51.100.${ipSequence}`,
      ...(key ? { [keyHeader]: key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function registerAgent(name: string, activationMode?: 'autonomous' | 'owner_claim') {
  const response = await register(request('/api/agents/register', 'POST', {
    name,
    description: `${name} performs an isolated API lifecycle test.`,
    capabilities: ['web-research', 'data-analysis'],
    ...(activationMode ? { activation_mode: activationMode } : {}),
  }))
  assert.equal(response.status, 201)
  return response.json()
}

test('an autonomous agent can activate, authenticate with either key header, and use the core work APIs', async () => {
  const buyer = await registerAgent('Autonomous Buyer', 'autonomous')
  assert.equal(buyer.agent.status, 'active')
  assert.equal(buyer.agent.claim_url, null)
  assert.equal(buyer.agent.human_approval_required, false)

  const seller = await registerAgent('Autonomous Seller', 'autonomous')
  const buyerStatus = await status(request('/api/agents/status', 'GET', undefined, buyer.agent.api_key))
  assert.equal(buyerStatus.status, 200)
  assert.equal((await buyerStatus.json()).activation_method, 'autonomous')

  const sellerStatus = await status(request('/api/agents/status', 'GET', undefined, seller.agent.api_key, 'x-clawdmarket-agent-key'))
  assert.equal(sellerStatus.status, 200)
  assert.equal((await sellerStatus.json()).status, 'active')
  const bearerStatus = await status(new NextRequest('https://clawdmkt.test/api/agents/status', {
    headers: { authorization: `Bearer ${buyer.agent.api_key}` },
  }))
  assert.equal(bearerStatus.status, 200)

  assert.equal((await heartbeat(request(`/api/agents/${buyer.agent.id}/heartbeat`, 'POST', {}, buyer.agent.api_key), { params: Promise.resolve({ id: buyer.agent.id }) })).status, 200)
  const diagnostics = await selfTest(request('/api/agent/self-test', 'GET', undefined, buyer.agent.api_key))
  assert.notEqual((await diagnostics.json()).status, 'fail')
  assert.equal((await usage(request('/api/agents/usage', 'GET', undefined, buyer.agent.api_key))).status, 200)
  assert.equal((await inbox(request('/api/agents/inbox', 'GET', undefined, seller.agent.api_key))).status, 200)
  const deliveryHistory = await webhookDeliveries(request('/api/webhooks/deliveries', 'GET', undefined, seller.agent.api_key))
  assert.equal(deliveryHistory.status, 200)
  assert.deepEqual((await deliveryHistory.json()).deliveries, [])

  const emptyListings = await db.select().from(schema.listings).where(eq(schema.listings.seller_id, `user_agent_${seller.agent.id}`))
  assert.equal(emptyListings.length, 0, 'registration must not silently publish a generic service')
  const service = await listing(request('/api/listings', 'POST', {
    category: 'analysis', title: 'Isolated research report',
    description: 'A scoped research report with findings, citations, and a concise risk summary.', price_bankr: 2,
  }, seller.agent.api_key))
  assert.equal(service.status, 201)
  assert.equal((await payout(request('/api/payments/payout-address', 'PUT', { address: `0x${'12'.repeat(20)}` }, seller.agent.api_key))).status, 200)

  const taskResponse = await tasks.POST(request('/api/tasks', 'POST', {
    title: 'Research isolated onboarding',
    description: 'Verify the complete autonomous onboarding and task coordination path.',
    required_capabilities: ['web-research'], budget_usd: 2,
  }, buyer.agent.api_key))
  assert.equal(taskResponse.status, 200)
  const task = await taskResponse.json()
  const taskList = await tasks.GET(request('/api/tasks?status=open'))
  assert.equal((await taskList.json()).tasks.some((row: any) => row.id === task.task_id), true)

  const bidResponse = await bid(request(`/api/tasks/${task.task_id}/bid`, 'POST', {
    price_usd: 2, message: 'I can return a cited report.', eta_seconds: 600,
  }, seller.agent.api_key), { params: Promise.resolve({ id: task.task_id }) })
  assert.equal(bidResponse.status, 200)
  const placedBid = await bidResponse.json()
  assert.equal((await bids(request('/api/agents/bids', 'GET', undefined, seller.agent.api_key))).status, 200)

  const accepted = await accept(request(`/api/tasks/${task.task_id}/accept/${placedBid.bid_id}`, 'POST', {}, buyer.agent.api_key), {
    params: Promise.resolve({ id: task.task_id, bid_id: placedBid.bid_id }),
  })
  assert.equal(accepted.status, 200)
  assert.equal((await work(request('/api/work', 'GET', undefined, buyer.agent.api_key))).status, 200)
  assert.equal((await work(request('/api/work', 'GET', undefined, seller.agent.api_key))).status, 200)
})

test('owner-claim registration blocks marketplace actions until the private claim is completed', async () => {
  const malformed = await claim.POST(new NextRequest('https://clawdmkt.test/api/claim', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.240' }, body: '{',
  }))
  assert.equal(malformed.status, 400)
  const assisted = await registerAgent('Owner Assisted Agent')
  assert.equal(assisted.agent.status, 'pending_claim')
  assert.equal(assisted.agent.human_approval_required, true)
  assert.match(assisted.agent.claim_url, /\/claim\/claim_/)

  const pending = await status(request('/api/agents/status', 'GET', undefined, assisted.agent.api_key))
  assert.equal((await pending.json()).status, 'pending_claim')
  assert.equal((await heartbeat(request(`/api/agents/${assisted.agent.id}/heartbeat`, 'POST', {}, assisted.agent.api_key), { params: Promise.resolve({ id: assisted.agent.id }) })).status, 401)
  assert.equal((await listing(request('/api/listings', 'POST', {
    category: 'analysis', title: 'Should not publish',
    description: 'This listing must remain blocked until owner activation is complete.', price_bankr: 1,
  }, assisted.agent.api_key))).status, 401)

  const code = new URL(assisted.agent.claim_url).pathname.split('/').pop()!
  assert.equal((await claim.GET(request(`/api/claim?code=${encodeURIComponent(code)}`))).status, 200)
  const claimed = await claim.POST(request('/api/claim', 'POST', { code, email: 'owner@example.test' }))
  assert.equal(claimed.status, 200)
  assert.equal((await claimed.json()).activation_method, 'owner_claim')

  const active = await status(request('/api/agents/status', 'GET', undefined, assisted.agent.api_key))
  const activeBody = await active.json()
  assert.equal(activeBody.status, 'claimed')
  assert.equal(activeBody.human_approval_required, false)
  assert.equal((await heartbeat(request(`/api/agents/${assisted.agent.id}/heartbeat`, 'POST', {}, assisted.agent.api_key), { params: Promise.resolve({ id: assisted.agent.id }) })).status, 200)
  const generated = await db.select().from(schema.listings).where(eq(schema.listings.seller_id, `user_agent_${assisted.agent.id}`))
  assert.equal(generated.length, 0)
})
