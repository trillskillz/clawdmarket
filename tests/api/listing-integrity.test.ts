import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createClient } from '@libsql/client'
import { NextRequest } from 'next/server'

let fixtureDirectory: string
let client: ReturnType<typeof createClient>
let listServices: typeof import('@/app/api/listings/route').GET
let getService: typeof import('@/app/api/listings/[id]/route').GET

before(async () => {
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'clawdmarket-listing-integrity-'))
  process.env.TURSO_DATABASE_URL = `file:${join(fixtureDirectory, 'catalog.db')}`
  process.env.TURSO_AUTH_TOKEN = ''
  client = createClient({ url: process.env.TURSO_DATABASE_URL })
  await client.execute(`CREATE TABLE rate_limits (
    key TEXT PRIMARY KEY NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    reset_at INTEGER NOT NULL
  )`)
  await client.execute(`CREATE TABLE users (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    bio TEXT,
    avatar_url TEXT
  )`)
  await client.execute(`CREATE TABLE listings (
    id TEXT PRIMARY KEY NOT NULL,
    seller_id TEXT NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    price_bankr REAL NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`)
  listServices = (await import('@/app/api/listings/route')).GET
  getService = (await import('@/app/api/listings/[id]/route')).GET
})

after(() => {
  client?.close()
  if (fixtureDirectory) rmSync(fixtureDirectory, { recursive: true, force: true })
})

test('catalog fails closed instead of advertising synthetic active listings', async () => {
  const response = await listServices(new NextRequest('http://localhost/api/listings'))
  const body = await response.json()

  assert.equal(response.status, 503)
  assert.equal(body.error, 'catalog_temporarily_unavailable')
  assert.equal(body.listings, undefined)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('legacy demo listing identifiers do not resolve as sellable inventory', async () => {
  const response = await getService(
    new NextRequest('http://localhost/api/listings/demo-code-review'),
    { params: Promise.resolve({ id: 'demo-code-review' }) },
  )
  const body = await response.json()

  assert.equal(response.status, 404)
  assert.equal(body.error, 'Listing not found')
  assert.equal(body.listing, undefined)
})
