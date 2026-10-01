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
let jwt: typeof import('@/lib/auth').generateJWT
let create: typeof import('@/app/api/organizations/route').POST
let list: typeof import('@/app/api/organizations/route').GET
let inspect: typeof import('@/app/api/organizations/[id]/route').GET
let assign: typeof import('@/app/api/organizations/[id]/agents/route').PUT
let unassign: typeof import('@/app/api/organizations/[id]/agents/route').DELETE
let createTeam: typeof import('@/app/api/organizations/[id]/teams/route').POST
let listTeams: typeof import('@/app/api/organizations/[id]/teams/route').GET
let archiveTeam: typeof import('@/app/api/organizations/[id]/teams/[teamId]/route').PATCH

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-organizations-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'organizations.db')}`
  process.env.JWT_SECRET = 'organization-test-secret'
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'true'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  ;({ POST: create, GET: list } = await import('@/app/api/organizations/route'))
  inspect = (await import('@/app/api/organizations/[id]/route')).GET
  ;({ PUT: assign, DELETE: unassign } = await import('@/app/api/organizations/[id]/agents/route'))
  ;({ POST: createTeam, GET: listTeams } = await import('@/app/api/organizations/[id]/teams/route'))
  archiveTeam = (await import('@/app/api/organizations/[id]/teams/[teamId]/route')).PATCH
  await db.insert(schema.users).values([
    { id: 'org-owner', email: 'owner@test.invalid', name: 'Owner', password_hash: 'unused' },
    { id: 'org-outsider', email: 'outsider@test.invalid', name: 'Outsider', password_hash: 'unused' },
  ])
  await db.insert(schema.agents).values([
    { id: 'org-agent', name: 'Owned', description: 'Owned agent', capabilities: '[]', endpoint: 'https://test.invalid', owner_address: '', api_key: 'unused' },
    { id: 'other-agent', name: 'Other', description: 'Other agent', capabilities: '[]', endpoint: 'https://test.invalid', owner_address: '', api_key: 'unused' },
    { id: 'team-agent', name: 'Team', description: 'Team agent', capabilities: '[]', endpoint: 'https://test.invalid', owner_address: '', api_key: 'unused' },
  ])
  await db.insert(schema.agent_owners).values([
    { agentId: 'org-agent', userId: 'org-owner', establishedBy: 'test' },
    { agentId: 'other-agent', userId: 'org-outsider', establishedBy: 'test' },
    { agentId: 'team-agent', userId: 'org-owner', establishedBy: 'test' },
  ])
})

test('owner-only teams are idempotent, scoped, and archived only after assignments end', async () => {
  const created = await create(request('/api/organizations', 'POST', 'org-owner', { client_reference: 'team-org', name: 'Team Org' }))
  assert.equal(created.status, 201)
  const organizationId = (await created.json()).organization.id as string
  const params = { params: Promise.resolve({ id: organizationId }) }
  const teamPath = `/api/organizations/${organizationId}/teams`
  const teamBody = { slug: 'platform', name: 'Platform' }
  assert.equal((await createTeam(request(teamPath, 'POST', 'org-outsider', teamBody), params)).status, 404)
  const teamCreated = await createTeam(request(teamPath, 'POST', 'org-owner', teamBody), params)
  assert.equal(teamCreated.status, 201, JSON.stringify(await teamCreated.clone().json()))
  const team = (await teamCreated.json()).team
  assert.equal(team.status, 'active')
  assert.equal((await (await createTeam(request(teamPath, 'POST', 'org-owner', teamBody), params)).json()).idempotent, true)
  assert.equal((await createTeam(request(teamPath, 'POST', 'org-owner', { ...teamBody, name: 'Other' }), params)).status, 409)
  assert.equal((await listTeams(request(teamPath, 'GET', 'org-outsider'), params)).status, 404)
  assert.equal((await (await listTeams(request(teamPath, 'GET', 'org-owner'), params)).json()).teams.length, 1)
  const otherOrg = await create(request('/api/organizations', 'POST', 'org-owner', { client_reference: 'other-team-org', name: 'Other Org' }))
  const otherOrgId = (await otherOrg.json()).organization.id as string
  assert.equal((await assign(request(`/api/organizations/${otherOrgId}/agents`, 'PUT', 'org-owner', {
    agent_id: 'team-agent', cost_center: 'ENG', team_id: team.id }), { params: Promise.resolve({ id: otherOrgId }) })).status, 404)
  const agentPath = `/api/organizations/${organizationId}/agents`
  assert.equal((await assign(request(agentPath, 'PUT', 'org-owner', { agent_id: 'team-agent', cost_center: 'ENG', team_id: team.id }), params)).status, 200)
  const archiveParams = { params: Promise.resolve({ id: organizationId, teamId: team.id }) }
  const archivePath = `${teamPath}/${team.id}`
  assert.equal((await archiveTeam(request(archivePath, 'PATCH', 'org-owner', { status: 'archived' }), archiveParams)).status, 409)
  assert.equal((await unassign(request(agentPath, 'DELETE', 'org-owner', { agent_id: 'team-agent' }), params)).status, 200)
  const archived = await archiveTeam(request(archivePath, 'PATCH', 'org-owner', { status: 'archived' }), archiveParams)
  assert.equal((await archived.json()).team.status, 'archived')
  assert.equal((await (await archiveTeam(request(archivePath, 'PATCH', 'org-owner', { status: 'archived' }), archiveParams)).json()).idempotent, true)
  assert.equal((await assign(request(agentPath, 'PUT', 'org-owner', { agent_id: 'team-agent', cost_center: 'ENG', team_id: team.id }), params)).status, 404)
  assert.equal((await db.select().from(schema.trades)).length, 0)
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function request(path: string, method: string, userId: string | null, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method,
    headers: { 'Content-Type': 'application/json', ...(userId ? { Authorization: `Bearer ${jwt({ userId, email: `${userId}@test.invalid`, role: 'human' })}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) })
}

