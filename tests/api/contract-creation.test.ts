import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, access, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let api: typeof import('@/app/api/contracts/route'), jwt: typeof import('@/lib/auth').generateJWT
const treasuryKey = `0x${'22'.repeat(32)}` as const
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-contract-creation-'))
  Object.assign(process.env, { TURSO_DATABASE_URL: `file:${join(directory, 'creation.db')}`, TURSO_AUTH_TOKEN: '',
    JWT_SECRET: 'contract-creation-fixture-only', CHAT_ENCRYPTION_KEY: 'contract-creation-fixture-only', WEBHOOK_SECRET_KEY: 'contract-creation-fixture-only',
    EVM_SETTLEMENT_PRIVATE_KEY: treasuryKey, TREASURY_ADDRESS: privateKeyToAccount(treasuryKey).address,
    EVM_RPC_URL_8453: 'http://127.0.0.1:1', EVM_ACCEPTED_TOKENS: JSON.stringify([{ chainId: 8453, address: `0x${'44'.repeat(20)}`, symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, rpcUrl: 'http://127.0.0.1:1' }]),
  })
  delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED
  delete process.env.DEV_WALLET_ADDRESS; delete process.env.DEV_FEE_WALLET_ADDRESS
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  api = await import('@/app/api/contracts/route'); jwt = (await import('@/lib/auth')).generateJWT
})
after(async () => { db?.$client.close(); if (directory) await rm(directory, { recursive: true, force: true }) })
function request(buyer: string, body?: unknown, reference?: string, cookie = false) {
  const token = jwt({ userId: buyer, email: `${buyer}@test.invalid`, role: 'human' })
  return new NextRequest(`http://localhost/api/contracts${reference === undefined ? '' : `?client_reference=${encodeURIComponent(reference)}`}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json',
      ...(cookie ? { Cookie: `auth-token=${token}` } : { Authorization: `Bearer ${token}` }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}
async function fixture() {
  const buyer = crypto.randomUUID(), seller = crypto.randomUUID(), other = crypto.randomUUID()
  await db.insert(schema.users).values([buyer, seller, other].map(id => ({ id, name: 'Disposable participant', email: `${id}@test.invalid`, password_hash: 'unused' })))
  const body = { client_reference: crypto.randomUUID(), seller_id: seller, expires_in_hours: 72, milestones: [
    { title: 'First finite report', amount: .4, deadline_in_hours: 12, acceptance_spec: { required_artifacts: ['report'], notes: 'PRIVATE_ORIGINAL_SCOPE' } },
    { title: 'Second finite report', amount: .6, deadline_in_hours: 24 },
  ] }
  return { buyer, seller, other, body }
}
async function post(f: Awaited<ReturnType<typeof fixture>>, body: unknown = f.body) { return api.POST(request(f.buyer, body)) }
async function waitFor(path: string) {
  const deadline = Date.now() + 20000
  while (true) { try { await access(path); return } catch {
    assert.ok(Date.now() < deadline, `Missing process barrier ${path}`)
    await new Promise(resolve => setTimeout(resolve, 10))
  } }
}
function child(buyer: string, body: unknown, barrier: string, boundary?: string) {
  const process = spawn(globalThis.process.execPath, ['--conditions=react-server', '--import', 'tsx', 'tests/helpers/contract-creation-process.ts', buyer, JSON.stringify(body), barrier, ...(boundary ? [boundary] : [])], {
    cwd: globalThis.process.cwd(), env: { ...globalThis.process.env }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = '', errors = ''; process.stdout.on('data', data => output += data); process.stderr.on('data', data => errors += data)
  return { process, result: new Promise<{ status: number; body: any }>((resolve, reject) => {
    process.on('error', reject); process.on('exit', code => {
      if (code !== 0) reject(new Error(`Creation child exit ${code}: ${errors}`))
      else { try { resolve(JSON.parse(output)) } catch (error) { reject(error) } }
    })
  }) }
}
test('lost committed HTTP creation reply recovers exact original draft, milestone IDs and fixed deadlines', async () => {
  const f = await fixture()
  let committed: any
  const server = createServer(async (incoming, outgoing) => {
    let body = ''; for await (const chunk of incoming) body += chunk
    const response = await api.POST(request(f.buyer, JSON.parse(body)))
    assert.equal(response.status, 201); committed = await response.json()
    outgoing.destroy() // Actual lost transport response after the transaction committed.
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = (server.address() as { port: number }).port
    await assert.rejects(fetch(`http://127.0.0.1:${port}`, { method: 'POST', body: JSON.stringify(f.body) }))
    const read = await api.GET(request(f.buyer, undefined, f.body.client_reference))
    assert.equal(read.status, 200); assert.equal(read.headers.get('Cache-Control'), 'no-store')
    const original = await read.json()
    assert.deepEqual(original, { ...committed, idempotent: true })
    const replay = await post(f); assert.equal(replay.status, 200)
    assert.deepEqual(await replay.json(), original)
    assert.equal(original.contract.total_amount, 1); assert.equal(original.contract.fee_amount, .05); assert.equal(original.contract.escrow_amount, 1.05)
    const createdAt = Date.parse(original.contract.created_at)
    assert.equal(Date.parse(original.contract.expires_at) - createdAt, 72 * 3600000)
    assert.equal(Date.parse(original.milestones[0].deadline_at) - createdAt, 12 * 3600000)
    assert.equal(Date.parse(original.milestones[1].deadline_at) - createdAt, 24 * 3600000)
    for (const table of ['credit_entries', 'trades', 'organization_contract_attributions']) {
      assert.equal(Number((await db.$client.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n), 0)
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
test('same reference rejects changed seller, ordered milestone scope, amount, expiry and relative deadline', async () => {
  const f = await fixture(); assert.equal((await post(f)).status, 201)
  for (const body of [ { ...f.body, seller_id: f.other }, { ...f.body, milestones: [...f.body.milestones].reverse() },
    { ...f.body, milestones: [{ ...f.body.milestones[0], amount: .5 }, f.body.milestones[1]] },
    { ...f.body, expires_in_hours: 71 }, { ...f.body, milestones: [{ ...f.body.milestones[0], deadline_in_hours: 13 }, f.body.milestones[1]] } ]) {
    const response = await post(f, body); assert.equal(response.status, 409)
    assert.equal((await response.json()).code, 'CONTRACT_CREATION_CONFLICT')
  }
  assert.equal((await db.select().from(schema.contracts).where(eq(schema.contracts.buyer_id, f.buyer))).length, 1)
})
test('buyer-scoped lookup cannot enumerate seller or other buyer private scope and defaults replay canonically', async () => {
  const f = await fixture(), original = await (await post(f)).json()
  for (const actor of [f.seller, f.other]) {
    const response = await api.GET(request(actor, undefined, f.body.client_reference))
    assert.equal(response.status, 404); assert.equal(JSON.stringify(await response.json()).includes('PRIVATE_ORIGINAL_SCOPE'), false)
  }
  const normalized = { ...f.body, milestones: f.body.milestones.map(m => ({ ...m, review_window_hours: 24 })) }
  const response = await post(f, normalized); assert.equal(response.status, 200)
  assert.equal((await response.json()).contract.id, original.contract.id)
  const separate = await api.POST(request(f.other, f.body)); assert.equal(separate.status, 201)
  assert.notEqual((await separate.json()).contract.id, original.contract.id)
})
test('original recovery survives closed admission, unavailable credit and cancellation', async () => {
  const f = await fixture(), created = await (await post(f)).json()
  await db.update(schema.contracts).set({ state: 'CANCELED' }).where(eq(schema.contracts.id, created.contract.id))
  process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED = 'true'; delete process.env.EVM_SETTLEMENT_PRIVATE_KEY
  try {
    const response = await post(f); assert.equal(response.status, 200)
    assert.equal((await response.json()).contract.state, 'CANCELED')
    assert.equal((await api.GET(request(f.buyer, undefined, f.body.client_reference))).status, 200)
    const fresh = await post(f, { ...f.body, client_reference: crypto.randomUUID() }); assert.equal(fresh.status, 503)
    assert.equal((await fresh.json()).code, 'CONTRACT_FUNDING_UNAVAILABLE')
    process.env.EVM_SETTLEMENT_PRIVATE_KEY = treasuryKey
    const paused = await post(f, { ...f.body, client_reference: crypto.randomUUID() }); assert.equal(paused.status, 503)
    assert.equal((await paused.json()).code, 'NEW_PAYMENTS_PAUSED')
  } finally { delete process.env.CLAWDMARKET_NEW_PAYMENTS_PAUSED; process.env.EVM_SETTLEMENT_PRIVATE_KEY = treasuryKey }
})
test('no-reference historical creation stays separate and referenced lookup requires valid bounded input and CSRF', async () => {
  const f = await fixture(), { client_reference: ignored, ...legacy } = f.body
  assert.ok(ignored)
  const first = await (await post(f, legacy)).json(), second = await (await post(f, legacy)).json()
  assert.notEqual(first.contract.id, second.contract.id)
  assert.equal((await db.select().from(schema.contract_creation_requests).where(eq(schema.contract_creation_requests.buyer_id, f.buyer))).length, 0)
  for (const reference of ['', 'short', 'x'.repeat(129), 'invalid/reference']) {
    assert.equal((await api.GET(request(f.buyer, undefined, reference))).status, 400)
    assert.equal((await post(f, { ...f.body, client_reference: reference })).status, 400)
  }
  assert.equal((await api.POST(request(f.buyer, f.body, undefined, true))).status, 403)
  assert.equal((await api.GET(new NextRequest('http://localhost/api/contracts?client_reference=some-reference'))).status, 401)
})
test('oversized and deeply nested referenced metadata fail before any draft or milestone write', async () => {
  const f = await fixture()
  const huge = await post(f, { ...f.body, padding: 'x'.repeat(65536) }); assert.equal(huge.status, 413)
  let nested: unknown = 'leaf'; for (let i = 0; i < 30; i++) nested = { nested }
  const response = await post(f, { ...f.body, milestones: [{ ...f.body.milestones[0], acceptance_spec: { nested } }] })
  assert.equal(response.status, 400); assert.equal((await response.json()).code, 'CONTRACT_CREATION_INPUT_LIMIT')
  assert.equal((await db.select().from(schema.contracts).where(eq(schema.contracts.buyer_id, f.buyer))).length, 0)
})
for (const changed of [false, true]) test(`separate processes ${changed ? 'conflict on changed' : 'recover the same'} original creation reference without duplicate milestones`, async () => {
  const f = await fixture(), barriers = [join(directory, crypto.randomUUID()), join(directory, crypto.randomUUID())]
  const commands = [f.body, changed ? { ...f.body, expires_in_hours: 24 } : f.body]
  const children = commands.map((body, i) => child(f.buyer, body, barriers[i]))
  const settled = Promise.all(children.map(c => c.result)); void settled.catch(() => {})
  try {
    await Promise.all(barriers.map(path => waitFor(`${path}.ready`)))
    await Promise.all(barriers.map(path => writeFile(`${path}.go`, '')))
    const results = await settled
    assert.deepEqual(results.map(r => r.status).sort(), changed ? [201, 409] : [200, 201], JSON.stringify(results))
    const rows = await db.select().from(schema.contracts).where(eq(schema.contracts.buyer_id, f.buyer))
    assert.equal(rows.length, 1)
    const milestones = await db.select().from(schema.contract_milestones).where(eq(schema.contract_milestones.contract_id, rows[0].id))
    assert.equal(milestones.length, 2)
    for (const response of results.filter(r => r.status < 300)) {
      assert.equal(response.body.contract.id, rows[0].id)
      assert.deepEqual(response.body.milestones.map((m: any) => m.id).sort(), milestones.map(m => m.id).sort())
    }
  } finally { for (const c of children) c.process.kill('SIGTERM') }
})
for (const boundary of ['before', 'after']) test(`original contract creation survives real ${boundary}-commit SIGKILL without orphan or replacement milestones`, async () => {
  const f = await fixture(), barrier = join(directory, crypto.randomUUID())
  const running = child(f.buyer, f.body, barrier, boundary)
  const exited = new Promise<void>(resolve => running.process.once('exit', () => resolve()))
  // Expected process death rejects the command result; it is not a successful response.
  void running.result.catch(() => {})
  try {
    await waitFor(`${barrier}.ready`); await writeFile(`${barrier}.go`, '')
    await waitFor(`${barrier}.boundary`)
    running.process.kill('SIGKILL'); await exited
    assert.equal(running.process.signalCode, 'SIGKILL')
    const before = await db.select().from(schema.contracts).where(eq(schema.contracts.buyer_id, f.buyer))
    const saved = await db.select().from(schema.contract_creation_requests).where(eq(schema.contract_creation_requests.buyer_id, f.buyer))
    assert.equal(before.length, boundary === 'before' ? 0 : 1)
    assert.equal(saved.length, boundary === 'before' ? 0 : 1)
    const response = await post(f); assert.equal(response.status, boundary === 'before' ? 201 : 200)
    const original = await response.json()
    if (before.length) assert.equal(original.contract.id, before[0].id)
    const replay = await (await post(f)).json()
    assert.equal(replay.contract.id, original.contract.id)
    assert.deepEqual(replay.milestones, original.milestones)
    assert.equal((await db.select().from(schema.contracts).where(eq(schema.contracts.buyer_id, f.buyer))).length, 1)
    assert.equal((await db.select().from(schema.contract_milestones).where(eq(schema.contract_milestones.contract_id, original.contract.id))).length, 2)
  } finally {
    if (running.process.exitCode === null && running.process.signalCode === null) running.process.kill('SIGKILL')
    await exited
  }
})
