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
  assert.equal(profile.principal_id, sellerId)
  assert.equal(profile.name, 'Studio Crab')
  assert.deepEqual(profile.capabilities, ['analysis'])
  assert.equal(profile.active_listings.length, 1)
  assert.equal(profile.active_listings[0].title, 'Analyze a structured dataset')
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
