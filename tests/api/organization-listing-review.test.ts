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
import { reviewedSharedService } from '../helpers/reviewed-shared-service'
import { createHash } from 'node:crypto'
import { canonicalContract } from '@/lib/structured-verification'

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
    CLAWDMARKET_ROUTE_PLANNING_ENABLED: 'true', CLAWDMARKET_WORKFLOW_PLANNING_ENABLED: 'true', CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED: 'true',
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
async function fixture(tempo = false, registeredIds = false) {
  const f = await reviewedTaskFixture({ db, schema }, tempo, false, registeredIds)
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
  assert.equal(a.checkout_available, true); assert.equal(a.terms.explicit_acceptance, true); assert.equal(a.terms.total_minor, 105)
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

async function originalUseFixture(tempo: boolean) {
  // Stored-evidence fixtures only. No reviewed checkout API or live payment exists yet.
  const f = await fixture(tempo), a = await propose(f), input = decision(a)
  assert.equal((await approval.POST(request(`${f.prefix}/${a.id}/approval`, f.reviewer, 'POST', input), context(f.org, a.id))).status, 201)
  const originalReference = crypto.randomUUID()
  const digest = (value: unknown) => createHash('sha256').update(canonicalContract(value)).digest('hex')
  const trade = await db.transaction(async tx => {
    await tx.update(schema.listings).set({ status: 'sold' }).where(eq(schema.listings.id, f.listing.id))
    const [trade] = await tx.insert(schema.trades).values({ listing_id: f.listing.id, buyer_id: f.buyer, seller_id: f.seller,
      amount: 1, fee: 0.05, item_price: 1, platform_fee: 0.05, total_cost: 1.05, seller_amount: 1, dev_amount: 0.05,
      payment_rail: f.body.payment.rail as 'evm' | 'mpp', client_reference: `organization-listing:${a.id}`, status: 'pending' }).returning()
    await tx.insert(schema.organization_trade_attributions).values({ trade_id: trade.id, organization_id: f.org, agent_id: f.buyerAgent,
      team_id: f.team, cost_center: 'TASK', total_minor: 105, created_at: new Date() })
    await tx.insert(schema.organization_listing_uses).values({ authorization_id: a.id, listing_id: f.listing.id, trade_id: trade.id,
      authority_hash: a.authority_hash, client_reference: originalReference,
      request_hash: digest({ version: a.version, client_reference: originalReference, authority_hash: a.authority_hash }),
      amount_minor: 105, chain_id: f.body.payment.chain_id,
      fee_token_address: tempo ? f.body.payment.token_address : null, fee_token_decimals: tempo ? 6 : 18,
      maximum_chain_fee_units: tempo ? '5000' : '100000000000000', created_at: new Date() })
    return trade
  })
  return { ...f, a, trade }
}

for (const tempo of [false, true]) test(`${tempo ? 'Tempo' : 'L1'} original listing use retains frozen economics after cancellation, revocation and editable listing changes`, async () => {
  const f = await originalUseFixture(tempo)
  const { originalListingPayment, organizationListingExposure } = await import('@/lib/organization-listing-uses')
  const { genericListingFundingGuard } = await import('@/lib/organization-listing-authorizations')
  const original = await originalListingPayment(db, f.trade.id)
  assert.equal(original?.trade.id, f.trade.id)
  assert.equal(original?.terms.listing.item_price_usd, 1)
  const expectedFee = tempo ? 5000n : 100000000000000n
  const before = await organizationListingExposure(db, f.org, f.buyer, f.body.payment as Parameters<typeof organizationListingExposure>[3])
  assert.equal(before.lifetime, 105); assert.equal(tempo ? before.fees : before.gas, expectedFee)
  await db.update(schema.trades).set({ status: 'cancelled' }).where(eq(schema.trades.id, f.trade.id))
  await db.update(schema.listings).set({ status: 'active', price_bankr: 9, title: 'Edited listing', seller_id: f.owner }).where(eq(schema.listings.id, f.listing.id))
  assert.equal((await item.DELETE(request(`${f.prefix}/${f.a.id}`, f.owner, 'DELETE'), context(f.org, f.a.id))).status, 200)
  assert.equal((await originalListingPayment(db, f.trade.id))?.terms.listing.seller_id, f.seller)
  assert.deepEqual(await organizationListingExposure(db, f.org, f.buyer, f.body.payment as Parameters<typeof organizationListingExposure>[3]), before)
  for (const buyer of [f.buyer, f.other]) await assert.rejects(genericListingFundingGuard(db, f.listing.id, buyer), /LISTING_ORIGINAL_CHECKOUT_REQUIRED/)
  await db.update(schema.organization_listing_uses).set({ maximum_chain_fee_units: '0' }).where(eq(schema.organization_listing_uses.trade_id, f.trade.id))
  await assert.rejects(originalListingPayment(db, f.trade.id), /ORGANIZATION_LISTING_USE_INVALID/)
  await assert.rejects(organizationListingExposure(db, f.org, f.buyer, f.body.payment as Parameters<typeof organizationListingExposure>[3]), /ORGANIZATION_LISTING_USE_INVALID/)
})

for (const tempo of [false, true]) test(`${tempo ? 'Tempo' : 'L1'} consumed listing exposure blocks another reviewed task and cross-scope/orphan records fail closed`, async () => {
  const f = await originalUseFixture(tempo), tasks = await import('@/lib/organization-task-authorizations')
  const { listing_id: _listing, buyer_agent_id: _buyer, delivery: _delivery, ...body } = f.body
  const task = (await tasks.proposeOrganizationTask(f.org, f.owner, tasks.organizationTaskInput.parse({ ...body,
    task_id: f.task, winning_bid_id: f.bid, max_daily: '1.05', max_monthly: '1.05', max_lifetime: '1.05' }))).authorization
  await tasks.approveOrganizationTask(f.org, task.id, f.reviewer, { version: task.version, client_reference: crypto.randomUUID(), authority_hash: task.authority_hash, approve: true })
  await assert.rejects(tasks.checkoutOrganizationTask(f.org, task.id, f.buyer, { version: task.version, client_reference: crypto.randomUUID(), authority_hash: task.authority_hash }), /ORGANIZATION_TASK_DAILY_EXPOSURE/)
  assert.equal((await db.select().from(schema.organization_task_uses).where(eq(schema.organization_task_uses.task_id, f.task))).length, 0)
  const { originalListingPayment, organizationListingExposure } = await import('@/lib/organization-listing-uses')
  await db.update(schema.task_workspaces).set({ trade_id: f.trade.id }).where(eq(schema.task_workspaces.task_id, f.task))
  await assert.rejects(originalListingPayment(db, f.trade.id), /ORGANIZATION_LISTING_USE_INVALID/)
  await db.update(schema.task_workspaces).set({ trade_id: null }).where(eq(schema.task_workspaces.task_id, f.task))
  await db.delete(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.trade_id, f.trade.id))
  await assert.rejects(originalListingPayment(db, f.trade.id), /ORGANIZATION_LISTING_USE_INVALID/)
  await assert.rejects(organizationListingExposure(db, f.org, f.buyer, f.body.payment as Parameters<typeof organizationListingExposure>[3]), /ORGANIZATION_LISTING_USE_INVALID/)
})

