import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let api: typeof import('@/app/api/organizations/[id]/teams/[teamId]/budget/route')
let budgets: typeof import('@/lib/organization-team-budgets')
let reserve: typeof import('@/lib/service-order-reservation').reserveServiceOrder
const treasury = privateKeyToAccount(`0x${'77'.repeat(32)}`).address
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-team-budgets-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'teams.db')}`, TURSO_AUTH_TOKEN: '', JWT_SECRET: 'team-budget-tests-only',
    CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true', CLAWDMARKET_REUSABLE_SERVICES_ENABLED: 'true', TREASURY_ADDRESS: treasury,
    EVM_SETTLEMENT_PRIVATE_KEY: `0x${'77'.repeat(32)}` })
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Test Base', address: `0x${'44'.repeat(20)}`,
    symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: 'https://rpc.example.invalid' }])
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  api = await import('@/app/api/organizations/[id]/teams/[teamId]/budget/route'); budgets = await import('@/lib/organization-team-budgets')
  reserve = (await import('@/lib/service-order-reservation')).reserveServiceOrder
})
after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })
const context = (id: string, teamId: string) => ({ params: Promise.resolve({ id, teamId }) })
function request(path: string, method: string, userId: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method, headers: { 'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt({ userId, email: `${userId}@test.invalid`, role: 'human' })}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function fixture() {
  const id = crypto.randomUUID(), owner = `team-owner-${id}`, outsider = `team-outsider-${id}`, seller = `team-seller-${id}`
  const agents = [crypto.randomUUID(), crypto.randomUUID()], buyers = agents.map((id) => `user_agent_${id}`), teams = [crypto.randomUUID(), crypto.randomUUID()]
  const now = new Date()
  await db.insert(schema.users).values([owner, outsider, seller, ...buyers].map((userId) => ({ id: userId, name: userId, email: `${userId}@test.invalid`, password_hash: 'unused' })))
  await db.insert(schema.agents).values(agents.map((agentId) => ({ id: agentId, name: 'Department buyer', description: 'Budget fixture', capabilities: '[]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused' })))
  await db.insert(schema.agent_owners).values(agents.map((agentId) => ({ agentId, userId: owner, establishedBy: 'test' })))
  await db.insert(schema.organizations).values({ id, owner_account_id: owner, client_reference: id, name: 'Departments', created_at: now, updated_at: now })
  await db.insert(schema.organization_teams).values(teams.map((teamId, index) => ({ id: teamId, organization_id: id, slug: `department-${index}`, name: `Department ${index}`, created_at: now, updated_at: now })))
  await db.insert(schema.organization_agent_assignments).values(agents.map((agentId) => ({ agent_id: agentId, organization_id: id, team_id: teams[0], cost_center: 'ENGINEERING', assigned_at: now, updated_at: now })))
  await db.insert(schema.payout_addresses).values({ user_id: seller, address: treasury })
  const serviceId = crypto.randomUUID()
  await db.insert(schema.service_definitions).values({ id: serviceId, seller_id: seller, title: 'Department service', description: 'Return private structured code review.',
    capabilities: '["code-review"]', price_minor: 100, status: 'active', estimated_latency_seconds: 30, max_concurrency: 3,
    output_schema: '{"type":"object"}', verification_policy: '{"required":true,"methods":["buyer_review","schema"],"acceptance":{"version":1,"mode":"explicit_buyer"}}' })
  const path = `/api/organizations/${id}/teams/${teams[0]}/budget`, params = context(id, teams[0])
  const principal = (index = 0) => ({ userId: buyers[index], agentId: agents[index], kind: 'registered-agent' as const, usesCookieAuth: false })
  return { id, owner, outsider, seller, agents, buyers, teams, serviceId, path, params, principal }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const input = { expected_version: 0, max_per_execution: '1.05', max_daily: '1.05', max_monthly: '3.15' }
async function set(f: Fixture, value = input) { return api.PUT(request(f.path, 'PUT', f.owner, value), f.params) }
async function buy(f: Fixture, index = 0, reference = crypto.randomUUID()) {
  return reserve({ serviceId: f.serviceId, principal: f.principal(index), externalOnly: true,
    request: { client_reference: reference, objective: 'Review private code within the department allowance', input: {}, provider_requirements: {}, payment_rail: 'evm', max_total: 105 } })
}
const rejectsCode = (action: () => Promise<unknown>, code: string) => assert.rejects(action, (error: unknown) => (error as { code?: string }).code === code)

test('department budgets are owner-only, versioned, audited and bounded by CSRF/body limits', async () => {
  const f = await fixture()
  assert.equal((await api.GET(request(f.path, 'GET', f.outsider), f.params)).status, 404)
  assert.equal((await api.PUT(request(f.path, 'PUT', f.buyers[0], input), f.params)).status, 401)
  assert.equal((await api.PUT(request(f.path, 'PUT', f.outsider, input), f.params)).status, 404)
  const { createOrganizationServiceAccount } = await import('@/lib/organization-service-accounts')
  const key = await createOrganizationServiceAccount(f.id, f.owner, { client_reference: crypto.randomUUID(), name: 'Department read-only fixture', lifetime_days: 1 })
  assert.equal(key.kind, 'ok'); if (key.kind !== 'ok' || !key.api_key) assert.fail('Fixture read credential unavailable')
  const keyRequest = new NextRequest(`http://localhost${f.path}`, { headers: { Authorization: `Bearer ${key.api_key}` } })
  assert.equal((await api.GET(keyRequest, f.params)).status, 401)
  const { createOrganizationInvitation, acceptOrganizationInvitation } = await import('@/lib/organization-membership')
  const invitation = await createOrganizationInvitation(f.id, f.owner, f.outsider, crypto.randomUUID())
  assert.equal(invitation.kind, 'ok'); if (invitation.kind !== 'ok' || !invitation.invitation_id) assert.fail('Fixture invitation unavailable')
  assert.equal((await acceptOrganizationInvitation(invitation.invitation_id, f.outsider)).kind, 'ok')
  assert.equal((await api.GET(request(f.path, 'GET', f.outsider), f.params)).status, 404)
  const foreign = await fixture()
  assert.equal((await api.GET(request(f.path, 'GET', f.owner), context(foreign.id, f.teams[0]))).status, 404)
  const cookie = new NextRequest(`http://localhost${f.path}`, { method: 'PUT', headers: { Cookie: `auth-token=${jwt({ userId: f.owner, email: 'owner@test.invalid', role: 'human' })}` }, body: JSON.stringify(input) })
  assert.equal((await api.PUT(cookie, f.params)).status, 403)
  assert.equal((await api.PUT(request(f.path, 'PUT', f.owner, { ...input, padding: 'x'.repeat(3000) }), f.params)).status, 413)
  assert.equal((await set(f)).status, 200)
  const replay = await set(f); assert.equal((await replay.json()).idempotent, true)
  assert.equal((await set(f, { ...input, max_daily: '2.10' })).status, 409)
  assert.equal((await db.select().from(schema.organization_team_budget_events).where(eq(schema.organization_team_budget_events.team_id, f.teams[0]))).length, 1)
  const read = await api.GET(request(f.path, 'GET', f.owner), f.params)
  assert.match(read.headers.get('Cache-Control')!, /private.*no-store/)
  assert.equal((await read.json()).usage.reserved_or_spent_today, '0.00')
})

