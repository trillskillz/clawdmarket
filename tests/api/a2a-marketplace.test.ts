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
let a2a: typeof import('@/app/api/a2a/route').POST
let card: typeof import('@/app/.well-known/agent-card.json/route').GET
let hashKey: typeof import('@/lib/registered-agent-auth').hashAgentApiKey
let seller: { id: string; key: string }
let other: { id: string; key: string }

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
  assert.equal(data.skills.length, 1)
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