for (const tempo of [false, true]) for (const family of ['route', 'workflow'] as const) for (const ceiling of ['gross', 'fee'] as const)
  test(`${tempo ? 'Tempo' : 'L1'} consumed listing ${ceiling} exposure blocks ${family} reservation and remains charged after cancellation`, async () => {
    const f = await originalUseFixture(tempo), perFee = tempo ? '5000' : '100000000000000'
    const gross = ceiling === 'gross' ? '1.05' : '10.00', fee = ceiling === 'fee' ? perFee : (BigInt(perFee) * 10n).toString()
    const attempt = async () => {
      try {
        const execute = await reviewedSharedService({ db, schema }, (path, actor, body) => request(path, actor, 'POST', body), f, family, gross, fee)
        return await execute()
      } catch (error) {
        if (!(error instanceof Error && 'code' in error)) throw error
        return { status: 'status' in error ? error.status : 409, code: String(error.code), trade: undefined }
      }
    }
    for (const cancelled of [false, true]) {
      if (cancelled) {
        await db.update(schema.trades).set({ status: 'cancelled' }).where(eq(schema.trades.id, f.trade.id))
        await db.update(schema.listings).set({ status: 'active' }).where(eq(schema.listings.id, f.listing.id))
      }
      const denied = await attempt()
      assert.equal(denied.status, 409, JSON.stringify(denied))
      assert.match(denied.code, ceiling === 'gross' ? /GROSS_LIMIT/ : /(?:GAS|FEE(?:_TOKEN)?)_LIMIT/)
      assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))).length, 1)
      assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.buyer_id, f.buyer))).length, 0)
    }
  })