test('a department ceiling rolls back the second agent order, capacity and gross reservation', async () => {
  const f = await fixture(); assert.equal((await set(f)).status, 200)
  const first = await buy(f)
  await rejectsCode(() => buy(f, 1), 'TEAM_DAILY_LIMIT')
  const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.serviceId))
  assert.equal(service.active_orders, 1)
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.service_id, f.serviceId))).length, 1)
  assert.equal((await budgets.teamBudgetUsage(f.id, f.teams[0])).reserved_or_spent_today_minor, 105)
  const replay = await buy(f, 0, first.order.client_reference)
  assert.equal(replay.trade.id, first.trade.id)
  process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'false'
  try {
    assert.equal((await set(f, { ...input, expected_version: 1, max_daily: '2.10' })).status, 503)
    await rejectsCode(() => buy(f, 1), 'TEAM_DAILY_LIMIT')
    assert.equal((await api.GET(request(f.path, 'GET', f.owner), f.params)).status, 200)
  } finally { process.env.CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED = 'true' }
})

test('department per-execution/monthly caps remain additional to organization and buyer ceilings', async () => {
  for (const constraint of ['per_execution', 'monthly', 'organization'] as const) {
    const f = await fixture()
    const body = { ...input, max_daily: '3.15', max_per_execution: constraint === 'per_execution' ? '1.04' : '1.05',
      max_monthly: constraint === 'monthly' ? '1.04' : '3.15' }
    assert.equal((await set(f, body)).status, 200)
    if (constraint === 'organization') await db.insert(schema.organization_spend_budgets).values({ organization_id: f.id, max_per_execution_minor: 104, version: 1, created_at: new Date(), updated_at: new Date() })
    await rejectsCode(() => buy(f), constraint === 'per_execution' ? 'TEAM_PER_EXECUTION_LIMIT' : constraint === 'monthly' ? 'TEAM_MONTHLY_LIMIT' : 'ORGANIZATION_PER_EXECUTION_LIMIT')
    assert.equal((await db.select().from(schema.organization_trade_attributions).where(eq(schema.organization_trade_attributions.organization_id, f.id))).length, 0)
    assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.service_id, f.serviceId))).length, 0)
  }
})

