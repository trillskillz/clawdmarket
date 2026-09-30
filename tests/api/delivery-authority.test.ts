import test, { before, after } from 'node:test'
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
let token: typeof import('@/lib/auth').generateJWT
let deliver: typeof import('@/app/api/trades/[id]/delivery/route').POST
let message: typeof import('@/app/api/messages/route').POST

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-delivery-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'delivery.db')}`
  process.env.JWT_SECRET = 'delivery-authority-tests-only'
  process.env.CHAT_ENCRYPTION_KEY = 'delivery-authority-chat-tests-only'
  process.env.WEBHOOK_SECRET_KEY = 'delivery-authority-webhook-tests-only'
  delete process.env.CLAWDMARKET_LEGACY_MESSAGE_DELIVERY_ENABLED
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  token = (await import('@/lib/auth')).generateJWT
  deliver = (await import('@/app/api/trades/[id]/delivery/route')).POST
  message = (await import('@/app/api/messages/route')).POST
  await db.insert(schema.users).values(['delivery-buyer', 'delivery-seller', 'delivery-outsider'].map((id) => ({
    id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' as const,
  })))
})

after(() => {
  delete process.env.CLAWDMARKET_LEGACY_MESSAGE_DELIVERY_ENABLED
  db?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

function request(path: string, userId: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token({ userId, email: `${userId}@test.invalid`, role: 'human' })}` },
    body: JSON.stringify(body),
  })
}

async function fundedTrade() {
  const [listing] = await db.insert(schema.listings).values({
    seller_id: 'delivery-seller', category: 'skills', title: 'Review delivery fixture',
    description: 'Review a repository and return actionable findings.', price_bankr: 1, status: 'sold',
  }).returning()
  const [trade] = await db.insert(schema.trades).values({
    listing_id: listing.id, buyer_id: 'delivery-buyer', seller_id: 'delivery-seller',
    amount: 1, fee: 0.05, item_price: 1, platform_fee: 0.05, total_cost: 1.05,
    seller_amount: 1, dev_amount: 0.05, payment_rail: 'evm', status: 'escrow_held',
  }).returning()
  return trade.id
}

const payload = { summary: 'The requested review is complete with actionable findings.', artifact: { findings: ['Check authentication'] } }

test('messages cannot open buyer review and dedicated delivery is seller-only and idempotent', async () => {
  const tradeId = await fundedTrade()
  const oldCommand = request('/api/messages', 'delivery-seller', {
    receiver_id: 'delivery-buyer', content: JSON.stringify({ type: 'task_complete', trade_id: tradeId, ...payload }),
  })
  const rejected = await message(oldCommand)
  assert.equal(rejected.status, 409)
  assert.equal((await rejected.json()).error_code, 'DELIVERY_ENDPOINT_REQUIRED')
  assert.equal(rejected.headers.get('Deprecation'), 'true')
  const typed = await message(request('/api/messages', 'delivery-seller', {
    receiver_id: 'delivery-buyer', type: 'task_complete', payload: { trade_id: tradeId, ...payload },
  }))
  assert.equal(typed.status, 409)
  assert.equal((await db.select().from(schema.messages)).length, 0)
  assert.equal((await db.select().from(schema.trade_deliveries)).length, 0)
  const [stillFunded] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId))
  assert.equal(stillFunded.status, 'escrow_held')

  const forbidden = await deliver(request(`/api/trades/${tradeId}/delivery`, 'delivery-outsider', payload), { params: Promise.resolve({ id: tradeId }) })
  assert.equal(forbidden.status, 403)
  const first = await deliver(request(`/api/trades/${tradeId}/delivery`, 'delivery-seller', payload), { params: Promise.resolve({ id: tradeId }) })
  assert.equal(first.status, 201)
  const firstBody = await first.json()
  assert.equal(firstBody.idempotent, false)
  assert.equal(firstBody.verification.status, 'manual_review')
  const repeated = await deliver(request(`/api/trades/${tradeId}/delivery`, 'delivery-seller', payload), { params: Promise.resolve({ id: tradeId }) })
  assert.equal(repeated.status, 200)
  assert.equal((await repeated.json()).delivery.id, firstBody.delivery.id)
  const changed = await deliver(request(`/api/trades/${tradeId}/delivery`, 'delivery-seller', { ...payload, summary: 'A different report was submitted after the first delivery.' }), { params: Promise.resolve({ id: tradeId }) })
  assert.equal(changed.status, 409)
  assert.equal((await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, tradeId))).length, 1)
  assert.equal((await db.select().from(schema.messages)).length, 1)
  const [review] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId))
  assert.equal(review.status, 'pending_release')
})

test('concurrent identical deliveries create one delivery and one notification', async () => {
  const tradeId = await fundedTrade()
  const beforeMessages = (await db.select().from(schema.messages)).length
  const submit = () => deliver(request(`/api/trades/${tradeId}/delivery`, 'delivery-seller', payload), { params: Promise.resolve({ id: tradeId }) })
  const responses = await Promise.all([submit(), submit()])
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201])
  assert.equal((await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, tradeId))).length, 1)
  assert.equal((await db.select().from(schema.messages)).length, beforeMessages + 1)
})

test('ordinary messages remain communication only, including delivery-like text', async () => {
  const tradeId = await fundedTrade()
  const sent = await message(request('/api/messages', 'delivery-seller', {
    receiver_id: 'delivery-buyer', content: `I finished trade ${tradeId}; please review it.`,
  }))
  assert.equal(sent.status, 201)
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId))
  assert.equal(trade.status, 'escrow_held')
  assert.equal((await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, tradeId))).length, 0)
})

test('temporary legacy bridge requires operator opt-in and advertises deprecation', async () => {
  const tradeId = await fundedTrade()
  process.env.CLAWDMARKET_LEGACY_MESSAGE_DELIVERY_ENABLED = 'true'
  try {
    const response = await message(request('/api/messages', 'delivery-seller', {
      receiver_id: 'delivery-buyer', content: JSON.stringify({ type: 'task_complete', trade_id: tradeId, ...payload }),
    }))
    assert.equal(response.status, 201)
    assert.equal(response.headers.get('Deprecation'), 'true')
    assert.equal(response.headers.get('Link'), `</api/trades/${tradeId}/delivery>; rel="successor-version"`)
    const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId))
    assert.equal(trade.status, 'pending_release')
  } finally {
    delete process.env.CLAWDMARKET_LEGACY_MESSAGE_DELIVERY_ENABLED
  }
})
