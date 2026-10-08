import test, { before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createServer } from 'node:http'
import { createLocalTestSchema } from '../helpers/local-schema'
import { runTrustedBenchmark } from '../../scripts/trusted-benchmark-worker.mjs'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let definitions: typeof import('@/app/api/admin/benchmark-definitions/route')
let catalog: typeof import('@/app/api/benchmark-definitions/route')
let retire: typeof import('@/app/api/admin/benchmark-definitions/[id]/route').DELETE
let runs: typeof import('@/app/api/benchmark-runs/route'), detail: typeof import('@/app/api/benchmark-runs/[id]/route')
let submit: typeof import('@/app/api/benchmark-runs/[id]/submission/route').POST
let report: typeof import('@/app/api/benchmark-runs/[id]/report/route').POST
let jwt: typeof import('@/lib/auth').generateJWT, hashKey: typeof import('@/lib/registered-agent-auth').hashAgentApiKey
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-trusted-benchmarks-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'benchmarks.db')}`; process.env.TURSO_AUTH_TOKEN = ''
  process.env.JWT_SECRET = 'trusted-benchmark-test-jwt'; process.env.CHAT_ENCRYPTION_KEY = 'trusted-benchmark-test-chat'
  process.env.ADMIN_USER_IDS = 'benchmark-admin'
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema'); await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT; hashKey = (await import('@/lib/registered-agent-auth')).hashAgentApiKey
  await db.insert(schema.users).values(['benchmark-admin', 'benchmark-owner', 'benchmark-outsider'].map((id) => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' as const })))
  definitions = await import('@/app/api/admin/benchmark-definitions/route'); catalog = await import('@/app/api/benchmark-definitions/route')
  retire = (await import('@/app/api/admin/benchmark-definitions/[id]/route')).DELETE
  runs = await import('@/app/api/benchmark-runs/route'); detail = await import('@/app/api/benchmark-runs/[id]/route')
  submit = (await import('@/app/api/benchmark-runs/[id]/submission/route')).POST; report = (await import('@/app/api/benchmark-runs/[id]/report/route')).POST
})
after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })
beforeEach(async () => { await db.delete(schema.rate_limits) })
function context(id: string) { return { params: Promise.resolve({ id }) } }
function req(path: string, actor?: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const token = actor?.startsWith('benchmark-') ? jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' }) : actor ? `key-${actor}` : ''
  return new NextRequest(`http://localhost${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
async function agent(extra: Partial<typeof schema.agents.$inferInsert> = {}) {
  const id = crypto.randomUUID()
  await db.insert(schema.agents).values({ id, name: id, description: 'Controlled benchmark fixture', capabilities: '["data-extraction"]',
    endpoint: '', owner_address: '', api_key: hashKey(`key-${id}`), benchmarkScore: 77, velocityScore: 12, ...extra })
  return id
}
async function fixture() {
  const target = await agent(), grader = await agent(), stranger = await agent()
  process.env.CLAWDMARKET_BENCHMARK_GRADER_IDS = grader
  const body = { suite_key: `extract-${crypto.randomUUID()}`, version: 1, title: 'Exact extraction fixture', capability_id: 'data-extraction', grader_agent_id: grader,
    adapter: 'json_exact_v1', cases: [{ id: 'a', input: { text: 'PRIVATE_INPUT' }, expected: { name: 'SECRET_EXPECTED' } }, { id: 'b', input: { text: 'Second input' }, expected: [1, 2] }] }
  const published = await definitions.POST(req('/api/admin/benchmark-definitions', 'benchmark-admin', body))
  assert.equal(published.status, 201, JSON.stringify(await published.clone().json()))
  const definition = (await published.json()).definition
  const createBody = { definition_id: definition.id, client_reference: crypto.randomUUID() }
  const created = await runs.POST(req('/api/benchmark-runs', target, createBody))
  assert.equal(created.status, 201)
  const run = (await created.json()).run
  const outputs = { outputs: [{ id: 'b', output: [1, 2] }, { id: 'a', output: { name: 'wrong' } }] }
  return { target, grader, stranger, definition, body, run, createBody, outputs }
}
async function ready() {
  const f = await fixture()
  const result = await submit(req(`/api/benchmark-runs/${f.run.id}/submission`, f.target, f.outputs), context(f.run.id))
  assert.equal(result.status, 200)
  f.run = (await result.json()).run
  return { ...f, report: { version: 1, adapter: 'json_exact_v1', definition_hash: f.run.definition_hash, submission_hash: f.run.submission_hash,
    cases: [{ id: 'a', passed: false }, { id: 'b', passed: true }] } }
}

