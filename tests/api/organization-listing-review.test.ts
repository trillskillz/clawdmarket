import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { reviewedTaskFixture } from '../helpers/reviewed-task-fixture'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let collection: typeof import('@/app/api/organizations/[id]/listing-authorizations/route')
let item: typeof import('@/app/api/organizations/[id]/listing-authorizations/[authorizationId]/route')
let approval: typeof import('@/app/api/organizations/[id]/listing-authorizations/[authorizationId]/approval/route')
const treasuryKey = `0x${'99'.repeat(32)}` as const, treasury = privateKeyToAccount(treasuryKey).address.toLowerCase()
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-listing-review-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'review.db')}`, TURSO_AUTH_TOKEN: '',
    JWT_SECRET: 'listing-review-fixture-only', AGENT_API_KEY_PEPPER: 'listing-review-pepper-fixture-only',
    TREASURY_ADDRESS: treasury, EVM_SETTLEMENT_PRIVATE_KEY: treasuryKey, MPP_RECIPIENT_ADDRESS: treasury,
    MPP_SECRET_KEY_CURRENT: 'listing-review-mpp-fixture-only-secret', TEMPO_RPC_URL: 'https://rpc.example.invalid',
    CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true', CLAWDMARKET_ROUTE_EXECUTION_ENABLED: 'true', CLAWDMARKET_REUSABLE_SERVICES_ENABLED: 'true',
    EVM_ACCEPTED_TOKENS: JSON.stringify([{ chainId: 1, chainName: 'Listing review fixture', address: `0x${'44'.repeat(20)}`,
      symbol: 'TEST', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: 'https://rpc.example.invalid' }]) })
  for (const name of ['VERCEL', 'VERCEL_ENV', 'CLAWDMARKET_NEW_PAYMENTS_PAUSED', 'DEV_WALLET_ADDRESS', 'DEV_FEE_WALLET_ADDRESS']) delete process.env[name]
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  collection = await import('@/app/api/organizations/[id]/listing-authorizations/route')
  item = await import('@/app/api/organizations/[id]/listing-authorizations/[authorizationId]/route')
  approval = await import('@/app/api/organizations/[id]/listing-authorizations/[authorizationId]/approval/route')
})
after(async () => { db?.$client.close(); if (directory) await rm(directory, { recursive: true, force: true }) })
const context = (id: string, authorizationId = '') => ({ params: Promise.resolve({ id, authorizationId }) })
function request(path: string, actor: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method, headers: { Authorization: `Bearer ${jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })}`,
    'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function fixture(tempo = false) {
  const f = await reviewedTaskFixture({ db, schema }, tempo)
  const [listing] = await db.insert(schema.listings).values({ seller_id: f.seller, category: 'code', title: 'Original public code listing',
    description: 'Deliver the original reviewed code findings.', price_bankr: 1 }).returning()
  const { task_id: _task, winning_bid_id: _bid, ...payment } = f.body
  const body = { ...payment, listing_id: listing.id, buyer_agent_id: f.buyerAgent,
    delivery: { output_format: 'json', acceptance_criteria: ['PRIVATE_LISTING_ACCEPTANCE'], required_json_keys: ['report'], minimum_sources: 0 } }
  const prefix = `/api/organizations/${f.org}/listing-authorizations`
  return { ...f, listing, body, prefix }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function propose(f: Fixture) {
  const response = await collection.POST(request(f.prefix, f.owner, 'POST', f.body), context(f.org))
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  assert.match(response.headers.get('cache-control')!, /private.*no-store/)
  return (await response.json()).authorization
}
const decision = (a: { version: number; authority_hash: string }) => ({ version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true })
async function buy(f: Fixture, actor: string) {
  return (await import('@/app/api/trades/route')).POST(request('/api/trades', actor, 'POST', {
    listing_id: f.listing.id, amount: 1, payment_rail: f.body.payment.rail, client_reference: crypto.randomUUID(),
  }))
}
for (const tempo of [false, true]) test(`${tempo ? 'Tempo' : 'L1'} listing review freezes private terms, denies unrelated readers and recovers original decisions without any checkout`, async () => {
  const f = await fixture(tempo), a = await propose(f), saved = decision(a), ctx = context(f.org, a.id), path = `${f.prefix}/${a.id}`
  assert.equal(a.checkout_available, false); assert.equal(a.terms.explicit_acceptance, true); assert.equal(a.terms.total_minor, 105)
  const recovered = await collection.GET(request(`${f.prefix}?client_reference=${f.body.client_reference}`, f.owner), context(f.org))
  assert.equal(recovered.status, 200); assert.equal((await recovered.json()).authorization.id, a.id)
  const replay = await collection.POST(request(f.prefix, f.owner, 'POST', f.body), context(f.org)); assert.equal(replay.status, 200)
  for (const actor of [f.other, f.buyer, f.seller]) {
    const denied = await item.GET(request(path, actor), ctx); assert.ok([401, 404].includes(denied.status)); assert.doesNotMatch(await denied.text(), /PRIVATE_LISTING_ACCEPTANCE|payer_address/)
  }
  assert.equal((await approval.POST(request(path + '/approval', f.owner, 'POST', saved), ctx)).status, 403)
  assert.equal((await approval.POST(request(path + '/approval', f.reviewer, 'POST', saved), ctx)).status, 201)
  assert.equal((await approval.POST(request(path + '/approval', f.reviewer, 'POST', saved), ctx)).status, 200)
  const denied = await buy(f, f.buyer); assert.equal(denied.status, 409); assert.equal((await denied.json()).error_code, 'LISTING_REVIEWED_CHECKOUT_REQUIRED')
  const revoked = await item.DELETE(request(path, f.owner, 'DELETE'), ctx); assert.equal(revoked.status, 200)
  const original = await approval.POST(request(path + '/approval', f.reviewer, 'POST', saved), ctx)
  assert.equal(original.status, 200); assert.equal((await original.json()).authorization.state, 'revoked')
  assert.equal((await buy(f, f.buyer)).status, 409)
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.listing_id, f.listing.id))).length, 0)
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, f.listing.id)))[0].status, 'active')
})
for (const tempo of [false, true]) test(`${tempo ? 'Tempo' : 'L1'} free pending review keeps public inventory available to another buyer and then loses fresh approval eligibility`, async () => {
  const f = await fixture(tempo), a = await propose(f)
  const publicResponse = await (await import('@/app/api/listings/route')).GET(new NextRequest(`http://localhost/api/listings?seller_id=${f.seller}&status=active`))
  assert.equal(publicResponse.status, 200); assert.equal(JSON.stringify(await publicResponse.json()).includes(f.listing.id), true)
  const bought = await buy(f, f.other); assert.equal(bought.status, 201, JSON.stringify(await bought.clone().json()))
  const approve = await approval.POST(request(`${f.prefix}/${a.id}/approval`, f.reviewer, 'POST', decision(a)), context(f.org, a.id))
  assert.equal(approve.status, 409)
  assert.equal((await db.select().from(schema.organization_listing_authorizations).where(eq(schema.organization_listing_authorizations.id, a.id)))[0].state, 'pending')
  const trades = await db.select().from(schema.trades).where(eq(schema.trades.listing_id, f.listing.id)); assert.equal(trades.length, 1); assert.equal(trades[0].buyer_id, f.other)
})
test('different buyers may review one public listing concurrently without taking inventory or creating financial identities', async () => {
  const first = await fixture(), second = await fixture(), a = await propose(first)
  second.body.listing_id = first.listing.id
  const b = await propose(second); assert.notEqual(a.id, b.id)
  assert.equal((await db.select().from(schema.organization_listing_authorizations).where(eq(schema.organization_listing_authorizations.listing_id, first.listing.id))).length, 2)
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.listing_id, first.listing.id))).length, 0)
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, first.listing.id)))[0].status, 'active')
})
for (const tempo of [false, true]) test(`${tempo ? 'Tempo' : 'L1'} listing approval rejects current owner, quote, department, reviewer, seller and ban drift`, async () => {
  for (const mutation of ['owner', 'quote', 'department', 'reviewer', 'seller', 'ban', 'rails']) {
    const f = await fixture(tempo), a = await propose(f)
    if (mutation === 'owner') await db.update(schema.organizations).set({ owner_account_id: f.other }).where(eq(schema.organizations.id, f.org))
    if (mutation === 'quote') await db.update(schema.listings).set({ price_bankr: 2 }).where(eq(schema.listings.id, f.listing.id))
    if (mutation === 'department') await db.update(schema.organization_agent_assignments).set({ cost_center: 'CHANGED' }).where(eq(schema.organization_agent_assignments.agent_id, f.buyerAgent))
    if (mutation === 'reviewer') await (await import('@/lib/organization-purchasing')).revokePurchasingRole(f.org, f.owner, f.roleId)
    if (mutation === 'seller') await db.update(schema.agents).set({ visibility: 'private' }).where(eq(schema.agents.id, f.providerAgent))
    if (mutation === 'ban') await db.update(schema.users).set({ is_banned: true }).where(eq(schema.users.id, f.owner))
    if (mutation === 'rails') await db.insert(schema.seller_payment_preferences).values({ seller_id: f.seller, supported_rails: '[]', confirmed_by: 'local-test-seller', confirmed_at: new Date().toISOString() })
    const response = await approval.POST(request(`${f.prefix}/${a.id}/approval`, f.reviewer, 'POST', decision(a)), context(f.org, a.id))
    assert.equal(response.status, ['owner', 'reviewer'].includes(mutation) ? 403 : 409, `${mutation}: ${JSON.stringify(await response.clone().json())}`)
    assert.equal((await db.select().from(schema.organization_listing_authorizations).where(eq(schema.organization_listing_authorizations.id, a.id)))[0].state, 'pending')
    assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.listing_id, f.listing.id))).length, 0)
  }
})
test('listing review refuses conflicting original references, overlarge bodies and cookie mutations without CSRF', async () => {
  const f = await fixture(); await propose(f)
  const changed = await collection.POST(request(f.prefix, f.owner, 'POST', { ...f.body, delivery: { ...f.body.delivery, required_json_keys: ['changed'] } }), context(f.org))
  assert.equal(changed.status, 409)
  const huge = await collection.POST(request(f.prefix, f.owner, 'POST', { ...f.body, padding: 'x'.repeat(20000) }), context(f.org)); assert.equal(huge.status, 413)
  const cookie = new NextRequest(`http://localhost${f.prefix}`, { method: 'POST', headers: { Cookie: `auth-token=${jwt({ userId: f.owner, email: `${f.owner}@test.invalid`, role: 'human' })}`,
    'Content-Type': 'application/json' }, body: JSON.stringify(f.body) })
  assert.equal((await collection.POST(cookie, context(f.org))).status, 403)
})