test('reassignment preserves original department exposure and lowered caps stop original checkout fresh sends', async () => {
  const f = await fixture(); await set(f); const first = await buy(f)
  await db.update(schema.organization_agent_assignments).set({ team_id: f.teams[1], cost_center: 'RESEARCH' }).where(eq(schema.organization_agent_assignments.agent_id, f.agents[0]))
  assert.equal((await budgets.teamBudgetUsage(f.id, f.teams[0])).reserved_or_spent_today_minor, 105)
  assert.equal((await budgets.teamBudgetUsage(f.id, f.teams[1])).reserved_or_spent_today_minor, 0)
  assert.equal((await set(f, { ...input, expected_version: 1, max_daily: '1.04' })).status, 200)
  const { organizationFundingBudgetFailure } = await import('@/lib/organization-budgets')
  assert.equal(await organizationFundingBudgetFailure(first.trade), 'TEAM_DAILY_LIMIT')
  const { serviceFundingEligibility } = await import('@/lib/service-funding-eligibility')
  assert.equal(await serviceFundingEligibility(first.trade), 'TEAM_DAILY_LIMIT')
  // A cancelled external checkout may still receive its original payment.
  await db.update(schema.trades).set({ status: 'cancelled' }).where(eq(schema.trades.id, first.trade.id))
  assert.equal((await budgets.teamBudgetUsage(f.id, f.teams[0])).reserved_or_spent_today_minor, 105)
  await db.update(schema.trades).set({ payout_status: 'refunded' }).where(eq(schema.trades.id, first.trade.id))
  assert.equal((await budgets.teamBudgetUsage(f.id, f.teams[0])).reserved_or_spent_today_minor, 0)
})

test('department caps apply to attributed listing fresh-send authority without closing original proof recovery', async () => {
  const f = await fixture(), now = new Date(); await set(f)
  const [listing] = await db.insert(schema.listings).values({ seller_id: f.seller, category: 'skills', title: 'Department listing', description: 'Original pending checkout', price_bankr: 1 }).returning()
  const [trade] = await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: f.buyers[0], seller_id: f.seller, amount: 1, fee: .05, total_cost: 1.05, status: 'pending', payment_rail: 'evm' }).returning()
  await db.insert(schema.organization_trade_attributions).values({ trade_id: trade.id, organization_id: f.id, team_id: f.teams[0], agent_id: f.agents[0], cost_center: 'ENGINEERING', total_minor: 105, created_at: now })
  await set(f, { ...input, expected_version: 1, max_daily: '1.04' })
  const { serviceFundingEligibility } = await import('@/lib/service-funding-eligibility')
  assert.equal(await serviceFundingEligibility(trade), 'TEAM_DAILY_LIMIT')
  assert.equal(await serviceFundingEligibility(trade, db, 'proof_recovery'), null)
  assert.equal((await db.select().from(schema.evm_payment_intents).where(eq(schema.evm_payment_intents.trade_id, trade.id))).length, 0)
})