test('separate server processes converge on one opt-in reference and immutable report', async () => {
  const f = await ready(), reference = crypto.randomUUID()
  const execute = promisify(execFile)
  const once = async (expression: string) => {
    const { stdout } = await execute(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--input-type=module', '-e',
      `const m=await import('./lib/trusted-benchmarks.ts'); try { const result=await (${expression}); console.log(JSON.stringify(result)) } catch(error) { console.log(JSON.stringify({status:error.status,code:error.code})) } finally { const {db}=await import('./lib/db.ts'); db.$client.close() }`], { timeout: 20000, env: { ...process.env } })
    return JSON.parse(stdout.trim())
  }
  const child = async (expression: string) => {
    for (let retry = 0; retry < 4; retry++) {
      const result = await once(expression)
      if (result.status !== 503) return result
      assert.equal(result.code, 'BENCHMARK_STORAGE_BUSY')
      // A bounded busy response resumes the exact request in a fresh process.
      await new Promise((resolve) => setTimeout(resolve, 100 * (retry + 1)))
    }
    assert.fail('Same-request recovery remained busy after bounded client retries')
  }
  const creates = await Promise.all([1, 2].map(() => child(`m.createBenchmarkRun(${JSON.stringify(f.target)},${JSON.stringify({ definition_id: f.definition.id, client_reference: reference })})`)))
  assert.equal(creates[0].run.id, creates[1].run.id)
  assert.deepEqual(creates.map((item) => item.reused).sort(), [false, true])
  const reports = await Promise.all([1, 2].map(() => child(`m.submitBenchmarkReport(${JSON.stringify(f.run.id)},${JSON.stringify(f.grader)},${JSON.stringify(f.report)})`)))
  assert.equal(reports[0].run.report_hash, reports[1].run.report_hash)
  assert.deepEqual(reports.map((item) => item.reused).sort(), [false, true])
})

