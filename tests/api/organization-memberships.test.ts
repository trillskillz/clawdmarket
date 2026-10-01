import test, { after, before } from 'node:test'
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
let assignAgent: typeof import('@/app/api/organizations/[id]/agents/route').PUT
let invite: typeof import('@/app/api/organizations/[id]/invitations/route').POST
let listInvitations: typeof import('@/app/api/organizations/[id]/invitations/route').GET
let targetInvitations: typeof import('@/app/api/organizations/invitations/route').GET
let accept: typeof import('@/app/api/organizations/invitations/[invitationId]/accept/route').POST
let cancel: typeof import('@/app/api/organizations/[id]/invitations/[invitationId]/route').DELETE
let listMembers: typeof import('@/app/api/organizations/[id]/members/route').GET
let revoke: typeof import('@/app/api/organizations/[id]/members/[accountId]/route').DELETE

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-memberships-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'memberships.db')}`
  process.env.JWT_SECRET = 'organization-membership-test-secret'
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'true'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  ;({ POST: createOrganization, GET: listOrganizations } = await import('@/app/api/organizations/route'))
  inspectOrganization = (await import('@/app/api/organizations/[id]/route')).GET
  ;({ GET: listTeams, POST: createTeam } = await import('@/app/api/organizations/[id]/teams/route'))
  assignAgent = (await import('@/app/api/organizations/[id]/agents/route')).PUT
  ;({ GET: listInvitations, POST: invite } = await import('@/app/api/organizations/[id]/invitations/route'))
  targetInvitations = (await import('@/app/api/organizations/invitations/route')).GET
  accept = (await import('@/app/api/organizations/invitations/[invitationId]/accept/route')).POST
  cancel = (await import('@/app/api/organizations/[id]/invitations/[invitationId]/route')).DELETE
  listMembers = (await import('@/app/api/organizations/[id]/members/route')).GET
  revoke = (await import('@/app/api/organizations/[id]/members/[accountId]/route')).DELETE
  await db.insert(schema.users).values([
    { id: 'member-owner', email: 'owner@test.invalid', name: 'Owner', password_hash: 'unused' },
    { id: 'member-target', email: 'target@test.invalid', name: 'Target', password_hash: 'unused' },
    { id: 'member-outsider', email: 'outsider@test.invalid', name: 'Outsider', password_hash: 'unused' },
  ])
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

test('invitation requires target acceptance; viewer reads only limited data; owner revokes', async () => {
  const created = await createOrganization(request('/api/organizations', 'POST', 'member-owner', {
    client_reference: 'membership-org', name: 'Member Org' }))
  assert.equal(created.status, 201)
  const id = (await created.json()).organization.id as string
  const params = { params: Promise.resolve({ id }) }
  const invitesPath = `/api/organizations/${id}/invitations`
  const body = { client_reference: 'invite-1', target_account_id: 'member-target' }
  assert.equal((await invite(request(invitesPath, 'POST', 'member-target', body), params)).status, 404)
  const invited = await invite(request(invitesPath, 'POST', 'member-owner', body), params)
  assert.equal(invited.status, 201, JSON.stringify(await invited.clone().json()))
  const invitationId = (await invited.json()).invitation_id as string
  const spare = await invite(request(invitesPath, 'POST', 'member-owner', {
    client_reference: 'invite-spare', target_account_id: 'member-target',
  }), params)
  const spareId = (await spare.json()).invitation_id as string
  assert.equal((await (await invite(request(invitesPath, 'POST', 'member-owner', body), params)).json()).idempotent, true)
  assert.equal((await invite(request(invitesPath, 'POST', 'member-owner', { ...body, target_account_id: 'member-outsider' }), params)).status, 409)
  assert.equal((await invite(request(invitesPath, 'POST', 'member-owner', { client_reference: 'self', target_account_id: 'member-owner' }), params)).status, 409)
  assert.equal((await invite(request(invitesPath, 'POST', 'member-owner', { client_reference: 'missing', target_account_id: 'missing-account' }), params)).status, 404)
  assert.equal((await (await targetInvitations(request('/api/organizations/invitations', 'GET', 'member-target'))).json()).invitations.length, 2)
  assert.equal((await (await targetInvitations(request('/api/organizations/invitations', 'GET', 'member-outsider'))).json()).invitations.length, 0)
  assert.equal((await listInvitations(request(invitesPath, 'GET', 'member-target'), params)).status, 404)
  assert.equal((await accept(request(`/api/organizations/invitations/${invitationId}/accept`, 'POST', 'member-outsider'),
    { params: Promise.resolve({ invitationId }) })).status, 404)
  const accepted = await accept(request(`/api/organizations/invitations/${invitationId}/accept`, 'POST', 'member-target'),
    { params: Promise.resolve({ invitationId }) })
  assert.equal(accepted.status, 200)
  assert.equal((await accepted.json()).authority, 'read_only')
  assert.equal((await (await accept(request(`/api/organizations/invitations/${invitationId}/accept`, 'POST', 'member-target'),
    { params: Promise.resolve({ invitationId }) })).json()).idempotent, true)
  const shared = await (await listOrganizations(request('/api/organizations', 'GET', 'member-target'))).json()
  assert.equal(shared.organizations[0].role, 'viewer')
  const viewerDetail = await (await inspectOrganization(request(`/api/organizations/${id}`, 'GET', 'member-target'), params)).json()
  assert.equal(viewerDetail.role, 'viewer')
  assert.equal('assignments' in viewerDetail, false)
  assert.equal('audit' in viewerDetail, false)
  assert.equal(JSON.stringify(viewerDetail).includes('member-owner'), false)
  assert.equal((await listTeams(request(`/api/organizations/${id}/teams`, 'GET', 'member-target'), params)).status, 200)
  assert.equal((await createTeam(request(`/api/organizations/${id}/teams`, 'POST', 'member-target', { slug: 'bad', name: 'Bad' }), params)).status, 404)
  assert.equal((await assignAgent(request(`/api/organizations/${id}/agents`, 'PUT', 'member-target', {
    agent_id: 'any-agent', cost_center: 'ENG',
  }), params)).status, 404)
  assert.equal((await listMembers(request(`/api/organizations/${id}/members`, 'GET', 'member-target'), params)).status, 404)
  assert.equal((await (await listMembers(request(`/api/organizations/${id}/members`, 'GET', 'member-owner'), params)).json()).members[0].role, 'viewer')
  const revokeParams = { params: Promise.resolve({ id, accountId: 'member-target' }) }
  const revokePath = `/api/organizations/${id}/members/member-target`
  assert.equal((await revoke(request(revokePath, 'DELETE', 'member-target'), revokeParams)).status, 404)
  assert.equal((await revoke(request(revokePath, 'DELETE', 'member-owner'), revokeParams)).status, 200)
  assert.equal((await (await revoke(request(revokePath, 'DELETE', 'member-owner'), revokeParams)).json()).idempotent, true)
  assert.equal((await inspectOrganization(request(`/api/organizations/${id}`, 'GET', 'member-target'), params)).status, 404)
  assert.equal((await listTeams(request(`/api/organizations/${id}/teams`, 'GET', 'member-target'), params)).status, 404)
  assert.equal((await accept(request(`/api/organizations/invitations/${invitationId}/accept`, 'POST', 'member-target'),
    { params: Promise.resolve({ invitationId }) })).status, 409)
  assert.equal((await accept(request(`/api/organizations/invitations/${spareId}/accept`, 'POST', 'member-target'),
    { params: Promise.resolve({ invitationId: spareId }) })).status, 409)
  const [spareAfterRevoke] = await db.select().from(schema.organization_invitations).where(eq(schema.organization_invitations.id, spareId))
  assert.equal(spareAfterRevoke.status, 'cancelled')
  const reinvited = await invite(request(invitesPath, 'POST', 'member-owner', {
    client_reference: 'invite-again', target_account_id: 'member-target',
  }), params)
  assert.equal(reinvited.status, 201)
  const newId = (await reinvited.json()).invitation_id as string
  assert.equal((await accept(request(`/api/organizations/invitations/${newId}/accept`, 'POST', 'member-target'),
    { params: Promise.resolve({ invitationId: newId }) })).status, 200)
  assert.equal((await inspectOrganization(request(`/api/organizations/${id}`, 'GET', 'member-target'), params)).status, 200)
  assert.equal((await db.select().from(schema.organization_memberships).where(eq(schema.organization_memberships.organization_id, id))).length, 1)
  assert.equal((await db.select().from(schema.trades)).length, 0)
})

test('cancelled and expired invitations cannot create membership', async () => {
  const created = await createOrganization(request('/api/organizations', 'POST', 'member-owner', {
    client_reference: 'cancel-org', name: 'Cancel Org' }))
  const id = (await created.json()).organization.id as string
  const params = { params: Promise.resolve({ id }) }
  const invitesPath = `/api/organizations/${id}/invitations`
  const first = await invite(request(invitesPath, 'POST', 'member-owner', { client_reference: 'cancel', target_account_id: 'member-target' }), params)
  const firstId = (await first.json()).invitation_id as string
  const cancellationPath = `${invitesPath}/${firstId}`
  const cancellationParams = { params: Promise.resolve({ id, invitationId: firstId }) }
  assert.equal((await cancel(request(cancellationPath, 'DELETE', 'member-target'), cancellationParams)).status, 404)
  assert.equal((await cancel(request(cancellationPath, 'DELETE', 'member-owner'), cancellationParams)).status, 200)
  assert.equal((await (await cancel(request(cancellationPath, 'DELETE', 'member-owner'), cancellationParams)).json()).idempotent, true)
  assert.equal((await accept(request(`/api/organizations/invitations/${firstId}/accept`, 'POST', 'member-target'),
    { params: Promise.resolve({ invitationId: firstId }) })).status, 409)
  const second = await invite(request(invitesPath, 'POST', 'member-owner', { client_reference: 'expired', target_account_id: 'member-target' }), params)
  const secondId = (await second.json()).invitation_id as string
  await db.update(schema.organization_invitations).set({ expires_at: new Date(Date.now() - 1) }).where(eq(schema.organization_invitations.id, secondId))
  assert.equal((await accept(request(`/api/organizations/invitations/${secondId}/accept`, 'POST', 'member-target'),
    { params: Promise.resolve({ invitationId: secondId }) })).status, 410)
  assert.equal((await db.select().from(schema.organization_memberships).where(eq(schema.organization_memberships.organization_id, id))).length, 0)
})

test('concurrent invitation acceptance creates one membership and one join event', async () => {
  const created = await createOrganization(request('/api/organizations', 'POST', 'member-owner', {
    client_reference: 'race-org', name: 'Race Org' }))
  const id = (await created.json()).organization.id as string
  const invited = await invite(request(`/api/organizations/${id}/invitations`, 'POST', 'member-owner', {
    client_reference: 'race-invite', target_account_id: 'member-outsider',
  }), { params: Promise.resolve({ id }) })
  const invitationId = (await invited.json()).invitation_id as string
  const path = `/api/organizations/invitations/${invitationId}/accept`
  const params = { params: Promise.resolve({ invitationId }) }
  const results = await Promise.all(Array.from({ length: 3 }, () => accept(request(path, 'POST', 'member-outsider'), params)))
  assert.deepEqual(results.map((result) => result.status), [200, 200, 200])
  const members = await db.select().from(schema.organization_memberships).where(eq(schema.organization_memberships.organization_id, id))
  assert.equal(members.length, 1)
  const events = await db.select().from(schema.organization_audit_events).where(eq(schema.organization_audit_events.organization_id, id))
  assert.equal(events.filter((event) => event.action === 'member_joined').length, 1)
})

test('cancel and accept cannot both win one invitation', async () => {
  const created = await createOrganization(request('/api/organizations', 'POST', 'member-owner', {
    client_reference: 'cancel-race-org', name: 'Cancel Race Org' }))
  const id = (await created.json()).organization.id as string
  const invited = await invite(request(`/api/organizations/${id}/invitations`, 'POST', 'member-owner', {
    client_reference: 'race-invite', target_account_id: 'member-outsider',
  }), { params: Promise.resolve({ id }) })
  const invitationId = (await invited.json()).invitation_id as string
  const [accepted, cancelled] = await Promise.all([
    accept(request(`/api/organizations/invitations/${invitationId}/accept`, 'POST', 'member-outsider'),
      { params: Promise.resolve({ invitationId }) }),
    cancel(request(`/api/organizations/${id}/invitations/${invitationId}`, 'DELETE', 'member-owner'),
      { params: Promise.resolve({ id, invitationId }) }),
  ])
  assert.deepEqual([accepted.status, cancelled.status].sort(), [200, 409])
  const [row] = await db.select().from(schema.organization_invitations).where(eq(schema.organization_invitations.id, invitationId))
  const members = await db.select().from(schema.organization_memberships).where(eq(schema.organization_memberships.organization_id, id))
  assert.equal(members.length, row.status === 'accepted' ? 1 : 0)
})

test('two concurrent invitations cannot create two memberships', async () => {
  const created = await createOrganization(request('/api/organizations', 'POST', 'member-owner', {
    client_reference: 'double-invite-org', name: 'Double Invite Org' }))
  const id = (await created.json()).organization.id as string
  const ids: string[] = []
  for (const reference of ['first', 'second']) {
    const invited = await invite(request(`/api/organizations/${id}/invitations`, 'POST', 'member-owner', {
      client_reference: reference, target_account_id: 'member-outsider',
    }), { params: Promise.resolve({ id }) })
    ids.push((await invited.json()).invitation_id)
  }
  const responses = await Promise.all(ids.map((invitationId) => accept(
    request(`/api/organizations/invitations/${invitationId}/accept`, 'POST', 'member-outsider'),
    { params: Promise.resolve({ invitationId }) },
  )))
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
  const memberships = await db.select().from(schema.organization_memberships).where(eq(schema.organization_memberships.organization_id, id))
  const invitations = await db.select().from(schema.organization_invitations).where(eq(schema.organization_invitations.organization_id, id))
  assert.equal(memberships.length, 1)
  assert.equal(invitations.filter((row) => row.status === 'accepted').length, 1)
})

test('enterprise write flag closes new invitations while private reads remain available', async () => {
  const created = await createOrganization(request('/api/organizations', 'POST', 'member-owner', {
    client_reference: 'flag-org', name: 'Flag Org' }))
  const id = (await created.json()).organization.id as string
  const params = { params: Promise.resolve({ id }) }
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'false'
  try {
    assert.equal((await invite(request(`/api/organizations/${id}/invitations`, 'POST', 'member-owner', {
      client_reference: 'flag-invite', target_account_id: 'member-target',
    }), params)).status, 503)
    assert.equal((await inspectOrganization(request(`/api/organizations/${id}`, 'GET', 'member-owner'), params)).status, 200)
    assert.equal((await db.select().from(schema.organization_invitations).where(eq(schema.organization_invitations.organization_id, id))).length, 0)
  } finally {
    process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'true'
  }
})
