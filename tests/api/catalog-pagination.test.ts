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
let getActivity: typeof import('@/app/api/activity/route').GET
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
  getActivity = (await import('@/app/api/activity/route')).GET

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
  await db.insert(schema.payout_addresses).values({
    user_id: 'user_agent_scale-agent-000',
    address: '0x1111111111111111111111111111111111111111',
  })
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
  assert.equal(first.agents[0].is_online, false)
  assert.equal(first.agents[0].availability, 'unknown')

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
  assert.equal(first.agents[0].availability, 'unknown')

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
  assert.equal(sellerSearch.listings[0].external_payment_ready, false)
  assert.equal(sellerSearch.listings[0].seller_online, false)
  assert.equal(sellerSearch.listings[0].seller_availability, 'unknown')

  const payoutReady = await (await listServices(new NextRequest('http://localhost/api/listings?search=Scale%20Agent%20000'))).json()
  assert.equal(payoutReady.total, 1)
  assert.equal(payoutReady.listings[0].external_payment_ready, true)
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
  assert.equal(stats.tasks_total, 125)
  assert.equal(stats.tasks_routed, 0)
  assert.equal(stats.tasks_completed, 0)
  assert.equal(stats.tasks_open, 125)
  assert.equal(stats.completed_trades, 0)
  assert.equal(stats.recorded_volume_usd, 0)

  await db.$client.execute({
    sql: `UPDATE agents SET is_online = 0, last_seen_at = unixepoch() WHERE id = ?`,
    args: ['scale-agent-000'],
  })
  const refreshedStats = await (await getStats()).json()
  assert.equal(refreshedStats.agents_online, 1)

  const onlineDirectory = await (await listAgents(new NextRequest('http://localhost/api/agents/list?search=Scale%20Agent%20000'))).json()
  assert.equal(onlineDirectory.agents[0].is_online, true)
  assert.equal(onlineDirectory.agents[0].availability, 'online')
  const onlineCatalog = await (await listServices(new NextRequest('http://localhost/api/listings?search=Scale%20Agent%20000'))).json()
  assert.equal(onlineCatalog.listings[0].seller_online, true)
  assert.equal(onlineCatalog.listings[0].seller_availability, 'online')

  await db.$client.execute({
    sql: `UPDATE agents SET is_online = 1, last_seen_at = unixepoch() - 181 WHERE id = ?`,
    args: ['scale-agent-000'],
  })
  const staleStats = await (await getStats()).json()
  assert.equal(staleStats.agents_online, 0)
  const staleDirectory = await (await listAgents(new NextRequest('http://localhost/api/agents/list?search=Scale%20Agent%20000'))).json()
  assert.equal(staleDirectory.agents[0].is_online, false)
  assert.equal(staleDirectory.agents[0].availability, 'offline')
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

test('market statistics count routed tasks, completed trades, and recorded volume from stored records', async () => {
  await db.$client.execute({
    sql: `UPDATE tasks SET status = 'assigned', assigned_agent_id = ? WHERE id = ?`,
    args: ['scale-agent-001', 'scale-task-001'],
  })
  await db.$client.execute({
    sql: `UPDATE tasks SET status = 'completed', assigned_agent_id = ? WHERE id = ?`,
    args: ['scale-agent-002', 'scale-task-002'],
  })
  await db.insert(schema.trades).values({
    id: 'scale-completed-trade',
    listing_id: 'scale-listing-000',
    buyer_id: 'user_agent_scale-agent-001',
    seller_id: 'user_agent_scale-agent-000',
    amount: 10,
    fee: 0.5,
    item_price: 10,
    platform_fee: 0.5,
    total_cost: 10.5,
    seller_amount: 10,
    status: 'completed',
  })

  const stats = await (await getStats()).json()
  assert.equal(stats.tasks_total, 125)
  assert.equal(stats.tasks_routed, 2)
  assert.equal(stats.tasks_completed, 1)
  assert.equal(stats.tasks_open, 123)
  assert.equal(stats.total_trades, 1)
  assert.equal(stats.trade_count, 1)
  assert.equal(stats.completed_trades, 1)
  assert.equal(stats.recorded_volume_usd, 10)
  assert.equal(stats.total_volume_usd, 10)
  assert.equal(stats.platform_fees_usd, 0.5)
  assert.equal(stats.trades_today, 1)
  assert.equal(stats.volume_last_24h, 10)
  assert.equal(stats.volume_by_rail.ledger, 10)
})

test('activity includes mixed-format timestamps and disables response caching', async () => {
  const createdAt = new Date(Date.now() + 5_000).toISOString()
  await db.$client.execute({
    sql: `INSERT INTO agents
      (id, name, description, capabilities, endpoint, owner_address, api_key, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    args: [
      'mixed-timestamp-agent',
      'Mixed Timestamp Agent',
      'Verifies activity timestamps stored as ISO text.',
      '[]',
      'https://mixed-timestamp.invalid',
      'mixed-timestamp-owner',
      'mixed-timestamp-key',
      createdAt,
    ],
  })

  const response = await getActivity()
  const activity = await response.json()
  const registration = activity.find((event: any) => event.id === 'registration_mixed-timestamp-agent')
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
  assert.equal(registration.description, 'New agent "Mixed Timestamp Agent" registered')
  assert.equal(registration.timestamp, createdAt)
})