test('the CLI survives process death after HTTP report commit and recovers without a second POST', async () => {
  const f = await ready(), stateDirectory = join(directory, crypto.randomUUID())
  let posts = 0, killWorker: (() => void) | undefined
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const chunks: Buffer[] = []
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
      const request = new NextRequest(`http://localhost${incoming.url}`, { method: incoming.method,
        headers: { Authorization: String(incoming.headers.authorization || '') },
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) })
      const response = incoming.method === 'POST' ? await report(request, context(f.run.id)) : await detail.GET(request, context(f.run.id))
      if (incoming.method === 'POST' && ++posts === 1) {
        assert.equal(response.status, 200)
        killWorker!()
        outgoing.destroy()
        return
      }
      outgoing.writeHead(response.status, { 'Content-Type': 'application/json', Connection: 'close' })
      outgoing.end(await response.text())
    })().catch((error) => { outgoing.destroy(error) })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const execute = () => new Promise<{ code: number | null; signal: string | null; stdout: string }>((resolve, reject) => {
    const worker = spawn(process.execPath, ['scripts/trusted-benchmark-worker.mjs', f.run.id, stateDirectory], { detached: true,
      env: { ...process.env, BASE_URL: `http://127.0.0.1:${address.port}`, CLAWDMARKET_BENCHMARK_GRADER_API_KEY: `key-${f.grader}` }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    worker.stdout.on('data', (chunk) => { stdout += chunk }); worker.stderr.on('data', (chunk) => { stderr += chunk })
    killWorker = () => { if (worker.pid) process.kill(-worker.pid, 'SIGKILL') }
    const timeout = setTimeout(() => { killWorker!(); reject(new Error(`Worker timed out: ${stderr}`)) }, 15000)
    worker.on('error', (error) => { clearTimeout(timeout); reject(error) })
    worker.on('exit', (code, signal) => { clearTimeout(timeout); resolve({ code, signal, stdout }) })
  })
  try {
    const killed = await execute()
    assert.equal(killed.signal, 'SIGKILL')
    const recovered = await execute()
    assert.equal(recovered.code, 0)
    const receipt = JSON.parse(recovered.stdout.trim())
    assert.equal(receipt.state, 'graded'); assert.equal(receipt.reused, true); assert.equal(posts, 1)
    const authoritative = await (await detail.GET(req(`/api/benchmark-runs/${f.run.id}`, f.target), context(f.run.id))).json()
    assert.equal(receipt.report_hash, authoritative.run.report_hash)
    assert.equal(JSON.stringify(receipt).includes('SECRET_EXPECTED'), false)
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
})

test('only admins publish immutable leaf versions; aliases/families and unconfigured graders cannot create definitions', async () => {
  const f = await fixture()
  for (const actor of [undefined, 'benchmark-outsider', f.grader]) assert.ok([401, 403].includes((await definitions.POST(req('/api/admin/benchmark-definitions', actor, f.body))).status))
  const results = await Promise.all([definitions.POST(req('/api/admin/benchmark-definitions', 'benchmark-admin', f.body)), definitions.POST(req('/api/admin/benchmark-definitions', 'benchmark-admin', f.body))])
  assert.deepEqual(results.map((r) => r.status), [200, 200])
  assert.equal((await (await definitions.POST(req('/api/admin/benchmark-definitions', 'benchmark-admin', f.body))).json()).definition.id, f.definition.id)
  assert.equal((await definitions.POST(req('/api/admin/benchmark-definitions', 'benchmark-admin', { ...f.body, title: 'Changed version' }))).status, 409)
  for (const capability_id of ['family:research', 'analysis']) assert.equal((await definitions.POST(req('/api/admin/benchmark-definitions', 'benchmark-admin', { ...f.body, capability_id }))).status, 400)
  process.env.CLAWDMARKET_BENCHMARK_GRADER_IDS = ''
  assert.equal((await definitions.POST(req('/api/admin/benchmark-definitions', 'benchmark-admin', { ...f.body, version: 2 }))).status, 409)
  assert.equal((await definitions.POST(req('/api/admin/benchmark-definitions', 'benchmark-admin', f.body))).status, 200)
})

test('catalog never exposes expected answers, inputs, salts, ciphertext or admin identity; version pagination is stable', async () => {
  const f = await fixture()
  const second = await definitions.POST(req('/api/admin/benchmark-definitions', 'benchmark-admin', { ...f.body, version: 2 }))
  assert.equal(second.status, 201)
  const responses = await Promise.all([1, 2].map((page) => catalog.GET(req(`/api/benchmark-definitions?capability=data-extraction&limit=1&page=${page}`))))
  const pages = await Promise.all(responses.map((r) => r.json()))
  assert.notEqual(pages[0].definitions[0].id, pages[1].definitions[0].id)
  for (const forbidden of ['SECRET_EXPECTED', 'PRIVATE_INPUT', 'ciphertext', 'nonce', 'created_by', 'salt', 'request_hash']) assert.equal(JSON.stringify(pages).includes(forbidden), false)
  assert.equal((await catalog.GET(req('/api/benchmark-definitions?capability=family:research'))).status, 400)
  const row = (await db.select().from(schema.benchmark_definitions).where(eq(schema.benchmark_definitions.id, f.definition.id)))[0]
  assert.equal(row.ciphertext.includes('SECRET_EXPECTED'), false)
})

test('target opts in once; original references recover after retirement without renewing access or spending', async () => {
  const f = await fixture()
  const responses = await Promise.all([runs.POST(req('/api/benchmark-runs', f.target, f.createBody)), runs.POST(req('/api/benchmark-runs', f.target, f.createBody))])
  for (const response of responses) assert.equal((await response.json()).run.id, f.run.id)
  assert.equal((await runs.POST(req('/api/benchmark-runs', f.target, { ...f.createBody, definition_id: crypto.randomUUID() }))).status, 409)
  assert.equal((await retire(req(`/api/admin/benchmark-definitions/${f.definition.id}`, 'benchmark-admin', undefined, 'DELETE'), context(f.definition.id))).status, 200)
  const replay = await (await runs.POST(req('/api/benchmark-runs', f.target, f.createBody))).json()
  assert.equal(replay.run.id, f.run.id); assert.equal(replay.run.state, 'cancelled')
  assert.equal((await runs.POST(req('/api/benchmark-runs', f.target, { ...f.createBody, client_reference: crypto.randomUUID() }))).status, 409)
  assert.equal((await db.select().from(schema.trades)).length, 0)
  assert.equal((await db.select().from(schema.capability_performance_events)).length, 0)
})

test('expected answers are granted only to the designated grader after immutable target submission', async () => {
  const f = await fixture()
  assert.equal((await detail.GET(req(`/api/benchmark-runs/${f.run.id}`, f.stranger), context(f.run.id))).status, 404)
  const target = await (await detail.GET(req(`/api/benchmark-runs/${f.run.id}`, f.target), context(f.run.id))).json()
  assert.equal(target.test_cases[0].input.text, 'PRIVATE_INPUT')
  assert.equal(JSON.stringify(target).includes('SECRET_EXPECTED'), false)
  const before = await (await detail.GET(req(`/api/benchmark-runs/${f.run.id}`, f.grader), context(f.run.id))).json()
  assert.equal(before.grading_material, undefined)
  await db.insert(schema.agent_owners).values({ agentId: f.target, userId: 'benchmark-owner', establishedBy: 'test' })
  assert.equal((await detail.GET(req(`/api/benchmark-runs/${f.run.id}`, f.target), context(f.run.id))).status, 409, 'owner change revokes material access')
  const g = await ready()
  const gradedMaterial = await detail.GET(req(`/api/benchmark-runs/${g.run.id}`, g.grader), context(g.run.id))
  assert.match(gradedMaterial.headers.get('Cache-Control') || '', /private, no-store/)
  assert.equal((await gradedMaterial.json()).grading_material.cases[0].expected.name, 'SECRET_EXPECTED')
  assert.equal((await submit(req(`/api/benchmark-runs/${g.run.id}/submission`, g.grader, g.outputs), context(g.run.id))).status, 404)
})

test('reports bind exact suite/output/cases; the server rejects inflated pass claims and immutable-result changes', async () => {
  const f = await ready(), path = `/api/benchmark-runs/${f.run.id}/report`
  assert.equal((await report(req(path, f.target, f.report), context(f.run.id))).status, 404)
  for (const body of [{ ...f.report, definition_hash: 'a'.repeat(64) }, { ...f.report, submission_hash: 'b'.repeat(64) },
    { ...f.report, cases: [{ id: 'a', passed: true }, { id: 'b', passed: true }] }, { ...f.report, cases: [{ id: 'b', passed: true }] }]) {
    assert.equal((await report(req(path, f.grader, body), context(f.run.id))).status, 422)
  }
  const responses = await Promise.all([report(req(path, f.grader, f.report), context(f.run.id)), report(req(path, f.grader, f.report), context(f.run.id))])
  const results = await Promise.all(responses.map((r) => r.json()))
  assert.equal(results[0].run.report_hash, results[1].run.report_hash)
  assert.deepEqual(results[0].run.observation, { passed_count: 1, total_count: 2, exact_match_percent: 50 })
  assert.equal(results[0].run.evidence.measured_quality_score, null); assert.equal(results[0].run.evidence.routing_eligible, false)
  assert.equal((await report(req(path, f.grader, { ...f.report, cases: [{ id: 'a', passed: true }] }), context(f.run.id))).status, 409)
  assert.equal((await submit(req(`/api/benchmark-runs/${f.run.id}/submission`, f.target, { outputs: [{ id: 'a', output: {} }] }), context(f.run.id))).status, 409)
  process.env.CLAWDMARKET_BENCHMARK_GRADER_IDS = ''
  assert.equal((await report(req(path, f.grader, f.report), context(f.run.id))).status, 200)
  assert.equal((await submit(req(`/api/benchmark-runs/${f.run.id}/submission`, f.target, f.outputs), context(f.run.id))).status, 200)
  const recovered = await (await detail.GET(req(`/api/benchmark-runs/${f.run.id}`, f.grader), context(f.run.id))).json()
  assert.equal(recovered.grading_material, undefined)
  const row = (await db.select().from(schema.benchmark_runs).where(eq(schema.benchmark_runs.id, f.run.id)))[0]
  assert.equal(row.submission_ciphertext, null)
  const [target] = await db.select().from(schema.agents).where(eq(schema.agents.id, f.target))
  assert.equal(target.benchmarkScore, 77); assert.equal(target.velocityScore, 12)
})

test('revocation, shared ownership, reference participants and expiry cannot grant or complete grading', async () => {
  for (const reason of ['config', 'shared-owner', 'archive', 'reference', 'expiry']) {
    const f = await ready()
    if (reason === 'config') process.env.CLAWDMARKET_BENCHMARK_GRADER_IDS = ''
    if (reason === 'shared-owner') for (const id of [f.target, f.grader]) await db.insert(schema.agent_owners).values({ agentId: id, userId: 'benchmark-owner', establishedBy: 'test' })
    if (reason === 'archive') await db.update(schema.agents).set({ archivedAt: new Date() }).where(eq(schema.agents.id, f.target))
    if (reason === 'reference') await db.update(schema.agents).set({ description: '[clawdmarket-reference-fleet:v1]' }).where(eq(schema.agents.id, f.target))
    if (reason === 'expiry') await db.update(schema.benchmark_runs).set({ expires_at: new Date(0) }).where(eq(schema.benchmark_runs.id, f.run.id))
    assert.equal((await report(req(`/api/benchmark-runs/${f.run.id}/report`, f.grader, f.report), context(f.run.id))).status, 409, reason)
  }
  assert.ok(await (await import('@/lib/trusted-benchmarks')).expireBenchmarkRuns() >= 1)
})

test('ciphertext swaps fail closed; cancellation purges unfinished output and blocks grading', async () => {
  const f = await ready(), g = await ready()
  process.env.CLAWDMARKET_BENCHMARK_GRADER_IDS = `${f.grader},${g.grader}`
  const [other] = await db.select().from(schema.benchmark_runs).where(eq(schema.benchmark_runs.id, g.run.id))
  await db.update(schema.benchmark_runs).set({ submission_ciphertext: other.submission_ciphertext, submission_nonce: other.submission_nonce }).where(eq(schema.benchmark_runs.id, f.run.id))
  assert.equal((await detail.GET(req(`/api/benchmark-runs/${f.run.id}`, f.grader), context(f.run.id))).status, 422)
  assert.equal((await report(req(`/api/benchmark-runs/${f.run.id}/report`, f.grader, f.report), context(f.run.id))).status, 422)
  assert.equal((await detail.DELETE(req(`/api/benchmark-runs/${f.run.id}`, f.target, undefined, 'DELETE'), context(f.run.id))).status, 200)
  assert.equal((await detail.DELETE(req(`/api/benchmark-runs/${f.run.id}`, f.target, undefined, 'DELETE'), context(f.run.id))).status, 200)
  assert.equal((await report(req(`/api/benchmark-runs/${f.run.id}/report`, f.grader, f.report), context(f.run.id))).status, 409)
  assert.equal((await db.select().from(schema.benchmark_runs).where(eq(schema.benchmark_runs.id, f.run.id)))[0].submission_ciphertext, null)
})

test('the external grader journals before an uncertain POST and recovers the original hash without exposing test materials', async () => {
  const f = await ready(), journalDirectory = join(directory, crypto.randomUUID()); mkdirSync(journalDirectory, { mode: 0o700 })
  const stateFile = join(journalDirectory, 'run.json')
  let loseReply = true, reports = 0
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), request = new NextRequest(url, { ...init, signal: init?.signal || undefined })
    if (init?.method === 'POST') {
      reports++
      assert.ok(readFileSync(stateFile, 'utf8').includes('submission_hash'))
      const result = await report(request, context(f.run.id))
      if (loseReply) { loseReply = false; throw new Error('LOST_COMMITTED_REPORT') }
      return result
    }
    return detail.GET(request, context(f.run.id))
  }
  const options = { baseUrl: 'http://localhost', apiKey: `key-${f.grader}`, runId: f.run.id, stateFile, fetcher }
  await assert.rejects(() => runTrustedBenchmark(options), /BENCHMARK_REQUEST_UNCERTAIN/)
  const recovered = await runTrustedBenchmark(options)
  assert.equal(recovered.state, 'graded'); assert.equal(reports, 1)
  for (const secret of ['SECRET_EXPECTED', 'PRIVATE_INPUT', `key-${f.grader}`]) assert.equal(readFileSync(stateFile, 'utf8').includes(secret), false)
})

