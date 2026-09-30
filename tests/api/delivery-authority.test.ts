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
let getVerification: typeof import('@/app/api/trades/[id]/verification/route').GET

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
  getVerification = (await import('@/app/api/trades/[id]/verification/route')).GET
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

test('service verification failures persist evidence without opening buyer review', async () => {
  const tradeId = await fundedTrade()
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId))
  const serviceId = crypto.randomUUID()
  await db.insert(schema.service_definitions).values({
    id: serviceId, seller_id: 'delivery-seller', title: 'Verified review fixture',
    description: 'Return structured findings and independently listed source URLs.',
    price_minor: 100, capabilities: '["code-review"]', status: 'active', active_orders: 1,
    output_schema: JSON.stringify({ type: 'object', properties: { findings: { type: 'array' }, sources: { type: 'array' } }, required: ['findings', 'sources'], additionalProperties: false }),
    verification_policy: JSON.stringify({ required: true, methods: ['buyer_review', 'schema', 'source_urls'], minimum_sources: 2 }),
  })
  await db.insert(schema.service_orders).values({
    id: crypto.randomUUID(), service_id: serviceId, listing_id: trade.listing_id, trade_id: tradeId,
    buyer_id: 'delivery-buyer', client_reference: `verified-${crypto.randomUUID()}`,
    objective: 'Review the supplied repository for findings', price_minor: 100, payment_rail: 'evm', state: 'funded',
  })
  const failed = await deliver(request(`/api/trades/${tradeId}/delivery`, 'delivery-seller', {
    summary: 'Completed review with two supporting source URLs.',
    artifact: { findings: 'wrong', sources: ['https://example.com/a#one', 'https://example.com/a#two'] },
  }), { params: Promise.resolve({ id: tradeId }) })
  assert.equal(failed.status, 422)
  const failedResults = await db.select().from(schema.verification_results).where(eq(schema.verification_results.trade_id, tradeId))
  assert.deepEqual(failedResults.filter((row) => row.status === 'failed').map((row) => row.method).sort(), ['schema', 'source_urls'])
  assert.equal((await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, tradeId))).length, 0)
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.id, tradeId)))[0].status, 'escrow_held')

  const accepted = await deliver(request(`/api/trades/${tradeId}/delivery`, 'delivery-seller', {
    summary: 'Completed review with two supporting source URLs.',
    artifact: { findings: ['Check login flow'], sources: ['https://example.com/a', 'https://example.org/b'] },
  }), { params: Promise.resolve({ id: tradeId }) })
  assert.equal(accepted.status, 201, JSON.stringify(await accepted.clone().json()))
  const body = await accepted.json()
  assert.equal(body.verification.status, 'passed')
  assert.equal(body.verification.categories.semantic_verified, false)
  assert.equal(body.verification.categories.buyer_accepted, false)
  const results = await db.select().from(schema.verification_results).where(eq(schema.verification_results.trade_id, tradeId))
  assert.deepEqual(results.filter((row) => row.delivery_id === body.delivery.id).map((row) => `${row.method}:${row.status}`).sort(), ['buyer_review:pending', 'schema:passed', 'source_urls:passed'])
  const outsider = await getVerification(new NextRequest(`http://localhost/api/trades/${tradeId}/verification`, {
    headers: { Authorization: `Bearer ${token({ userId: 'delivery-outsider', email: 'delivery-outsider@test.invalid', role: 'human' })}` },
  }), { params: Promise.resolve({ id: tradeId }) })
  assert.equal(outsider.status, 404)
  const buyerRequest = () => new NextRequest(`http://localhost/api/trades/${tradeId}/verification`, {
    headers: { Authorization: `Bearer ${token({ userId: 'delivery-buyer', email: 'delivery-buyer@test.invalid', role: 'human' })}` },
  })
  const inspection = await getVerification(buyerRequest(), { params: Promise.resolve({ id: tradeId }) })
  assert.equal(inspection.status, 200)
  const inspectionBody = await inspection.json()
  assert.equal(inspectionBody.categories.structure_verified, true)
  assert.equal(inspectionBody.categories.source_list_verified, true)
  assert.equal(inspectionBody.categories.semantic_verified, false)
  assert.equal(inspectionBody.categories.buyer_accepted, false)
  assert.equal(JSON.stringify(inspectionBody).includes('Check login flow'), false)
  const { markBuyerReviewAccepted } = await import('@/lib/verification-evidence')
  await markBuyerReviewAccepted(tradeId)
  const acceptedInspection = await getVerification(buyerRequest(), { params: Promise.resolve({ id: tradeId }) })
  assert.equal((await acceptedInspection.json()).categories.buyer_accepted, true)
})

test('buyer review evidence distinguishes auto-confirm and dispute from acceptance', async () => {
  const { advanceBuyerReview } = await import('@/lib/verification-evidence')
  for (const [state, status] of [['skipped', 'skipped'], ['disputed', 'disputed']] as const) {
    const tradeId = await fundedTrade()
    const delivered = await deliver(request(`/api/trades/${tradeId}/delivery`, 'delivery-seller', payload), { params: Promise.resolve({ id: tradeId }) })
    assert.equal(delivered.status, 201)
    await db.transaction((tx) => advanceBuyerReview(tx, tradeId, state))
    const [row] = await db.select().from(schema.verification_results).where(eq(schema.verification_results.trade_id, tradeId))
    assert.equal(row.status, status)
    const inspection = await getVerification(new NextRequest(`http://localhost/api/trades/${tradeId}/verification`, {
      headers: { Authorization: `Bearer ${token({ userId: 'delivery-buyer', email: 'delivery-buyer@test.invalid', role: 'human' })}` },
    }), { params: Promise.resolve({ id: tradeId }) })
    assert.equal((await inspection.json()).categories.buyer_accepted, false)
  }
})
