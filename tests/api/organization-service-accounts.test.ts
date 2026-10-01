import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let createOrganization: typeof import('@/app/api/organizations/route').POST
let listOrganizations: typeof import('@/app/api/organizations/route').GET
let inspectOrganization: typeof import('@/app/api/organizations/[id]/route').GET
let listTeams: typeof import('@/app/api/organizations/[id]/teams/route').GET
let createTeam: typeof import('@/app/api/organizations/[id]/teams/route').POST
let createKey: typeof import('@/app/api/organizations/[id]/service-accounts/route').POST
let listKeys: typeof import('@/app/api/organizations/[id]/service-accounts/route').GET
let revokeKey: typeof import('@/app/api/organizations/[id]/service-accounts/[accountId]/route').DELETE

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-service-accounts-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'service-accounts.db')}`
  process.env.JWT_SECRET = 'organization-service-account-test-secret'
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'true'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  ;({ POST: createOrganization, GET: listOrganizations } = await import('@/app/api/organizations/route'))
  inspectOrganization = (await import('@/app/api/organizations/[id]/route')).GET
  ;({ GET: listTeams, POST: createTeam } = await import('@/app/api/organizations/[id]/teams/route'))
  ;({ GET: listKeys, POST: createKey } = await import('@/app/api/organizations/[id]/service-accounts/route'))
  revokeKey = (await import('@/app/api/organizations/[id]/service-accounts/[accountId]/route')).DELETE
  await db.insert(schema.users).values([
    { id: 'service-owner', email: 'service-owner@test.invalid', name: 'Owner', password_hash: 'unused' },
    { id: 'service-outsider', email: 'service-outsider@test.invalid', name: 'Outsider', password_hash: 'unused' },
  ])
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function request(path: string, method: string, credential?: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) })
}
function accountToken(userId: string) {
  return jwt({ userId, email: `${userId}@test.invalid`, role: 'human' })
}

test('read-only service key is issued once, scoped, expirable, and revocable', async () => {
  const ownerToken = accountToken('service-owner')
  const outsiderToken = accountToken('service-outsider')
  const first = await createOrganization(request('/api/organizations', 'POST', ownerToken,
    { client_reference: 'service-primary', name: 'Primary' }))
  const id = (await first.json()).organization.id as string
  const other = await createOrganization(request('/api/organizations', 'POST', ownerToken,
    { client_reference: 'service-other', name: 'Other' }))
  const otherId = (await other.json()).organization.id as string
  const path = `/api/organizations/${id}/service-accounts`
  const params = { params: Promise.resolve({ id }) }
  const payload = { client_reference: 'reporter-1', name: 'Reporter', lifetime_days: 2 }
  assert.equal((await createKey(request(path, 'POST', outsiderToken, payload), params)).status, 404)
  const created = await createKey(request(path, 'POST', ownerToken, payload), params)
  assert.equal(created.status, 201, JSON.stringify(await created.clone().json()))
  const body = await created.json()
  const token = body.api_key as string
  const accountId = body.service_account.id as string
  assert.match(token, /^cmo_[a-f0-9]{64}$/)
  assert.equal(created.headers.get('cache-control'), 'private, no-store')
  const [stored] = await db.select().from(schema.organization_service_accounts).where(eq(schema.organization_service_accounts.id, accountId))
  assert.equal(stored.credential_hash, (await import('@/lib/registered-agent-auth')).hashAgentApiKey(`organization-read:${token}`))
  assert.equal(JSON.stringify(stored).includes(token), false)
  const replay = await createKey(request(path, 'POST', ownerToken, payload), params)
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).api_key, null)
  assert.equal((await createKey(request(path, 'POST', ownerToken, { ...payload, name: 'Other' }), params)).status, 409)
  assert.equal(JSON.stringify(await (await listKeys(request(path, 'GET', ownerToken), params)).json()).includes(token), false)
  assert.equal((await listKeys(request(path, 'GET', token), params)).status, 401)
  const listed = await (await listOrganizations(request('/api/organizations', 'GET', token))).json()
  assert.deepEqual(listed.organizations.map((item: { id: string }) => item.id), [id])
  const detail = await (await inspectOrganization(request(`/api/organizations/${id}`, 'GET', token), params)).json()
  assert.equal(detail.role, 'service_account')
  assert.equal('assignments' in detail, false)
  assert.equal('audit' in detail, false)
  assert.equal((await inspectOrganization(request(`/api/organizations/${otherId}`, 'GET', token), { params: Promise.resolve({ id: otherId }) })).status, 404)
  assert.equal((await listTeams(request(`/api/organizations/${id}/teams`, 'GET', token), params)).status, 200)
  assert.equal((await listTeams(request(`/api/organizations/${otherId}/teams`, 'GET', token), { params: Promise.resolve({ id: otherId }) })).status, 404)
  assert.equal((await createTeam(request(`/api/organizations/${id}/teams`, 'POST', token, { slug: 'bad', name: 'Bad' }), params)).status, 401)
  assert.equal((await createOrganization(request('/api/organizations', 'POST', token, { client_reference: 'bad', name: 'Bad' }))).status, 401)
  assert.equal((await createKey(request(path, 'POST', token, { client_reference: 'bad', name: 'Bad' }), params)).status, 401)
  assert.equal((await revokeKey(request(`${path}/${accountId}`, 'DELETE', token), { params: Promise.resolve({ id, accountId }) })).status, 401)
  assert.equal(await (await import('@/lib/auth')).authenticateRequest(`Bearer ${token}`), null)
  assert.equal(await (await import('@/lib/request-principal')).resolveRequestPrincipal(request('/api/routes/plan', 'POST', token)), null)
  const revokeParams = { params: Promise.resolve({ id, accountId }) }
  assert.equal((await revokeKey(request(`${path}/${accountId}`, 'DELETE', outsiderToken), revokeParams)).status, 404)
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'false'
  try {
    assert.equal((await createKey(request(path, 'POST', ownerToken, { client_reference: 'blocked', name: 'Blocked' }), params)).status, 503)
    assert.equal((await revokeKey(request(`${path}/${accountId}`, 'DELETE', ownerToken), revokeParams)).status, 200)
  } finally { process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'true' }
  assert.equal((await (await revokeKey(request(`${path}/${accountId}`, 'DELETE', ownerToken), revokeParams)).json()).idempotent, true)
  assert.equal((await listOrganizations(request('/api/organizations', 'GET', token))).status, 401)
  const [record] = await db.select().from(schema.organization_service_accounts).where(eq(schema.organization_service_accounts.id, accountId))
  assert.equal(record.status, 'revoked')
  const audit = await db.select().from(schema.organization_audit_events).where(eq(schema.organization_audit_events.service_account_id, accountId))
  assert.deepEqual(audit.map((row) => row.action).sort(), ['service_account_created', 'service_account_revoked'])
  assert.equal((await db.select().from(schema.trades)).length, 0)
})

test('expired key fails and concurrent creation returns a single secret', async () => {
  const ownerToken = accountToken('service-owner')
  const createdOrg = await createOrganization(request('/api/organizations', 'POST', ownerToken,
    { client_reference: 'service-race', name: 'Race' }))
  const id = (await createdOrg.json()).organization.id as string
  const params = { params: Promise.resolve({ id }) }
  const path = `/api/organizations/${id}/service-accounts`
  const payload = { client_reference: 'race-key', name: 'Worker' }
  const results = await Promise.all(Array.from({ length: 3 }, () => createKey(request(path, 'POST', ownerToken, payload), params)))
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 200, 201])
  const bodies = await Promise.all(results.map((result) => result.json()))
  const token = bodies.find((body) => body.api_key)?.api_key as string
  assert.equal(bodies.filter((body) => body.api_key).length, 1)
  const [row] = await db.select().from(schema.organization_service_accounts).where(eq(schema.organization_service_accounts.organization_id, id))
  await db.update(schema.organization_service_accounts).set({ expires_at: new Date(Date.now() - 1000) })
    .where(eq(schema.organization_service_accounts.id, row.id))
  assert.equal((await listOrganizations(request('/api/organizations', 'GET', token))).status, 401)
})