test('the bounded worker response accommodates a maximum-size definition and submission together', async () => {
  const f = await fixture(), suite = { ...f.body, version: 2, cases: [{ id: 'large', input: '', expected: 'x'.repeat(65050) }] }
  assert.ok(Buffer.byteLength(JSON.stringify(suite)) < 65536)
  const published = await definitions.POST(req('/api/admin/benchmark-definitions', 'benchmark-admin', suite))
  assert.equal(published.status, 201)
  const definition = (await published.json()).definition
  const created = await (await runs.POST(req('/api/benchmark-runs', f.target, { definition_id: definition.id, client_reference: crypto.randomUUID() }))).json()
  const id = created.run.id, path = `/api/benchmark-runs/${id}`, outputs = { outputs: [{ id: 'large', output: 'y'.repeat(65050) }] }
  assert.equal((await submit(req(`${path}/submission`, f.target, outputs), context(id))).status, 200)
  const response = await detail.GET(req(path, f.grader), context(id))
  assert.ok(Buffer.byteLength(await response.text()) > 131072, 'combined grant exceeds either individual request limit')
  const journalDirectory = join(directory, crypto.randomUUID()); mkdirSync(journalDirectory, { mode: 0o700 })
  const fetcher: typeof fetch = async (input, init) => {
    const request = new NextRequest(String(input), { ...init, signal: init?.signal || undefined })
    return init?.method === 'POST' ? report(request, context(id)) : detail.GET(request, context(id))
  }
  const result = await runTrustedBenchmark({ baseUrl: 'http://localhost', apiKey: `key-${f.grader}`, runId: id, stateFile: join(journalDirectory, 'run.json'), fetcher })
  assert.equal(result.state, 'graded')
})

