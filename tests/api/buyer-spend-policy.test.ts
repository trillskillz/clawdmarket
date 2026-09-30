import test, { before, after } from 'node:test'
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
let route: typeof import('@/app/api/spending-policy/route')

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-spend-policy-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'spend.db')}`
  process.env.JWT_SECRET = 'spend-policy-tests-only'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  route = await import('@/app/api/spending-policy/route')
  await db.insert(schema.users).values([
    { id: 'policy-owner', name: 'Owner', email: 'owner@test.invalid', password_hash: 'unused', role: 'human' },
    { id: 'policy-outsider', name: 'Other', email: 'other@test.invalid', password_hash: 'unused', role: 'human' },
    { id: 'user_agent_policy-agent', name: 'Agent', email: 'agent@test.invalid', password_hash: 'unused', role: 'agent' },
    { id: 'policy-seller', name: 'Seller', email: 'seller@test.invalid', password_hash: 'unused', role: 'human' },
  ])
  await db.insert(schema.agents).values({ id: 'policy-agent', name: 'Agent', description: 'Buyer agent', capabilities: '["security-analysis"]', endpoint: 'https://example.invalid', owner_address: 'owner@test.invalid', api_key: 'unused' })
  await db.insert(schema.agent_owners).values({ agentId: 'policy-agent', userId: 'policy-owner', establishedBy: 'test' })
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function request(userId: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/spending-policy${method === 'GET' && userId === 'policy-owner' ? '?agent_id=policy-agent' : ''}`, {
    method, headers: { Authorization: `Bearer ${jwt({ userId, email: `${userId}@test.invalid`, role: userId === 'policy-owner' ? 'human' : 'agent' })}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const policy = { max_per_execution: '1.00', max_daily: '1.50', max_monthly: '5.00',
  approved_payment_rails: ['evm'], allowed_capabilities: ['security'], blocked_providers: ['blocked-seller'] }

test('only a linked owner can set a versioned policy; agent can read but cannot relax it', async () => {
  const unauthorized = await route.PUT(request('policy-outsider', 'PUT', { agent_id: 'policy-agent', expected_version: 0, policy }))
  assert.equal(unauthorized.status, 404)
  const agentWrite = await route.PUT(request('user_agent_policy-agent', 'PUT', { agent_id: 'policy-agent', expected_version: 0, policy }))
  assert.equal(agentWrite.status, 401)
  const first = await route.PUT(request('policy-owner', 'PUT', { agent_id: 'policy-agent', expected_version: 0, policy }))
  assert.equal(first.status, 200, JSON.stringify(await first.clone().json()))
  assert.equal((await first.json()).version, 1)
  const replay = await route.PUT(request('policy-owner', 'PUT', { agent_id: 'policy-agent', expected_version: 0, policy }))
  assert.equal((await replay.json()).idempotent, true)
  const stale = await route.PUT(request('policy-owner', 'PUT', { agent_id: 'policy-agent', expected_version: 0, policy: { ...policy, max_daily: '2.00' } }))
  assert.equal(stale.status, 409)
  const read = await route.GET(request('user_agent_policy-agent', 'GET'))
  assert.equal(read.status, 200)
  const body = await read.json()
  assert.equal(body.policy.max_daily, '1.50')
  assert.equal(body.version, 1)
  const outsiderRead = await route.GET(new NextRequest('http://localhost/api/spending-policy?agent_id=policy-agent', {
    headers: { Authorization: `Bearer ${jwt({ userId: 'policy-outsider', email: 'other@test.invalid', role: 'human' })}` },
  }))
  assert.equal(outsiderRead.status, 404)
  assert.equal((await db.select().from(schema.buyer_spend_policy_events)).length, 1)
})

test('policy rejects price, provider, rail, capability and open-reservation budget violations', async () => {
  const { enforceAgentSpendPolicy } = await import('@/lib/agent-spend-policy')
  const context = { agentId: 'policy-agent', buyerId: 'user_agent_policy-agent', sellerId: 'policy-seller', paymentRail: 'evm' as const, capabilities: ['security-analysis'], totalCost: 0.8 }
  await db.transaction((tx) => enforceAgentSpendPolicy(tx, context))
  for (const [changes, code] of [
    [{ totalCost: 1.01 }, 'BUYER_PER_EXECUTION_LIMIT'],
    [{ paymentRail: 'mpp' }, 'BUYER_PAYMENT_RAIL_BLOCKED'],
    [{ sellerId: 'blocked-seller' }, 'BUYER_PROVIDER_BLOCKED'],
    [{ capabilities: ['translation'] }, 'BUYER_CAPABILITY_BLOCKED'],
  ] as Array<[Partial<typeof context>, string]>) {
    await assert.rejects(() => db.transaction((tx) => enforceAgentSpendPolicy(tx, { ...context, ...changes })), (error: unknown) => (error as { code?: string }).code === code)
  }
  const [listing] = await db.insert(schema.listings).values({ seller_id: 'policy-seller', category: 'skills', title: 'Reserved work', description: 'An unpaid reservation that counts against the budget.', price_bankr: 0.8, status: 'sold' }).returning()
  await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: context.buyerId, seller_id: context.sellerId, amount: 0.8, fee: 0, total_cost: 0.8, payment_rail: 'evm', status: 'pending' })
  await assert.rejects(() => db.transaction((tx) => enforceAgentSpendPolicy(tx, context)), (error: unknown) => (error as { code?: string }).code === 'BUYER_DAILY_LIMIT')
  const read = await route.GET(request('user_agent_policy-agent', 'GET'))
  assert.equal((await read.json()).usage.remaining_daily, '0.70')
})

test('concurrent owner updates cannot overwrite each other at one expected version', async () => {
  const update = (maxDaily: string) => route.PUT(request('policy-owner', 'PUT', {
    agent_id: 'policy-agent', expected_version: 1, policy: { ...policy, max_daily: maxDaily },
  }))
  const responses = await Promise.all([update('2.00'), update('3.00')])
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409])
  assert.equal((await db.select().from(schema.buyer_spend_policy_events)).length, 2)
})

test('approval, verification, and retry ceilings fail closed without an approval or retry workflow', async () => {
  const { buyerSpendPolicyInput, checkBuyerPolicyConstraints } = await import('@/lib/buyer-spend-policy')
  const parsed = buyerSpendPolicyInput.parse({ approval_required_above: '0.50', max_retry_budget: '1.00',
    required_verification_methods: ['buyer_review', 'schema'] })
  const base = { totalMinor: 50, sellerId: 'policy-seller', paymentRail: 'evm' as const,
    capabilities: ['security-analysis'], verificationMethods: ['buyer_review', 'schema'] }
  assert.equal(checkBuyerPolicyConstraints(parsed, { ...base, totalMinor: 51 }), 'BUYER_APPROVAL_REQUIRED')
  assert.equal(checkBuyerPolicyConstraints(parsed, { ...base, verificationMethods: ['buyer_review'] }), 'BUYER_VERIFICATION_REQUIRED')
  assert.equal(checkBuyerPolicyConstraints(parsed, { ...base, retrySpendMinor: 101 }), 'BUYER_RETRY_BUDGET_EXCEEDED')
})