test('reviewed route reads expose local contention as retryable without retrying writes or hiding policy and other storage errors', async () => {
  const { validateOrganizationRouteAuthority } = await import('@/lib/organization-route-authorizations')
  const { PurchasingError } = await import('@/lib/organization-purchasing-transaction')
  type Args = Parameters<typeof validateOrganizationRouteAuthority>
  let attempts = 0
  const readFailure = (error: Error) => validateOrganizationRouteAuthority({ select: () => { attempts++; throw error } } as unknown as Args[0], {} as Args[1], {} as Args[2])
  const busy = new Error('Failed query', { cause: new Error('SQLITE_BUSY: database is locked') })
  await assert.rejects(readFailure(busy), error => (error as { code: string; status: number }).code === 'PURCHASING_STORAGE_BUSY' && (error as { status: number }).status === 503)
  assert.equal(attempts, 1, 'the caller recovers the same original operation; this guard does not retry a financial callback')
  const unrelated = new Error('SQLITE_CORRUPT: malformed database')
  await assert.rejects(readFailure(unrelated), error => error === unrelated)
  await assert.rejects(readFailure(new PurchasingError('REVIEWER_REQUIRED', 403)), error => (error as { code: string; status: number }).code === 'REVIEWER_REQUIRED' && (error as { status: number }).status === 403)
})

for (const tempo of [false, true]) test(`${tempo ? 'Tempo' : 'L1'} internal listing checkout consumes one exact original trade and replays after all fresh permissions close`, async () => {
  const f = await fixture(tempo), a = await propose(f)
  const domain = await import('@/lib/organization-listing-checkout')
  const body = { version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash }
  await assert.rejects(domain.checkoutOrganizationListing(f.org, a.id, f.buyer, body), /ORGANIZATION_LISTING_APPROVAL_REQUIRED/)
  await assert.rejects(domain.inspectOrganizationListingCheckout(f.org, a.id, f.owner), /ORGANIZATION_LISTING_NOT_FOUND/)
  assert.equal((await domain.inspectOrganizationListingCheckout(f.org, a.id, f.buyer)).trade, null)
  assert.equal((await approval.POST(request(`${f.prefix}/${a.id}/approval`, f.reviewer, 'POST', decision(a)), context(f.org, a.id))).status, 201)
  const results = await Promise.all([domain.checkoutOrganizationListing(f.org, a.id, f.buyer, body), domain.checkoutOrganizationListing(f.org, a.id, f.buyer, body)])
  assert.deepEqual(results.map(value => value.created).sort(), [false, true])
  const trade = results[0].trade!
  assert.equal(results[1].trade?.id, trade.id)
  assert.equal(trade.listing_id, f.listing.id)
  assert.equal(trade.total_cost, 1.05)
  assert.equal(results[0].payment_authority.kind, tempo ? 'organization_listing_v2' : 'organization_listing_v1')
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, trade.id))).length, 0)
  assert.equal((await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.listing_id, f.listing.id))).length, 1)
  await assert.rejects(domain.checkoutOrganizationListing(f.org, a.id, f.buyer, { ...body, client_reference: crypto.randomUUID() }), /ORGANIZATION_LISTING_CHECKOUT_CONFLICT/)
  await db.update(schema.listings).set({ status: 'active', title: 'Edited after original checkout', price_bankr: 5 }).where(eq(schema.listings.id, f.listing.id))
  await db.update(schema.trades).set({ status: 'cancelled' }).where(eq(schema.trades.id, trade.id))
  await db.insert(schema.seller_payment_preferences).values({ seller_id: f.seller, supported_rails: '[]', confirmed_by: 'test-seller', confirmed_at: new Date().toISOString() })
  assert.equal((await item.DELETE(request(`${f.prefix}/${a.id}`, f.owner, 'DELETE'), context(f.org, a.id))).status, 200)
  process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED = 'true'
  try {
    const replay = await domain.checkoutOrganizationListing(f.org, a.id, f.buyer, body)
    assert.equal(replay.created, false); assert.equal(replay.trade?.id, trade.id); assert.equal(replay.trade?.status, 'cancelled')
    assert.equal((await domain.inspectOrganizationListingCheckout(f.org, a.id, f.buyer)).trade?.id, trade.id)
  } finally { delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED }
})