test('read-only named credentials cannot submit or grade and cookie admin writes require CSRF', async () => {
  const f = await ready(), key = `readonly-${crypto.randomUUID()}`
  await db.insert(schema.agent_credentials).values({ id: crypto.randomUUID(), agentId: f.grader, name: 'Benchmark reader',
    keyHash: hashKey(`key-${key}`), keyPrefix: 'readonly', scopes: '["agent:read"]', createdByType: 'agent', createdAt: new Date() })
  assert.equal((await detail.GET(req(`/api/benchmark-runs/${f.run.id}`, key), context(f.run.id))).status, 200)
  assert.equal((await report(req(`/api/benchmark-runs/${f.run.id}/report`, key, f.report), context(f.run.id))).status, 403)
  assert.equal((await runs.POST(req('/api/benchmark-runs', key, f.createBody))).status, 403)
  const cookie = `auth-token=${jwt({ userId: 'benchmark-admin', email: 'benchmark-admin@test.invalid', role: 'human' })}`
  const headers = { Cookie: cookie, Authorization: 'Bearer invalid', 'Content-Type': 'application/json' }
  assert.equal((await definitions.POST(new NextRequest('http://localhost/api/admin/benchmark-definitions', { method: 'POST', headers, body: JSON.stringify(f.body) }))).status, 403)
  assert.equal((await retire(new NextRequest(`http://localhost/api/admin/benchmark-definitions/${f.definition.id}`, { method: 'DELETE', headers }), context(f.definition.id))).status, 403)
})

