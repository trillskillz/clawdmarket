import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { createLocalTestSchema } from '../helpers/local-schema'
import { runProviderWork } from '../../scripts/provider-worker.mjs'

let directory: string
let db: typeof import('@/lib/db').db
let schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let baseUrl: string
const server = createServer()

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-provider-worker-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'worker.db')}`
  process.env.JWT_SECRET = 'provider-worker-test-secret'
  process.env.CHAT_ENCRYPTION_KEY = 'provider-worker-test-chat-secret-32bytes'
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  const { GET: getWork } = await import('@/app/api/trades/[id]/work-order/route')
  const { POST: action } = await import('@/app/api/trades/[id]/work-order/attempt/route')
  const { POST: deliver } = await import('@/app/api/trades/[id]/delivery/route')
  const { POST: uploadArtifact } = await import('@/app/api/trades/[id]/artifacts/route')
  server.on('request', async (incoming, outgoing) => {
    try {
      const chunks = []
      for await (const chunk of incoming) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString()
      const request = new NextRequest(`${baseUrl}${incoming.url}`, { method: incoming.method,
        headers: incoming.headers as Record<string, string>, ...(body ? { body } : {}) })
      const id = incoming.url!.split('/')[3]
      const handler = incoming.url!.endsWith('/artifacts') ? uploadArtifact : incoming.url!.endsWith('/delivery') ? deliver : incoming.url!.endsWith('/attempt') ? action : getWork
      const response = await handler(request, { params: Promise.resolve({ id }) })
      outgoing.writeHead(response.status, Object.fromEntries(response.headers))
      outgoing.end(await response.text())
    } catch { outgoing.writeHead(500); outgoing.end('{}') }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await new Promise<void>((done) => server.close(() => done()))
  db?.$client.close()
  await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const serviceId = crypto.randomUUID()
  const sellerId = `worker-seller-${serviceId}`
  const buyerId = `worker-buyer-${serviceId}`
  await db.insert(schema.users).values([sellerId, buyerId].map((id) => ({
    id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' as const,
  })))
  await db.insert(schema.service_definitions).values({ id: serviceId, seller_id: sellerId, title: 'Provider worker fixture',
    description: 'An isolated funded provider order', price_minor: 2, provider_protocol: 'leased_v1', status: 'active', active_orders: 1 })
  const [listing] = await db.insert(schema.listings).values({ seller_id: sellerId, category: 'code',
    title: 'Provider worker fixture', description: 'An isolated fixture', price_bankr: 0.02, status: 'sold' }).returning()
  const [trade] = await db.insert(schema.trades).values({ listing_id: listing.id, seller_id: sellerId, buyer_id: buyerId,
    amount: 0.02, fee: 0, status: 'escrow_held', payment_rail: 'evm', funded_at: new Date().toISOString() }).returning()
  const [order] = await db.insert(schema.service_orders).values({ id: crypto.randomUUID(), service_id: serviceId, listing_id: listing.id, trade_id: trade.id,
    buyer_id: buyerId, client_reference: `worker-${serviceId}`, objective: 'Process the isolated sample', input_json: '{"sample":"private fixture input"}',
    price_minor: 2, payment_rail: 'evm', state: 'funded' }).returning()
  const { queueFundedWorkOrder } = await import('@/lib/service-order-dispatch')
  await db.transaction((tx) => queueFundedWorkOrder(tx, trade.id, sellerId))
  const [attempt] = await db.select().from(schema.service_execution_attempts).where(eq(schema.service_execution_attempts.order_id, order.id))
  const apiKey = jwt({ userId: sellerId, email: `${sellerId}@test.invalid`, role: 'human' })
  const stateFile = join(directory, `${trade.id}.json`)
  const handler = async () => ({ summary: 'Provider completed the isolated sample for buyer review.', artifact: { result: 'controlled' } })
  return { serviceId, sellerId, buyerId, trade, order, attempt, apiKey, stateFile, handler, baseUrl, tradeId: trade.id }
}

test('provider processes survive restart with the same prepared output and leave payment/review to the buyer', async () => {
  const f = await fixture()
  const handlerPath = join(directory, `${f.trade.id}.mjs`)
  const marker = join(directory, `${f.trade.id}.calls`)
  await writeFile(handlerPath, `import {appendFile} from 'node:fs/promises'; export default async () => {
    await appendFile(${JSON.stringify(marker)}, 'computed\\n');
    return {summary:'A controlled provider computed one private result.', artifact:{result:'prepared'}};
  }`)
  const args = ['scripts/provider-worker.mjs', '--trade-id', f.trade.id, '--service-id', f.serviceId,
    '--handler', handlerPath, '--state-dir', join(directory, `cli-${f.trade.id}`)]
  const execute = (extra: string[] = []) => promisify(execFile)(process.execPath, [...args, ...extra], {
    cwd: resolve('.'), env: { ...process.env, BASE_URL: baseUrl, CLAWDMARKET_PROVIDER_API_KEY: f.apiKey },
  })
  assert.equal(JSON.parse((await execute(['--prepare-only'])).stdout).state, 'prepared')
  assert.equal((await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, f.trade.id))).length, 0)
  const result = JSON.parse((await execute()).stdout)
  const replay = JSON.parse((await execute()).stdout)
  assert.equal(result.state, 'delivered')
  assert.equal(result.attempt_id, f.attempt.id)
  assert.equal(replay.delivery_id, result.delivery_id)
  assert.equal(replay.idempotent, true)
  assert.equal((await readFile(marker, 'utf8')).trim(), 'computed')
  const [order] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, f.order.id))
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, f.trade.id))
  assert.equal(order.state, 'verifying')
  assert.equal(order.capacity_released_at, null)
  assert.equal(trade.status, 'pending_release')
  assert.notEqual(trade.payout_status, 'complete')
  assert.equal((await db.select().from(schema.settlement_transfers)).length, 0)
})

test('lost acceptance response resumes the existing attempt without creating another acceptance or order', async () => {
  const f = await fixture()
  let lost = false
  const fetcher: typeof fetch = async (url, init) => {
    const response = await fetch(url, init)
    if (!lost && String(init?.body).includes('"action":"accept"')) { lost = true; throw new Error('connection lost after commit') }
    return response
  }
  await assert.rejects(runProviderWork({ ...f, fetcher }), /PROVIDER_REQUEST_UNCERTAIN/)
  assert.equal(JSON.parse(await readFile(f.stateFile, 'utf8')).phase, 'running')
  const result = await runProviderWork(f)
  assert.equal(result.attempt_id, f.attempt.id)
  const attempts = await db.select().from(schema.service_execution_attempts).where(eq(schema.service_execution_attempts.order_id, f.order.id))
  assert.equal(attempts.length, 1)
  assert.equal(attempts[0].state, 'delivered')
})

test('lost delivery response replays persisted bytes even after terminal buyer settlement', async () => {
  const f = await fixture()
  let calls = 0
  const handler = async () => { calls++; return f.handler() }
  const fetcher: typeof fetch = async (url, init) => {
    const response = await fetch(url, init)
    if (String(url).endsWith('/delivery')) throw new Error('response lost after delivery committed')
    return response
  }
  await assert.rejects(runProviderWork({ ...f, handler, fetcher }), /PROVIDER_REQUEST_UNCERTAIN/)
  const journal = JSON.parse(await readFile(f.stateFile, 'utf8'))
  assert.equal(journal.phase, 'prepared')
  assert.equal((await stat(f.stateFile)).mode & 0o777, 0o600)
  assert.ok(!JSON.stringify(journal).includes(f.apiKey))
  assert.ok(!JSON.stringify(journal).includes('private fixture input'))
  // Simulate settlement completed elsewhere; replay must still verify the original content.
  await db.update(schema.trades).set({ status: 'completed' }).where(eq(schema.trades.id, f.trade.id))
  await db.update(schema.service_orders).set({ state: 'completed', capacity_released_at: new Date() }).where(eq(schema.service_orders.id, f.order.id))
  const resumed = await runProviderWork({ ...f, handler })
  assert.equal(resumed.idempotent, true)
  assert.equal(calls, 1)
  assert.equal((await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, f.trade.id))).length, 1)
})

test('heartbeats maintain execution and abort a handler when another connection interrupts work', async () => {
  const f = await fixture()
  let heartbeatCount = 0
  const fetcher: typeof fetch = async (url, init) => {
    if (String(init?.body).includes('"action":"heartbeat"') && ++heartbeatCount === 3) {
      await db.update(schema.trades).set({ status: 'disputed' }).where(eq(schema.trades.id, f.trade.id))
    }
    return fetch(url, init)
  }
  let aborted = false
  const handler = async (_work: unknown, { signal }: { signal: AbortSignal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(signal.reason) }, { once: true })
  })
  await assert.rejects(runProviderWork({ ...f, handler, fetcher, heartbeatMs: 10 }), /WORK_ORDER_NOT_FUNDED/)
  assert.equal(aborted, true)
  assert.ok(heartbeatCount >= 3)
  assert.equal((await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, f.trade.id))).length, 0)
})

test('expired acknowledgment or lease stops work before invoking the handler or submitting saved output', async () => {
  for (const prepared of [false, true]) {
    const f = await fixture()
    if (prepared) await runProviderWork({ ...f, prepareOnly: true })
    await db.update(schema.service_execution_attempts).set(prepared
      ? { lease_expires_at: new Date(Date.now() - 1000) } : { acknowledgment_due_at: new Date(Date.now() - 1000) })
      .where(eq(schema.service_execution_attempts.id, f.attempt.id))
    await assert.rejects(runProviderWork({ ...f, handler: () => { throw new Error('must not compute') } }), /PROVIDER_DEADLINE_EXPIRED/)
    assert.equal((await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, f.trade.id))).length, 0)
  }
})

test('mismatched journal or service and unauthenticated users cannot start provider execution', async () => {
  const f = await fixture()
  await assert.rejects(runProviderWork({ ...f, serviceId: crypto.randomUUID() }), /PROVIDER_WORK_ORDER_MISMATCH/)
  await runProviderWork({ ...f, prepareOnly: true })
  const journal = JSON.parse(await readFile(f.stateFile, 'utf8'))
  journal.attempt_id = crypto.randomUUID()
  await writeFile(f.stateFile, JSON.stringify(journal))
  await assert.rejects(runProviderWork(f), /PROVIDER_JOURNAL_MISMATCH/)
  await assert.rejects(runProviderWork({ ...f, apiKey: 'invalid-key' }), /UNAUTHORIZED/)
})

test('competing CLI workers cannot compute the same journal concurrently', async () => {
  const f = await fixture()
  const marker = join(directory, `${f.trade.id}.started`)
  const handlerPath = join(directory, `${f.trade.id}.slow.mjs`)
  await writeFile(handlerPath, `import {writeFile} from 'node:fs/promises'; export default async () => {
    await writeFile(${JSON.stringify(marker)}, 'started'); await new Promise(r=>setTimeout(r,500));
    return {summary:'A single controlled worker produced this result.'};
  }`)
  const args = ['scripts/provider-worker.mjs', '--trade-id', f.trade.id, '--handler', handlerPath,
    '--state-dir', join(directory, `race-${f.trade.id}`)]
  const execute = () => promisify(execFile)(process.execPath, args, {
    env: { ...process.env, BASE_URL: baseUrl, CLAWDMARKET_PROVIDER_API_KEY: f.apiKey },
  })
  const first = execute()
  for (let index = 0; index < 200; index++) {
    if (await stat(marker).then(() => true, () => false)) break
    await new Promise((done) => setTimeout(done, 10))
  }
  await assert.rejects(execute(), (error: unknown) => {
    assert.equal((error as { code: number }).code, 75)
    return true
  })
  assert.equal(JSON.parse((await first).stdout).state, 'delivered')
})

test('SIGKILL releases the process lock and an idempotent handler resumes the same attempt', async () => {
  const f = await fixture()
  const marker = join(directory, `${f.trade.id}.pid`)
  const resultFile = join(directory, `${f.trade.id}.result`)
  const handlerPath = join(directory, `${f.trade.id}.kill.mjs`)
  await writeFile(handlerPath, `import {readFile,writeFile} from 'node:fs/promises';
    export default async (_work,{idempotencyKey}) => {
      try {return JSON.parse(await readFile(${JSON.stringify(resultFile)},'utf8'))} catch {}
      const output={summary:'An idempotent provider resumed the same original task.',artifact:{key:idempotencyKey}};
      await writeFile(${JSON.stringify(resultFile)},JSON.stringify(output));
      await writeFile(${JSON.stringify(marker)},String(process.pid));
      await new Promise(r=>setTimeout(r,10000)); return output;
    }`)
  const args = ['scripts/provider-worker.mjs', '--trade-id', f.trade.id, '--handler', handlerPath,
    '--state-dir', join(directory, `kill-${f.trade.id}`)]
  const execute = () => promisify(execFile)(process.execPath, args, {
    env: { ...process.env, BASE_URL: baseUrl, CLAWDMARKET_PROVIDER_API_KEY: f.apiKey }, timeout: 5000,
  })
  const first = execute().then(() => false, () => true)
  for (let index = 0; index < 200; index++) {
    if (await stat(marker).then(() => true, () => false)) break
    await new Promise((done) => setTimeout(done, 10))
  }
  process.kill(Number(await readFile(marker, 'utf8')), 'SIGKILL')
  assert.equal(await first, true)
  const resumed = JSON.parse((await execute()).stdout)
  assert.equal(resumed.state, 'delivered')
  assert.equal(resumed.attempt_id, f.attempt.id)
  const [delivery] = await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, f.trade.id))
  assert.equal(JSON.parse(delivery.artifact_json!).key, f.attempt.id)
})

test('private files survive prepared restart and an uncertain upload without duplicate computation or attachments', async () => {
  const { createHash } = await import('node:crypto')
  const f = await fixture()
  let computed = 0
  const text = 'Confidential provider result in a separate encrypted attachment.'
  const file = (content: string, name: string, media_type: string) => ({ name, media_type,
    content_base64: Buffer.from(content).toString('base64'), sha256: createHash('sha256').update(content).digest('hex') })
  const handler = async () => { computed++; return { summary: 'A private result prepared once for buyer verification.',
    files: [file(JSON.stringify({ result: text }), 'result.json', 'application/json'), file(text, 'notes.txt', 'text/plain')], verification_file_index: 0 } }
  assert.equal((await runProviderWork({ ...f, handler, prepareOnly: true })).state, 'prepared')
  assert.equal((await db.select().from(schema.private_artifacts).where(eq(schema.private_artifacts.trade_id, f.trade.id))).length, 0)
  let uncertain = true
  const fetcher: typeof fetch = async (input, init) => {
    const response = await fetch(input, init)
    if (String(input).endsWith('/artifacts') && uncertain) { uncertain = false; throw new Error('lost upload response') }
    return response
  }
  await assert.rejects(runProviderWork({ ...f, handler, fetcher }), /PROVIDER_REQUEST_UNCERTAIN_RESUME_SAME_TRADE/)
  assert.equal((await db.select().from(schema.private_artifacts).where(eq(schema.private_artifacts.trade_id, f.trade.id))).length, 1)
  assert.equal((await runProviderWork({ ...f, handler })).state, 'delivered')
  assert.equal((await runProviderWork({ ...f, handler })).idempotent, true)
  assert.equal(computed, 1)
  const rows = await db.select().from(schema.private_artifacts).where(eq(schema.private_artifacts.trade_id, f.trade.id))
  assert.equal(rows.length, 2)
  assert.ok(rows.every((row) => row.delivery_id))
  const [delivery] = await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, f.trade.id))
  assert.equal(delivery.artifact_json, null)
  const { downloadPrivateArtifact } = await import('@/lib/private-artifacts')
  assert.equal((await downloadPrivateArtifact(f.trade.id, rows.find((row) => row.name === 'notes.txt')!.id, f.buyerId)).bytes.toString(), text)
  const journal = JSON.parse(await readFile(f.stateFile, 'utf8'))
  assert.equal(journal.artifact_uploads.length, 2)
  assert.equal(journal.phase, 'delivered')
  assert.equal((await stat(f.stateFile)).mode & 0o777, 0o600)
  assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.id, f.trade.id)))[0].status, 'pending_release')
})


test('the controlled production artifact handler delivers two verified files against the agreed schema', async () => {
  const { default: handler } = await import('../../examples/providers/controlled-private-review.mjs')
  const f = await fixture()
  await db.update(schema.service_definitions).set({ output_schema: JSON.stringify({ type: 'object', required: ['kind', 'sample_sha256', 'sample_bytes', 'execution_attempt_id', 'semantic_verified'], properties: { kind: { type: 'string' }, sample_sha256: { type: 'string' }, sample_bytes: { type: 'integer' }, execution_attempt_id: { type: 'string' }, semantic_verified: { type: 'boolean' } }, additionalProperties: false }), verification_policy: '{"required":true,"methods":["buyer_review","schema"]}' }).where(eq(schema.service_definitions.id, f.serviceId))
  assert.equal((await runProviderWork({ ...f, handler, prepareOnly: true })).state, 'prepared')
  assert.equal((await runProviderWork({ ...f, handler })).state, 'delivered')
  const { downloadPrivateArtifact } = await import('@/lib/private-artifacts')
  const files = await db.select().from(schema.private_artifacts).where(eq(schema.private_artifacts.trade_id, f.trade.id))
  assert.equal(files.length, 2)
  const result = JSON.parse((await downloadPrivateArtifact(f.trade.id, files.find((row) => row.name === 'result.json')!.id, f.buyerId)).bytes.toString())
  assert.equal(result.kind, 'controlled_review'); assert.equal(result.semantic_verified, false)
  assert.equal(result.execution_attempt_id, f.attempt.id)
  const methods = await db.select().from(schema.verification_results).where(eq(schema.verification_results.trade_id, f.trade.id))
  assert.equal(methods.find((row) => row.method === 'schema')?.status, 'passed')
  assert.equal(methods.find((row) => row.method === 'artifact_integrity')?.status, 'passed')
  assert.equal(methods.find((row) => row.method === 'buyer_review')?.status, 'pending')
})

test('provider uploads privately before verifier approval and preserves the selected job across exact delivery recovery', async () => {
  const f = await fixture()
  const text = 'export default (value) => value;'
  const { createHash } = await import('node:crypto')
  const { canonicalJSON } = await import('../../scripts/verifier-contract.mjs')
  const sha = (value: string) => createHash('sha256').update(value).digest('hex')
  const verifier = crypto.randomUUID(), owner = `verifier-owner-${verifier}`
  await db.insert(schema.users).values([owner, `user_agent_${verifier}`].map((id) => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused', role: 'human' as const })))
  await db.insert(schema.agents).values({ id: verifier, name: 'Worker verifier', description: 'Controlled worker verifier', capabilities: '[]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused' })
  await db.insert(schema.agent_owners).values({ agentId: verifier, userId: owner, establishedBy: 'verified-test' })
  const suite = { version: 1, cases: [{ id: 'echo', args: [1], expected: 1 }] }
  const config = { version: 1, adapter: 'javascript_tests_v1', verifier_agent_id: verifier, suite_sha256: sha(canonicalJSON(suite)), max_runtime_seconds: 5 }
  const [service] = await db.update(schema.service_definitions).set({ verification_policy: JSON.stringify({ methods: ['buyer_review', 'isolated_checks'], isolated_checks: config, acceptance: { version: 1, mode: 'explicit_buyer' } }) }).where(eq(schema.service_definitions.id, f.serviceId)).returning()
  const { captureServiceExecutionContract } = await import('@/lib/service-execution-contract')
  await db.update(schema.service_orders).set({ execution_contract_json: captureServiceExecutionContract(service, []) }).where(eq(schema.service_orders.id, f.order.id))
  let computed = 0
  const handler = async () => { computed++; return { summary: 'Private code awaits approved verification before review.', files: [{ name: 'module.mjs', media_type: 'text/plain', content_base64: Buffer.from(text).toString('base64'), sha256: sha(text) }] } }
  const prepared = await runProviderWork({ ...f, handler, uploadOnly: true })
  assert.equal(prepared.state, 'awaiting_verifier'); assert.equal(prepared.artifact_ids.length, 1)
  assert.equal((await db.select().from(schema.trade_deliveries).where(eq(schema.trade_deliveries.trade_id, f.trade.id))).length, 0)
  const { createVerificationJob, submitVerificationReport } = await import('@/lib/verification-jobs')
  const approved = await createVerificationJob(f.trade.id, f.buyerId, { client_reference: crypto.randomUUID(), artifact_id: prepared.artifact_ids[0], test_suite: suite })
  await submitVerificationReport(approved.job.id, `user_agent_${verifier}`, { version: 1, adapter: config.adapter, artifact_sha256: sha(text), suite_sha256: config.suite_sha256, status: 'passed', total_checks: 1, passed_checks: 1, failed_checks: 0, elapsed_ms: 100, failure: null,
    isolation: { kind: 'bwrap-systemd-v1', network_enabled: false, host_home_mounted: false, memory_limit_bytes: 134217728, task_limit: 32 } })
  assert.equal((await runProviderWork({ ...f, handler, verificationJobId: approved.job.id })).state, 'delivered')
  assert.equal((await runProviderWork({ ...f, handler, verificationJobId: approved.job.id })).idempotent, true)
  assert.equal(computed, 1)
  assert.equal(JSON.parse(JSON.parse(await readFile(f.stateFile, 'utf8')).delivery_body).verification_job_id, approved.job.id)
  await assert.rejects(runProviderWork({ ...f, handler, verificationJobId: crypto.randomUUID() }), /PROVIDER_DELIVERY_ALREADY_BOUND/)
})
