import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'
import { canonicalJSON } from '../../scripts/verifier-contract.mjs'
import { runIsolatedVerification } from '../../scripts/isolated-verifier.mjs'
import { runVerifierWork } from '../../scripts/verification-worker.mjs'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let upload: typeof import('@/app/api/trades/[id]/artifacts/route').POST
let createJob: typeof import('@/app/api/trades/[id]/verification-jobs/route').POST
let jobApi: typeof import('@/app/api/verification-jobs/[id]/route')
let download: typeof import('@/app/api/verification-jobs/[id]/artifact/route').GET
let deliver: typeof import('@/app/api/trades/[id]/delivery/route').POST
let confirm: typeof import('@/app/api/trades/[id]/confirm/route').POST
const verifier = `agent_${crypto.randomUUID()}`
const verifierUser = `user_agent_${verifier}`
const suite = { version: 1, cases: [{ id: 'echo', args: ['confidential_test_value'], expected: 'confidential_test_value' }] }
const code = 'export default (value) => value;'
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const policy = { required: true, methods: ['buyer_review', 'isolated_checks'], acceptance: { version: 1, mode: 'explicit_buyer' },
  isolated_checks: { version: 1, adapter: 'javascript_tests_v1', verifier_agent_id: verifier, suite_sha256: sha(canonicalJSON(suite)), max_runtime_seconds: 5 } }