test('current linked owners can inspect target inputs but transfer revokes the former owner and unfinished grant', async () => {
  const f = await fixture()
  await db.insert(schema.agent_owners).values({ agentId: f.target, userId: 'benchmark-owner', establishedBy: 'test' })
  const fresh = await (await runs.POST(req('/api/benchmark-runs', f.target, { ...f.createBody, client_reference: crypto.randomUUID() }))).json()
  const id = fresh.run.id
  const owned = await detail.GET(req(`/api/benchmark-runs/${id}`, 'benchmark-owner'), context(id))
  assert.equal(owned.status, 200)
  assert.equal(JSON.stringify(await owned.json()).includes('SECRET_EXPECTED'), false)
  await db.delete(schema.agent_owners).where(eq(schema.agent_owners.agentId, f.target))
  await db.insert(schema.agent_owners).values({ agentId: f.target, userId: 'benchmark-outsider', establishedBy: 'test' })
  assert.equal((await detail.GET(req(`/api/benchmark-runs/${id}`, 'benchmark-owner'), context(id))).status, 404)
  assert.equal((await detail.GET(req(`/api/benchmark-runs/${id}`, 'benchmark-outsider'), context(id))).status, 409)
  assert.equal((await submit(req(`/api/benchmark-runs/${id}/submission`, f.target, f.outputs), context(id))).status, 409)
})

