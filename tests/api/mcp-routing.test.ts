import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let mcp: typeof import('@/app/api/mcp/route').POST
let register: typeof import('@/app/api/agents/register/route').POST
let buyer: { id: string; key: string }
let other: { id: string; key: string }
const treasury = privateKeyToAccount(`0x${'66'.repeat(32)}`)

async function registerAgent(name: string) {
  const result = await register(new NextRequest('http://localhost/api/agents/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': `198.51.100.${Math.floor(Math.random() * 200) + 1}` },
    body: JSON.stringify({ name, description: 'MCP routing test agent', capabilities: ['security-analysis'], activation_mode: 'autonomous' }),
  }))
  assert.equal(result.status, 201)
  const data = await result.json()
  return { id: String(data.agent.id), key: String(data.agent.api_key) }
}

function call(name: string, args: unknown, key?: string) {
  return mcp(new NextRequest('http://localhost/api/mcp', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/call', params: { name, arguments: args } }),
  }))
}

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-mcp-route-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'mcp.db')}`
  process.env.JWT_SECRET = 'mcp-routing-tests-only'
  process.env.WEBHOOK_SECRET_KEY = 'mcp-routing-tests-only'
  process.env.TREASURY_ADDRESS = treasury.address
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'66'.repeat(32)}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Test Base', address: `0x${'44'.repeat(20)}`, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: 'https://rpc.example.invalid' }])
  delete process.env.MPP_SECRET_KEY
  delete process.env.MPP_SECRET_KEY_CURRENT
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  mcp = (await import('@/app/api/mcp/route')).POST
  register = (await import('@/app/api/agents/register/route')).POST
  buyer = await registerAgent(`MCP Buyer ${crypto.randomUUID().slice(0, 8)}`)
  other = await registerAgent(`MCP Other ${crypto.randomUUID().slice(0, 8)}`)
  const sellerId = `mcp-seller-${crypto.randomUUID()}`
  await db.insert(schema.users).values({ id: sellerId, name: 'MCP seller', email: `${sellerId}@test.invalid`, password_hash: 'unused', role: 'human' })
  await db.insert(schema.payout_addresses).values({ user_id: sellerId, address: treasury.address })
  await db.insert(schema.service_definitions).values({ id: crypto.randomUUID(), seller_id: sellerId,
    title: 'MCP security review', description: 'Review API authorization and authentication logic.',
    capabilities: '["security-analysis"]', price_minor: 100, status: 'active', estimated_latency_seconds: 120 })
})

after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

test('MCP plan_work is authenticated, free, and does not persist an economic route', async () => {
  const request = { client_reference: `mcp-${crypto.randomUUID()}`, objective: 'Review this API for authentication issues',
    required_capabilities: ['security'], max_budget: { amount: '5.00', currency: 'USD' } }
  const unauthorized = await call('plan_work', request)
  assert.equal(unauthorized.status, 200)
  assert.equal((await unauthorized.json()).result.isError, true)
  const before = { routes: (await db.select().from(schema.route_plans)).length,
    orders: (await db.select().from(schema.service_orders)).length, trades: (await db.select().from(schema.trades)).length }
  const result = await call('plan_work', request, buyer.key)
  assert.equal(result.status, 200)
  const body = await result.json()
  assert.equal(body.mpp_receipt, undefined)
  const preview = JSON.parse(body.result.content[0].text)
  assert.equal(preview.persisted, false)
  assert.equal(preview.funds_moved, false)
  assert.deepEqual(preview.plan.required_capabilities, ['security-analysis'])
  assert.equal(preview.plan.candidates.length, 1)
  assert.equal((await db.select().from(schema.route_plans)).length, before.routes)
  assert.equal((await db.select().from(schema.service_orders)).length, before.orders)
  assert.equal((await db.select().from(schema.trades)).length, before.trades)
})

test('MCP get_route shares buyer-owned inspection and hides another agent route', async () => {
  const buyerId = `user_agent_${buyer.id}`
  await db.insert(schema.users).values({ id: buyerId, name: 'MCP buyer', email: `${buyerId}@test.invalid`, password_hash: 'unused', role: 'agent' }).onConflictDoNothing()
  const routeId = crypto.randomUUID()
  await db.insert(schema.route_plans).values({ id: routeId, buyer_id: buyerId, client_reference: `mcp-route-${routeId}`,
    objective: 'Inspect this planned API security review', required_capabilities: '["security-analysis"]',
    max_budget_minor: 500, candidates_json: '[]', expires_at: new Date(Date.now() + 300_000) })
  const owner = await call('get_route', { route_id: routeId }, buyer.key)
  assert.equal(owner.status, 200)
  const snapshot = JSON.parse((await owner.json()).result.content[0].text)
  assert.equal(snapshot.route.id, routeId)
  assert.equal(snapshot.payment_exposure, null)
  const foreign = await call('get_route', { route_id: routeId }, other.key)
  const result = await foreign.json()
  assert.equal(result.result.isError, true)
  assert.match(result.result.content[0].text, /ROUTE_NOT_FOUND/)
  assert.equal(result.mpp_receipt, undefined)
})
