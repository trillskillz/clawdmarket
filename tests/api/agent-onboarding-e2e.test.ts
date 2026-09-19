import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
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
let listingDirectory: typeof import('@/app/api/listings/route').GET
let listingDetail: typeof import('@/app/api/listings/[id]/route').GET
let agentDirectory: typeof import('@/app/api/agents/list/route').GET
let agentSearch: typeof import('@/app/api/agents/search/route').GET
let agentDetail: typeof import('@/app/api/agents/[id]/route').GET
let archiveAgent: typeof import('@/app/api/agents/register/[id]/route').DELETE
let cleanupCanaries: typeof import('@/app/api/cron/agent-canaries/route').GET
let tradePreview: typeof import('@/app/api/trades/preview/route').POST
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
  process.env.CRON_SECRET = 'isolated-canary-cleanup-secret'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  register = (await import('@/app/api/agents/register/route')).POST
  status = (await import('@/app/api/agents/status/route')).GET
  heartbeat = (await import('@/app/api/agents/[id]/heartbeat/route')).POST
  claim = await import('@/app/api/claim/route')
  listing = (await import('@/app/api/listings/route')).POST
  listingDirectory = (await import('@/app/api/listings/route')).GET
  listingDetail = (await import('@/app/api/listings/[id]/route')).GET
  agentDirectory = (await import('@/app/api/agents/list/route')).GET
  agentSearch = (await import('@/app/api/agents/search/route')).GET
  agentDetail = (await import('@/app/api/agents/[id]/route')).GET
  archiveAgent = (await import('@/app/api/agents/register/[id]/route')).DELETE
  cleanupCanaries = (await import('@/app/api/cron/agent-canaries/route')).GET
  tradePreview = (await import('@/app/api/trades/preview/route')).POST
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
  // Test fixture for the deliberately supported pre-HMAC storage format.
  // codeql[js/insufficient-password-hash]
  const legacyDigest = createHash('sha256').update(buyer.agent.api_key).digest('hex')
  await db.update(schema.agents).set({ api_key: legacyDigest }).where(eq(schema.agents.id, buyer.agent.id))
  const buyerStatus = await status(request('/api/agents/status', 'GET', undefined, buyer.agent.api_key))
  assert.equal(buyerStatus.status, 200)
  assert.equal((await buyerStatus.json()).activation_method, 'autonomous')
  const upgradedBuyer = await db.select().from(schema.agents).where(eq(schema.agents.id, buyer.agent.id)).get()
  assert.notEqual(upgradedBuyer?.api_key, legacyDigest, 'legacy API key digests should upgrade after successful auth')

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

test('a sponsored ephemeral canary stays private and archives without stranding work', async () => {
  const unsponsored = await register(request('/api/agents/register', 'POST', {
    name: 'Unsponsored Canary',
    activation_mode: 'autonomous',
    lifecycle_mode: 'ephemeral',
  }))
  assert.equal(unsponsored.status, 403)
  assert.equal((await unsponsored.json()).error, 'sponsor_required')

  const sponsor = await registerAgent('Canary Sponsor', 'autonomous')
  const created = await register(request('/api/agents/register', 'POST', {
    name: 'Release Canary Agent',
    description: 'Private production lifecycle verification agent.',
    capabilities: ['web-research'],
    activation_mode: 'autonomous',
    lifecycle_mode: 'ephemeral',
    profile_visibility: 'public',
  }, sponsor.agent.api_key))
  assert.equal(created.status, 201)
  const canary = await created.json()
  assert.equal(canary.agent.lifecycle_mode, 'ephemeral')
  assert.equal(canary.agent.profile_visibility, 'private')
  assert.equal(canary.agent.profile_url, null)
  assert.equal(canary.agent.sponsor_agent_id, sponsor.agent.id)

  const selfStatus = await status(request('/api/agents/status', 'GET', undefined, canary.agent.api_key))
  assert.equal(selfStatus.status, 200)
  const stored = await db.select().from(schema.agents).where(eq(schema.agents.id, canary.agent.id)).get()
  assert.equal(stored?.apiKeyPrefix, canary.agent.api_key.slice(0, 12))
  assert.ok(stored?.apiKeyLastUsedAt)

  const publicAgents = await agentDirectory(request('/api/agents/list?limit=100'))
  assert.equal((await publicAgents.json()).agents.some((row: any) => row.id === canary.agent.id), false)
  const search = await agentSearch(request('/api/agents/search?q=release+canary&limit=50'))
  assert.equal((await search.json()).agents.some((row: any) => row.id === canary.agent.id), false)
  assert.equal((await agentDetail(request(`/api/agents/${canary.agent.id}`), { params: Promise.resolve({ id: canary.agent.id }) })).status, 404)
  assert.equal((await agentDetail(request(`/api/agents/${canary.agent.id}`, 'GET', undefined, canary.agent.api_key), { params: Promise.resolve({ id: canary.agent.id }) })).status, 200)

  const serviceResponse = await listing(request('/api/listings', 'POST', {
    category: 'analysis',
    title: 'Private canary report',
    description: 'A private listing used to validate the production agent lifecycle.',
    price_bankr: 1,
  }, canary.agent.api_key))
  assert.equal(serviceResponse.status, 201)
  const service = (await serviceResponse.json()).listing
  const publicListings = await listingDirectory(request(`/api/listings?seller_id=user_agent_${canary.agent.id}&limit=50`))
  assert.equal((await publicListings.json()).listings.length, 0)
  assert.equal((await listingDetail(request(`/api/listings/${service.id}`), { params: Promise.resolve({ id: service.id }) })).status, 404)
  assert.equal((await listingDetail(request(`/api/listings/${service.id}`, 'GET', undefined, canary.agent.api_key), { params: Promise.resolve({ id: service.id }) })).status, 200)
  assert.equal((await tradePreview(request('/api/trades/preview', 'POST', { listing_id: service.id }))).status, 409)

  const taskResponse = await tasks.POST(request('/api/tasks', 'POST', {
    title: 'Canary active obligation',
    description: 'This open task must prevent the agent from being archived.',
    required_capabilities: ['web-research'],
    budget_usd: 1,
  }, canary.agent.api_key))
  assert.equal(taskResponse.status, 200)
  const task = await taskResponse.json()

  const blocked = await archiveAgent(request(`/api/agents/register/${canary.agent.id}`, 'DELETE', {
    reason: 'Post-deployment canary cleanup',
  }, canary.agent.api_key), { params: Promise.resolve({ id: canary.agent.id }) })
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json()).blockers.active_tasks, 1)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, canary.agent.api_key))).status, 200)
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, service.id)).get())?.status, 'active')

  await db.update(schema.tasks).set({ status: 'cancelled' }).where(eq(schema.tasks.id, task.task_id))
  const archived = await archiveAgent(request(`/api/agents/register/${canary.agent.id}`, 'DELETE', {
    reason: 'Post-deployment canary cleanup',
  }, canary.agent.api_key), { params: Promise.resolve({ id: canary.agent.id }) })
  assert.equal(archived.status, 200)
  const archivedBody = await archived.json()
  assert.equal(archivedBody.status, 'archived')
  assert.equal(archivedBody.credential_revoked, true)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, canary.agent.api_key))).status, 401)

  const archivedAgent = await db.select().from(schema.agents).where(eq(schema.agents.id, canary.agent.id)).get()
  assert.ok(archivedAgent?.archivedAt)
  assert.ok(archivedAgent?.apiKeyRevokedAt)
  assert.equal(archivedAgent?.status, 'inactive')
  const archivedListing = await db.select().from(schema.listings).where(eq(schema.listings.id, service.id)).get()
  assert.equal(archivedListing?.status, 'expired')
  const events = await db.select().from(schema.agent_lifecycle_events).where(eq(schema.agent_lifecycle_events.agent_id, canary.agent.id))
  assert.deepEqual(events.map((event) => event.action).sort(), ['archived', 'registered'])
})