test('a linked grader owner can inspect metadata but cannot retrieve expected answers or report using account authority', async () => {
  const f = await fixture()
  await db.insert(schema.agent_owners).values({ agentId: f.grader, userId: 'benchmark-owner', establishedBy: 'test' })
  const fresh = await (await runs.POST(req('/api/benchmark-runs', f.target, { ...f.createBody, client_reference: crypto.randomUUID() }))).json()
  const id = fresh.run.id, path = `/api/benchmark-runs/${id}`
  assert.equal((await submit(req(`${path}/submission`, f.target, f.outputs), context(id))).status, 200)
  const owner = await detail.GET(req(path, 'benchmark-owner'), context(id))
  assert.equal(owner.status, 200)
  const metadata = await owner.json()
  assert.equal(metadata.run.state, 'awaiting_grading')
  assert.equal(metadata.grading_material, undefined); assert.equal(metadata.test_cases, undefined)
  assert.equal(JSON.stringify(metadata).includes('SECRET_EXPECTED'), false)
  const grader = await (await detail.GET(req(path, f.grader), context(id))).json()
  assert.equal(grader.grading_material.cases[0].expected.name, 'SECRET_EXPECTED')
  const body = { version: 1, adapter: 'json_exact_v1', definition_hash: grader.run.definition_hash, submission_hash: grader.run.submission_hash,
    cases: [{ id: 'a', passed: false }, { id: 'b', passed: true }] }
  assert.equal((await report(req(`${path}/report`, 'benchmark-owner', body), context(id))).status, 401)
})

test('version attempt limits include cancelled runs, and definition ciphertext substitution cannot authorize materials', async () => {
  const f = await fixture()
  for (let index = 0; index < 2; index++) assert.equal((await runs.POST(req('/api/benchmark-runs', f.target, { ...f.createBody, client_reference: crypto.randomUUID() }))).status, 201)
  await detail.DELETE(req(`/api/benchmark-runs/${f.run.id}`, f.target, undefined, 'DELETE'), context(f.run.id))
  assert.equal((await runs.POST(req('/api/benchmark-runs', f.target, { ...f.createBody, client_reference: crypto.randomUUID() }))).status, 429)
  const g = await ready(), other = await fixture()
  process.env.CLAWDMARKET_BENCHMARK_GRADER_IDS = `${g.grader},${other.grader}`
  const [row] = await db.select().from(schema.benchmark_definitions).where(eq(schema.benchmark_definitions.id, other.definition.id))
  await db.update(schema.benchmark_definitions).set({ ciphertext: row.ciphertext, nonce: row.nonce }).where(eq(schema.benchmark_definitions.id, g.definition.id))
  assert.equal((await detail.GET(req(`/api/benchmark-runs/${g.run.id}`, g.grader), context(g.run.id))).status, 422)
  assert.equal((await report(req(`/api/benchmark-runs/${g.run.id}/report`, g.grader, g.report), context(g.run.id))).status, 422)
})
