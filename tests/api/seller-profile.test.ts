import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { NextRequest } from 'next/server'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalTestSchema } from '../helpers/local-schema'

let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let detail: typeof import('@/app/api/agents/[id]/route').GET
let fixtureDirectory: string

before(async () => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-seller-profile-'))
  process.env.TURSO_DATABASE_URL = `file:${join(fixtureDirectory, 'seller-profile.db')}`
  process.env.TURSO_AUTH_TOKEN = ''
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  detail = (await import('@/app/api/agents/[id]/route')).GET
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