test('a legacy buyer-supplied reference prefix does not acquire reviewed scope or block original financial recovery', async () => {
  const f = await fixture()
  const [trade] = await db.insert(schema.trades).values({ listing_id: f.listing.id, buyer_id: f.buyer, seller_id: f.seller,
    amount: 1, fee: 0.05, total_cost: 1.05, payment_rail: 'evm', client_reference: 'organization-listing:legacy-customer-reference', status: 'pending' }).returning()
  await db.insert(schema.organization_trade_attributions).values({ trade_id: trade.id, organization_id: f.org, agent_id: f.buyerAgent,
    team_id: f.team, cost_center: 'TASK', total_minor: 105, created_at: new Date() })
  const { originalListingPayment, organizationListingExposure } = await import('@/lib/organization-listing-uses')
  assert.equal(await originalListingPayment(db, trade.id), null)
  assert.equal((await organizationListingExposure(db, f.org, f.buyer, f.body.payment as Parameters<typeof organizationListingExposure>[3])).lifetime, 0)
  assert.equal((await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.trade_id, trade.id))).length, 0)
})

for (const tempo of [false, true]) test(`${tempo ? 'Tempo' : 'L1'} reviewed task, route, workflow and internal listing checkout preserve registry-format agent identifiers`, async () => {
  const f = await fixture(tempo, true)
  assert.match(f.buyerAgent, /^agent_[a-f0-9-]{36}$/)
  const tasks = await import('@/lib/organization-task-authorizations')
  const { listing_id: _listing, buyer_agent_id: _buyer, delivery: _delivery, ...terms } = f.body
  const task = (await tasks.proposeOrganizationTask(f.org, f.owner, tasks.organizationTaskInput.parse({ ...terms,
    task_id: f.task, winning_bid_id: f.bid }))).authorization
  await tasks.approveOrganizationTask(f.org, task.id, f.reviewer, { version: task.version, client_reference: crypto.randomUUID(), authority_hash: task.authority_hash, approve: true })
  const taskTrade = (await tasks.checkoutOrganizationTask(f.org, task.id, f.buyer, { version: task.version, client_reference: crypto.randomUUID(), authority_hash: task.authority_hash })).trade!
  assert.equal(taskTrade.buyer_id, `user_agent_${f.buyerAgent}`)
  const a = await propose(f)
  assert.equal((await approval.POST(request(`${f.prefix}/${a.id}/approval`, f.reviewer, 'POST', decision(a)), context(f.org, a.id))).status, 201)
  const { checkoutOrganizationListing } = await import('@/lib/organization-listing-checkout')
  const original = await checkoutOrganizationListing(f.org, a.id, f.buyer, { version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash })
  assert.equal(original.trade?.buyer_id, `user_agent_${f.buyerAgent}`)
  assert.equal(original.trade?.seller_id, `user_agent_${f.providerAgent}`)
  assert.notEqual(original.trade?.id, taskTrade.id)
  for (const family of ['route', 'workflow'] as const) {
    const execute = await reviewedSharedService({ db, schema }, (path, actor, body) => request(path, actor, 'POST', body), f, family, '10.00', f.body.max_lifetime_chain_fee_units)
    const result = await execute()
    assert.equal(result.status, 201, JSON.stringify(result))
    assert.equal(result.trade.buyer_id, f.buyer)
    assert.equal(result.trade.seller_id, f.seller)
  }
})