const pythonCode = 'def run(value):\n    return value\n'
const pythonPolicy = { ...policy, isolated_checks: { ...policy.isolated_checks, adapter: 'python_tests_v1' } }
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-verification-jobs-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'test.db')}`
  process.env.JWT_SECRET = 'verification-jobs-test-jwt'
  process.env.CHAT_ENCRYPTION_KEY = 'verification-jobs-test-chat'
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  upload = (await import('@/app/api/trades/[id]/artifacts/route')).POST
  createJob = (await import('@/app/api/trades/[id]/verification-jobs/route')).POST
  jobApi = await import('@/app/api/verification-jobs/[id]/route')
  download = (await import('@/app/api/verification-jobs/[id]/artifact/route')).GET
  deliver = (await import('@/app/api/trades/[id]/delivery/route')).POST
  confirm = (await import('@/app/api/trades/[id]/confirm/route')).POST
  await db.insert(schema.users).values(['verify-buyer', 'verify-seller', 'verify-outsider', 'verify-owner', verifierUser].map((id) => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' as const })))
  await db.insert(schema.agents).values({ id: verifier, name: 'Approved verifier', description: 'Controlled verification test', capabilities: '[]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused' })
  await db.insert(schema.agent_owners).values({ agentId: verifier, userId: 'verify-owner', establishedBy: 'verified-test' })
})
after(() => { db?.$client.close(); rmSync(directory, { recursive: true, force: true }) })
const params = (id: string) => ({ params: Promise.resolve({ id }) })
function request(user = 'verify-buyer', input?: unknown, method = input === undefined ? 'GET' : 'POST') { return new NextRequest('http://localhost/api/test', { method,
  headers: { 'Content-Type': 'application/json', ...(user ? { Authorization: `Bearer ${jwt({ userId: user, email: `${user}@test.invalid`, role: 'human' })}` } : {}) }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) }) }
async function fixture(verificationPolicy = policy) {
  const [listing] = await db.insert(schema.listings).values({ seller_id: 'verify-seller', category: 'code', title: 'Verified code', description: 'External verification fixture', price_bankr: 1, status: 'sold' }).returning()
  const [trade] = await db.insert(schema.trades).values({ listing_id: listing.id, buyer_id: 'verify-buyer', seller_id: 'verify-seller', amount: 1, fee: 0, payment_rail: 'ledger', status: 'escrow_held' }).returning()
  const [service] = await db.insert(schema.service_definitions).values({ id: crypto.randomUUID(), seller_id: trade.seller_id, title: 'Verified code', description: 'External verification fixture', price_minor: 100, active_orders: 1, verification_policy: JSON.stringify(verificationPolicy) }).returning()
  const { captureServiceExecutionContract } = await import('@/lib/service-execution-contract')
  await db.insert(schema.service_orders).values({ id: crypto.randomUUID(), service_id: service.id, trade_id: trade.id, listing_id: listing.id, buyer_id: trade.buyer_id, client_reference: crypto.randomUUID(), objective: 'Verify the private module', price_minor: 100, payment_rail: 'ledger', state: 'funded', execution_contract_json: captureServiceExecutionContract(service, []) })
  return { trade, service }
}
async function artifact(tradeId: string, source = code, name = 'module.mjs') {
  const response = await upload(request('verify-seller', { client_reference: `code:${crypto.randomUUID()}`, name, media_type: 'text/plain', content_base64: Buffer.from(source).toString('base64'), sha256: sha(source) }), params(tradeId))
  assert.equal(response.status, 201, await response.clone().text())
  return (await response.json()).artifact.id as string
}
function report(source = code, passed = true) { return { version: 1, adapter: 'javascript_tests_v1', artifact_sha256: sha(source), suite_sha256: sha(canonicalJSON(suite)), status: passed ? 'passed' : 'failed', total_checks: 1, passed_checks: passed ? 1 : 0, failed_checks: passed ? 0 : 1, elapsed_ms: 100, failure: passed ? null : 'checks_failed', isolation: { kind: 'bwrap-systemd-v1', network_enabled: false, host_home_mounted: false, memory_limit_bytes: 134_217_728, task_limit: 32 } } }
async function job(tradeId: string, artifactId: string) {
  const input = { client_reference: `check:${crypto.randomUUID()}`, artifact_id: artifactId, test_suite: suite }
  const response = await createJob(request('verify-buyer', input), params(tradeId))
  assert.equal(response.status, 201, await response.clone().text())
  return { input, job: (await response.json()).job }
}
const delivery = (artifactId: string, jobId?: string) => ({ summary: 'A private module with approved external verification.', artifact_ids: [artifactId], ...(jobId ? { verification_job_id: jobId } : {}) })

test('buyer approval limits private grants and binds immutable report/reference recovery', async () => {
  const f = await fixture(), id = await artifact(f.trade.id)
  const input = { client_reference: `check:${crypto.randomUUID()}`, artifact_id: id, test_suite: suite }
  assert.equal((await createJob(request('verify-seller', input), params(f.trade.id))).status, 403)
  assert.equal((await createJob(request('verify-outsider', input), params(f.trade.id))).status, 404)
  const created = await createJob(request('verify-buyer', input), params(f.trade.id))
  assert.equal(created.status, 201)
  const saved = (await created.json()).job
  assert.equal(JSON.stringify(saved).includes('confidential_test_value'), false)
  assert.equal((await createJob(request('verify-buyer', input), params(f.trade.id))).status, 200)
  assert.equal((await createJob(request('verify-buyer', { ...input, artifact_id: crypto.randomUUID() }), params(f.trade.id))).status, 409)
  const dbRows = await db.select().from(schema.verification_jobs).where(eq(schema.verification_jobs.id, saved.id))
  assert.equal(JSON.stringify(dbRows).includes('confidential_test_value'), false)
  assert.equal((await jobApi.GET(request(''), params(saved.id))).status, 401)
  assert.equal((await jobApi.GET(request('verify-outsider'), params(saved.id))).status, 404)
  const work = await jobApi.GET(request(verifierUser), params(saved.id)).then((response) => response.json())
  assert.deepEqual(work.test_suite, suite)
  const bytes = await download(request(verifierUser), params(saved.id))
  assert.equal(bytes.status, 200); assert.equal(await bytes.text(), code)
  assert.equal(bytes.headers.get('Cache-Control'), 'private, no-store')
  assert.equal((await download(request('verify-seller'), params(saved.id))).status, 403)
  assert.equal((await jobApi.POST(request('verify-seller', report()), params(saved.id))).status, 403)
  assert.equal((await jobApi.POST(request(verifierUser, { ...report(), artifact_sha256: '0'.repeat(64) }), params(saved.id))).status, 422)
  assert.equal((await jobApi.POST(request(verifierUser, report()), params(saved.id))).status, 200)
  assert.equal((await jobApi.POST(request(verifierUser, report()), params(saved.id)).then((response) => response.json())).idempotent, true)
  assert.equal((await jobApi.POST(request(verifierUser, report(code, false)), params(saved.id))).status, 409)
  assert.equal((await download(request(verifierUser), params(saved.id))).status, 409)
  assert.equal((await db.select().from(schema.verification_jobs).where(eq(schema.verification_jobs.id, saved.id)))[0].suite_ciphertext, null)
})

test('failed external checks hold escrow, corrected checks open explicit review and settle once', async () => {
  const f = await fixture(), badCode = 'export default () => false;', badId = await artifact(f.trade.id, badCode)
  const bad = await job(f.trade.id, badId)
  assert.equal((await jobApi.POST(request(verifierUser, report(badCode, false)), params(bad.job.id))).status, 200)
  assert.equal((await deliver(request('verify-seller', delivery(badId, bad.job.id)), params(f.trade.id))).status, 422)
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.id, f.trade.id)))[0].status, 'escrow_held')
  const goodId = await artifact(f.trade.id), good = await job(f.trade.id, goodId)
  assert.equal((await jobApi.POST(request(verifierUser, report()), params(good.job.id))).status, 200)
  assert.equal((await deliver(request('verify-seller', delivery(goodId)), params(f.trade.id))).status, 422)
  const payload = delivery(goodId, good.job.id)
  const response = await deliver(request('verify-seller', payload), params(f.trade.id))
  assert.equal(response.status, 201, await response.clone().text())
  const results = await db.select().from(schema.verification_results).where(eq(schema.verification_results.trade_id, f.trade.id))
  assert.equal(results.some((row) => row.method === 'isolated_checks_failure' && row.status === 'failed'), true)
  assert.equal(results.some((row) => row.method === 'isolated_checks' && row.status === 'passed' && row.delivery_id !== null), true)
  assert.equal(JSON.stringify(results).includes('confidential_test_value'), false)
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.id, f.trade.id)))[0].auto_confirm_at, null)
  await db.insert(schema.wallets).values({ user_id: f.trade.buyer_id, balance: 0, escrow: 1 }).onConflictDoUpdate({ target: schema.wallets.user_id, set: { balance: 0, escrow: 1 } })
  assert.equal((await confirm(request(f.trade.buyer_id, {}), params(f.trade.id))).status, 200)
  assert.equal((await deliver(request('verify-seller', payload), params(f.trade.id))).status, 200)
  assert.equal((await jobApi.POST(request(verifierUser, report()), params(good.job.id))).status, 200)
  assert.equal((await db.select().from(schema.transactions).where(and(eq(schema.transactions.reference_id, f.trade.id), eq(schema.transactions.type, 'escrow_release')))).length, 1)
})

test('revocation, expiry and current owner changes invalidate verification grants and acceptance', async () => {
  const f = await fixture(), id = await artifact(f.trade.id), first = await job(f.trade.id, id)
  assert.equal((await jobApi.POST(request(verifierUser, report()), params(first.job.id))).status, 200)
  assert.equal((await jobApi.DELETE(request('verify-buyer', undefined, 'DELETE'), params(first.job.id))).status, 200)
  assert.equal((await jobApi.POST(request(verifierUser, report()), params(first.job.id)).then((response) => response.json())).job.state, 'cancelled')
  assert.equal((await deliver(request('verify-seller', delivery(id, first.job.id)), params(f.trade.id))).status, 422)
  const expired = await job(f.trade.id, id)
  await db.update(schema.verification_jobs).set({ expires_at: new Date(Date.now() - 1000) }).where(eq(schema.verification_jobs.id, expired.job.id))
  assert.equal((await download(request(verifierUser), params(expired.job.id))).status, 409)
  assert.equal((await jobApi.POST(request(verifierUser, report()), params(expired.job.id))).status, 409)
  assert.equal(await (await import('@/lib/verification-jobs')).expireVerificationJobs(), 1)
  assert.equal((await db.select().from(schema.verification_jobs).where(eq(schema.verification_jobs.id, expired.job.id)))[0].suite_ciphertext, null)
  const changed = await job(f.trade.id, id)
  await db.update(schema.agent_owners).set({ userId: f.trade.seller_id }).where(eq(schema.agent_owners.agentId, verifier))
  try {
    assert.equal((await download(request(verifierUser), params(changed.job.id))).status, 409)
    assert.equal((await jobApi.POST(request(verifierUser, report()), params(changed.job.id))).status, 409)
    assert.equal((await createJob(request('verify-buyer', { ...changed.input, client_reference: crypto.randomUUID() }), params(f.trade.id))).status, 409)
  } finally { await db.update(schema.agent_owners).set({ userId: 'verify-owner' }).where(eq(schema.agent_owners.agentId, verifier)) }
})

test('read-only named verifier credentials retrieve approved input but cannot report or revoke', async () => {
  const f = await fixture(), id = await artifact(f.trade.id), approved = await job(f.trade.id, id)
  const created = await (await import('@/lib/agent-named-credentials')).createNamedAgentCredential({ agentId: verifier, name: 'Verifier read-only', scopes: ['agent:read'], actorCredentialId: null })
  assert.equal(created.kind, 'created')
  if (created.kind !== 'created') assert.fail('Named credential fixture failed')
  const req = (method: string, body?: unknown) => new NextRequest(`http://localhost/api/verification-jobs/${approved.job.id}`, { method,
    headers: { Authorization: `Bearer ${created.api_key}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  assert.equal((await jobApi.GET(req('GET'), params(approved.job.id))).status, 200)
  assert.equal((await jobApi.POST(req('POST', report()), params(approved.job.id))).status, 401)
  assert.equal((await jobApi.DELETE(req('DELETE'), params(approved.job.id))).status, 401)
})

test('Python jobs use the frozen adapter and reject wrong file, suite, report identity and runtime', async () => {
  const f = await fixture(pythonPolicy), wrong = await artifact(f.trade.id, pythonCode), id = await artifact(f.trade.id, pythonCode, 'module.py')
  await db.update(schema.service_definitions).set({ verification_policy: JSON.stringify(policy) }).where(eq(schema.service_definitions.id, f.service.id))
  const body = { client_reference: crypto.randomUUID(), artifact_id: id, test_suite: suite }
  assert.equal((await createJob(request('verify-buyer', { ...body, artifact_id: wrong }), params(f.trade.id))).status, 400)
  assert.equal((await createJob(request('verify-buyer', { ...body, test_suite: { ...suite, cases: [{ ...suite.cases[0], expected: 'replacement' }] } }), params(f.trade.id))).status, 422)
  const approved = await job(f.trade.id, id)
  assert.equal(approved.job.policy.adapter, 'python_tests_v1')
  const pyReport = { ...report(pythonCode), adapter: 'python_tests_v1' }
  for (const changes of [{ adapter: 'javascript_tests_v1' }, { artifact_sha256: sha(code) }, { suite_sha256: 'f'.repeat(64) }, { total_checks: 2, passed_checks: 2 }, { elapsed_ms: 10001 }]) {
    assert.equal((await jobApi.POST(request(verifierUser, { ...pyReport, ...changes }), params(approved.job.id))).status, 422)
  }
  assert.equal((await jobApi.POST(request('verify-owner', pyReport), params(approved.job.id))).status, 404)
  assert.equal((await jobApi.GET(request('verify-buyer'), params(approved.job.id)).then((response) => response.json())).test_suite, undefined)
  assert.equal((await download(request('verify-buyer'), params(approved.job.id))).status, 403)
  const credential = await (await import('@/lib/agent-named-credentials')).createNamedAgentCredential({ agentId: verifier, name: 'Python reader', scopes: ['agent:read'], actorCredentialId: null })
  if (credential.kind !== 'created') assert.fail('Named credential fixture failed')
  const scoped = new NextRequest('http://localhost/api/test', { method: 'POST', headers: { Authorization: `Bearer ${credential.api_key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(pyReport) })
  assert.equal((await jobApi.POST(scoped, params(approved.job.id))).status, 401)
  assert.equal((await jobApi.POST(request(verifierUser, pyReport), params(approved.job.id))).status, 200)
  assert.equal((await jobApi.POST(request(verifierUser, { ...pyReport, elapsed_ms: 101 }), params(approved.job.id))).status, 409)
  assert.equal((await download(request(verifierUser), params(approved.job.id))).status, 409)
  const revoked = await job(f.trade.id, id)
  await jobApi.DELETE(request('verify-buyer', undefined, 'DELETE'), params(revoked.job.id))
  assert.equal((await jobApi.POST(request(verifierUser, pyReport), params(revoked.job.id))).status, 409)
  const expired = await job(f.trade.id, id)
  await db.update(schema.verification_jobs).set({ expires_at: new Date(Date.now() - 1000) }).where(eq(schema.verification_jobs.id, expired.job.id))
  assert.equal((await jobApi.POST(request(verifierUser, pyReport), params(expired.job.id))).status, 409)
  const changed = await job(f.trade.id, id)
  await db.update(schema.agent_owners).set({ userId: f.trade.buyer_id }).where(eq(schema.agent_owners.agentId, verifier))
  try {
    assert.equal((await download(request(verifierUser), params(changed.job.id))).status, 409)
    assert.equal((await jobApi.POST(request(verifierUser, pyReport), params(changed.job.id))).status, 409)
  } finally { await db.update(schema.agent_owners).set({ userId: 'verify-owner' }).where(eq(schema.agent_owners.agentId, verifier)) }
})

