import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let api: typeof import('@/app/api/benchmarks/route')
let detail: typeof import('@/app/api/benchmarks/[id]/route').GET
let score: typeof import('@/app/api/benchmarks/[id]/score/route').POST
let hashKey: typeof import('@/lib/registered-agent-auth').hashAgentApiKey
let jwt: typeof import('@/lib/auth').generateJWT

before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-peer-benchmarks-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'benchmarks.db')}`
  process.env.TURSO_AUTH_TOKEN = ''
  process.env.JWT_SECRET = 'peer-benchmark-test-only'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  api = await import('@/app/api/benchmarks/route')
  detail = (await import('@/app/api/benchmarks/[id]/route')).GET
  score = (await import('@/app/api/benchmarks/[id]/score/route')).POST
  hashKey = (await import('@/lib/registered-agent-auth')).hashAgentApiKey
  jwt = (await import('@/lib/auth')).generateJWT
})
after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })

async function agent(prefix: string, extra: Partial<typeof schema.agents.$inferInsert> = {}) {
  const id = `${prefix}-${crypto.randomUUID()}`
  await db.insert(schema.agents).values({ id, name: id, description: 'Peer test', capabilities: '["data-analysis"]', endpoint: '', owner_address: '', api_key: hashKey(`key-${id}`), status: 'active', ...extra })
  return id
}
async function owner(agentId: string, userId = crypto.randomUUID()) {
  await db.insert(schema.users).values({ id: userId, email: `${userId}@test.invalid`, name: userId, password_hash: 'unused', role: 'human' }).onConflictDoNothing()
  await db.insert(schema.agent_owners).values({ agentId, userId, establishedBy: 'test' })
  return userId
}
function request(path: string, agentId?: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(agentId ? { Authorization: `Bearer key-${agentId}` } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
function context(id: string) { return { params: Promise.resolve({ id }) } }
async function create(target: string, evaluator: string, extra: Record<string, unknown> = {}) {
  return api.POST(request('/api/benchmarks', evaluator, { agent_id: target, capability: 'analysis', test_input: 'PRIVATE_INPUT', client_reference: crypto.randomUUID(), ...extra }))
}
async function createdPair() {
  const target = await agent('target'), evaluator = await agent('evaluator')
  const response = await create(target, evaluator)
  assert.equal(response.status, 201)
  return { target, evaluator, id: (await response.json()).benchmark_id as string }
}

test('public peer metadata excludes all raw materials and hidden/inactive/archived targets', async () => {
  const { id, target } = await createdPair()
  const publicResponse = await api.GET(request(`/api/benchmarks?agent_id=${target}`))
  assert.equal(publicResponse.headers.get('Cache-Control'), 'private, no-store')
  const publicBody = await publicResponse.json()
  assert.equal(publicBody.total, 1)
  assert.equal(publicBody.benchmarks[0].capability, 'data-analysis')
  assert.equal(publicBody.benchmarks[0].evidence.kind, 'peer_asserted')
  assert.equal(JSON.stringify(publicBody).includes('PRIVATE_INPUT'), false)
  for (const field of ['testInput', 'testOutput', 'notes', 'scoringRubric', 'evaluatorAgentId', 'clientReference']) assert.equal(field in publicBody.benchmarks[0], false)
  for (const change of [{ visibility: 'private' as const }, { visibility: 'public' as const, status: 'inactive' as const }, { status: 'active' as const, archivedAt: new Date() }]) {
    await db.update(schema.agents).set(change).where(eq(schema.agents.id, target))
    assert.equal((await (await api.GET(request(`/api/benchmarks?agent_id=${target}`))).json()).total, 0)
  }
  assert.equal((await db.select().from(schema.benchmarks).where(eq(schema.benchmarks.id, id))).length, 1)
  for (const limit of ['0', '-1', '1.5', 'NaN']) assert.equal((await api.GET(request(`/api/benchmarks?limit=${limit}`))).status, 400)
})

test('creation binds the original evaluator and UUID reference; exact recovery preserves one ID', async () => {
  const target = await agent('reference-target'), evaluator = await agent('reference-evaluator')
  const reference = crypto.randomUUID()
  const responses = await Promise.all([create(target, evaluator, { client_reference: reference }), create(target, evaluator, { client_reference: reference })])
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201])
  const results = await Promise.all(responses.map((r) => r.json()))
  assert.equal(results[0].benchmark_id, results[1].benchmark_id)
  assert.equal(results[0].evaluator_agent_id, evaluator)
  assert.equal((await create(target, evaluator, { client_reference: reference, test_input: 'altered' })).status, 409)
  const other = await agent('other-evaluator')
  const otherResult = await (await create(target, other, { client_reference: reference })).json()
  assert.notEqual(otherResult.benchmark_id, results[0].benchmark_id)
})

test('self/shared-owner/reference evaluation is rejected without creating a claim', async () => {
  const target = await agent('ineligible-target'), evaluator = await agent('ineligible-evaluator')
  assert.equal((await create(target, target)).status, 403)
  const shared = await owner(target)
  await owner(evaluator, shared)
  assert.equal((await create(target, evaluator)).status, 403)
  const { REFERENCE_FLEET_MARKER } = await import('@/lib/reference-fleet-manifest')
  const reference = await agent('reference', { description: REFERENCE_FLEET_MARKER })
  assert.equal((await create(target, reference)).status, 403)
  assert.equal((await create(reference, await agent('normal-evaluator'))).status, 403)
  const hidden = await agent('private-target', { visibility: 'private' })
  assert.equal((await create(hidden, evaluator)).status, 404)
})

test('private material is available only to participants and their current linked owners', async () => {
  const { target, evaluator, id } = await createdPair()
  const stranger = await agent('private-stranger')
  for (const caller of [undefined, stranger]) assert.equal((await detail(request(`/api/benchmarks/${id}`, caller), context(id))).status, 404)
  for (const caller of [target, evaluator]) {
    const response = await detail(request(`/api/benchmarks/${id}`, caller), context(id))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
    assert.equal((await response.json()).benchmark.testInput, 'PRIVATE_INPUT')
  }
  const userId = await owner(target)
  const ownerRequest = () => new NextRequest(`http://localhost/api/benchmarks/${id}`, { headers: { Authorization: `Bearer ${jwt({ userId, email: `${userId}@test.invalid`, role: 'human' })}` } })
  assert.equal((await detail(ownerRequest(), context(id))).status, 200)
  await db.delete(schema.agent_owners).where(eq(schema.agent_owners.agentId, target))
  assert.equal((await detail(ownerRequest(), context(id))).status, 404)
})

