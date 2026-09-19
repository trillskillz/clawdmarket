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
let deliver: typeof import('@/lib/webhook-delivery').deliverWebhookEvent
let processPending: typeof import('@/lib/webhook-delivery').processPendingWebhookDeliveries
let inspectHealth: typeof import('@/lib/webhook-delivery').inspectWebhookDeliveryHealth
let history: typeof import('@/app/api/webhooks/deliveries/route').GET
let cron: typeof import('@/app/api/cron/webhooks/route').GET
const agentId = 'agent_webhook_outbox'
const userId = `user_agent_${agentId}`
const apiKey = 'clawd_webhook_outbox_test_key'

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'webhook-outbox.db')}`
  process.env.JWT_SECRET = 'isolated-webhook-outbox-tests-only'
  process.env.WEBHOOK_SECRET_KEY = 'isolated-webhook-outbox-secret'
  process.env.CRON_SECRET = 'isolated-webhook-cron-secret'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  const auth = await import('@/lib/registered-agent-auth')
  const webhook = await import('@/lib/webhook-delivery')
  deliver = webhook.deliverWebhookEvent
  processPending = webhook.processPendingWebhookDeliveries
  inspectHealth = webhook.inspectWebhookDeliveryHealth
  history = (await import('@/app/api/webhooks/deliveries/route')).GET
  cron = (await import('@/app/api/cron/webhooks/route')).GET

  await db.insert(schema.users).values({ id: userId, email: `${agentId}@agent.test`, name: agentId, password_hash: 'unused', role: 'agent' })
  await db.insert(schema.agents).values({
    id: agentId, name: agentId, description: 'Webhook retry fixture', capabilities: '[]', endpoint: '',
    owner_address: '', api_key: auth.hashAgentApiKey(apiKey), status: 'active',
  })
  const webhookId = 'webhook_outbox_fixture'
  const secret = webhook.createWebhookSecret(webhookId)
  await db.insert(schema.webhooks).values({
    id: webhookId, agent_id: userId, url: 'https://127.0.0.1/webhook',
    secret_hash: await webhook.hashSecret(secret), events: JSON.stringify(['trade.created']), active: 1,
  })
})

after(() => {
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function request(path: string, authorization?: string) {
  return new NextRequest(`https://clawdmkt.test${path}`, { headers: authorization ? { authorization } : {} })
}

test('webhook events are persisted before delivery and retried with a stable delivery ID', async () => {
  await deliver(userId, 'trade.created', { trade_id: 'trade_outbox_fixture' })
  const [first] = await db.select().from(schema.webhook_deliveries)
  assert.equal(first.attempts, 1)
  assert.equal(first.success, 0)
  assert.ok(first.next_attempt_at)
  assert.match(first.last_error || '', /private|public|address|destination|blocked|unsafe/i)
  assert.equal(JSON.parse(first.payload).delivery_id, first.id)

  await db.update(schema.webhook_deliveries).set({ next_attempt_at: new Date(Date.now() - 1000) }).where(eq(schema.webhook_deliveries.id, first.id))
  const retried = await processPending(5)
  assert.deepEqual(retried, { attempted: 1, delivered: 0, failed: 1, skipped: 0 })
  const [second] = await db.select().from(schema.webhook_deliveries).where(eq(schema.webhook_deliveries.id, first.id))
  assert.equal(second.attempts, 2)
  assert.equal(JSON.parse(second.payload).delivery_id, first.id)
  assert.deepEqual(await inspectHealth(), {
    healthy: true, retrying_count: 1, failed_count: 0, overdue_count: 0,
    oldest_pending_at: first.created_at.toISOString(),
  })
})

test('delivery history is private and the cron worker requires its secret', async () => {
  assert.equal((await history(request('/api/webhooks/deliveries'))).status, 401)
  const authorized = await history(new NextRequest('https://clawdmkt.test/api/webhooks/deliveries', { headers: { 'x-agent-api-key': apiKey } }))
  assert.equal(authorized.status, 200)
  const body = await authorized.json()
  assert.equal(body.deliveries.length, 1)
  assert.equal(body.deliveries[0].status, 'retrying')

  assert.equal((await cron(request('/api/cron/webhooks'))).status, 401)
  const run = await cron(request('/api/cron/webhooks', 'Bearer isolated-webhook-cron-secret'))
  assert.equal(run.status, 200)
})