test('actual Python worker recovers a lost report, holds failed output, and settles corrected work only after buyer review', { skip: process.env.CLAWDMARKET_TEST_ISOLATED_VERIFIER !== '1' }, async () => {
  const f = await fixture(pythonPolicy), badCode = 'def run(value):\n    return False\n'
  const badId = await artifact(f.trade.id, badCode, 'bad.py'), bad = await job(f.trade.id, badId)
  const apiKey = jwt({ userId: verifierUser, email: `${verifierUser}@test.invalid`, role: 'human' })
  let loseReply = false, lost = false, downloads = 0
  const fetcher: typeof fetch = async (input, init) => {
    const req = new NextRequest(String(input), { ...init, signal: init?.signal ?? undefined })
    const id = new URL(String(input)).pathname.split('/')[3]
    if (String(input).endsWith('/artifact')) { downloads++; return download(req, params(id)) }
    if (init?.method === 'POST') {
      const response = await jobApi.POST(req, params(id))
      if (loseReply && !lost) { lost = true; throw new Error('Lost committed report reply') }
      return response
    }
    return jobApi.GET(req, params(id))
  }
  const worker = (id: string) => runVerifierWork({ baseUrl: 'http://localhost:3000', apiKey, jobId: id, stateFile: join(directory, `${id}.json`), fetcher })
  assert.equal((await worker(bad.job.id)).state, 'failed')
  assert.equal((await deliver(request('verify-seller', delivery(badId, bad.job.id)), params(f.trade.id))).status, 422)
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.id, f.trade.id)))[0].status, 'escrow_held')
  const goodId = await artifact(f.trade.id, pythonCode, 'corrected.py'), good = await job(f.trade.id, goodId)
  loseReply = true
  await assert.rejects(worker(good.job.id), /VERIFIER_REQUEST_UNCERTAIN/)
  const recovered = await worker(good.job.id)
  assert.equal(recovered.state, 'passed'); assert.equal(recovered.idempotent, true)
  assert.equal(downloads, 2, 'recovery cannot download private inputs again')
  const { readFile, stat } = await import('node:fs/promises')
  const saved = await readFile(join(directory, `${good.job.id}.json`), 'utf8')
  for (const secret of [apiKey, 'confidential_test_value', pythonCode]) assert.equal(saved.includes(secret), false)
  assert.equal((await stat(join(directory, `${good.job.id}.json`))).mode & 0o777, 0o600)
  const payload = delivery(goodId, good.job.id)
  assert.equal((await deliver(request('verify-seller', payload), params(f.trade.id))).status, 201)
  const { assertTradeReleaseAllowed } = await import('@/lib/trade-acceptance')
  const { GET: inspect } = await import('@/app/api/trades/[id]/verification/route')
  const view = await inspect(request('verify-buyer'), params(f.trade.id)).then((response) => response.json())
  assert.equal(view.categories.deterministic_tests_passed, true)
  assert.equal(view.categories.static_analysis_passed, false)
  assert.equal(view.categories.semantic_verified, false)
  assert.equal(view.categories.buyer_accepted, false)
  for (const reason of ['auto_confirm', 'seller_payout'] as const) await assert.rejects(assertTradeReleaseAllowed(f.trade.id, reason), /EXPLICIT_ACCEPTANCE_REQUIRED/)
  const [held] = await db.select().from(schema.trades).where(eq(schema.trades.id, f.trade.id))
  assert.equal(held.status, 'pending_release'); assert.equal(held.auto_confirm_at, null)
  await db.insert(schema.wallets).values({ user_id: f.trade.buyer_id, balance: 0, escrow: 1 }).onConflictDoUpdate({ target: schema.wallets.user_id, set: { balance: 0, escrow: 1 } })
  const sellerBefore = (await db.select().from(schema.wallets).where(eq(schema.wallets.user_id, f.trade.seller_id)))[0]?.balance ?? 0
  assert.equal((await confirm(request(f.trade.buyer_id, {}), params(f.trade.id))).status, 200)
  assert.equal((await deliver(request('verify-seller', payload), params(f.trade.id))).status, 200)
  assert.equal((await worker(good.job.id)).report_hash, recovered.report_hash)
  assert.equal((await db.select().from(schema.wallets).where(eq(schema.wallets.user_id, f.trade.seller_id)))[0].balance, sellerBefore + 1)
  assert.equal((await db.select().from(schema.transactions).where(and(eq(schema.transactions.reference_id, f.trade.id), eq(schema.transactions.type, 'escrow_release')))).length, 1)
  const rows = await db.select().from(schema.verification_results).where(eq(schema.verification_results.trade_id, f.trade.id))
  assert.equal(rows.some((row) => row.method === 'isolated_checks_failure' && row.status === 'failed'), true)
  assert.equal(rows.some((row) => row.method === 'isolated_checks' && row.status === 'passed'), true)
  assert.equal(JSON.stringify(rows).includes('confidential_test_value'), false)
})