test('only the creator can score; exact concurrent replay is immutable and never raises quality aggregates', async () => {
  const { target, evaluator, id } = await createdPair()
  const stranger = await agent('score-stranger')
  const path = `/api/benchmarks/${id}/score`
  const body = { score: 95, test_output: 'PRIVATE_OUTPUT', notes: 'PRIVATE_NOTES' }
  for (const caller of [target, stranger]) assert.equal((await score(request(path, caller, body), context(id))).status, 404)
  const responses = await Promise.all([score(request(path, evaluator, body), context(id)), score(request(path, evaluator, body), context(id))])
  assert.deepEqual(responses.map((r) => r.status), [200, 200])
  const results = await Promise.all(responses.map((r) => r.json()))
  assert.deepEqual(results.map((r) => r.reused).sort(), [false, true])
  assert.equal(results[0].evidence.measured_quality_score, null)
  assert.equal(results[0].evidence.routing_eligible, false)
  assert.equal((await score(request(path, evaluator, { ...body, score: 96 }), context(id))).status, 409)
  const [profile] = await db.select().from(schema.agents).where(eq(schema.agents.id, target))
  assert.equal(profile.benchmarkScore, null)
  assert.equal(profile.benchmarkCount, 0)
  assert.equal(profile.benchmarkHistory, '[]')
  assert.equal(profile.velocityScore, null)
  assert.equal((await db.select().from(schema.capability_performance_events)).length, 0)
  const publicBody = await (await api.GET(request(`/api/benchmarks?agent_id=${target}`))).json()
  assert.equal(publicBody.benchmarks[0].score, 95)
  assert.equal(JSON.stringify(publicBody).includes('PRIVATE_'), false)
  const replay = await create(target, evaluator, { client_reference: (await (await detail(request(`/api/benchmarks/${id}`, evaluator), context(id))).json()).benchmark.clientReference })
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).status, 'scored')
})

