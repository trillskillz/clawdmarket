import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'
import { CAPABILITIES, normalizeCapability } from '@/lib/capabilities'
import { CAPABILITY_FAMILIES } from '@/lib/capability-hierarchy'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let list: typeof import('@/app/api/agents/list/route').GET
let search: typeof import('@/app/api/agents/search/route').GET
let services: typeof import('@/app/api/services/route').GET
const request = (path: string) => new NextRequest(`http://localhost${path}`)

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-hierarchy-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'hierarchy.db')}`
  process.env.TURSO_AUTH_TOKEN = ''
  delete process.env.ANTHROPIC_API_KEY
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  list = (await import('@/app/api/agents/list/route')).GET
  search = (await import('@/app/api/agents/search/route')).GET
  services = (await import('@/app/api/services/route')).GET
})
after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

async function agent(capabilities: string, extra: Partial<typeof schema.agents.$inferInsert> = {}) {
  const id = crypto.randomUUID()
  await db.insert(schema.agents).values({ id, name: 'Hierarchy fixture', description: 'Hierarchy directory test',
    capabilities, endpoint: '', owner_address: 'PRIVATE_OWNER', api_key: `PRIVATE_KEY_${id}`,
    created_at: new Date('2026-01-01'), ...extra })
  return id
}

test('hierarchy partitions every canonical leaf without changing the flat catalog or legacy research alias', async () => {
  const hierarchy = await (await (await import('@/app/api/capabilities/hierarchy/route')).GET()).json()
  const flatResponse = await (await import('@/app/api/capabilities/route')).GET()
  assert.deepEqual(await flatResponse.json(), CAPABILITIES)
  assert.match(flatResponse.headers.get('Link') || '', /capabilities\/hierarchy/)
  const leaves = hierarchy.families.flatMap((family: { id: string; purchasable: boolean; children: { id: string; parent_id: string }[] }) => {
    assert.equal(family.purchasable, false)
    for (const leaf of family.children) assert.equal(leaf.parent_id, family.id)
    return family.children.map((leaf) => leaf.id)
  })
  assert.deepEqual([...leaves].sort(), CAPABILITIES.map((leaf) => leaf.id).sort())
  assert.equal(new Set(leaves).size, leaves.length)
  assert.equal(hierarchy.matching.sibling_inheritance, false)
  assert.equal(hierarchy.matching.quality_inheritance, false)
  const resolve = (await import('@/app/api/capabilities/resolve/route')).GET
  const family = await (await resolve(request('/api/capabilities/resolve?q=family:research'))).json()
  assert.deepEqual(family.canonical_ids, [])
  assert.equal(family.families[0].id, 'family:research')
  assert.ok(family.families[0].descendant_ids.includes('data-analysis'))
  assert.deepEqual(family.unknown, [])
  const mixed = await (await resolve(request('/api/capabilities/resolve?capabilities=family:research,analysis'))).json()
  assert.deepEqual(mixed.canonical_ids, ['data-analysis'])
  assert.equal(mixed.families.length, 1)
  const legacy = await (await resolve(request('/api/capabilities/resolve?q=research'))).json()
  assert.deepEqual(legacy.canonical_ids, ['web-research'])
  assert.deepEqual(legacy.families, [])
  const unknown = await (await resolve(request('/api/capabilities/resolve?q=family:unknown-research'))).json()
  assert.deepEqual(unknown.canonical_ids, [])
  assert.deepEqual(unknown.unknown, ['family:unknown-research'])
})

test('family agent discovery matches explicit aliases, preserves privacy and fails closed on malformed claims', async () => {
  const expected = [await agent('["web-research"]'), await agent('[" WEB SEARCH "]'),
    await agent('["analysis"]'), await agent('["fact-checking"]')]
  await agent('["web-research"]', { status: 'inactive' })
  for (const claims of ['["family:research"]', '["web-research:verified"]', '["prefix-web-research"]',
    '["code-review"]', '{broken', '"web-research"', '{"claim":"web-research"}', '[123,null,true]']) await agent(claims)
  await agent('["web-research"]', { visibility: 'private' })
  await agent('["web-research"]', { archivedAt: new Date() })
  const first = await (await list(request('/api/agents/list?family=family:research&limit=2'))).json()
  const second = await (await list(request('/api/agents/list?family=family:research&limit=2&page=2'))).json()
  assert.equal(first.error, undefined)
  assert.equal(first.family, 'family:research')
  assert.equal(first.total, expected.length)
  assert.equal(second.total, expected.length)
  assert.equal(first.has_more, true)
  assert.equal(second.has_more, false)
  assert.deepEqual([...first.agents, ...second.agents].map((row: { id: string }) => row.id).sort(), expected.sort())
  assert.equal(JSON.stringify(first).includes('PRIVATE_OWNER'), false)
  assert.equal(JSON.stringify(first).includes('PRIVATE_KEY'), false)
  const keyword = await (await list(request('/api/agents/list?family=family:research&search=Hierarchy'))).json()
  const semantic = await (await search(request('/api/agents/search?family=family:research&q=Hierarchy&limit=2'))).json()
  const nextSemantic = await (await search(request('/api/agents/search?family=family:research&q=Hierarchy&limit=2&page=2'))).json()
  assert.equal(semantic.total, expected.length)
  assert.equal(semantic.family, 'family:research')
  assert.deepEqual([...semantic.agents, ...nextSemantic.agents].map((row: { id: string }) => row.id).sort(), expected)
  assert.deepEqual(keyword.agents.map((row: { id: string }) => row.id).sort(), expected)
  assert.deepEqual((await (await list(request('/api/agents/list?family=family:research&verified=true'))).json()).agents, [])
})

test('service family discovery intersects exact leaves, excludes hidden sellers and counts stable pages', async () => {
  const human = crypto.randomUUID()
  await db.insert(schema.users).values({ id: human, email: `${human}@test.invalid`, name: 'Human provider', password_hash: 'unused', role: 'human' })
  const insert = async (seller: string, capabilities: string, status: 'active' | 'draft' = 'active') => {
    const id = crypto.randomUUID()
    await db.insert(schema.service_definitions).values({ id, seller_id: seller, title: 'Hierarchy research',
      description: 'Explicit capability service fixture', capabilities, price_minor: 100, status, created_at: new Date('2026-01-01') })
    return id
  }
  const expected = [await insert(human, '["web-research"]'), await insert(human, '["data-analysis"]')]
  await insert(human, '["code-review"]')
  await insert(human, '["family:research"]')
  await insert(human, '{broken')
  await insert(human, '"web-research"')
  await insert(human, '["web-research"]', 'draft')
  for (const extra of [{ visibility: 'private' as const }, { status: 'inactive' as const }, { archivedAt: new Date() }]) {
    const id = await agent('["web-research"]', extra)
    await db.insert(schema.users).values({ id: `user_agent_${id}`, email: `${id}@test.invalid`, name: 'Hidden provider', password_hash: 'unused', role: 'agent' })
    await insert(`user_agent_${id}`, '["web-research"]')
  }
  const first = await (await services(request('/api/services?family=family:research&limit=1'))).json()
  const second = await (await services(request('/api/services?family=family:research&limit=1&page=2'))).json()
  assert.equal(first.total, 2)
  assert.equal(second.total, 2)
  assert.equal(first.has_more, true)
  assert.equal(second.has_more, false)
  assert.deepEqual([...first.services, ...second.services].map((row: { id: string }) => row.id).sort(), expected.sort())
  const exact = await (await services(request('/api/services?family=family:research&capability=research'))).json()
  assert.equal(exact.total, 1)
  assert.deepEqual(exact.services[0].capabilities, ['web-research'])
  assert.equal((await (await services(request('/api/services?family=family:code&capability=research'))).json()).total, 0)
})

test('unknown and SQL-like families are rejected before directory or semantic lookup', async () => {
  for (const value of ['research', 'family:missing', "family:research') OR 1=1 --"]) {
    for (const [path, handler] of [['/api/agents/list?', list], ['/api/agents/search?q=research&', search], ['/api/services?', services]] as const) {
      assert.equal((await handler(request(`${path}family=${encodeURIComponent(value)}`))).status, 400)
    }
  }
  for (const value of ['1.5', '1junk', '-1', 'NaN']) {
    for (const [path, handler] of [['/api/agents/list?', list], ['/api/agents/search?q=research&', search], ['/api/services?', services]] as const) {
      assert.equal((await handler(request(`${path}family=family:research&page=${value}`))).status, 400)
      assert.equal((await handler(request(`${path}family=family:research&limit=${value}`))).status, 400)
    }
  }
})

test('families cannot become service, route, allowed or blocked spending capabilities', async () => {
  const { serviceDefinitionInput } = await import('@/lib/service-definitions')
  const { routePlanInput } = await import('@/lib/route-planning')
  const { buyerSpendPolicyInput } = await import('@/lib/buyer-spend-policy')
  for (const { id } of CAPABILITY_FAMILIES) {
    assert.equal(normalizeCapability(id), null)
    assert.equal(serviceDefinitionInput.safeParse({ title: 'Test service', description: 'A valid service description for testing', capabilities: [id], pricing: { model: 'fixed', amount: '1.00', currency: 'USD' } }).success, false)
    assert.equal(routePlanInput.safeParse({ client_reference: crypto.randomUUID(), objective: 'Research the requested objective', required_capabilities: [id], max_budget: { amount: '1.00', currency: 'USD' } }).success, false)
    for (const field of ['allowed_capabilities', 'blocked_capabilities']) assert.equal(buyerSpendPolicyInput.safeParse({ [field]: [id] }).success, false)
  }
  assert.equal(normalizeCapability('research'), 'web-research')
})
