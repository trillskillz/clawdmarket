import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let plan: typeof import('@/app/api/workflows/plan/route').POST
let api: typeof import('@/app/api/workflows/[id]/approval/route')
const treasury = privateKeyToAccount(`0x${'99'.repeat(32)}`).address.toLowerCase(), token = `0x${'44'.repeat(20)}`
const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } }
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-workflow-approval-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'approval.db')}`
  process.env.TURSO_AUTH_TOKEN = ''
  process.env.JWT_SECRET = 'workflow-approval-tests-only'
  process.env.TREASURY_ADDRESS = treasury
  process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'99'.repeat(32)}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Test Base', address: token,
    symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: 'https://rpc.example.invalid' }])
  process.env.CLAWDMARKET_WORKFLOW_PLANNING_ENABLED = 'true'
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  plan = (await import('@/app/api/workflows/plan/route')).POST
  api = await import('@/app/api/workflows/[id]/approval/route')
})
after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })
function request(id: string, method: string, userId: string | null, body?: unknown, headers = {}) {
  return new NextRequest(`http://localhost/api/workflows/${id}/approval`, { method,
    headers: { 'Content-Type': 'application/json', ...(userId ? { Authorization: `Bearer ${jwt({ userId, email: `${userId}@test.invalid`, role: 'human' })}` } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}
const context = (id: string) => ({ params: Promise.resolve({ id }) })
async function fixture(agentBuyer = false) {
  const agentId = crypto.randomUUID(), owner = `workflow-owner-${agentId}`, buyer = agentBuyer ? `user_agent_${agentId}` : owner
  const outsider = `workflow-outsider-${agentId}`
  await db.insert(schema.users).values([...new Set([owner, buyer, outsider])].map((id) => ({ id, name: id, email: `${id}@test.invalid`, password_hash: 'unused' })))
  if (agentBuyer) {
    await db.insert(schema.agents).values({ id: agentId, name: 'Workflow buyer', description: 'Isolated workflow buyer', capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused' })
    await db.insert(schema.agent_owners).values({ agentId, userId: owner, establishedBy: 'test' })
  }
  const response = await plan(request('plan', 'POST', buyer, { client_reference: `workflow-${agentId}`, objective: 'Research then review a private repository',
    max_budget: { amount: '5.00', currency: 'USD' }, deadline_seconds: 300,
    nodes: [{ key: 'research', objective: 'Research the private repository requirements', required_capabilities: ['research'], budget: { amount: '2.00', currency: 'USD' }, deadline_seconds: 100 },
      { key: 'review', objective: 'Review the private repository using the research', required_capabilities: ['code-review'], budget: { amount: '3.00', currency: 'USD' }, deadline_seconds: 300, depends_on: ['research'] }] }))
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  const workflow = (await response.json()).workflow
  const body = { version: 1, client_reference: `approval-${agentId}`, plan_hash: workflow.plan_hash,
    expires_at: new Date(Math.floor(Date.now() / 1000) * 1000 + 600_000).toISOString(),
    max_gross_minor: 500, max_chain_fee_units: '3000', private_data: 'selected_provider_only',
    payment: { rail: 'evm', chain_id: 8453, token_address: token, payer_address: `0x${'11'.repeat(20)}`, treasury_address: treasury,
      minimum_token_reserve_units: '5000000', minimum_native_reserve_wei: '10000', max_gas_cost_wei: '1000' },
    nodes: [{ key: 'research', static_input: { private_text: 'WORKFLOW_PRIVATE_INPUT' }, provider_requirements: { approved_providers: ['seller-a', 'seller-b'] },
      verification: policy, max_per_attempt_minor: 100, max_retry_minor: 100, max_attempts: 2,
      max_latency_seconds: 60, max_chain_fee_per_attempt_units: '1000', dependency_inputs: [] },
      { key: 'review', static_input: {}, provider_requirements: { approved_providers: ['seller-a'] }, verification: policy,
        max_per_attempt_minor: 300, max_retry_minor: 0, max_attempts: 1, max_latency_seconds: 120,
        max_chain_fee_per_attempt_units: '1000', dependency_inputs: [{ source_node: 'research', artifact_index: 0, target_field: 'research_artifact' }] }] }
  return { id: workflow.id as string, owner, buyer, outsider, agentId, body }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
const approve = (f: Fixture, body: unknown = f.body, user = f.owner) => api.POST(request(f.id, 'POST', user, body), context(f.id))

test('owner freezes the exact private graph and contracts without child orders or spending authority', async () => {
  const f = await fixture(true)
  assert.equal((await approve(f, f.body, f.buyer)).status, 401)
  assert.equal((await approve(f, f.body, f.outsider)).status, 404)
  const result = await approve(f)
  assert.equal(result.status, 201, JSON.stringify(await result.clone().json()))
  assert.equal(result.headers.get('cache-control'), 'private, no-store')
  const { approval } = await result.json()
  assert.equal(approval.plan_hash, f.body.plan_hash)
  assert.match(approval.contract_hash, /^[a-f0-9]{64}$/)
  assert.equal(approval.contract.workflow.buyer_id, f.buyer)
  assert.equal(approval.contract.terms.nodes[0].static_input.private_text, 'WORKFLOW_PRIVATE_INPUT')
  assert.equal(approval.contract.token.token_decimals, 6)
  assert.equal(approval.current_plan_matches, true)
  assert.equal(approval.spending_authority, false)
  assert.equal(approval.execution_available, false)
  for (const table of [schema.route_plans, schema.route_payment_mandates, schema.route_funding_steps, schema.service_orders, schema.trades, schema.transactions]) {
    assert.equal((await db.select().from(table)).length, 0)
  }
  assert.equal((await api.GET(request(f.id, 'GET', f.buyer), context(f.id))).status, 200)
  assert.equal((await api.GET(request(f.id, 'GET', f.outsider), context(f.id))).status, 404)
  assert.equal((await api.GET(request(f.id, 'GET', null), context(f.id))).status, 401)
  const named = await (await import('@/lib/agent-named-credentials')).createNamedAgentCredential({ agentId: f.agentId, name: 'Workflow read only', scopes: ['agent:read'], actorCredentialId: null })
  assert.equal(named.kind, 'created')
  if (named.kind !== 'created') throw Error('Fixture credential failed')
  const headers = { Authorization: `Bearer ${named.api_key}` }
  assert.equal((await api.GET(request(f.id, 'GET', null, undefined, headers), context(f.id))).status, 200)
  assert.equal((await api.POST(request(f.id, 'POST', null, f.body, headers), context(f.id))).status, 401)
  assert.equal((await api.DELETE(request(f.id, 'DELETE', null, undefined, headers), context(f.id))).status, 401)
})

test('semantic replay preserves approval identity; every authority-changing field conflicts', async () => {
  const f = await fixture()
  const initial = await (await approve(f)).json()
  const reordered = structuredClone(f.body)
  reordered.nodes.reverse(); reordered.nodes[1].provider_requirements.approved_providers.reverse()
  for (const node of reordered.nodes) node.verification.methods.reverse()
  const replay = await approve(f, reordered)
  assert.equal(replay.status, 200)
  assert.equal((await replay.json()).approval.id, initial.approval.id)
  const variants = [
    { ...f.body, max_gross_minor: 499 }, { ...f.body, max_chain_fee_units: '3001' },
    { ...f.body, payment: { ...f.body.payment, payer_address: `0x${'22'.repeat(20)}` } },
    { ...f.body, nodes: f.body.nodes.map((node) => ({ ...node, static_input: { changed: true } })) },
    { ...f.body, nodes: f.body.nodes.map((node) => ({ ...node, provider_requirements: { approved_providers: ['seller-c'] } })) },
  ]
  for (const changed of variants) {
    const response = await approve(f, changed)
    assert.equal(response.status, 409)
    assert.equal((await response.json()).error_code, 'WORKFLOW_APPROVAL_IDEMPOTENCY_CONFLICT')
  }
})

test('approval checks per-node/gross budgets, aggregate integer fees, dependencies, acceptance and expiry', async () => {
  const f = await fixture()
  const cases: Array<[unknown, string]> = [
    [{ ...f.body, plan_hash: 'a'.repeat(64) }, 'WORKFLOW_PLAN_CHANGED'],
    [{ ...f.body, max_gross_minor: 501 }, 'WORKFLOW_APPROVAL_BUDGET_EXCEEDED'],
    [{ ...f.body, max_gross_minor: 499 }, 'WORKFLOW_APPROVAL_BUDGET_EXCEEDED'],
    [{ ...f.body, max_chain_fee_units: '2999' }, 'WORKFLOW_AGGREGATE_FEE_EXCEEDED'],
    [{ ...f.body, nodes: [{ ...f.body.nodes[0], max_per_attempt_minor: 101 }, f.body.nodes[1]] }, 'WORKFLOW_NODE_BUDGET_EXCEEDED'],
    [{ ...f.body, nodes: [{ ...f.body.nodes[0], max_chain_fee_per_attempt_units: '1001' }, f.body.nodes[1]] }, 'WORKFLOW_NODE_FEE_EXCEEDED'],
    [{ ...f.body, nodes: [{ ...f.body.nodes[0], max_latency_seconds: 101 }, f.body.nodes[1]] }, 'WORKFLOW_NODE_LATENCY_EXCEEDED'],
    [{ ...f.body, nodes: [f.body.nodes[0], { ...f.body.nodes[1], dependency_inputs: [] }] }, 'WORKFLOW_DEPENDENCY_CONTRACT_MISMATCH'],
    [{ ...f.body, nodes: [f.body.nodes[0], { ...f.body.nodes[1], dependency_inputs: [{ source_node: 'review', artifact_index: 0, target_field: 'research_artifact' }] }] }, 'WORKFLOW_DEPENDENCY_CONTRACT_MISMATCH'],
    [{ ...f.body, nodes: [f.body.nodes[0]] }, 'WORKFLOW_NODE_CONTRACT_MISMATCH'],
    [{ ...f.body, expires_at: new Date(0).toISOString() }, 'WORKFLOW_APPROVAL_EXPIRY_INVALID'],
    [{ ...f.body, nodes: f.body.nodes.map((node) => ({ ...node, verification: { required: true, methods: ['buyer_review'] } })) }, 'INVALID_WORKFLOW_APPROVAL'],
    [{ ...f.body, nodes: [f.body.nodes[0], { ...f.body.nodes[1], static_input: { research_artifact: 'overwrite' } }] }, 'INVALID_WORKFLOW_APPROVAL'],
    [{ ...f.body, nodes: [f.body.nodes[0], { ...f.body.nodes[1], dependency_inputs: [{ source_node: 'research', artifact_index: 0, target_field: 'constructor' }] }] }, 'INVALID_WORKFLOW_APPROVAL'],
    [{ ...f.body, payment: { ...f.body.payment, chain_id: 123 } }, 'MANDATE_PAYMENT_RAIL_UNAVAILABLE'],
  ]
  for (const [body, code] of cases) {
    const response = await approve(f, body)
    assert.equal(response.status, code === 'WORKFLOW_PLAN_CHANGED' || code === 'MANDATE_PAYMENT_RAIL_UNAVAILABLE' ? 409 : 400, code)
    assert.equal((await response.json()).error_code, code)
  }
  assert.equal((await db.select().from(schema.workflow_approvals).where(eq(schema.workflow_approvals.workflow_id, f.id))).length, 0)
})

test('current owner link controls approval, inspection and revocation after transfer', async () => {
  const f = await fixture(true)
  const initial = await (await approve(f)).json()
  await db.update(schema.agent_owners).set({ userId: f.outsider }).where(eq(schema.agent_owners.agentId, f.agentId))
  assert.equal((await api.GET(request(f.id, 'GET', f.owner), context(f.id))).status, 404)
  assert.equal((await approve(f)).status, 404)
  const transferred = await api.GET(request(f.id, 'GET', f.outsider), context(f.id))
  assert.equal((await transferred.json()).approval.current_owner_controls, false)
  assert.equal((await api.DELETE(request(f.id, 'DELETE', f.owner), context(f.id))).status, 404)
  const revoked = await api.DELETE(request(f.id, 'DELETE', f.outsider), context(f.id))
  const body = await revoked.json()
  assert.equal(body.approval.id, initial.approval.id)
  assert.equal(body.approval.state, 'revoked')
  assert.equal((await (await api.DELETE(request(f.id, 'DELETE', f.outsider), context(f.id))).json()).idempotent, true)
  const row = (await db.select().from(schema.workflow_approvals).where(eq(schema.workflow_approvals.workflow_id, f.id)))[0]
  assert.equal(row.owner_account_id, f.owner)
  assert.equal(row.revoked_by, f.outsider)
})

test('cancelled/changed/corrupt plans cannot gain new approval; original review remains recoverable', async () => {
  const f = await fixture(), g = await fixture()
  await db.update(schema.workflow_nodes).set({ budget_minor: 199 }).where(eq(schema.workflow_nodes.workflow_id, g.id))
  assert.equal((await (await approve(g)).json()).error_code, 'WORKFLOW_CONTRACT_INVALID')
  const initial = await (await approve(f)).json()
  await db.update(schema.workflow_nodes).set({ objective: 'Changed after owner review' }).where(eq(schema.workflow_nodes.workflow_id, f.id))
  const history = await (await api.GET(request(f.id, 'GET', f.owner), context(f.id))).json()
  assert.equal(history.approval.current_plan_matches, false)
  assert.equal(history.approval.contract_hash, initial.approval.contract_hash)
  assert.equal((await approve(f)).status, 200)
  await db.update(schema.workflows).set({ state: 'cancelled' }).where(eq(schema.workflows.id, f.id))
  assert.equal((await (await api.GET(request(f.id, 'GET', f.owner), context(f.id))).json()).approval.workflow_cancelled, true)
  assert.equal((await api.DELETE(request(f.id, 'DELETE', f.owner), context(f.id))).status, 200)
  const cancelled = await fixture()
  await db.update(schema.workflows).set({ state: 'cancelled' }).where(eq(schema.workflows.id, cancelled.id))
  assert.equal((await (await approve(cancelled)).json()).error_code, 'WORKFLOW_NOT_APPROVABLE')
})

test('cookie fallback enforces CSRF and oversized bodies are bounded before storage', async () => {
  const f = await fixture()
  const cookie = jwt({ userId: f.owner, email: `${f.owner}@test.invalid`, role: 'human' })
  assert.equal((await api.POST(request(f.id, 'POST', null, f.body, { Cookie: `auth-token=${cookie}`, Authorization: 'Bearer invalid' }), context(f.id))).status, 403)
  const huge = { ...f.body, extra: 'x'.repeat(196_608) }
  assert.equal((await approve(f, huge)).status, 413)
  assert.equal((await api.GET(request(f.id, 'GET', f.owner), context(f.id))).status, 200)
  assert.equal((await (await api.GET(request(f.id, 'GET', f.owner), context(f.id))).json()).approval, null)
})

test('independent processes race the exact approval and recover the original durable identity', async () => {
  const f = await fixture()
  const child = `const { approveWorkflow } = require('./lib/workflow-approval.ts'); const { db } = require('./lib/db.ts');
    approveWorkflow(process.argv[1], process.argv[2], JSON.parse(process.argv[3])).then(r => console.log(JSON.stringify({id:r.approval.id,idempotent:r.idempotent}))).catch(e => {if(e.code==='WORKFLOW_APPROVAL_STORAGE_BUSY')console.log(JSON.stringify({error_code:e.code}));else{console.error(e.code || e.message);process.exitCode=1}}).finally(() => db.$client.close());`
  const run = () => promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--eval', child, f.id, f.owner, JSON.stringify(f.body)],
    { cwd: process.cwd(), env: { ...process.env, TURSO_AUTH_TOKEN: '' }, timeout: 30_000 })
  const results = await Promise.allSettled([run(), run()])
  for (const result of results) if (result.status === 'rejected') throw result.reason
  const values = results.map((result) => JSON.parse(result.status === 'fulfilled' ? result.value.stdout.trim() : 'null'))
  // Bounded contention may return the documented 503. Recover only the same
  // saved request, in a fresh process after every competing process has exited.
  for (let i = 0; i < values.length; i++) {
    if (values[i].error_code === 'WORKFLOW_APPROVAL_STORAGE_BUSY') values[i] = JSON.parse((await run()).stdout.trim())
  }
  assert.equal(values[0].id, values[1].id)
  assert.deepEqual(values.map((value) => value.idempotent).sort(), [false, true])
  assert.equal((await db.select().from(schema.workflow_approvals).where(eq(schema.workflow_approvals.workflow_id, f.id))).length, 1)
  const recovered = JSON.parse((await run()).stdout.trim())
  assert.equal(recovered.id, values[0].id)
  assert.equal(recovered.idempotent, true)
})

test('real cross-process lock exhaustion returns retryable 503 and the same request recovers once', async () => {
  const f = await fixture()
  const script = `const {db}=require('./lib/db.ts'); (async()=>{const tx=await db.$client.transaction('write'); console.log('locked');
    await new Promise(resolve=>setTimeout(resolve,1800)); await tx.rollback();db.$client.close();})().catch(e=>{console.error(e.message);process.exitCode=1});`
  const holder = spawn(process.execPath, ['--conditions=react-server', '--import', 'tsx', '--eval', script], { cwd: process.cwd(), env: { ...process.env, TURSO_AUTH_TOKEN: '' } })
  const exited = new Promise<void>((resolve, reject) => {
    holder.once('error', reject)
    holder.once('exit', (code) => code === 0 ? resolve() : reject(Error(`Fixture lock process failed: ${code}`)))
  })
  await new Promise<void>((resolve, reject) => {
    holder.stdout.once('data', (chunk) => String(chunk).includes('locked') ? resolve() : reject(Error('Fixture lock not acquired')))
    holder.once('error', reject)
    holder.once('exit', () => reject(Error('Fixture lock process ended before ready')))
  })
  try {
    const busy = await approve(f)
    assert.equal(busy.status, 503)
    const body = await busy.json()
    assert.equal(body.error_code, 'WORKFLOW_APPROVAL_STORAGE_BUSY')
    assert.equal(body.retryable, true)
    assert.equal(body.spending_authority, false)
  } finally { await exited }
  const recovered = await approve(f)
  assert.equal(recovered.status, 201)
  assert.equal((await approve(f)).status, 200)
  assert.equal((await db.select().from(schema.workflow_approvals).where(eq(schema.workflow_approvals.workflow_id, f.id))).length, 1)
})

test('revoked approvals replay without reopening and corrupt stored contracts fail closed', async () => {
  const f = await fixture()
  await approve(f)
  await api.DELETE(request(f.id, 'DELETE', f.owner), context(f.id))
  const replay = await (await approve(f)).json()
  assert.equal(replay.approval.state, 'revoked')
  assert.equal(replay.approval.spending_authority, false)
  await db.update(schema.workflow_approvals).set({ contract_hash: 'b'.repeat(64) }).where(eq(schema.workflow_approvals.workflow_id, f.id))
  assert.equal((await (await api.GET(request(f.id, 'GET', f.owner), context(f.id))).json()).error_code, 'WORKFLOW_APPROVAL_CONTRACT_INVALID')
})

test('closed rollout and expiry preserve original review/revocation without fresh authority', async (t) => {
  const f = await fixture(), fresh = await fixture()
  assert.equal((await approve(f)).status, 201)
  const savedMode = process.env.NODE_ENV, savedFlag = process.env.CLAWDMARKET_WORKFLOW_PLANNING_ENABLED
  try {
    Object.assign(process.env, { NODE_ENV: 'production', CLAWDMARKET_WORKFLOW_PLANNING_ENABLED: 'false' })
    assert.equal((await approve(fresh)).status, 503)
    assert.equal((await api.GET(request(f.id, 'GET', f.owner), context(f.id))).status, 200)
    t.mock.timers.enable({ apis: ['Date'], now: Date.parse(f.body.expires_at) + 1000 })
    const replay = await approve(f)
    assert.equal(replay.status, 200)
    const body = await replay.json()
    assert.equal(body.approval.expired, true)
    assert.equal(body.approval.expires_at, f.body.expires_at)
    assert.equal(body.approval.spending_authority, false)
    assert.equal((await api.DELETE(request(f.id, 'DELETE', f.owner), context(f.id))).status, 200)
  } finally {
    t.mock.timers.reset()
    if (savedMode === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV'); else Object.assign(process.env, { NODE_ENV: savedMode })
    if (savedFlag === undefined) delete process.env.CLAWDMARKET_WORKFLOW_PLANNING_ENABLED; else process.env.CLAWDMARKET_WORKFLOW_PLANNING_ENABLED = savedFlag
  }
})

test('Tempo freezes explicit fee-token terms and never substitutes EVM gas terms', async () => {
  const f = await fixture()
  const { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } = await import('@/lib/constants')
  const names = ['MPP_SECRET_KEY_CURRENT', 'MPP_RECIPIENT_ADDRESS', 'TEMPO_RPC_URL'] as const
  const saved = names.map((name) => process.env[name])
  try {
    process.env.MPP_SECRET_KEY_CURRENT = 'workflow-tempo-dummy-secret-at-least-32'
    process.env.MPP_RECIPIENT_ADDRESS = treasury
    process.env.TEMPO_RPC_URL = 'https://rpc.example.invalid'
    const body = { ...f.body, payment: { rail: 'mpp', chain_id: TEMPO_CHAIN_ID, token_address: PATHUSD_ADDRESS,
      payer_address: f.body.payment.payer_address, treasury_address: treasury, minimum_token_reserve_units: '5000000',
      fee_token_address: PATHUSD_ADDRESS, minimum_fee_token_reserve_units: '1000', max_fee_token_cost_units: '1000' } }
    const response = await approve(f, body)
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
    const { approval } = await response.json()
    assert.equal(approval.contract.terms.payment.rail, 'mpp')
    assert.equal(approval.contract.token.fee_token_decimals, 6)
    assert.equal(Object.hasOwn(approval.contract.terms.payment, 'max_gas_cost_wei'), false)
    assert.equal(approval.spending_authority, false)
    const other = await fixture()
    const legacy = { ...other.body, payment: { ...other.body.payment, rail: 'mpp' } }
    assert.equal((await (await approve(other, legacy)).json()).error_code, 'INVALID_WORKFLOW_APPROVAL')
  } finally {
    names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index] })
  }
})
