import assert from 'node:assert/strict'
import test, { before, after } from 'node:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let rails: typeof import('@/app/api/payments/seller-rails/route')
let buy: typeof import('@/app/api/trades/route').POST
const treasury = privateKeyToAccount(`0x${'22'.repeat(32)}`)

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-transparency-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'test.db')}`, TURSO_AUTH_TOKEN: '', JWT_SECRET: 'local-transparency-test',
    CHAT_ENCRYPTION_KEY: 'local-transparency-test', WEBHOOK_SECRET_KEY: 'local-transparency-test', TREASURY_ADDRESS: treasury.address, EVM_SETTLEMENT_PRIVATE_KEY: `0x${'22'.repeat(32)}`,
    EVM_ACCEPTED_TOKENS: JSON.stringify([{ chainId: 8453, chainName: 'Disposable Base', address: `0x${'44'.repeat(20)}`, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: 'https://rpc.test.invalid' }]) })
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  await db.$client.executeMultiple(readFileSync('migrations/2026-10-14-marketplace-transparency-v1.sql', 'utf8'))
  jwt = (await import('@/lib/auth')).generateJWT
  rails = await import('@/app/api/payments/seller-rails/route')
  buy = (await import('@/app/api/trades/route')).POST
  await db.insert(schema.users).values(['seller', 'buyer', 'other'].map(id => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused' })))
  await db.insert(schema.wallets).values(['seller', 'buyer', 'other'].map(id => ({ user_id: id, balance: 0, escrow: 0 })))
  await db.insert(schema.payout_addresses).values({ user_id: 'seller', address: treasury.address })
})
after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })
function request(path: string, user: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method, headers: { Authorization: `Bearer ${jwt({ userId: user, email: `${user}@test.invalid`, role: 'human' })}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
}
async function preferences(supported_payment_rails: string[]) {
  const response = await rails.PUT(request('/api/payments/seller-rails', 'seller', 'PUT', { supported_payment_rails }))
  assert.equal(response.status, 200)
  return response.json()
}

