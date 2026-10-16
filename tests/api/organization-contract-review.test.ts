import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { reviewedContractFixture } from '../helpers/reviewed-contract-fixture'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let collection: typeof import('@/app/api/organizations/[id]/contract-authorizations/route')
let item: typeof import('@/app/api/organizations/[id]/contract-authorizations/[authorizationId]/route')
let approval: typeof import('@/app/api/organizations/[id]/contract-authorizations/[authorizationId]/approval/route')
let jwt: typeof import('@/lib/auth').generateJWT
const treasuryKey = `0x${'99'.repeat(32)}` as const
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-contract-review-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'review.db')}`, TURSO_AUTH_TOKEN: '', JWT_SECRET: 'contract-review-fixture-only',
    AGENT_API_KEY_PEPPER: 'contract-review-fixture-only', WEBHOOK_SECRET_KEY: 'contract-review-fixture-only', CHAT_ENCRYPTION_KEY: 'contract-review-fixture-only',
    CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true', TREASURY_ADDRESS: privateKeyToAccount(treasuryKey).address,
    EVM_SETTLEMENT_PRIVATE_KEY: treasuryKey, EVM_ACCEPTED_TOKENS: JSON.stringify([{ chainId: 8453, address: `0x${'44'.repeat(20)}`,
      symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, rpcUrl: 'http://127.0.0.1:1' }]),
  })
  delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED; delete process.env.DEV_WALLET_ADDRESS; delete process.env.DEV_FEE_WALLET_ADDRESS
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  collection = await import('@/app/api/organizations/[id]/contract-authorizations/route')
  item = await import('@/app/api/organizations/[id]/contract-authorizations/[authorizationId]/route')
  approval = await import('@/app/api/organizations/[id]/contract-authorizations/[authorizationId]/approval/route')
})
after(async () => { db?.$client.close(); if (directory) await rm(directory, { recursive: true, force: true }) })
function request(path: string, actor: string, method = 'GET', body?: unknown, cookie = false) {
  const token = jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })
  return new NextRequest(`http://localhost${path}`, { method, headers: { 'Content-Type': 'application/json',
    ...(cookie ? { Cookie: `auth-token=${token}` } : { Authorization: `Bearer ${token}` }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
function context(id: string, authorizationId = '') { return { params: Promise.resolve({ id, authorizationId }) } }
async function fixture(reference = true) { return reviewedContractFixture({ db, schema }, reference) }
async function propose(f: Awaited<ReturnType<typeof fixture>>) {
  const response = await collection.POST(request(f.prefix, f.owner, 'POST', f.input), context(f.org))
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  return (await response.json()).authorization
}
function decision(a: any) { return { version: 1, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true } }

test('private contract review freezes original ordered milestones, credit fee/refund terms and an independent organizational reviewer without funding', async () => {
  const f = await fixture(), a = await propose(f)
  assert.equal(a.review_url, `/organizations/${f.org}/contract-authorizations/${a.id}`)
  assert.equal(a.funding_available, false); assert.equal(a.terms.payment.rail, 'credit'); assert.equal(a.terms.payment.redeemable, false)
  assert.equal(a.terms.payment.upfront_fee_minor, 5); assert.equal(a.terms.payment.refundable_principal_minor, 100)
  assert.equal(a.terms.explicit_buyer_acceptance, true); assert.equal(a.terms.automatic_review_window_acceptance, false)
  assert.deepEqual(a.terms.original.milestones.map((m: any) => m.id), f.original.milestones.map((m: any) => m.id))
  assert.equal(a.terms.original.gross_minor, 105); assert.equal(a.cost_center, 'TASK')
  const path = `${f.prefix}/${a.id}`, input = decision(a)
  for (const actor of [f.buyer, f.seller, f.other]) assert.ok((await item.GET(request(path, actor), context(f.org, a.id))).status >= 400)
  assert.equal((await approval.POST(request(path + '/approval', f.owner, 'POST', input), context(f.org, a.id))).status, 403)
  const approved = await approval.POST(request(path + '/approval', f.reviewer, 'POST', input), context(f.org, a.id))
  assert.equal(approved.status, 201); assert.equal((await approved.json()).authorization.state, 'approved')
  assert.equal((await approval.POST(request(path + '/approval', f.reviewer, 'POST', input), context(f.org, a.id))).status, 200)
  const privateRead = await item.GET(request(path, f.reviewer), context(f.org, a.id))
  assert.equal(privateRead.status, 200); assert.equal(privateRead.headers.get('Cache-Control'), 'private, no-store')
  const participant = await (await import('@/app/api/contracts/[id]/route')).GET(request(`/api/contracts/${f.original.contract.id}`, f.owner), { params: Promise.resolve({ id: f.original.contract.id }) })
  assert.equal(participant.status, 403, 'review access cannot read participant-only delivery')
  for (const table of ['credit_entries', 'trades', 'organization_contract_attributions']) {
    assert.equal(Number((await db.$client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n), 0)
  }
})
test('every contract companion state blocks generic funding and exact proposal/decision replay never reopens revocation', async () => {
  const f = await fixture(), a = await propose(f), path = `${f.prefix}/${a.id}`, saved = decision(a)
  const fund = (await import('@/app/api/contracts/[id]/route')).PATCH
  const ordinary = await (await import('@/app/api/contracts/route')).POST(request('/api/contracts', f.buyer, 'POST', {
    client_reference: crypto.randomUUID(), seller_id: f.seller, milestones: [{ title: 'Separate ordinary agreement', amount: .2 }],
  }))
  assert.equal(ordinary.status, 201); const ordinaryId = (await ordinary.json()).contract.id
  for (const state of ['pending', 'approved', 'revoked']) {
    if (state === 'approved') assert.equal((await approval.POST(request(path + '/approval', f.reviewer, 'POST', saved), context(f.org, a.id))).status, 201)
    if (state === 'revoked') assert.equal((await item.DELETE(request(path, f.owner, 'DELETE'), context(f.org, a.id))).status, 200)
    const listed = await (await (await import('@/app/api/contracts/route')).GET(request('/api/contracts', f.buyer))).json()
    assert.equal(listed.contracts.find((c: any) => c.id === f.original.contract.id)?.reviewed_contract, true)
    assert.equal(listed.contracts.find((c: any) => c.id === ordinaryId)?.reviewed_contract, false, 'review presence belongs only to its exact original agreement')
    const participant = await (await import('@/app/api/contracts/[id]/route')).GET(request(`/api/contracts/${f.original.contract.id}`, f.seller), { params: Promise.resolve({ id: f.original.contract.id }) })
    assert.equal(participant.status, 200); assert.equal(participant.headers.get('Cache-Control'), 'private, no-store')
    const privateView = await participant.json()
    assert.equal(privateView.contract.reviewed_contract, true); assert.deepEqual(privateView.viewer, { is_buyer: false, is_seller: true })
    const response = await fund(request(`/api/contracts/${f.original.contract.id}`, f.buyer, 'PATCH', { action: 'fund' }), { params: Promise.resolve({ id: f.original.contract.id }) })
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'CONTRACT_REVIEWED_FUNDING_REQUIRED')
  }
  const replay = await collection.POST(request(f.prefix, f.owner, 'POST', f.input), context(f.org))
  assert.equal(replay.status, 200); assert.equal((await replay.json()).authorization.state, 'revoked')
  const approvalReplay = await approval.POST(request(path + '/approval', f.reviewer, 'POST', saved), context(f.org, a.id))
  assert.equal(approvalReplay.status, 200); assert.equal((await approvalReplay.json()).authorization.state, 'revoked')
  assert.equal((await collection.POST(request(f.prefix, f.owner, 'POST', { ...f.input, client_reference: crypto.randomUUID() }), context(f.org))).status, 409)
  assert.equal((await db.select().from(schema.contracts).where(eq(schema.contracts.id, f.original.contract.id)))[0].state, 'DRAFT')
})

test('ordinary participant inventory remains explicitly unreviewed without inferring an organizational grant', async () => {
  const f = await fixture()
  const api = await import('@/app/api/contracts/route')
  const listed = await (await api.GET(request('/api/contracts', f.buyer))).json()
  assert.equal(listed.contracts.find((c: any) => c.id === f.original.contract.id)?.reviewed_contract, false)
  const detail = await (await import('@/app/api/contracts/[id]/route')).GET(request(`/api/contracts/${f.original.contract.id}`, f.buyer), { params: Promise.resolve({ id: f.original.contract.id }) })
  assert.equal(detail.status, 200); const body = await detail.json()
  assert.equal(body.contract.reviewed_contract, false); assert.deepEqual(body.viewer, { is_buyer: true, is_seller: false })
  assert.equal((await db.select().from(schema.organization_contract_authorizations).where(eq(schema.organization_contract_authorizations.contract_id, f.original.contract.id))).length, 0)
})
test('contract decision rejects current ownership, assignment, reviewer, amount, milestone, acceptance, deadline, seller rail and ban drift', async () => {
  for (const mutation of ['owner', 'assignment', 'reviewer', 'quote', 'milestone', 'acceptance', 'deadline', 'rails', 'ban', 'seller-private', 'department', 'reviewer-ban', 'reviewer-buyer-owner', 'reviewer-seller-owner']) {
    const f = await fixture(), a = await propose(f), path = `${f.prefix}/${a.id}/approval`
    if (mutation === 'owner') await db.update(schema.organizations).set({ owner_account_id: f.other }).where(eq(schema.organizations.id, f.org))
    if (mutation === 'assignment') await db.update(schema.organization_agent_assignments).set({ cost_center: 'CHANGED' }).where(eq(schema.organization_agent_assignments.agent_id, f.buyerAgent))
    if (mutation === 'reviewer') await (await import('@/lib/organization-purchasing')).revokePurchasingRole(f.org, f.owner, f.roleId)
    if (mutation === 'quote') await db.update(schema.contracts).set({ total_amount: 2 }).where(eq(schema.contracts.id, f.original.contract.id))
    if (mutation === 'milestone') await db.update(schema.contract_milestones).set({ title: 'Changed finite work' }).where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
    if (mutation === 'acceptance') await db.update(schema.contract_milestones).set({ acceptance_spec: '{"required_artifacts":["changed"]}' }).where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
    if (mutation === 'deadline') await db.update(schema.contract_milestones).set({ deadline_at: new Date(Date.now() + 300000) }).where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
    if (mutation === 'rails') await db.update(schema.seller_payment_preferences).set({ supported_rails: '["evm"]' }).where(eq(schema.seller_payment_preferences.seller_id, f.seller))
    if (mutation === 'ban') await db.update(schema.users).set({ is_banned: true }).where(eq(schema.users.id, f.buyer))
    if (mutation === 'seller-private') await db.update(schema.agents).set({ visibility: 'private' }).where(eq(schema.agents.id, f.providerAgent))
    if (mutation === 'department') await db.update(schema.organization_teams).set({ status: 'archived' }).where(eq(schema.organization_teams.id, f.team))
    if (mutation === 'reviewer-ban') await db.update(schema.users).set({ is_banned: true }).where(eq(schema.users.id, f.reviewer))
    if (mutation === 'reviewer-buyer-owner') await db.update(schema.agent_owners).set({ userId: f.reviewer }).where(eq(schema.agent_owners.agentId, f.buyerAgent))
    if (mutation === 'reviewer-seller-owner') await db.insert(schema.agent_owners).values({ agentId: f.providerAgent, userId: f.reviewer, establishedBy: 'disposable-fixture' })
    const response = await approval.POST(request(path, f.reviewer, 'POST', decision(a)), context(f.org, a.id))
    assert.ok(response.status >= 400 && response.status < 500, `${mutation}: ${response.status} ${JSON.stringify(await response.clone().json())}`)
    assert.equal((await db.select().from(schema.organization_contract_authorizations).where(eq(schema.organization_contract_authorizations.id, a.id)))[0].state, 'pending')
  }
})
test('contract review refuses reviewer ownership of provider, changed original proposal, unreferenced legacy drafts, CSRF and oversized input', async () => {
  const f = await fixture(), a = await propose(f)
  assert.equal((await collection.POST(request(f.prefix, f.owner, 'POST', { ...f.input, max_lifetime: '3.15' }), context(f.org))).status, 409)
  assert.equal((await collection.GET(request(`${f.prefix}?client_reference=${f.input.client_reference}`, f.owner), context(f.org))).status, 200)
  assert.ok((await collection.GET(request(`${f.prefix}?client_reference=${f.input.client_reference}`, f.reviewer), context(f.org))).status >= 400)
  assert.equal((await approval.POST(request(`${f.prefix}/${a.id}/approval`, f.reviewer, 'POST', decision(a), true), context(f.org, a.id))).status, 403)
  const oversized = await collection.POST(request(f.prefix, f.owner, 'POST', { ...f.input, padding: 'x'.repeat(20000) }), context(f.org))
  assert.equal(oversized.status, 413)
  const legacy = await fixture(false)
  assert.equal((await collection.POST(request(legacy.prefix, legacy.owner, 'POST', legacy.input), context(legacy.org))).status, 409)
  const controlled = await fixture()
  await db.insert(schema.agent_owners).values({ agentId: controlled.providerAgent, userId: controlled.reviewer, establishedBy: 'disposable-fixture' })
  const forbidden = await collection.POST(request(controlled.prefix, controlled.owner, 'POST', controlled.input), context(controlled.org))
  assert.equal(forbidden.status, 403)
  assert.equal((await db.select().from(schema.organization_contract_authorizations).where(eq(schema.organization_contract_authorizations.contract_id, controlled.original.contract.id))).length, 0)
})
test('elapsed review windows cannot invent acceptance for any companion state while ordinary historical policy stays unchanged', async () => {
  const reviewed: string[] = []
  for (const state of ['pending', 'approved', 'revoked']) {
    const f = await fixture(), a = await propose(f), saved = decision(a)
    if (state !== 'pending') await approval.POST(request(`${f.prefix}/${a.id}/approval`, f.reviewer, 'POST', saved), context(f.org, a.id))
    if (state === 'revoked') await item.DELETE(request(`${f.prefix}/${a.id}`, f.owner, 'DELETE'), context(f.org, a.id))
    // State-only maintenance control; no funding or delivery is fabricated as economic proof.
    await db.update(schema.contracts).set({ state: 'AWAITING_REVIEW' }).where(eq(schema.contracts.id, f.original.contract.id))
    await db.update(schema.contract_milestones).set({ state: 'AWAITING_BUYER_REVIEW', updated_at: new Date(Date.now() - 3 * 86400000) })
      .where(eq(schema.contract_milestones.id, f.original.milestones[0].id))
    reviewed.push(f.original.milestones[0].id)
  }
  const legacy = await fixture(false)
  await db.update(schema.contracts).set({ state: 'AWAITING_REVIEW' }).where(eq(schema.contracts.id, legacy.original.contract.id))
  await db.update(schema.contract_milestones).set({ state: 'AWAITING_BUYER_REVIEW', updated_at: new Date(Date.now() - 3 * 86400000) })
    .where(eq(schema.contract_milestones.id, legacy.original.milestones[0].id))
  const previous = process.env.MAINTENANCE_SECRET; process.env.MAINTENANCE_SECRET = 'contract-review-maintenance-fixture-only'
  try {
    const { POST } = await import('@/app/api/contracts/maintenance/route')
    const response = await POST(new NextRequest('http://localhost/api/contracts/maintenance', {
      method: 'POST', headers: { 'x-maintenance-secret': process.env.MAINTENANCE_SECRET },
    }))
    assert.equal(response.status, 200); assert.equal((await response.json()).auto_approved_milestones, 1)
    for (const id of reviewed) assert.equal((await db.select().from(schema.contract_milestones).where(eq(schema.contract_milestones.id, id)))[0].state, 'AWAITING_BUYER_REVIEW')
    assert.equal((await db.select().from(schema.contract_milestones).where(eq(schema.contract_milestones.id, legacy.original.milestones[0].id)))[0].state, 'APPROVED')
    assert.equal(Number((await db.$client.execute('SELECT COUNT(*) AS n FROM credit_entries')).rows[0].n), 0)
  } finally { if (previous === undefined) delete process.env.MAINTENANCE_SECRET; else process.env.MAINTENANCE_SECRET = previous }
})