test('independent agent processes cannot overspend one department or duplicate its capacity', async () => {
  const f = await fixture(); await set(f)
  const results = await Promise.allSettled([0, 1].map((index) => {
    const script = `const {db}=require('./lib/db.ts');const {reserveServiceOrder}=require('./lib/service-order-reservation.ts');
      (async()=>{try{const r=await reserveServiceOrder({serviceId:${JSON.stringify(f.serviceId)},principal:${JSON.stringify(f.principal(index))},externalOnly:true,
      request:{client_reference:${JSON.stringify(crypto.randomUUID())},objective:'Review private code within department allowance',input:{},provider_requirements:{},payment_rail:'evm',max_total:105}});
      console.log(JSON.stringify({trade:r.trade.id}));}catch(e){if(e.code!=='TEAM_DAILY_LIMIT')throw e;console.log(JSON.stringify({error:e.code}));}})().finally(()=>db.$client.close());`
    return promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', '-e', script], { cwd: process.cwd(), env: { ...process.env }, timeout: 30_000 })
  }))
  const outcomes = results.map((result) => { if (result.status === 'rejected') throw result.reason; return JSON.parse(result.value.stdout.trim().split('\n').at(-1)!) })
  assert.equal(outcomes.filter((row) => row.trade).length, 1); assert.equal(outcomes.filter((row) => row.error === 'TEAM_DAILY_LIMIT').length, 1)
  assert.equal((await budgets.teamBudgetUsage(f.id, f.teams[0])).reserved_or_spent_today_minor, 105)
  const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.serviceId)); assert.equal(service.active_orders, 1)
})

test('concurrent owner changes have one version and archived teams preserve private budget history', async () => {
  const f = await fixture()
  const results = await Promise.all([set(f), set(f, { ...input, max_daily: '2.10' })])
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409])
  assert.equal((await db.select().from(schema.organization_team_budget_events).where(eq(schema.organization_team_budget_events.team_id, f.teams[0]))).length, 1)
  await db.delete(schema.organization_agent_assignments).where(eq(schema.organization_agent_assignments.organization_id, f.id))
  await db.update(schema.organization_teams).set({ status: 'archived' }).where(eq(schema.organization_teams.id, f.teams[0]))
  assert.equal((await api.GET(request(f.path, 'GET', f.owner), f.params)).status, 200)
  const response = await set(f, { ...input, expected_version: 1, max_daily: '3.15' }); assert.equal(response.status, 409)
  assert.equal((await response.json()).error_code, 'TEAM_ARCHIVED')
})

test('MPP reservations share the department ceiling and uncertain cancellations retain their exposure', async () => {
  const f = await fixture(); await set(f)
  const names = ['MPP_SECRET_KEY_CURRENT', 'MPP_RECIPIENT_ADDRESS', 'TEMPO_RPC_URL'] as const, saved = names.map((name) => process.env[name])
  try {
    process.env.MPP_SECRET_KEY_CURRENT = 'department-mpp-tests-only-dummy-secret'; process.env.MPP_RECIPIENT_ADDRESS = treasury; process.env.TEMPO_RPC_URL = 'https://rpc.example.invalid'
    const purchase = () => reserve({ serviceId: f.serviceId, principal: f.principal(), externalOnly: true,
      request: { client_reference: crypto.randomUUID(), objective: 'Review private code within the department allowance', input: {}, provider_requirements: {}, payment_rail: 'mpp', max_total: 105 } })
    const original = await purchase(); assert.equal(original.trade.payment_rail, 'mpp')
    await rejectsCode(purchase, 'TEAM_DAILY_LIMIT')
    await db.update(schema.trades).set({ status: 'cancelled' }).where(eq(schema.trades.id, original.trade.id))
    assert.equal((await budgets.teamBudgetUsage(f.id, f.teams[0])).reserved_or_spent_today_minor, 105)
    await rejectsCode(purchase, 'TEAM_DAILY_LIMIT')
    // This case covers reservation authority only, not an actual MPP transfer/refund.
  } finally { names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index] }) }
})