test('unconfirmed legacy rails require owner review; settings cannot target another owner agent', async () => {
  const result = await (await rails.GET(request('/api/payments/seller-rails', 'seller'))).json()
  assert.equal(result.payment_rail_review_required, true)
  assert.equal(result.credit_redeemable, false)
  assert.equal(result.supported_payment_rails.includes('credit'), false)
  assert.match(result.settlement_disclosure, /cannot be withdrawn/)
  const forbidden = await rails.PUT(request('/api/payments/seller-rails', 'other', 'PUT', { agent_id: 'seller-agent', supported_payment_rails: ['credit'] }))
  assert.equal(forbidden.status, 403)
  const token = jwt({ userId: 'seller', email: 'seller@test.invalid', role: 'human' })
  const noCsrf = await rails.PUT(new NextRequest('http://localhost/api/payments/seller-rails', { method: 'PUT', headers: { Cookie: `auth-token=${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ supported_payment_rails: ['credit'] }) }))
  assert.equal(noCsrf.status, 403)
})

test('external-only seller rejects credit atomically and automatic checkout honors supported rails', async () => {
  await preferences(['evm'])
  const [listing] = await db.insert(schema.listings).values({ seller_id: 'seller', category: 'analysis', title: 'Disposable API check', description: 'A local test only', price_bankr: 1 }).returning()
  const rejected = await buy(request('/api/trades', 'buyer', 'POST', { listing_id: listing.id, amount: 1, payment_rail: 'credit', client_reference: 'unsupported-credit-test' }))
  assert.equal(rejected.status, 409, JSON.stringify(await rejected.clone().json()))
  assert.equal((await rejected.json()).code, 'SELLER_PAYMENT_RAIL_UNSUPPORTED')
  assert.equal((await db.select().from(schema.trades)).length, 0)
  assert.equal((await db.select().from(schema.credit_entries)).length, 0)
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, listing.id)))[0].status, 'active')
  const created = await buy(request('/api/trades', 'buyer', 'POST', { listing_id: listing.id, amount: 1, payment_rail: 'auto', client_reference: 'original-external-order' }))
  assert.equal(created.status, 201, JSON.stringify(await created.clone().json()))
  const original = await created.json()
  assert.equal(original.trade.payment_rail, 'evm')
  await preferences([])
  const replay = await buy(request('/api/trades', 'buyer', 'POST', { listing_id: listing.id, amount: 1, payment_rail: 'evm', client_reference: 'original-external-order' }))
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).trade.id, original.trade.id)
  assert.equal((await db.select().from(schema.trades)).length, 1)
})

test('transaction-time rail enforcement rolls back an attempted internal debit after preferences change', async () => {
  const [listing] = await db.insert(schema.listings).values({ seller_id: 'seller', category: 'analysis', title: 'Stale policy checkout', description: 'A local test only', price_bankr: 1 }).returning()
  const { createLedgerTrade } = await import('@/lib/settlement')
  await assert.rejects(db.transaction(tx => createLedgerTrade(tx, listing, 'buyer', 'other', { rail: 'credit' })), /seller does not accept/)
  assert.equal((await db.select().from(schema.listings).where(eq(schema.listings.id, listing.id)))[0].status, 'active')
})

test('service checkout and routing honor seller rails and preserve unclaimed capacity', async () => {
  await preferences(['evm'])
  const create = (await import('@/app/api/services/route')).POST
  const response = await create(request('/api/services', 'seller', 'POST', {
    title: 'Disposable API fixture', description: 'Finite local API contract testing', capabilities: ['code-review'],
    pricing: { model: 'fixed', amount: '1.00', currency: 'USD' }, max_concurrency: 1, status: 'active',
  }))
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  const service = (await response.json()).service
  const createOrder = (await import('@/app/api/services/[id]/orders/route')).POST
  const rejected = await createOrder(request(`/api/services/${service.id}/orders`, 'buyer', 'POST', {
    client_reference: 'unsupported-service-credit', objective: 'Check this disposable fixture', input: {}, payment_rail: 'credit',
  }), { params: Promise.resolve({ id: service.id }) })
  assert.equal(rejected.status, 409)
  assert.equal((await rejected.json()).error_code, 'SELLER_PAYMENT_RAIL_UNSUPPORTED')
  assert.equal((await db.select().from(schema.service_orders)).length, 0)
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, service.id)))[0].active_orders, 0)
  const { planRoute, routePlanInput } = await import('@/lib/route-planning')
  const planned = await planRoute(routePlanInput.parse({ client_reference: 'seller-rail-planning', objective: 'Review a disposable code fixture', required_capabilities: ['code-review'], input: {},
    max_budget: { amount: '2.00', currency: 'USD' }, verification: { required: true, methods: ['buyer_review'] }, payment_policy: { allowed_rails: ['mpp', 'evm'] } }), 'buyer')
  assert.ok(planned.candidates.length > 0)
  assert.ok(planned.candidates.every(candidate => candidate.payment_rail === 'evm'))
  const { inspectPilotFunnel } = await import('@/lib/pilot-funnel')
  const funnel = await inspectPilotFunnel([service.id])
  assert.equal(funnel.cohorts.ownership_unverified.checkout, 0)
  assert.equal(funnel.contribution_margin_usd, null)
  assert.equal(funnel.operator_intervention_minutes, null)
  await preferences([])
})

test('task funding rejects an unsupported seller rail before creating a financial obligation', async () => {
  await db.insert(schema.agents).values({ id: 'task-provider', name: 'Task provider', description: 'A disposable test only', capabilities: '[]', endpoint: 'https://example.invalid', owner_address: treasury.address, api_key: 'unused' })
  await db.insert(schema.seller_payment_preferences).values({ seller_id: 'user_agent_task-provider', supported_rails: '["evm"]', confirmed_by: 'test-owner', confirmed_at: new Date().toISOString() })
  await db.insert(schema.tasks).values({ id: 'rail-test-task', posterAgentId: 'buyer', title: 'Disposable task', description: 'Test rail enforcement', budgetUsd: 1, status: 'assigned', assignedAgentId: 'task-provider', winningBidId: 'rail-test-bid' })
  await db.insert(schema.bids).values({ id: 'rail-test-bid', taskId: 'rail-test-task', bidderAgentId: 'task-provider', priceUsd: 1, status: 'accepted' })
  const detail = (await import('@/app/api/tasks/[id]/route')).GET
  const preview = await (await detail(request('/api/tasks/rail-test-task', 'buyer'), { params: Promise.resolve({ id: 'rail-test-task' }) })).json()
  assert.deepEqual(preview.workspace.seller_payment_preferences.supported_payment_rails, ['evm'])
  assert.equal(preview.workspace.seller_payment_preferences.credit_redeemable, false)
  const fund = (await import('@/app/api/tasks/[id]/fund/route')).POST
  const count = (await db.select().from(schema.trades)).length
  const rejected = await fund(request('/api/tasks/rail-test-task/fund', 'buyer', 'POST', { payment_rail: 'credit', expected_total: 1.05 }), { params: Promise.resolve({ id: 'rail-test-task' }) })
  assert.equal(rejected.status, 409)
  assert.equal((await rejected.json()).code, 'SELLER_PAYMENT_RAIL_UNSUPPORTED')
  assert.equal((await db.select().from(schema.trades)).length, count)
  assert.equal((await db.select().from(schema.task_workspaces)).length, 0)
  const accepted = await fund(request('/api/tasks/rail-test-task/fund', 'buyer', 'POST', { payment_rail: 'evm', expected_total: 1.05, client_reference: 'original-task-funnel-checkout' }), { params: Promise.resolve({ id: 'rail-test-task' }) })
  assert.equal(accepted.status, 201, JSON.stringify(await accepted.clone().json()))
  const { inspectPilotFunnel } = await import('@/lib/pilot-funnel')
  const funnel = await inspectPilotFunnel(['rail-test-task'], 'task')
  assert.equal(funnel.selection_kind, 'task')
  assert.equal(funnel.cohorts.ownership_unverified.checkout, 1)
  assert.equal(funnel.cohorts.ownership_unverified.funded, 0)
  assert.equal(funnel.cohorts.ownership_unverified.buyer_accepted, 0)
})

test('cohort identity is operator-attributed, append-only and unknown after independence evidence expires', async () => {
  const { loadMarketplaceCohorts } = await import('@/lib/marketplace-cohorts')
  const ids = ['user_agent_same-name', 'user_agent_unrecognized', 'user_agent_expired']
  await db.insert(schema.marketplace_cohort_attributions).values([
    { id: 'reference-record', principal_id: ids[0], cohort: 'platform_reference', evidence_ref: 'operator-fixture-manifest:test-only', recorded_by: 'test-operator', recorded_at: '2026-10-14T00:00:00Z' },
    { id: 'expired-record', principal_id: ids[2], cohort: 'independence_verified', owner_group: 'test-only-owner', evidence_ref: 'test-only-review', recorded_by: 'test-operator', recorded_at: '2026-10-13T00:00:00Z', expires_at: '2026-10-13T01:00:00Z' },
  ])
  const result = await loadMarketplaceCohorts(ids)
  assert.equal(result.get(ids[0])?.cohort, 'platform_reference')
  assert.equal(result.get(ids[1])?.cohort, 'ownership_unverified')
  assert.equal(result.get(ids[2])?.cohort, 'ownership_unverified')
  await db.insert(schema.agents).values(ids.map((id, index) => ({ id: id.slice(11), name: 'Identical display name', description: 'Identical text', capabilities: '[]', endpoint: 'https://example.invalid', owner_address: '', api_key: `unused-${index}`, lastSeenAt: new Date() })))
  await assert.rejects(db.$client.execute("UPDATE marketplace_cohort_attributions SET cohort='ownership_unverified' WHERE id='reference-record'"), /append-only/)
  await assert.rejects(db.$client.execute("DELETE FROM marketplace_cohort_attributions WHERE id='reference-record'"), /append-only/)
})

test('operator runtime reference IDs override independence records without exposing credentials', async () => {
  const previous = process.env.REFERENCE_FLEET_KEYS_JSON
  const principal = 'user_agent_agent_runtime0001'
  const dummyCredential = `clawd_${'a'.repeat(48)}`
  await db.insert(schema.marketplace_cohort_attributions).values({ id: 'runtime-reference-record', principal_id: principal, cohort: 'independence_verified', owner_group: 'test-only', evidence_ref: 'test-only-review', recorded_by: 'test-operator', recorded_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() })
  process.env.REFERENCE_FLEET_KEYS_JSON = JSON.stringify({ version: 1, agents: { 'atlas-research': { agent_id: 'agent_runtime0001', presence_key: dummyCredential } } })
  try {
    const { loadMarketplaceCohorts } = await import('@/lib/marketplace-cohorts')
    const result = (await loadMarketplaceCohorts([principal])).get(principal)
    assert.equal(result?.cohort, 'platform_reference')
    assert.equal(JSON.stringify(result).includes(dummyCredential), false)
  } finally { if (previous === undefined) delete process.env.REFERENCE_FLEET_KEYS_JSON; else process.env.REFERENCE_FLEET_KEYS_JSON = previous }
})

test('public statistics distinguish inventory and ownership; storage failure returns unavailable without zero counts', async () => {
  const { getMarketStats } = await import('@/lib/market-stats')
  const stats = await getMarketStats()
  assert.equal(stats.services_listed, stats.listings_total)
  assert.equal(stats.services_online, stats.listings_active)
  assert.equal(stats.tasks_routed, stats.tasks_assigned)
  assert.equal(stats.executable_reusable_services, 0)
  assert.equal(stats.cohort_counts.platform_reference.registered, 1)
  assert.equal(stats.cohort_counts.platform_reference.recently_online, 1)
  assert.equal(stats.cohort_counts.ownership_unverified.registered, 3)
  assert.equal(stats.economic_adoption.independently_attributed_volume_usd, 0)
  assert.equal(stats.data_status, 'available')
  assert.ok(stats.observed_at)
  const { GET } = await import('@/app/api/stats/route')
  await db.$client.execute('ALTER TABLE listings RENAME TO unavailable_listings')
  try {
    const response = await GET()
    assert.equal(response.status, 503)
    const data = await response.json()
    assert.equal(data.data_status, 'unavailable')
    assert.equal(data.observed_at, null)
    assert.equal(data.completed_trades, undefined)
    assert.equal(data.recorded_volume_usd, undefined)
  } finally { await db.$client.execute('ALTER TABLE unavailable_listings RENAME TO listings') }
})

test('an ownership transfer invalidates prior independence attribution without rewriting its history', async () => {
  const previous = new Date(Date.now() - 120_000), reviewed = new Date(Date.now() - 60_000).toISOString()
  const principal = 'user_agent_ownership-liveness'
  await db.insert(schema.agents).values({ id: 'ownership-liveness', name: 'Ownership liveness fixture', description: 'Disposable local test', capabilities: '[]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused', created_at: previous })
  await db.insert(schema.agent_owners).values({ agentId: 'ownership-liveness', userId: 'seller', establishedBy: 'local-test', establishedAt: previous, updatedAt: previous })
  await db.insert(schema.marketplace_cohort_attributions).values([
    { id: 'ownership-liveness-review', principal_id: principal, cohort: 'independence_verified', owner_group: 'local-provider-group', evidence_ref: 'local-test-review', recorded_by: 'test-operator', recorded_at: reviewed, expires_at: new Date(Date.now() + 86_400_000).toISOString() },
    { id: 'buyer-liveness-review', principal_id: 'buyer', cohort: 'independence_verified', owner_group: 'local-buyer-group', evidence_ref: 'local-test-review', recorded_by: 'test-operator', recorded_at: reviewed, expires_at: new Date(Date.now() + 86_400_000).toISOString() },
  ])
  const { loadMarketplaceCohorts } = await import('@/lib/marketplace-cohorts')
  const { independentPartiesSql } = await import('@/lib/independent-economic-evidence')
  const qualifies = async () => Number((await db.$client.execute({ sql: `SELECT CASE WHEN ${independentPartiesSql('t')} THEN 1 ELSE 0 END AS qualified FROM (SELECT ? AS buyer_id, ? AS seller_id) t`, args: ['buyer', principal] })).rows[0].qualified)
  assert.equal((await loadMarketplaceCohorts([principal])).get(principal)?.cohort, 'independence_verified')
  assert.equal(await qualifies(), 1)
  await db.update(schema.agent_owners).set({ userId: 'other', updatedAt: new Date() }).where(eq(schema.agent_owners.agentId, 'ownership-liveness'))
  assert.equal((await loadMarketplaceCohorts([principal])).get(principal)?.cohort, 'ownership_unverified')
  assert.equal(await qualifies(), 0)
  assert.equal((await db.select().from(schema.marketplace_cohort_attributions).where(eq(schema.marketplace_cohort_attributions.id, 'ownership-liveness-review')))[0].cohort, 'independence_verified')
})

test('independent volume requires accepted backing and distinct reviewed ownership; controlled attribution never upgrades recorded history', async () => {
  // Disposable stored-evidence fixtures exercise aggregation, not live demand.
  const reviewed = new Date(Date.now() - 5_000).toISOString(), expiry = new Date(Date.now() + 86_400_000).toISOString()
  await db.insert(schema.marketplace_cohort_attributions).values([
    { id: 'economic-buyer-review', principal_id: 'buyer', cohort: 'independence_verified', owner_group: 'local-buyer', evidence_ref: 'local-test-review', recorded_by: 'test-operator', recorded_at: reviewed, expires_at: expiry },
    { id: 'economic-seller-review', principal_id: 'seller', cohort: 'independence_verified', owner_group: 'local-provider', evidence_ref: 'local-test-review', recorded_by: 'test-operator', recorded_at: reviewed, expires_at: expiry },
  ])
  const [listing] = await db.insert(schema.listings).values({ seller_id: 'seller', category: 'analysis', title: 'Aggregation fixture', description: 'Disposable records only', price_bankr: 0.6, status: 'sold' }).returning()
  const [trade] = await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: 'buyer', seller_id: 'seller', amount: 0.6, fee: 0.03, total_cost: 0.63, seller_amount: 0.6, payment_rail: 'credit', status: 'completed' }).returning()
  const [delivery] = await db.insert(schema.trade_deliveries).values({ trade_id: trade.id, submitter_id: 'seller', summary: 'Local aggregation fixture only', content_hash: 'a'.repeat(64), verification: '{}' }).returning()
  const { getIndependentEconomicEvidence } = await import('@/lib/independent-economic-evidence')
  assert.equal((await getIndependentEconomicEvidence()).volume_usd, 0)
  await db.insert(schema.verification_results).values({ id: crypto.randomUUID(), trade_id: trade.id, delivery_id: delivery.id, content_hash: delivery.content_hash, method: 'buyer_review', verifier: 'buyer', version: '1', status: 'passed', evidence_json: '{}' })
  await db.insert(schema.credit_entries).values([
    { user_id: 'buyer', reference: trade.id, kind: 'purchase', available_delta: -63, escrow_delta: 60 },
    { user_id: 'buyer', reference: trade.id, kind: 'settlement', available_delta: 0, escrow_delta: -60 },
    { user_id: 'seller', reference: trade.id, kind: 'sale', available_delta: 60, escrow_delta: 0 },
  ])
  const qualified = await getIndependentEconomicEvidence()
  assert.equal(qualified.completed_trades, 1)
  assert.equal(qualified.volume_usd, 0.6)
  await db.insert(schema.marketplace_cohort_attributions).values({ id: 'economic-controlled-review', principal_id: 'seller', cohort: 'platform_canary', evidence_ref: 'local-control-manifest', recorded_by: 'test-operator', recorded_at: new Date().toISOString() })
  const controlled = await getIndependentEconomicEvidence()
  assert.equal(controlled.volume_usd, 0)
  assert.equal(controlled.recorded_volume_by_ownership.platform_controlled, 0.6)
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id)))[0].amount, 0.6)
})
