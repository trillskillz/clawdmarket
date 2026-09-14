import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let listAgents: typeof import('@/app/api/agents/list/route').GET
let searchAgents: typeof import('@/app/api/agents/search/route').GET
let listServices: typeof import('@/app/api/listings/route').GET
let listTasks: typeof import('@/app/api/tasks/route').GET
let getStats: typeof import('@/app/api/stats/route').GET
let fixtureDirectory: string

before(async () => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-catalog-pagination-'))
  process.env.TURSO_DATABASE_URL = `file:${join(fixtureDirectory, 'catalog-pagination.db')}`
  process.env.TURSO_AUTH_TOKEN = ''
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  listAgents = (await import('@/app/api/agents/list/route')).GET
  searchAgents = (await import('@/app/api/agents/search/route')).GET
  listServices = (await import('@/app/api/listings/route')).GET
  listTasks = (await import('@/app/api/tasks/route')).GET
  getStats = (await import('@/app/api/stats/route')).GET

  const agents = Array.from({ length: 125 }, (_, index) => {
    const suffix = String(index).padStart(3, '0')
    return {
      id: `scale-agent-${suffix}`,
      name: `Scale Agent ${suffix}`,
      description: `Scalable capability provider number ${suffix}.`,
      capabilities: JSON.stringify(['analysis', `batch-${index % 5}`]),
      endpoint: `https://agent-${suffix}.invalid`,
      owner_address: `owner-${suffix}`,
      api_key: `key-${suffix}`,
      status: 'active' as const,
    }
  })
  const users = agents.map((agent, index) => ({
    id: `user_agent_${agent.id}`,
    email: `scale-${index}@test.invalid`,
    password_hash: 'unused',
    name: agent.name,
    role: 'agent' as const,
  }))
  const listings = agents.map((agent, index) => ({
    id: `scale-listing-${String(index).padStart(3, '0')}`,
    seller_id: `user_agent_${agent.id}`,
    category: 'analysis' as const,
    title: `Scalable analysis service ${String(index).padStart(3, '0')}`,
    description: `A production analysis service used to verify catalog page ${index}.`,
    price_bankr: index + 1,
    status: 'active' as const,
  }))
  const tasks = agents.map((agent, index) => ({
    id: `scale-task-${String(index).padStart(3, '0')}`,
    posterAgentId: agent.id,
    title: `Scalable task ${String(index).padStart(3, '0')}`,
    description: `A task used to verify discovery beyond page one for batch ${index % 5}.`,
    requiredCapabilities: JSON.stringify(['analysis', `batch-${index % 5}`]),
    budgetUsd: index + 1,
    status: 'open' as const,
    taskType: 'general' as const,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  }))

  await db.insert(schema.users).values(users)
  await db.insert(schema.agents).values(agents)
  await db.insert(schema.listings).values(listings)
  await db.insert(schema.tasks).values(tasks)
})

after(() => {
  db?.$client.close()
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true })
})

test('agent registry pages through more than 100 agents without truncating the total', async () => {
  const firstResponse = await listAgents(new NextRequest('http://localhost/api/agents/list?page=1&limit=50'))
  const first = await firstResponse.json()
  assert.equal(firstResponse.status, 200)
  assert.equal(first.agents.length, 50)
  assert.equal(first.total, 125)
  assert.equal(first.total_pages, 3)
  assert.equal(first.has_more, true)

  const last = await (await listAgents(new NextRequest('http://localhost/api/agents/list?page=3&limit=50'))).json()
  assert.equal(last.agents.length, 25)
  assert.equal(last.total, 125)
  assert.equal(last.has_more, false)

  const filtered = await (await listAgents(new NextRequest('http://localhost/api/agents/list?search=batch-3&limit=50'))).json()
  assert.equal(filtered.total, 25)
  assert.equal(filtered.agents.length, 25)
})

test('agent capability search can page through the full matching set', async () => {
  const first = await (await searchAgents(new NextRequest('http://localhost/api/agents/search?q=capability&page=1&limit=50'))).json()
  assert.equal(first.agents.length, 50)
  assert.equal(first.total, 125)
  assert.equal(first.has_more, true)

  const last = await (await searchAgents(new NextRequest('http://localhost/api/agents/search?q=capability&page=3&limit=50'))).json()
  assert.equal(last.agents.length, 25)
  assert.equal(last.total, 125)
  assert.equal(last.has_more, false)
})

test('service catalog pages through more than 100 services without truncating the total', async () => {
  const firstResponse = await listServices(new NextRequest('http://localhost/api/listings?page=1&limit=50&status=active'))
  const first = await firstResponse.json()
  assert.equal(firstResponse.status, 200)
  assert.equal(first.listings.length, 50)
  assert.equal(first.total, 125)
  assert.equal(first.total_pages, 3)
  assert.equal(first.has_more, true)

  const last = await (await listServices(new NextRequest('http://localhost/api/listings?page=3&limit=50&status=active'))).json()
  assert.equal(last.listings.length, 25)
  assert.equal(last.total, 125)
  assert.equal(last.has_more, false)

  const sellerSearch = await (await listServices(new NextRequest('http://localhost/api/listings?search=Scale%20Agent%20124'))).json()
  assert.equal(sellerSearch.total, 1)
  assert.equal(sellerSearch.listings[0].seller_name, 'Scale Agent 124')
})

test('market statistics report full service totals instead of the current page size', async () => {
  await db.insert(schema.listings).values({
    id: 'scale-listing-second-service',
    seller_id: 'user_agent_scale-agent-000',
    category: 'analysis',
    title: 'Second service from an existing profile',
    description: 'Verifies that profile statistics count sellers rather than listings.',
    price_bankr: 10,
    status: 'active',
  })
  const stats = await (await getStats()).json()
  assert.equal(stats.agent_count, 125)
  assert.equal(stats.marketplace_profile_count, 125)
  assert.equal(stats.services_listed, 126)
  assert.equal(stats.services_online, 126)
  assert.equal(stats.agents_online, 0)

  await db.$client.execute({
    sql: `UPDATE agents SET is_online = 1, last_seen_at = unixepoch() WHERE id = ?`,
    args: ['scale-agent-000'],
  })
  const refreshedStats = await (await getStats()).json()
  assert.equal(refreshedStats.agents_online, 1)
})

test('task board filters and pages through more than 100 tasks', async () => {
  const firstResponse = await listTasks(new NextRequest('http://localhost/api/tasks?status=open&page=1&limit=50'))
  const first = await firstResponse.json()
  assert.equal(firstResponse.status, 200)
  assert.equal(first.tasks.length, 50)
  assert.equal(first.total, 125)
  assert.equal(first.total_pages, 3)
  assert.equal(first.has_more, true)

  const last = await (await listTasks(new NextRequest('http://localhost/api/tasks?status=open&page=3&limit=50'))).json()
  assert.equal(last.tasks.length, 25)
  assert.equal(last.total, 125)
  assert.equal(last.has_more, false)

  const filtered = await (await listTasks(new NextRequest('http://localhost/api/tasks?status=open&capability=batch-3&page=1&limit=50'))).json()
  assert.equal(filtered.total, 25)
  assert.equal(filtered.tasks.length, 25)
})
