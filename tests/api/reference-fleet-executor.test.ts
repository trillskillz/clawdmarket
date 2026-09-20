import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let hashAgentApiKey: typeof import('@/lib/registered-agent-auth').hashAgentApiKey
let runExecutions: typeof import('@/lib/reference-fleet-executor').runReferenceFleetExecutions
let inspectHealth: typeof import('@/lib/reference-fleet-executor').inspectReferenceFleetExecutionHealth
let listingPost: typeof import('@/app/api/listings/route').POST

const agentId = 'agent_referenceexecutor1'
const sellerId = `user_agent_${agentId}`
const buyerId = 'user_referencebuyer1'
const executorKey = `clawd_${'e'.repeat(48)}`
const presenceKey = `clawd_${'c'.repeat(48)}`
const runtimeKeysJson = JSON.stringify({
  version: 1,
  agents: {
    'atlas-research': {
      agent_id: agentId,
      presence_key: presenceKey,
      executor_key: executorKey,
    },
  },
})

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'reference-executor.db')}`
  process.env.JWT_SECRET = 'isolated-reference-executor-tests-only'
  process.env.CHAT_ENCRYPTION_KEY = 'isolated-reference-executor-chat-key'
  process.env.WEBHOOK_SECRET_KEY = 'isolated-reference-executor-webhook-key'
  process.env.AGENT_API_KEY_PEPPER = 'isolated-reference-executor-pepper'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  hashAgentApiKey = (await import('@/lib/registered-agent-auth')).hashAgentApiKey
  runExecutions = (await import('@/lib/reference-fleet-executor')).runReferenceFleetExecutions
  inspectHealth = (await import('@/lib/reference-fleet-executor')).inspectReferenceFleetExecutionHealth
  listingPost = (await import('@/app/api/listings/route')).POST

  await db.insert(schema.users).values([
    { id: buyerId, email: 'reference-buyer@test.invalid', password_hash: 'unused', name: 'Reference Buyer', role: 'human' },
    { id: sellerId, email: `${agentId}@agent.clawdmkt.com`, password_hash: 'unused', name: 'Atlas Research Scout', role: 'agent' },
  ])
  await db.insert(schema.wallets).values([
    { user_id: buyerId, balance: 0, escrow: 1 },
    { user_id: sellerId, balance: 0, escrow: 0 },
  ])
  await db.insert(schema.agents).values({
    id: agentId,
    name: 'Atlas Research Scout',
    description: '[clawdmarket-reference-fleet:v1] ClawdMarket-operated reference agent.',
    capabilities: JSON.stringify(['web-research', 'report-writing']),
    endpoint: 'https://clawdmkt.test/api/agents/status',
    owner_address: 'autonomous:test',
    api_key: hashAgentApiKey(`clawd_${'a'.repeat(48)}`),
    status: 'active',
  })
  await db.insert(schema.agent_credentials).values({
    id: 'agc_referenceexecutor1',
    agentId,
    name: 'reference-fleet-executor-v1',
    keyHash: hashAgentApiKey(executorKey),
    keyPrefix: executorKey.slice(0, 12),
    scopes: JSON.stringify(['agent:read', 'marketplace:write']),
    createdByType: 'credential',
    createdById: agentId,
  })
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
  delete process.env.CLAWDMARKET_REFERENCE_FLEET_EXECUTION_PAUSED
})

async function seedFundedTask(suffix: string) {
  const taskId = `task_reference_${suffix}`
  const listingId = `listing_reference_${suffix}`
  const tradeId = `trade_reference_${suffix}`
  await db.insert(schema.tasks).values({
    id: taskId,
    posterAgentId: buyerId,
    title: `Research delivery ${suffix}`,
    description: 'Produce a concise, source-grounded report about secure retry queues and state the key limitations.',
    requiredCapabilities: JSON.stringify(['web-research', 'report-writing']),
    budgetUsd: 1,
    status: 'assigned',
    assignedAgentId: agentId,
    winningBidId: `bid_reference_${suffix}`,
  })
  await db.insert(schema.listings).values({
    id: listingId,
    seller_id: sellerId,
    category: 'bounties',
    title: `Research delivery ${suffix}`,
    description: 'Task-backed hidden fulfillment listing for the isolated executor test.',
    price_bankr: 1,
    status: 'sold',
  })
  await db.insert(schema.trades).values({
    id: tradeId,
    listing_id: listingId,
    buyer_id: buyerId,
    seller_id: sellerId,
    amount: 1,
    fee: 0.05,
    item_price: 1,
    total_cost: 1.05,
    seller_amount: 1,
    payment_rail: 'ledger',
    status: 'escrow_held',
  })
  await db.insert(schema.task_workspaces).values({
    task_id: taskId,
    trade_id: tradeId,
    agreed_price: 1,
    output_format: 'text',
  })
  return { taskId, tradeId }
}

function successfulModelFetch() {
  return Promise.resolve(new Response(JSON.stringify({
    id: 'msg_reference_test',
    content: [{
      type: 'text',
      text: 'Use durable idempotency keys, atomic leases, bounded retries, and a dead-letter queue. Human review remains necessary for semantic correctness.',
      citations: [{ type: 'web_search_result_location', url: 'https://example.com/queue-safety', title: 'Queue safety' }],
    }],
    usage: { input_tokens: 120, output_tokens: 45, server_tool_use: { web_search_requests: 1 } },
  }), { status: 200, headers: { 'content-type': 'application/json' } }))
}

test('execution is fail-closed until an operator resumes it', async () => {
  const result = await runExecutions({
    runtimeKeysJson,
    anthropicApiKey: 'test-provider-key',
    fetcher: successfulModelFetch,
    expectedExecutorCount: 1,
  })
  assert.equal(result.paused, true)
  assert.equal(result.processed, 0)
})

test('a funded task is leased, executed, delivered once, and monitored', async () => {
  const { tradeId } = await seedFundedTask('success')
  await db.insert(schema.reference_fleet_controls).values({
    key: 'delivery_execution',
    paused: 0,
    reason: 'Isolated delivery canary',
    updated_by: 'test-operator',
  })
  const first = await runExecutions({
    runtimeKeysJson,
    anthropicApiKey: 'test-provider-key',
    fetcher: successfulModelFetch,
    expectedExecutorCount: 1,
  })
  assert.equal(first.paused, false)
  assert.equal(first.processed, 1)
  assert.equal(first.outcomes[0].state, 'delivered')

  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)).limit(1)
  assert.equal(trade.status, 'pending_release')
  const deliveries = await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, tradeId))
  assert.equal(deliveries.length, 1)
  assert.match(deliveries[0].summary, /durable idempotency keys/)

  const duplicateCron = await runExecutions({
    runtimeKeysJson,
    anthropicApiKey: 'test-provider-key',
    fetcher: async () => { throw new Error('duplicate cron must not invoke the provider') },
    expectedExecutorCount: 1,
  })
  assert.equal(duplicateCron.processed, 0)
  assert.equal((await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, tradeId))).length, 1)
  const health = await inspectHealth()
  assert.equal(health.healthy, true)
  assert.equal(health.counts.delivered, 1)
})

test('provider failures retain work for a bounded retry without exposing response bodies', async () => {
  const { tradeId } = await seedFundedTask('retry')
  const failed = await runExecutions({
    runtimeKeysJson,
    anthropicApiKey: 'test-provider-key',
    fetcher: async () => new Response('sensitive upstream response', { status: 503 }),
    expectedExecutorCount: 1,
  })
  assert.equal(failed.outcomes[0].state, 'retry_wait')
  assert.equal(failed.outcomes[0].error_code, 'provider_http_503')
  const [run] = await db.select().from(schema.reference_fleet_execution_runs)
    .where(eq(schema.reference_fleet_execution_runs.trade_id, tradeId)).limit(1)
  assert.equal(run.state, 'retry_wait')
  assert.equal(run.last_error?.includes('sensitive upstream response'), false)
})

test('managed reference agents cannot publish paid listings with executor credentials', async () => {
  const response = await listingPost(new NextRequest('https://clawdmkt.test/api/listings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-api-key': executorKey, 'x-forwarded-for': '198.51.100.90' },
    body: JSON.stringify({
      category: 'analysis',
      title: 'Premature managed service',
      description: 'This paid service must remain unavailable until the next explicitly reviewed phase.',
      price_bankr: 1,
    }),
  }))
  assert.equal(response.status, 409)
  assert.equal((await response.json()).code, 'REFERENCE_FLEET_PAID_SERVICES_LOCKED')
})
