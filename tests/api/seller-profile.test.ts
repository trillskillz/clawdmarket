import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { createLocalTestSchema } from '../helpers/local-schema'

let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let detail: typeof import('@/app/api/agents/[id]/route').GET
let genome: typeof import('@/app/api/agents/[id]/genome/route').GET
let trust: typeof import('@/app/api/agents/[id]/trust/route').GET
let lineage: typeof import('@/app/api/agents/[id]/lineage/route').GET
let generateJWT: typeof import('@/lib/auth').generateJWT
let fixtureDirectory: string

before(async () => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-seller-profile-'))
  process.env.TURSO_DATABASE_URL = `file:${join(fixtureDirectory, 'seller-profile.db')}`
  process.env.TURSO_AUTH_TOKEN = ''
  process.env.JWT_SECRET = 'seller-profile-tests-only'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  detail = (await import('@/app/api/agents/[id]/route')).GET
  genome = (await import('@/app/api/agents/[id]/genome/route')).GET
  trust = (await import('@/app/api/agents/[id]/trust/route')).GET
  lineage = (await import('@/app/api/agents/[id]/lineage/route')).GET
  generateJWT = (await import('@/lib/auth')).generateJWT
})

after(() => {
  db?.$client.close()
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true })
})

const params = (id: string) => ({ params: Promise.resolve({ id }) })

test('seller detail resolves an account seller and publishes active services', async () => {
  const sellerId = crypto.randomUUID()
  await db.insert(schema.users).values({
    id: sellerId,
    name: 'Studio Crab',
    email: `studio-${sellerId}@test.invalid`,
    password_hash: 'unused',
    role: 'agent',
    bio: 'Production data analysis seller.',
  })
  await db.insert(schema.listings).values({
    seller_id: sellerId,
    category: 'analysis',
    title: 'Analyze a structured dataset',
    description: 'Return validated findings and source notes.',
    price_bankr: 12,
  })

  const response = await detail(new NextRequest(`http://localhost/api/agents/${sellerId}`), params(sellerId))
  assert.equal(response.status, 200)
  const profile = await response.json()
  assert.equal(profile.profile_kind, 'account_seller')
  assert.equal(Object.hasOwn(profile, 'principal_id'), false)
  assert.equal(Object.hasOwn(profile, 'owner_address'), false)
  assert.equal(profile.name, 'Studio Crab')
  assert.deepEqual(profile.capabilities, ['analysis'])
  assert.equal(profile.active_listings.length, 1)
  assert.equal(profile.active_listings[0].title, 'Analyze a structured dataset')
})

test('public agent detail does not reveal legacy recovery data or economic principal IDs', async () => {
  const agentId = `private-owner-${crypto.randomUUID()}`
  const ownerEmail = `recovery-${crypto.randomUUID()}@private.invalid`
  await db.insert(schema.agents).values({
    id: agentId,
    name: 'Public provider',
    description: 'A public provider with private owner recovery details.',
    capabilities: '["code-review"]',
    endpoint: 'https://provider.invalid',
    owner_address: ownerEmail,
    owner_email: ownerEmail,
    api_key: 'unused',
    status: 'active',
  })

  const response = await detail(new NextRequest(`http://localhost/api/agents/${agentId}`), params(agentId))
  assert.equal(response.status, 200)
  const profile = await response.json()
  assert.equal(profile.id, agentId)
  assert.equal(Object.hasOwn(profile, 'owner_address'), false)
  assert.equal(Object.hasOwn(profile, 'owner_email'), false)
  assert.equal(Object.hasOwn(profile, 'principal_id'), false)
  assert.equal(JSON.stringify(profile).includes(ownerEmail), false)
})

test('seller detail resolves reference profiles and missing sellers explicitly', async () => {
  const reference = await detail(new NextRequest('http://localhost/api/agents/clawdmarket_seller'), params('clawdmarket_seller'))
  assert.equal(reference.status, 200)
  const profile = await reference.json()
  assert.equal(profile.profile_kind, 'reference')
  assert.ok(profile.active_listings.length > 0)

  const missing = await detail(new NextRequest('http://localhost/api/agents/not-a-seller'), params('not-a-seller'))
  assert.equal(missing.status, 404)
})

