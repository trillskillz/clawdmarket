import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let upload: typeof import('@/app/api/trades/[id]/artifacts/route').POST
let list: typeof import('@/app/api/trades/[id]/artifacts/route').GET
let download: typeof import('@/app/api/trades/[id]/artifacts/[artifactId]/route').GET
let deliver: typeof import('@/app/api/trades/[id]/delivery/route').POST
let inspect: typeof import('@/app/api/trades/[id]/verification/route').GET
let confirm: typeof import('@/app/api/trades/[id]/confirm/route').POST

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-private-artifacts-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'private.db')}`
  process.env.JWT_SECRET = 'artifact-test-jwt'
  process.env.CHAT_ENCRYPTION_KEY = 'artifact-test-encryption'
  process.env.WEBHOOK_SECRET_KEY = 'artifact-test-webhooks'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  ;({ POST: upload, GET: list } = await import('@/app/api/trades/[id]/artifacts/route'))
  download = (await import('@/app/api/trades/[id]/artifacts/[artifactId]/route')).GET
  deliver = (await import('@/app/api/trades/[id]/delivery/route')).POST
  inspect = (await import('@/app/api/trades/[id]/verification/route')).GET
  confirm = (await import('@/app/api/trades/[id]/confirm/route')).POST
  await db.insert(schema.users).values(['artifact-buyer', 'artifact-seller', 'artifact-outsider'].map((id) => ({
    id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' as const,
  })))
})
after(() => { db?.$client.close(); rmSync(directory, { recursive: true, force: true }) })
function request(path: string, user = 'artifact-seller', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${jwt({ userId: user, email: `${user}@test.invalid`, role: 'human' })}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const body = (text: string, extra: Record<string, unknown> = {}) => ({
  client_reference: `file:${crypto.randomUUID()}`, name: 'report.txt', media_type: 'text/plain',
  content_base64: Buffer.from(text).toString('base64'), sha256: createHash('sha256').update(text).digest('hex'), ...extra,
})
async function fixture(leased = false, verified = false) {
  const [listing] = await db.insert(schema.listings).values({ seller_id: 'artifact-seller', category: 'code', title: 'Private report', description: 'Private artifact fixture', price_bankr: 1, status: 'sold' }).returning()
  const [trade] = await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: 'artifact-buyer', seller_id: 'artifact-seller', amount: 1, fee: 0, status: 'escrow_held', payment_rail: 'ledger' }).returning()
  const [service] = await db.insert(schema.service_definitions).values({ id: crypto.randomUUID(), seller_id: 'artifact-seller', title: 'Private report', description: 'Private artifact fixture', price_minor: 100, status: 'active', active_orders: 1, provider_protocol: leased ? 'leased_v1' : 'manual',
    ...(verified ? { output_schema: JSON.stringify({ type: 'object', properties: { findings: { type: 'array' }, sources: { type: 'array' } }, required: ['findings', 'sources'], additionalProperties: false }), verification_policy: '{"required":true,"methods":["buyer_review","schema","source_urls"],"minimum_sources":2}' } : {}),
  }).returning()
  const [order] = await db.insert(schema.service_orders).values({ id: crypto.randomUUID(), service_id: service.id, trade_id: trade.id, listing_id: listing.id, buyer_id: trade.buyer_id, client_reference: crypto.randomUUID(), objective: 'Read the private report', price_minor: 100, payment_rail: 'ledger', state: 'funded' }).returning()
  const [route] = await db.insert(schema.route_plans).values({ id: crypto.randomUUID(), buyer_id: trade.buyer_id, client_reference: crypto.randomUUID(), objective: 'Read the private report', required_capabilities: '[]', max_budget_minor: 100, expires_at: new Date(Date.now() + 86400_000), service_order_id: order.id, state: 'funded' }).returning()
  let attemptId: string | undefined
  if (leased) {
    attemptId = crypto.randomUUID()
    await db.insert(schema.service_execution_attempts).values({ id: attemptId, order_id: order.id, state: 'accepted', accepted_at: new Date(), lease_expires_at: new Date(Date.now() + 300_000) })
  }
  return { trade, service, order, route, attemptId }
}
async function put(id: string, input: unknown) { return upload(request(`/api/trades/${id}/artifacts`, 'artifact-seller', input), params(id)) }
async function get(id: string, artifactId: string, user = 'artifact-buyer') { return download(request(`/api/trades/${id}/artifacts/${artifactId}`, user), { params: Promise.resolve({ id, artifactId }) }) }

test('encrypted private uploads, ownership, media/hash limits and exact recovery', async () => {
  const { trade, order, route } = await fixture()
  const secret = 'Private report payload must never appear in evidence or public metadata.'
  const input = body(secret, { provenance: { description: 'Generated from buyer input', source_uri: 'http://127.0.0.1:9/private' } })
  assert.equal((await upload(request('/api/unused', '', input), params(trade.id))).status, 401)
  assert.equal((await upload(request('/api/unused', 'artifact-outsider', input), params(trade.id))).status, 404)
  assert.equal((await upload(request('/api/unused', 'artifact-buyer', input), params(trade.id))).status, 403)
  const cookie = new NextRequest('http://localhost/api/unused', { method: 'POST', headers: { Cookie: `auth-token=${jwt({ userId: 'artifact-seller', email: 'artifact-seller@test.invalid', role: 'human' })}` }, body: JSON.stringify(input) })
  assert.equal((await upload(cookie, params(trade.id))).status, 403)
  const response = await put(trade.id, input)
  assert.equal(response.status, 201, await response.clone().text())
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  const metadata = (await response.json()).artifact
  assert.equal(metadata.order_id, order.id); assert.equal(metadata.route_id, route.id)
  assert.equal(metadata.provenance.verified, false)
  assert.equal(metadata.retention_hold, true)
  assert.equal((await put(trade.id, input)).status, 200)
  assert.equal((await put(trade.id, { ...input, name: 'changed.txt' })).status, 409)
  const rows = await db.select().from(schema.private_artifact_payloads)
  assert.equal(JSON.stringify(rows).includes(secret), false)
  assert.equal(JSON.stringify(rows).includes(input.content_base64), false)
  const listing = await list(request('/api/unused', 'artifact-buyer'), params(trade.id))
  assert.equal(JSON.stringify(await listing.json()).includes(input.content_base64), false)
  assert.equal((await list(request('/api/unused', 'artifact-outsider'), params(trade.id))).status, 404)
  assert.equal((await get(trade.id, metadata.id, 'artifact-outsider')).status, 404)
  assert.equal((await get(trade.id, metadata.id, '')).status, 401)
  const another = await fixture()
  assert.equal((await get(another.trade.id, metadata.id)).status, 404)
  const bytes = await get(trade.id, metadata.id)
  assert.equal(await bytes.text(), secret)
  assert.equal(bytes.headers.get('Content-Disposition'), 'attachment; filename="report.txt"')
  assert.equal(bytes.headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(bytes.headers.get('X-Artifact-SHA256'), input.sha256)
  assert.equal(bytes.headers.get('Content-Security-Policy'), "sandbox; default-src 'none'")
  for (const invalid of [{ media_type: 'text/html' }, { content_base64: '!!!!' }, { name: '../escape' }, { sha256: '0'.repeat(64) }, { media_type: 'application/pdf' }, { media_type: 'application/json' }]) {
    const result = await put(trade.id, { ...input, client_reference: crypto.randomUUID(), ...invalid })
    assert.ok([400, 422].includes(result.status), await result.text())
  }
  const tooLarge = request('/api/unused', 'artifact-seller', { padding: 'x'.repeat(96_001) })
  assert.equal((await upload(tooLarge, params(trade.id))).status, 413)
  await db.update(schema.trades).set({ status: 'pending' }).where(eq(schema.trades.id, another.trade.id))
  assert.equal((await put(another.trade.id, body('not funded'))).status, 409)
})

test('private JSON fails safely, corrects, links one delivery, then needs existing buyer acceptance', async () => {
  const f = await fixture(true, true)
  const bad = body('{"findings":"wrong","sources":["https://example.com/a","https://example.com/a#duplicate"]}', { media_type: 'application/json', name: 'bad.json', execution_attempt_id: f.attemptId })
  assert.equal((await put(f.trade.id, { ...bad, execution_attempt_id: crypto.randomUUID() })).status, 409)
  const badId = (await (await put(f.trade.id, bad)).json()).artifact.id
  const failed = await deliver(request('/api/unused', 'artifact-seller', { summary: 'A report with schema checks for private artifacts.', artifact_ids: [badId], verification_artifact_id: badId, execution_attempt_id: f.attemptId }), params(f.trade.id))
  assert.equal(failed.status, 422)
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.id, f.trade.id)))[0].status, 'escrow_held')
  assert.equal((await db.select().from(schema.service_execution_attempts).where(eq(schema.service_execution_attempts.id, f.attemptId!)))[0].state, 'accepted')
  const privateText = 'Confidential finding: correct the authorization check.'
  const good = body(JSON.stringify({ findings: [privateText], sources: ['https://example.com/a', 'https://example.org/b'] }), { media_type: 'application/json', name: 'result.json', execution_attempt_id: f.attemptId })
  const goodId = (await (await put(f.trade.id, good)).json()).artifact.id
  const textId = (await (await put(f.trade.id, body(privateText, { execution_attempt_id: f.attemptId }))).json()).artifact.id
  const payload = { summary: 'A corrected report with private attachments for buyer review.', execution_attempt_id: f.attemptId, artifact_ids: [goodId, textId], verification_artifact_id: goodId }
  assert.equal((await deliver(request('/api/unused', 'artifact-seller', { ...payload, artifact_ids: [goodId, goodId] }), params(f.trade.id))).status, 400)
  assert.equal((await deliver(request('/api/unused', 'artifact-seller', { ...payload, artifact: {} }), params(f.trade.id))).status, 400)
  const result = await deliver(request('/api/unused', 'artifact-seller', payload), params(f.trade.id))
  assert.equal(result.status, 201, await result.clone().text())
  const receipt = await result.json()
  assert.equal(receipt.delivery.artifact_json, null)
  const current = await inspect(request('/api/unused', 'artifact-buyer'), params(f.trade.id))
  const verification = await current.json()
  assert.equal(verification.categories.artifact_integrity_verified, true)
  assert.equal(verification.categories.structure_verified, true)
  assert.equal(verification.categories.source_list_verified, true)
  assert.equal(verification.categories.buyer_accepted, false)
  assert.equal(verification.categories.provenance_verified, false)
  assert.equal(verification.categories.semantic_verified, false)
  assert.equal(JSON.stringify(verification).includes(privateText), false)
  assert.equal(verification.results.filter((row: { status: string }) => row.status === 'failed').length, 2)
  assert.equal(verification.artifacts.filter((row: { delivery_id: string }) => row.delivery_id === receipt.delivery.id).length, 2)
  const { decryptMessage } = await import('@/lib/chat-crypto')
  const messages = await db.select().from(schema.messages).where(eq(schema.messages.sender_id, 'artifact-seller'))
  assert.equal((await Promise.all(messages.map((row) => decryptMessage(row.encrypted_content, row.nonce)))).some((text) => text.includes(privateText)), false)
  assert.equal(await (await get(f.trade.id, textId)).text(), privateText)
  assert.equal((await put(f.trade.id, body('a new file after delivery', { execution_attempt_id: f.attemptId }))).status, 409)
  await db.insert(schema.wallets).values({ user_id: f.trade.buyer_id, balance: 0, escrow: 1 }).onConflictDoUpdate({ target: schema.wallets.user_id, set: { balance: 0, escrow: 1 } })
  assert.equal((await confirm(request('/api/unused', 'artifact-seller', {}), params(f.trade.id))).status, 403)
  const accepted = await confirm(request('/api/unused', 'artifact-buyer', {}), params(f.trade.id))
  assert.equal(accepted.status, 200, await accepted.clone().text())
  assert.equal((await deliver(request('/api/unused', 'artifact-seller', payload), params(f.trade.id))).status, 200)
  assert.equal((await put(f.trade.id, good)).status, 200)
  assert.equal((await db.select().from(schema.transactions).where(and(eq(schema.transactions.reference_id, f.trade.id), eq(schema.transactions.type, 'escrow_release')))).length, 1)
  assert.equal((await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, f.trade.id))).length, 1)
  assert.equal((await inspect(request('/api/unused', 'artifact-buyer'), params(f.trade.id)).then((response) => response.json())).categories.buyer_accepted, true)
})

test('ciphertext swaps and metadata corruption are withheld and recorded before delivery', async () => {
  const { trade } = await fixture()
  const a = (await (await put(trade.id, body('secret alpha'))).json()).artifact
  const b = (await (await put(trade.id, body('secret beta'))).json()).artifact
  const [first] = await db.select().from(schema.private_artifact_payloads).where(eq(schema.private_artifact_payloads.artifact_id, a.id))
  const [second] = await db.select().from(schema.private_artifact_payloads).where(eq(schema.private_artifact_payloads.artifact_id, b.id))
  await db.update(schema.private_artifact_payloads).set({ ciphertext: second.ciphertext, nonce: second.nonce }).where(eq(schema.private_artifact_payloads.artifact_id, a.id))
  assert.equal((await get(trade.id, a.id)).status, 422)
  const payload = { summary: 'Review the private artifact report for integrity.', artifact_ids: [a.id] }
  assert.equal((await deliver(request('/api/unused', 'artifact-seller', payload), params(trade.id))).status, 422)
  const failures = await db.select().from(schema.verification_results).where(eq(schema.verification_results.trade_id, trade.id))
  assert.equal(failures[0].method, 'artifact_integrity_failure'); assert.equal(failures[0].status, 'failed')
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id)))[0].status, 'escrow_held')
  await db.update(schema.private_artifact_payloads).set({ ciphertext: first.ciphertext, nonce: first.nonce }).where(eq(schema.private_artifact_payloads.artifact_id, a.id))
  await db.update(schema.private_artifacts).set({ name: 'forged.txt' }).where(eq(schema.private_artifacts.id, a.id))
  assert.equal((await get(trade.id, a.id)).status, 422)
  await db.update(schema.private_artifacts).set({ name: 'report.txt' }).where(eq(schema.private_artifacts.id, a.id))
  assert.equal((await deliver(request('/api/unused', 'artifact-seller', payload), params(trade.id))).status, 201)
  const evidence = await inspect(request('/api/unused', 'artifact-buyer'), params(trade.id)).then((response) => response.json())
  assert.equal(evidence.categories.artifact_integrity_verified, true)
  assert.equal(evidence.results.some((row: { method: string; status: string }) => row.method === 'artifact_integrity_failure' && row.status === 'failed'), true)
})

test('independent processes serialize byte/count quotas and identical upload recovery', async () => {
  const { trade } = await fixture()
  const input = body('z'.repeat(65_536))
  const once = (data: unknown) => promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e',
    "import { uploadPrivateArtifact } from './lib/private-artifacts.ts'; try { const result = await uploadPrivateArtifact(process.env.ARTIFACT_TEST_TRADE, 'artifact-seller', JSON.parse(process.env.ARTIFACT_TEST_BODY)); console.log(JSON.stringify(result)); } catch(error) { console.log(JSON.stringify({status:error.status,code:error.code})); }"],
    { env: { ...process.env, ARTIFACT_TEST_TRADE: trade.id, ARTIFACT_TEST_BODY: JSON.stringify(data) } }).then(({ stdout }) => JSON.parse(stdout))
  const execute = async (data: unknown) => {
    for (let retry = 0; retry < 4; retry++) {
      const result = await once(data)
      if (result.status !== 503) return result
      assert.equal(result.code, 'ARTIFACT_STORAGE_BUSY')
      // Exercise the documented client recovery contract on slower CI runners.
      // The exact reference/body survives each fresh process and bounded server attempt.
      await new Promise((resolve) => setTimeout(resolve, 100 * (retry + 1)))
    }
    assert.fail('Same-reference upload recovery remained busy after bounded client retries')
  }
  const same = await Promise.all([execute(input), execute(input)])
  assert.equal(new Set(same.map((value) => value.artifact.id)).size, 1)
  assert.ok(same.filter((value) => value.idempotent === false).length <= 1)
  assert.ok(same.every((value) => typeof value.idempotent === 'boolean'))
  const races = await Promise.all(Array.from({ length: 4 }, () => execute({ ...input, client_reference: crypto.randomUUID() })))
  assert.equal(races.filter((value) => value.status === 413).length, 1, JSON.stringify(races))
  const rows = await db.select().from(schema.private_artifacts).where(eq(schema.private_artifacts.trade_id, trade.id))
  assert.equal(rows.length, 4); assert.equal(rows.reduce((sum, row) => sum + row.size_bytes, 0), 262_144)
  const small = await fixture()
  await Promise.all(Array.from({ length: 8 }, () => put(small.trade.id, body('tiny'))))
  assert.equal((await put(small.trade.id, body('ninth'))).status, 413)
})

test('retention purges expired terminal bytes, holds disputes and preserves metadata and exact replay', async () => {
  const { purgeExpiredArtifacts } = await import('@/lib/private-artifacts')
  const { trade } = await fixture()
  const input = body('Retained private payload')
  const id = (await (await put(trade.id, input)).json()).artifact.id
  await db.update(schema.private_artifacts).set({ retention_expires_at: new Date(Date.now() - 1000) }).where(eq(schema.private_artifacts.id, id))
  await db.update(schema.trades).set({ status: 'disputed' }).where(eq(schema.trades.id, trade.id))
  assert.equal(await purgeExpiredArtifacts(), 0)
  assert.equal((await get(trade.id, id)).status, 200)
  await db.update(schema.trades).set({ status: 'resolved' }).where(eq(schema.trades.id, trade.id))
  assert.equal((await get(trade.id, id)).status, 410)
  assert.equal(await purgeExpiredArtifacts(), 1)
  assert.equal(await purgeExpiredArtifacts(), 0)
  assert.equal((await db.select().from(schema.private_artifact_payloads).where(eq(schema.private_artifact_payloads.artifact_id, id))).length, 0)
  assert.equal((await put(trade.id, input)).status, 200)
  const listed = await list(request('/api/unused', 'artifact-buyer'), params(trade.id)).then((response) => response.json())
  assert.ok(listed.artifacts[0].purged_at)
  assert.equal(listed.artifacts[0].retention_hold, false)
  assert.equal((await get(trade.id, id)).status, 410)
})

test('streamed request limits and stalled-reader deadlines apply before JSON parsing', async () => {
  const { readBoundedJson } = await import('@/lib/private-artifacts')
  let cancelled = false
  const oversized = new Request('http://localhost', { method: 'POST', body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(32)) }, cancel() { cancelled = true } }), duplex: 'half' } as RequestInit)
  await assert.rejects(readBoundedJson(oversized, 16, 100), (error: unknown) => (error as { status: number }).status === 413)
  assert.equal(cancelled, true)
  const stalled = new Request('http://localhost', { method: 'POST', body: new ReadableStream(), duplex: 'half' } as RequestInit)
  await assert.rejects(readBoundedJson(stalled, 16, 10), (error: unknown) => (error as { status: number }).status === 408)
})

test('buyer disputes an artifact-bearing delivery through the existing gate without releasing escrow', async () => {
  const { POST: dispute } = await import('@/app/api/trades/[id]/dispute/route')
  const { trade } = await fixture()
  const id = (await (await put(trade.id, body('A private result subject to buyer review'))).json()).artifact.id
  assert.equal((await deliver(request('/api/unused', 'artifact-seller', { summary: 'A delivered report awaiting buyer approval or dispute.', artifact_ids: [id] }), params(trade.id))).status, 201)
  const response = await dispute(request('/api/unused', 'artifact-buyer', { reason: 'The artifact does not satisfy the agreed acceptance criteria.' }), params(trade.id))
  assert.equal(response.status, 200, await response.clone().text())
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.id, trade.id)))[0].status, 'disputed')
  assert.equal((await confirm(request('/api/unused', 'artifact-buyer', {}), params(trade.id))).status, 400)
  assert.equal((await db.select().from(schema.transactions).where(eq(schema.transactions.reference_id, trade.id))).length, 0)
  const evidence = await inspect(request('/api/unused', 'artifact-buyer'), params(trade.id)).then((result) => result.json())
  assert.equal(evidence.categories.buyer_accepted, false)
  assert.equal(evidence.results.find((row: { method: string }) => row.method === 'buyer_review').status, 'disputed')
  assert.equal((await get(trade.id, id)).status, 200)
})