test('independent owner updates preserve one version and stale owner authority cannot alter the current budget', async () => {
  const f = await fixture()
  const results = await Promise.allSettled([105, 210].map((max_daily) => {
    const script = `const {db}=require('./lib/db.ts');const {updateTeamBudget}=require('./lib/organization-team-budgets.ts');
      (async()=>{try{const r=await updateTeamBudget(${JSON.stringify(f.id)},${JSON.stringify(f.teams[0])},${JSON.stringify(f.owner)},
      {expected_version:0,max_per_execution:105,max_daily:${max_daily},max_monthly:315});console.log(JSON.stringify({version:r.row.version}));}
      catch(e){if(e.code!=='TEAM_BUDGET_VERSION_CONFLICT')throw e;console.log(JSON.stringify({error:e.code}));}})().finally(()=>db.$client.close());`
    return promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', '-e', script], { cwd: process.cwd(), env: { ...process.env }, timeout: 30_000 })
  }))
  const outcomes = results.map((result) => { if (result.status === 'rejected') throw result.reason; return JSON.parse(result.value.stdout.trim().split('\n').at(-1)!) })
  assert.equal(outcomes.filter((row) => row.version === 1).length, 1)
  assert.equal(outcomes.filter((row) => row.error === 'TEAM_BUDGET_VERSION_CONFLICT').length, 1)
  assert.equal((await db.select().from(schema.organization_team_budget_events).where(eq(schema.organization_team_budget_events.team_id, f.teams[0]))).length, 1)
  await db.update(schema.organizations).set({ owner_account_id: f.outsider }).where(eq(schema.organizations.id, f.id))
  assert.equal((await set(f, { ...input, expected_version: 1, max_daily: '3.15' })).status, 404)
  assert.equal((await api.GET(request(f.path, 'GET', f.owner), f.params)).status, 404)
  assert.equal((await api.GET(request(f.path, 'GET', f.outsider), f.params)).status, 200)
})

test('malformed stored department ceilings cannot silently authorize new orders', async () => {
  const f = await fixture(); await set(f)
  await db.$client.execute({ sql: 'UPDATE organization_team_budgets SET max_daily_minor = ? WHERE team_id = ?', args: ['invalid', f.teams[0]] })
  await rejectsCode(() => buy(f), 'TEAM_BUDGET_INVALID')
  assert.equal((await api.GET(request(f.path, 'GET', f.owner), f.params)).status, 409)
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.service_id, f.serviceId))).length, 0)
})

test('UTC windows count conservative legacy exposure without doubling original attributed trades', async () => {
  const f = await fixture(), now = new Date('2026-10-09T12:00:00Z')
  const dates = [now, new Date('2026-10-08T23:59:59Z'), new Date('2026-09-30T23:59:59Z')]
  for (let index = 0; index < dates.length; index++) {
    const [listing] = await db.insert(schema.listings).values({ seller_id: f.seller, title: 'Legacy department exposure', description: 'Conservative UTC window fixture', category: 'skills', price_bankr: 1 }).returning()
    const [trade] = await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: f.buyers[0], seller_id: f.seller, amount: 1, fee: .05, total_cost: 1.05,
      status: 'pending', payment_rail: 'evm', created_at: dates[index] }).returning()
    if (index === 0) await db.insert(schema.organization_trade_attributions).values({ trade_id: trade.id, organization_id: f.id, agent_id: f.agents[0], team_id: f.teams[0], cost_center: 'ENGINEERING', total_minor: 105, created_at: dates[index] })
  }
  assert.deepEqual(await budgets.teamBudgetUsage(f.id, f.teams[0], now), { reserved_or_spent_today_minor: 105, reserved_or_spent_month_minor: 210 })
})