test('actual isolated runner report completes the private verification lifecycle', { skip: process.env.CLAWDMARKET_TEST_ISOLATED_VERIFIER !== '1' }, async () => {
  const f = await fixture(), id = await artifact(f.trade.id), approved = await job(f.trade.id, id)
  const work = await jobApi.GET(request(verifierUser), params(approved.job.id)).then((response) => response.json())
  const bytes = Buffer.from(await (await download(request(verifierUser), params(approved.job.id))).arrayBuffer())
  const result = await runIsolatedVerification({ code: bytes, suite: work.test_suite, adapter: 'javascript_tests_v1', maxRuntimeSeconds: 5 })
  assert.equal(result.status, 'passed')
  assert.equal((await jobApi.POST(request(verifierUser, result), params(approved.job.id))).status, 200)
  assert.equal((await deliver(request('verify-seller', delivery(id, approved.job.id)), params(f.trade.id))).status, 201)
})

test('external verifier worker journals before an uncertain report response and resumes without private input retrieval', { skip: process.env.CLAWDMARKET_TEST_ISOLATED_VERIFIER !== '1' }, async () => {
  const f = await fixture(), id = await artifact(f.trade.id), approved = await job(f.trade.id, id)
  const apiKey = jwt({ userId: verifierUser, email: `${verifierUser}@test.invalid`, role: 'human' })
  const stateFile = join(directory, `${approved.job.id}.json`)
  let lost = false, downloads = 0, posts = 0
  const fetcher: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname
    const req = new NextRequest(String(input), { ...init, signal: init?.signal ?? undefined })
    if (path.endsWith('/artifact')) { downloads++; return download(req, params(approved.job.id)) }
    if (init?.method === 'POST') {
      posts++
      const response = await jobApi.POST(req, params(approved.job.id))
      if (!lost) { lost = true; throw new Error('Response lost after committed report') }
      return response
    }
    return jobApi.GET(req, params(approved.job.id))
  }
  const options = { baseUrl: 'http://localhost:3000', apiKey, jobId: approved.job.id, stateFile, fetcher }
  await assert.rejects(runVerifierWork(options), /VERIFIER_REQUEST_UNCERTAIN/)
  const resumed = await runVerifierWork(options)
  assert.equal(resumed.state, 'passed'); assert.equal(resumed.idempotent, true)
  assert.equal(downloads, 1); assert.equal(posts, 2)
  const { readFile, stat } = await import('node:fs/promises')
  const journal = await readFile(stateFile, 'utf8')
  assert.equal(journal.includes('confidential_test_value'), false)
  assert.equal(journal.includes(apiKey), false)
  assert.equal((await stat(stateFile)).mode & 0o777, 0o600)
})