test('private profile endpoints reject strangers and lineage omits prompt, config, and benchmark inputs', async () => {
  const agentId = `privacy-${crypto.randomUUID()}`
  const ownerId = crypto.randomUUID()
  const strangerId = crypto.randomUUID()
  for (const id of [ownerId, strangerId]) {
    await db.insert(schema.users).values({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' })
  }
  await db.insert(schema.agents).values({
    id: agentId, name: 'Private provider', description: 'Private', capabilities: '[]',
    endpoint: 'https://provider.invalid', owner_address: '', api_key: 'unused', status: 'active', visibility: 'private',
  })
  await db.insert(schema.agent_owners).values({ agentId, userId: ownerId, establishedBy: 'test' })
  await db.insert(schema.agentVersions).values({
    id: crypto.randomUUID(), agentId, baseAgentId: agentId, version: 2,
    systemPrompt: 'SECRET_SYSTEM_PROMPT', toolsConfig: 'SECRET_TOOLS_CONFIG',
  })
  await db.insert(schema.agentImprovements).values({
    id: crypto.randomUUID(), baseAgentId: agentId, fromAgentId: agentId, toAgentId: agentId,
    fromVersion: 1, toVersion: 2, improvedByAgentId: agentId,
    newSystemPrompt: 'SECRET_NEW_PROMPT', newToolsConfig: 'SECRET_NEW_TOOLS',
  })
  await db.insert(schema.benchmarks).values({
    id: crypto.randomUUID(), agentId, capability: 'analysis', testInput: 'SECRET_TEST_INPUT',
    testOutput: 'SECRET_TEST_OUTPUT', scoringRubric: 'SECRET_RUBRIC', notes: 'SECRET_NOTES',
  })

  const path = `http://localhost/api/agents/${agentId}`
  const owner = new NextRequest(path, { headers: { authorization: `Bearer ${generateJWT({ userId: ownerId, email: `${ownerId}@test.invalid`, role: 'human' })}` } })
  const stranger = new NextRequest(path, { headers: { authorization: `Bearer ${generateJWT({ userId: strangerId, email: `${strangerId}@test.invalid`, role: 'human' })}` } })
  for (const route of [genome, trust]) {
    assert.equal((await route(new NextRequest(path), params(agentId))).status, 404)
    assert.equal((await route(stranger, params(agentId))).status, 404)
    assert.equal((await route(owner, params(agentId))).status, 200)
  }
  assert.equal((await detail(stranger, params(agentId))).status, 404)
  assert.equal((await detail(owner, params(agentId))).status, 200)
  assert.equal((await lineage(new NextRequest(path), params(agentId))).status, 401)
  assert.equal((await lineage(stranger, params(agentId))).status, 404)
  const response = await lineage(owner, params(agentId))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.versions.length, 1)
  assert.equal(body.improvements.length, 1)
  assert.equal(body.benchmark_history.length, 1)
  assert.equal(JSON.stringify(body).includes('SECRET_'), false)

  await db.update(schema.agents).set({ visibility: 'public' }).where(eq(schema.agents.id, agentId))
  const publicLineage = await lineage(stranger, params(agentId))
  assert.equal(publicLineage.status, 200)
  assert.equal(JSON.stringify(await publicLineage.json()).includes('SECRET_'), false)

  await db.update(schema.agents).set({ archivedAt: new Date() }).where(eq(schema.agents.id, agentId))
  assert.equal((await genome(new NextRequest(path), params(agentId))).status, 404)
  assert.equal((await detail(stranger, params(agentId))).status, 404)
  assert.equal((await trust(stranger, params(agentId))).status, 404)
  assert.equal((await lineage(stranger, params(agentId))).status, 404)
})
