import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let deliver: typeof import('@/app/api/trades/[id]/delivery/route').POST
let confirm: typeof import('@/app/api/trades/[id]/confirm/route').POST
let cron: typeof import('@/app/api/cron/auto-confirm/route').GET
let release: typeof import('@/lib/trade-escrow').finalizeTradeCompletion
let external: typeof import('@/lib/external-settlement')
const policy = { required: true, methods: ['buyer_review', 'assertions'], acceptance: { version: 1, mode: 'explicit_buyer' },
  assertions: { version: 1, rules: [{ id: 'done', field: 'status', op: 'equals', value: 'done' }] } }

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-explicit-acceptance-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'test.db')}`
  process.env.JWT_SECRET = 'explicit-acceptance-test'
  process.env.CHAT_ENCRYPTION_KEY = 'explicit-acceptance-chat'
  process.env.CRON_SECRET = 'explicit-acceptance-cron'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  deliver = (await import('@/app/api/trades/[id]/delivery/route')).POST
  confirm = (await import('@/app/api/trades/[id]/confirm/route')).POST
  cron = (await import('@/app/api/cron/auto-confirm/route')).GET
  release = (await import('@/lib/trade-escrow')).finalizeTradeCompletion
  external = await import('@/lib/external-settlement')
  await db.insert(schema.users).values(['accept-buyer', 'accept-seller'].map((id) => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' as const })))
})
after(() => { db?.$client.close(); rmSync(directory, { recursive: true, force: true }) })
const params = (id: string) => ({ params: Promise.resolve({ id }) })
function request(user: string, body: unknown = {}) { return new NextRequest('http://localhost/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt({ userId: user, email: `${user}@test.invalid`, role: 'human' })}` }, body: JSON.stringify(body) }) }
async function fixture(snapshot = true) {
  const [listing] = await db.insert(schema.listings).values({ seller_id: 'accept-seller', category: 'code', title: 'Explicit acceptance', description: 'Acceptance gate test', price_bankr: 1, status: 'sold' }).returning()
  const [trade] = await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: 'accept-buyer', seller_id: 'accept-seller', amount: 1, fee: 0, seller_amount: 1, status: 'escrow_held', payment_rail: 'ledger' }).returning()
  const [service] = await db.insert(schema.service_definitions).values({ id: crypto.randomUUID(), seller_id: trade.seller_id, title: 'Explicit acceptance', description: 'Acceptance gate test', price_minor: 100, active_orders: 1, verification_policy: JSON.stringify(policy) }).returning()
  const { captureServiceExecutionContract } = await import('@/lib/service-execution-contract')
  const [order] = await db.insert(schema.service_orders).values({ id: crypto.randomUUID(), service_id: service.id, trade_id: trade.id, listing_id: listing.id, buyer_id: trade.buyer_id, client_reference: crypto.randomUUID(), objective: 'Review explicit acceptance', price_minor: 100, state: 'funded', payment_rail: 'ledger', execution_contract_json: snapshot ? captureServiceExecutionContract(service, []) : null }).returning()
  const payload = { summary: 'A completed report for explicit buyer review.', artifact: { status: 'done' } }
  const response = await deliver(request(trade.seller_id, payload), params(trade.id))
  assert.equal(response.status, 201, await response.clone().text())
  await db.insert(schema.wallets).values({ user_id: trade.buyer_id, balance: 0, escrow: 1 }).onConflictDoUpdate({ target: schema.wallets.user_id, set: { balance: 0, escrow: 1 } })
  const [current] = await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id))
  return { trade: current, service, order, payload }
}