for (const tempo of [false, true]) for (const family of ['task', 'route', 'workflow'] as const) for (const ceiling of ['gross', 'fee'] as const)
  test(`${tempo ? 'Tempo' : 'L1'} internal listing reservation cannot bypass prior ${family} ${ceiling} exposure or recycle its cancelled obligation`, async () => {
    const f = await fixture(tempo), perFee = tempo ? '5000' : '100000000000000'
    const gross = ceiling === 'gross' ? '1.05' : '10.00', fee = ceiling === 'fee' ? perFee : (BigInt(perFee) * 10n).toString()
    f.body.max_daily = gross; f.body.max_monthly = gross; f.body.max_lifetime = gross; f.body.max_lifetime_chain_fee_units = fee
    const a = await propose(f)
    assert.equal((await approval.POST(request(`${f.prefix}/${a.id}/approval`, f.reviewer, 'POST', decision(a)), context(f.org, a.id))).status, 201)
    let originalTrade: string
    if (family === 'task') {
      const tasks = await import('@/lib/organization-task-authorizations')
      const { listing_id: _listing, buyer_agent_id: _buyer, delivery: _delivery, ...terms } = f.body
      const task = (await tasks.proposeOrganizationTask(f.org, f.owner, tasks.organizationTaskInput.parse({ ...terms, client_reference: crypto.randomUUID(),
        task_id: f.task, winning_bid_id: f.bid, max_daily: '10.00', max_monthly: '10.00', max_lifetime: '10.00', max_lifetime_chain_fee_units: (BigInt(perFee) * 10n).toString() }))).authorization
      await tasks.approveOrganizationTask(f.org, task.id, f.reviewer, { version: task.version, client_reference: crypto.randomUUID(), authority_hash: task.authority_hash, approve: true })
      originalTrade = (await tasks.checkoutOrganizationTask(f.org, task.id, f.buyer, { version: task.version, client_reference: crypto.randomUUID(), authority_hash: task.authority_hash })).trade!.id
    } else {
      const execute = await reviewedSharedService({ db, schema }, (path, actor, body) => request(path, actor, 'POST', body), f, family, '10.00', (BigInt(perFee) * 10n).toString())
      const original = await execute(); assert.equal(original.status, 201, JSON.stringify(original)); originalTrade = original.trade.id
    }
    const { checkoutOrganizationListing } = await import('@/lib/organization-listing-checkout')
    const checkout = { version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash }
    const expected = ceiling === 'gross' ? /ORGANIZATION_LISTING_DAILY_EXPOSURE/ : /ORGANIZATION_LISTING_FEE_EXPOSURE/
    await assert.rejects(checkoutOrganizationListing(f.org, a.id, f.buyer, checkout), expected)
    const cancel = await (await import('@/app/api/trades/[id]/cancel/route')).POST(request(`/api/trades/${originalTrade}/cancel`, f.buyer, 'POST', {}), { params: Promise.resolve({ id: originalTrade }) })
    assert.equal(cancel.status, 200, JSON.stringify(await cancel.clone().json()))
    await assert.rejects(checkoutOrganizationListing(f.org, a.id, f.buyer, checkout), expected)
    assert.equal((await db.select().from(schema.organization_listing_uses).where(eq(schema.organization_listing_uses.listing_id, f.listing.id))).length, 0)
    assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, f.listing.id)))[0].status, 'active')
    assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))).length, 1)
  })