test('organization creation, assignment, private reads, audit, and idempotency', async () => {
  const body = { client_reference: 'org-ref-1', name: 'Engineering' }
  assert.equal((await create(request('/api/organizations', 'POST', null, body))).status, 401)
  const created = await create(request('/api/organizations', 'POST', 'org-owner', body))
  assert.equal(created.status, 201, JSON.stringify(await created.clone().json()))
  const organization = (await created.json()).organization
  assert.equal(organization.authority, 'accounting_only')
  assert.equal(JSON.stringify(organization).includes('owner@test.invalid'), false)
  assert.equal((await (await create(request('/api/organizations', 'POST', 'org-owner', body))).json()).idempotent, true)
  assert.equal((await create(request('/api/organizations', 'POST', 'org-owner', { ...body, name: 'Changed' }))).status, 409)
  assert.equal((await (await list(request('/api/organizations', 'GET', 'org-outsider'))).json()).organizations.length, 0)
  const params = { params: Promise.resolve({ id: organization.id }) }
  assert.equal((await inspect(request(`/api/organizations/${organization.id}`, 'GET', 'org-outsider'), params)).status, 404)
  const path = `/api/organizations/${organization.id}/agents`
  assert.equal((await assign(request(path, 'PUT', 'org-outsider', { agent_id: 'org-agent', cost_center: 'ENG' }), params)).status, 404)
  assert.equal((await assign(request(path, 'PUT', 'org-owner', { agent_id: 'other-agent', cost_center: 'ENG' }), params)).status, 403)
  assert.equal((await assign(request(path, 'PUT', 'org-owner', { agent_id: 'org-agent', cost_center: 'ENG' }), params)).status, 200)
  assert.equal((await (await assign(request(path, 'PUT', 'org-owner', { agent_id: 'org-agent', cost_center: 'ENG' }), params)).json()).idempotent, true)
  assert.equal((await assign(request(path, 'PUT', 'org-owner', { agent_id: 'org-agent', cost_center: 'OPS' }), params)).status, 409)
  const detail = await (await inspect(request(`/api/organizations/${organization.id}`, 'GET', 'org-owner'), params)).json()
  assert.equal(detail.assignments.length, 1)
  assert.equal(detail.audit.length, 2)
  assert.equal(JSON.stringify(detail).includes('owner@test.invalid'), false)
  assert.equal((await unassign(request(path, 'DELETE', 'org-owner', { agent_id: 'org-agent' }), params)).status, 200)
  assert.equal((await (await unassign(request(path, 'DELETE', 'org-owner', { agent_id: 'org-agent' }), params)).json()).idempotent, true)
  assert.equal((await db.select().from(schema.organization_audit_events)).filter((row) => row.organization_id === organization.id).length, 3)
  assert.equal((await db.select().from(schema.trades)).length, 0)
})