test('explicit acceptance holds beyond auto-confirm, ignores edited service terms and gates required evidence', async () => {
  const f = await fixture()
  assert.equal(f.trade.auto_confirm_at, null)
  await db.update(schema.service_definitions).set({ verification_policy: '{"required":true,"methods":["buyer_review"]}' }).where(eq(schema.service_definitions.id, f.service.id))
  await db.update(schema.trades).set({ auto_confirm_at: '2000-01-01T00:00:00.000Z' }).where(eq(schema.trades.id, f.trade.id))
  const cronResponse = await cron(new NextRequest('http://localhost/api/cron/auto-confirm', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }))
  assert.equal(cronResponse.status, 200, await cronResponse.clone().text())
  assert.equal((await cronResponse.json()).explicit_acceptance_held, 1)
  await assert.rejects(release(f.trade, 'auto_confirm'), { code: 'EXPLICIT_ACCEPTANCE_REQUIRED' })
  assert.equal((await confirm(request(f.trade.seller_id), params(f.trade.id))).status, 403)
  await db.update(schema.verification_results).set({ status: 'failed' }).where(and(eq(schema.verification_results.trade_id, f.trade.id), eq(schema.verification_results.method, 'assertions')))
  const blocked = await confirm(request(f.trade.buyer_id), params(f.trade.id))
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json()).code, 'REQUIRED_VERIFICATION_MISSING')
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.id, f.trade.id)))[0].status, 'pending_release')
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, f.order.id)))[0].capacity_released_at, null)
  assert.equal((await db.select().from(schema.verification_results).where(and(eq(schema.verification_results.trade_id, f.trade.id), eq(schema.verification_results.method, 'buyer_review'))))[0].status, 'pending')
  await db.update(schema.verification_results).set({ status: 'passed' }).where(and(eq(schema.verification_results.trade_id, f.trade.id), eq(schema.verification_results.method, 'assertions')))
  assert.equal((await confirm(request(f.trade.buyer_id), params(f.trade.id))).status, 200)
  assert.equal((await deliver(request(f.trade.seller_id, f.payload), params(f.trade.id))).status, 200)
  assert.equal((await confirm(request(f.trade.buyer_id), params(f.trade.id))).status, 400)
  assert.equal((await db.select().from(schema.transactions).where(and(eq(schema.transactions.reference_id, f.trade.id), eq(schema.transactions.type, 'escrow_release')))).length, 1)
  assert.equal((await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.service.id)))[0].active_orders, 0)
})

test('external payout creation and queued transfer processing cannot bypass explicit buyer acceptance', async () => {
  const f = await fixture()
  const [trade] = await db.update(schema.trades).set({ payment_rail: 'evm' }).where(eq(schema.trades.id, f.trade.id)).returning()
  await assert.rejects(external.settleExternallyFundedTrade(trade, 100, { process: false }), { code: 'EXPLICIT_ACCEPTANCE_REQUIRED' })
  assert.equal((await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.trade_id, trade.id))).length, 0)
  const [transfer] = await db.insert(schema.settlement_transfers).values({ business_key: `${trade.id}:seller_payout`, trade_id: trade.id, kind: 'seller_payout', chain_id: 8453, token_address: `0x${'11'.repeat(20)}`, from_address: `0x${'22'.repeat(20)}`, to_address: `0x${'33'.repeat(20)}`, token_amount: '1000000', usd_amount: 1 }).returning()
  await assert.rejects(external.processSettlementTransfer(transfer.id), { code: 'EXPLICIT_ACCEPTANCE_REQUIRED' })
  const [saved] = await db.select().from(schema.settlement_transfers).where(eq(schema.settlement_transfers.id, transfer.id))
  assert.equal(saved.attempts, 0); assert.equal(saved.raw_transaction, null); assert.equal(saved.nonce, null)
})

test('historical null snapshots keep their existing settlement terms', async () => {
  const f = await fixture(false)
  const { tradeAcceptanceStatus } = await import('@/lib/trade-acceptance')
  assert.equal((await tradeAcceptanceStatus(f.trade.id)).mode, 'legacy_settlement')
  assert.notEqual(f.trade.auto_confirm_at, null)
  assert.equal((await release(f.trade, 'auto_confirm')).status, 'completed')
  const [review] = await db.select().from(schema.verification_results).where(and(eq(schema.verification_results.trade_id, f.trade.id), eq(schema.verification_results.method, 'buyer_review')))
  assert.equal(review.status, 'skipped')
})

test('explicit acceptance preserves buyer dispute rights and corrupt snapshots fail closed', async () => {
  const f = await fixture()
  const dispute = (await import('@/app/api/trades/[id]/dispute/route')).POST
  const response = await dispute(request(f.trade.buyer_id, { reason: 'The report does not meet the agreed acceptance criteria.' }), params(f.trade.id))
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.id, f.trade.id)))[0].status, 'disputed')
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.reference_id, f.trade.id))).length, 0)
  assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, f.order.id)))[0].capacity_released_at, null)
  const corrupt = await fixture()
  await db.update(schema.service_orders).set({ execution_contract_json: '{}' }).where(eq(schema.service_orders.id, corrupt.order.id))
  const blocked = await confirm(request(corrupt.trade.buyer_id), params(corrupt.trade.id))
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json()).code, 'ACCEPTANCE_CONTRACT_INVALID')
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.reference_id, corrupt.trade.id))).length, 0)
})