test('the authenticated cleanup worker retires abandoned ephemeral agents', async () => {
  const sponsor = await registerAgent('Cleanup Sponsor', 'autonomous')
  const created = await register(request('/api/agents/register', 'POST', {
    name: 'Abandoned Release Canary',
    activation_mode: 'autonomous',
    lifecycle_mode: 'ephemeral',
  }, sponsor.agent.api_key))
  assert.equal(created.status, 201)
  const canary = await created.json()
  await db.update(schema.agents)
    .set({ created_at: new Date(Date.now() - 3 * 60 * 60 * 1000) })
    .where(eq(schema.agents.id, canary.agent.id))

  assert.equal((await cleanupCanaries(request('/api/cron/agent-canaries'))).status, 401)
  const cleaned = await cleanupCanaries(new NextRequest('https://clawdmkt.test/api/cron/agent-canaries', {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  }))
  assert.equal(cleaned.status, 200)
  const body = await cleaned.json()
  assert.equal(body.outcomes.some((outcome: any) => outcome.agent_id === canary.agent.id && outcome.result === 'archived'), true)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, canary.agent.api_key))).status, 401)
})

test('version publication cannot strand work and never silently republishes a service', async () => {
  const parent = await registerAgent('Versioned Agent', 'autonomous')
  const serviceResponse = await listing(request('/api/listings', 'POST', {
    category: 'code',
    title: 'Versioned code review',
    description: 'A concrete service that belongs to the current active version.',
    price_bankr: 3,
  }, parent.agent.api_key))
  const service = (await serviceResponse.json()).listing
  const taskResponse = await tasks.POST(request('/api/tasks', 'POST', {
    title: 'Version blocker task',
    description: 'Open work must prevent replacement of the authenticated version.',
    required_capabilities: ['code-review'],
    budget_usd: 3,
  }, parent.agent.api_key))
  const task = await taskResponse.json()

  const blocked = await register(request('/api/agents/register', 'POST', {
    name: 'Versioned Agent v2',
    parent_version_id: parent.agent.id,
    change_description: 'Improve retry handling.',
  }, parent.agent.api_key))
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json()).error, 'active_obligations')
  assert.equal((await db.select().from(schema.agents).where(eq(schema.agents.id, parent.agent.id)).get())?.status, 'active')
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, service.id)).get())?.status, 'active')

  await db.update(schema.tasks).set({ status: 'cancelled' }).where(eq(schema.tasks.id, task.task_id))
  const published = await register(request('/api/agents/register', 'POST', {
    name: 'Versioned Agent v2',
    parent_version_id: parent.agent.id,
    change_description: 'Improve retry handling.',
  }, parent.agent.api_key))
  assert.equal(published.status, 200)
  const next = await published.json()
  assert.equal(next.version, 2)
  assert.equal(next.next_actions[0].action, 'publish_service')
  assert.equal((await db.select().from(schema.agents).where(eq(schema.agents.id, parent.agent.id)).get())?.status, 'inactive')
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, service.id)).get())?.status, 'expired')
  const generated = await db.select().from(schema.listings).where(eq(schema.listings.seller_id, `user_agent_${next.agent.id}`))
  assert.equal(generated.length, 0)
  assert.equal((await status(request('/api/agents/status', 'GET', undefined, next.agent.api_key))).status, 200)
})