test('current shared-owner, archived and inactive participants cannot score a saved pending claim', async () => {
  const first = await createdPair()
  const shared = await owner(first.target)
  await owner(first.evaluator, shared)
  assert.equal((await score(request(`/api/benchmarks/${first.id}/score`, first.evaluator, { score: 100 }), context(first.id))).status, 403)
  for (const update of [{ status: 'inactive' as const }, { archivedAt: new Date() }]) {
    const pair = await createdPair()
    await db.update(schema.agents).set(update).where(eq(schema.agents.id, pair.target))
    assert.equal((await score(request(`/api/benchmarks/${pair.id}/score`, pair.evaluator, { score: 100 }), context(pair.id))).status, 403)
    assert.equal((await db.select().from(schema.benchmarks).where(eq(schema.benchmarks.id, pair.id)))[0].score, null)
  }
})

test('unknown-author historical rows stay stored and cannot be adopted by an arbitrary evaluator', async () => {
  const target = await agent('legacy-target'), evaluator = await agent('legacy-evaluator')
  const id = `bm_${crypto.randomUUID()}`
  await db.insert(schema.benchmarks).values({ id, agentId: target, capability: 'analysis', testInput: 'PRIVATE_LEGACY', status: 'pending' })
  assert.equal((await score(request(`/api/benchmarks/${id}/score`, evaluator, { score: 100 }), context(id))).status, 404)
  assert.equal((await detail(request(`/api/benchmarks/${id}`, evaluator), context(id))).status, 404)
  const visible = await detail(request(`/api/benchmarks/${id}`, target), context(id))
  assert.equal((await visible.json()).benchmark.evidence.author_known, false)
  assert.equal((await db.select().from(schema.benchmarks).where(eq(schema.benchmarks.id, id)))[0].status, 'pending')
})

test('original creation recovery survives later privacy and ownership changes without granting scoring authority', async () => {
  const target = await agent('recovery-target'), evaluator = await agent('recovery-evaluator')
  const reference = crypto.randomUUID()
  const original = await (await create(target, evaluator, { client_reference: reference })).json()
  await db.update(schema.agents).set({ visibility: 'private' }).where(eq(schema.agents.id, target))
  const shared = await owner(target)
  await owner(evaluator, shared)
  const replay = await create(target, evaluator, { client_reference: reference })
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).benchmark_id, original.benchmark_id)
  assert.equal((await score(request(`/api/benchmarks/${original.benchmark_id}/score`, evaluator, { score: 100 }), context(original.benchmark_id))).status, 403)
  assert.equal((await detail(request(`/api/benchmarks/${original.benchmark_id}`, evaluator), context(original.benchmark_id))).status, 200)
})

test('strict bodies and named credential scopes reject malformed or unauthorized mutations', async () => {
  const { target, evaluator, id } = await createdPair()
  for (const extra of [{ capability: 'invented-quality' }, { evaluator_agent_id: target }, { client_reference: 'not-uuid' }, { test_input: '' }]) assert.equal((await create(target, evaluator, extra)).status, 400)
  for (const body of [{ score: '100' }, { score: -1 }, { score: 101 }, { score: null }, { score: 1, independent: true }]) assert.equal((await score(request(`/api/benchmarks/${id}/score`, evaluator, body), context(id))).status, 400)
  await db.insert(schema.agent_credentials).values({ id: crypto.randomUUID(), agentId: evaluator, name: 'Read only', keyHash: hashKey('readonly-peer-key'), keyPrefix: 'readonly', scopes: '["agent:read"]', createdByType: 'agent', createdAt: new Date() })
  const readOnly = new NextRequest('http://localhost/api/benchmarks', { method: 'POST', headers: { Authorization: 'Bearer readonly-peer-key', 'Content-Type': 'application/json' }, body: JSON.stringify({ agent_id: target, capability: 'analysis', test_input: 'forbidden' }) })
  assert.equal((await api.POST(readOnly)).status, 403)
})
