import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let register: typeof import('@/app/api/agents/register/route').POST
let a2a: typeof import('@/app/api/a2a/route').POST
let card: typeof import('@/app/.well-known/agent-card.json/route').GET
let hashKey: typeof import('@/lib/registered-agent-auth').hashAgentApiKey
let seller: { id: string; key: string }
let other: { id: string; key: string }
const treasury = privateKeyToAccount(`0x${'66'.repeat(32)}`)

async function registerAgent(name: string) {
  const result = await register(new NextRequest('https://clawdmkt.test/api/agents/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${Math.floor(Math.random() * 200) + 1}` },
    body: JSON.stringify({ name, description: 'Isolated A2A test agent', capabilities: ['web-research'], activation_mode: 'autonomous' }),
  }))
  assert.equal(result.status, 201, JSON.stringify(await result.clone().json()))
  const data = await result.json()
  return { id: String(data.agent.id), key: String(data.agent.api_key) }
}

function rpc(method: string, params: unknown, key?: string, id: string | number = 1) {
  return a2a(new NextRequest('https://clawdmkt.test/api/a2a', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  }))
}

const message = (text = 'briefing') => ({ role: 'ROLE_USER', messageId: randomUUID(), parts: [{ text }] })

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'a2a.db')}`
  process.env.JWT_SECRET = 'isolated-a2a-tests-only'
  process.env.WEBHOOK_SECRET_KEY = 'isolated-a2a-tests-only'
  process.env.TREASURY_ADDRESS = treasury.address
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'66'.repeat(32)}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Test Base', address: `0x${'44'.repeat(20)}`, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: 'https://rpc.example.invalid' }])
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  register = (await import('@/app/api/agents/register/route')).POST
  a2a = (await import('@/app/api/a2a/route')).POST
  card = (await import('@/app/.well-known/agent-card.json/route')).GET
  hashKey = (await import('@/lib/registered-agent-auth')).hashAgentApiKey
  seller = await registerAgent(`A2A Seller ${randomUUID().slice(0, 8)}`)
  other = await registerAgent(`A2A Other ${randomUUID().slice(0, 8)}`)
  await db.insert(schema.tasks).values({
    id: `task_${randomUUID()}`, posterAgentId: other.id, title: 'A2A matching opportunity',
    description: 'A2A isolated test opportunity', requiredCapabilities: JSON.stringify(['web-research']),
    budgetUsd: 10, status: 'open', expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  })
})

after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

test('public card truthfully declares a 1.0 JSON-RPC task interface and read-only skill', async () => {
  const result = await card(new Request('https://clawdmkt.test/.well-known/agent-card.json'))
  const data = await result.json()
  assert.equal(data.supportedInterfaces[0].protocolBinding, 'JSONRPC')
  assert.equal(data.supportedInterfaces[0].protocolVersion, '1.0')
  assert.equal(data.supportedInterfaces[0].url, 'https://clawdmkt.com/api/a2a')
  assert.equal(data.capabilities.streaming, false)
  assert.equal(data.capabilities.pushNotifications, false)
  assert.deepEqual(data.skills.map((skill: { id: string }) => skill.id), ['marketplace_briefing', 'plan_work', 'inspect_route'])
  assert.match(data.skills[0].description, /read-only/)
  assert.equal(data.securitySchemes.agentBearer.httpAuthSecurityScheme.scheme, 'Bearer')
  assert.deepEqual(data.securityRequirements, [{ schemes: { agentBearer: { list: [] } } }])
  const localCard = await card(new Request('http://localhost:3000/.well-known/agent-card.json'))
  assert.equal((await localCard.json()).supportedInterfaces[0].url, 'http://localhost:3000/api/a2a')
})

test('A2A SendMessage creates a completed durable task; GetTask and ListTasks return the result', async () => {
  const input = message('briefing limit=10')
  const start = await rpc('SendMessage', { message: input }, seller.key, 7)
  assert.equal(start.status, 200, JSON.stringify(await start.clone().json()))
  const data = await start.json()
  assert.equal(data.id, 7)
  const task = data.result.task
  assert.equal(task.status.state, 'TASK_STATE_COMPLETED')
  assert.equal(task.artifacts[0].parts[0].data.agent.id, seller.id)
  assert.equal(task.artifacts[0].parts[0].data.read_only, true)
  assert.equal(task.history[0].role, 'ROLE_USER')
  assert.equal(start.headers.get('cache-control'), 'private, no-store')

  const loaded = await rpc('GetTask', { id: task.id, historyLength: 0 }, seller.key, 'fetch')
  assert.equal(loaded.status, 200)
  const loadedData = await loaded.json()
  assert.equal(loadedData.id, 'fetch')
  assert.equal(loadedData.result.id, task.id)
  assert.equal(loadedData.result.history, undefined)
  assert.deepEqual(loadedData.result.artifacts, task.artifacts)

  const listed = await rpc('ListTasks', { pageSize: 1 }, seller.key)
  const listData = await listed.json()
  assert.equal(listData.result.totalSize, 1)
  assert.equal(listData.result.tasks[0].id, task.id)
  assert.equal(listData.result.tasks[0].artifacts, undefined)

  const replay = await rpc('SendMessage', { message: input }, seller.key, 8)
  assert.equal((await replay.json()).result.task.id, task.id)
  const listedAgain = await rpc('ListTasks', { pageSize: 1 }, seller.key)
  assert.equal((await listedAgain.json()).result.totalSize, 1)
})

test('A2A requires an active read key and never reveals another agent task', async () => {
  assert.equal((await rpc('SendMessage', { message: message() })).status, 401)
  const limitedKey = `clawd_${randomUUID().replaceAll('-', '')}`
  await db.insert(schema.agent_credentials).values({
    id: `agc_${randomUUID()}`, agentId: seller.id, name: 'No read scope', keyHash: hashKey(limitedKey),
    keyPrefix: limitedKey.slice(0, 12), scopes: JSON.stringify(['marketplace:write']), createdByType: 'test',
  })
  assert.equal((await rpc('SendMessage', { message: message() }, limitedKey)).status, 403)
  const started = await rpc('SendMessage', { message: message() }, seller.key)
  const task = (await started.json()).result.task
  const stolen = await rpc('GetTask', { id: task.id }, other.key)
  assert.equal(stolen.status, 404)
  assert.equal((await stolen.json()).error.code, -32001)
  const otherList = await rpc('ListTasks', {}, other.key)
  assert.equal((await otherList.json()).result.totalSize, 0)
})

test('ListTasks uses a stable cursor and honors status filters', async () => {
  const first = await rpc('SendMessage', { message: message() }, other.key)
  const firstId = (await first.json()).result.task.id
  const second = await rpc('SendMessage', { message: message() }, other.key)
  const secondId = (await second.json()).result.task.id
  const pageOne = (await (await rpc('ListTasks', { pageSize: 1 }, other.key)).json()).result
  assert.equal(pageOne.totalSize, 2)
  assert.ok(pageOne.nextPageToken)
  const pageTwo = (await (await rpc('ListTasks', { pageSize: 1, pageToken: pageOne.nextPageToken, includeArtifacts: true }, other.key)).json()).result
  assert.equal(pageTwo.totalSize, 2)
  assert.equal(pageTwo.nextPageToken, '')
  assert.deepEqual(new Set([pageOne.tasks[0].id, pageTwo.tasks[0].id]), new Set([firstId, secondId]))
  assert.equal(pageTwo.tasks[0].artifacts[0].artifactId, 'briefing')
  const working = (await (await rpc('ListTasks', { status: 'TASK_STATE_WORKING' }, other.key)).json()).result
  assert.equal(working.totalSize, 0)
  assert.deepEqual(working.tasks, [])
})

test('A2A validates protocol and returns specified unsupported-operation errors', async () => {
  assert.equal((await rpc('SendMessage', { message: message('buy this listing') }, seller.key)).status, 400)
  const started = await rpc('SendMessage', { message: message() }, seller.key)
  const task = (await started.json()).result.task
  const cancel = await rpc('CancelTask', { id: task.id }, seller.key)
  assert.equal((await cancel.json()).error.code, -32002)
  const terminal = await rpc('SendMessage', { message: { ...message(), taskId: task.id } }, seller.key)
  assert.equal((await terminal.json()).error.code, -32004)
  const stream = await rpc('SendStreamingMessage', { message: message() }, seller.key)
  assert.equal((await stream.json()).error.code, -32004)
  const push = await rpc('CreateTaskPushNotificationConfig', {}, seller.key)
  assert.equal((await push.json()).error.code, -32003)
  const version = await a2a(new NextRequest('https://clawdmkt.test/api/a2a', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'A2A-Version': '0.3' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'GetTask', params: { id: task.id } }),
  }))
  assert.equal((await version.json()).error.code, -32009)
})

test('A2A never creates a marketplace trade, payment receipt, or wallet', async () => {
  const trades = await db.select().from(schema.trades)
  const receipts = await db.select().from(schema.payment_receipts)
  const wallets = await db.select().from(schema.wallets)
  const result = await rpc('SendMessage', { message: { role: 'ROLE_USER', messageId: randomUUID(), parts: [{ data: { action: 'get_briefing', limit: 2 } }] } }, seller.key)
  assert.equal(result.status, 200)
  assert.deepEqual(await db.select().from(schema.trades), trades)
  assert.deepEqual(await db.select().from(schema.payment_receipts), receipts)
  assert.deepEqual(await db.select().from(schema.wallets), wallets)
})

test('A2A plan_work previews shared routing candidates without a route or payment', async () => {
  const planner = await registerAgent(`A2A Planner ${randomUUID().slice(0, 8)}`)
  const readOnlyKey = `clawd_${randomUUID().replaceAll('-', '')}`
  await db.insert(schema.agent_credentials).values({ id: `agc_${randomUUID()}`, agentId: planner.id,
    name: 'Read-only A2A planner', keyHash: hashKey(readOnlyKey), keyPrefix: readOnlyKey.slice(0, 12),
    scopes: JSON.stringify(['agent:read']), createdByType: 'test' })
  const sellerId = `a2a-route-seller-${randomUUID()}`
  const serviceId = randomUUID()
  await db.insert(schema.users).values({ id: sellerId, name: 'A2A Route Seller', email: `${sellerId}@test.invalid`, password_hash: 'unused', role: 'human' })
  await db.insert(schema.payout_addresses).values({ user_id: sellerId, address: treasury.address })
  await db.insert(schema.service_definitions).values({ id: serviceId, seller_id: sellerId, title: 'A2A security review',
    description: 'Review authentication paths for a buyer agent.', capabilities: '["security-analysis"]',
    price_minor: 200, status: 'active', estimated_latency_seconds: 120 })
  const before = { routes: (await db.select().from(schema.route_plans)).length, trades: (await db.select().from(schema.trades)).length }
  const input = { role: 'ROLE_USER', messageId: randomUUID(), parts: [{ data: { action: 'plan_work', request: {
    objective: 'Review my API for authentication issues', required_capabilities: ['security'],
    max_budget: { amount: '5.00', currency: 'USD' },
  } }, mediaType: 'application/json' }] }
  const result = await rpc('SendMessage', { message: input }, readOnlyKey)
  assert.equal(result.status, 200, JSON.stringify(await result.clone().json()))
  const task = (await result.json()).result.task
  assert.equal(task.artifacts[0].artifactId, 'plan_work')
  const artifact = task.artifacts[0].parts[0].data
  assert.equal(artifact.kind, 'plan_work')
  assert.equal(artifact.persisted, false)
  assert.equal(artifact.funds_moved, false)
  assert.deepEqual(artifact.plan.required_capabilities, ['security-analysis'])
  assert.equal(artifact.plan.candidates[0].service_id, serviceId)
  assert.equal((await db.select().from(schema.route_plans)).length, before.routes)
  assert.equal((await db.select().from(schema.trades)).length, before.trades)
  const replay = await rpc('SendMessage', { message: input }, readOnlyKey)
  assert.equal((await replay.json()).result.task.id, task.id)
  const changed = await rpc('SendMessage', { message: { ...input, parts: [{ data: { action: 'plan_work', request: {
    objective: 'Review a different API authentication path', required_capabilities: ['security'],
    max_budget: { amount: '5.00', currency: 'USD' },
  } } }] } }, readOnlyKey)
  assert.equal(changed.status, 409)
  assert.equal((await changed.json()).error.code, -32602)
  assert.equal((await rpc('SendMessage', { message: { ...message(), parts: [{ data: { action: 'execute_route', route_id: randomUUID() } }] } }, readOnlyKey)).status, 400)
})

test('A2A inspect_route reads only the calling agent route and its payment exposure', async () => {
  const inspector = await registerAgent(`A2A Inspector ${randomUUID().slice(0, 8)}`)
  const buyerId = `user_agent_${inspector.id}`
  await db.insert(schema.users).values({ id: buyerId, name: 'A2A Route Buyer', email: `${buyerId}@test.invalid`, password_hash: 'unused', role: 'agent' }).onConflictDoNothing()
  const routeId = randomUUID()
  await db.insert(schema.route_plans).values({ id: routeId, buyer_id: buyerId, client_reference: `a2a-route-${routeId}`,
    objective: 'Inspect my planned repository review', required_capabilities: '["security-analysis"]',
    max_budget_minor: 500, candidates_json: '[]', expires_at: new Date(Date.now() + 300_000) })
  const input = { role: 'ROLE_USER', messageId: randomUUID(), parts: [{ data: { action: 'inspect_route', route_id: routeId }, mediaType: 'application/json' }] }
  const owner = await rpc('SendMessage', { message: input }, inspector.key)
  assert.equal(owner.status, 200)
  const task = (await owner.json()).result.task
  assert.equal(task.artifacts[0].artifactId, 'inspect_route')
  assert.equal(task.artifacts[0].parts[0].data.route.id, routeId)
  assert.equal(task.artifacts[0].parts[0].data.payment_exposure, null)
  const foreign = await rpc('SendMessage', { message: { ...input, messageId: randomUUID() } }, other.key)
  assert.equal(foreign.status, 404)
  assert.equal((await foreign.json()).error.data[0].reason, 'ROUTE_NOT_FOUND')
  assert.equal((await rpc('GetTask', { id: task.id }, other.key)).status, 404)
})
