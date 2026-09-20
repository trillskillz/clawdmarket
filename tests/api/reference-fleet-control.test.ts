import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let route: typeof import('@/app/api/admin/reference-fleet/execution/route')
let adminToken: string
let userToken: string

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'reference-control.db')}`
  process.env.JWT_SECRET = 'isolated-reference-control-tests-only'
  process.env.WEBHOOK_SECRET_KEY = 'isolated-reference-control-tests-only'
  const adminId = 'admin_reference_control'
  const userId = 'user_reference_control'
  process.env.ADMIN_USER_IDS = adminId
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  const { generateJWT } = await import('@/lib/auth')
  route = await import('@/app/api/admin/reference-fleet/execution/route')
  await db.insert(schema.users).values([
    { id: adminId, email: 'reference-admin@test.invalid', password_hash: 'unused', name: 'Reference admin', role: 'human' },
    { id: userId, email: 'reference-user@test.invalid', password_hash: 'unused', name: 'Reference user', role: 'human' },
  ])
  adminToken = generateJWT({ userId: adminId, email: 'reference-admin@test.invalid', role: 'human' })
  userToken = generateJWT({ userId, email: 'reference-user@test.invalid', role: 'human' })
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
  delete process.env.CLAWDMARKET_REFERENCE_FLEET_EXECUTION_PAUSED
  delete process.env.ADMIN_USER_IDS
})

function request(method: 'GET' | 'POST', token: string, body?: unknown) {
  return new NextRequest('https://clawdmkt.test/api/admin/reference-fleet/execution', {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

test('managed execution defaults paused and only admins can change its audited state', async () => {
  assert.equal((await route.GET(request('GET', userToken))).status, 403)
  assert.equal((await route.POST(request('POST', userToken, { paused: false, reason: 'Unauthorized resume' }))).status, 403)
  const initial = await (await route.GET(request('GET', adminToken))).json()
  assert.equal(initial.control.paused, true)
  assert.equal(initial.control.source, 'default')
  assert.equal(initial.paid_service_publication, 'locked')

  const resumed = await route.POST(request('POST', adminToken, {
    paused: false,
    reason: 'Begin isolated capability canary',
  }))
  assert.equal(resumed.status, 200)
  assert.equal((await resumed.json()).control.paused, false)
  const state = await (await route.GET(request('GET', adminToken))).json()
  assert.equal(state.events.length, 1)
  assert.equal(state.events[0].reason, 'Begin isolated capability canary')
})

test('the emergency environment pause cannot be cleared through the API', async () => {
  process.env.CLAWDMARKET_REFERENCE_FLEET_EXECUTION_PAUSED = 'true'
  try {
    const state = await (await route.GET(request('GET', adminToken))).json()
    assert.equal(state.control.paused, true)
    assert.equal(state.control.source, 'environment')
    const response = await route.POST(request('POST', adminToken, {
      paused: false,
      reason: 'Attempt API override',
    }))
    assert.equal(response.status, 409)
    assert.equal((await response.json()).code, 'ENVIRONMENT_EXECUTION_PAUSE')
  } finally {
    delete process.env.CLAWDMARKET_REFERENCE_FLEET_EXECUTION_PAUSED
  }
})
