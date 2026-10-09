import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { eq, and } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let jwt: typeof import('@/lib/auth').generateJWT
let budget: typeof import('@/lib/workflow-execution-budget'), approval: typeof import('@/lib/workflow-approval')
let execute: typeof import('@/app/api/routes/[id]/execute/route').POST
const treasury = privateKeyToAccount(`0x${'99'.repeat(32)}`).address.toLowerCase(), token = `0x${'44'.repeat(20)}`
const fee = '10000000000000000000000001' // Larger than SQLite's signed 64-bit range.
const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } }
before(async () => {
  directory = mkdtempSync(join(tmpdir(), 'clawdmarket-workspace-test-workflow-budget-'))
  process.env.TURSO_DATABASE_URL = `file:${join(directory, 'budget.db')}`; process.env.TURSO_AUTH_TOKEN = ''
  process.env.JWT_SECRET = 'workflow-budget-tests-only'
  process.env.TREASURY_ADDRESS = treasury; process.env.EVM_SETTLEMENT_PRIVATE_KEY = `0x${'99'.repeat(32)}`
  process.env.EVM_ACCEPTED_TOKENS = JSON.stringify([{ chainId: 8453, chainName: 'Test Base', address: token,
    symbol: 'USDC', decimals: 6, fixedUsdPrice: 1, confirmations: 3, rpcUrl: 'https://rpc.example.invalid' }])
  process.env.CLAWDMARKET_WORKFLOW_PLANNING_ENABLED = 'true'; process.env.CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED = 'true'
  process.env.CLAWDMARKET_REUSABLE_SERVICES_ENABLED = 'true'; process.env.CLAWDMARKET_ROUTE_EXECUTION_ENABLED = 'true'
  delete process.env.VERCEL; delete process.env.VERCEL_ENV
  db = (await import('@/lib/db')).db; schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  jwt = (await import('@/lib/auth')).generateJWT
  budget = await import('@/lib/workflow-execution-budget'); approval = await import('@/lib/workflow-approval')
  execute = (await import('@/app/api/routes/[id]/execute/route')).POST
})
after(() => { db?.$client.close(); if (directory) rmSync(directory, { recursive: true, force: true }) })
function request(path: string, user: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json',
    Authorization: `Bearer ${jwt({ userId: user, email: `${user}@test.invalid`, role: 'human' })}` }, body: JSON.stringify(body) })
}
const context = (id: string) => ({ params: Promise.resolve({ id }) })
async function fixture(dependent = false, linked = false, attempts = 1, payment?: unknown) {
  const id = crypto.randomUUID(), owner = `budget-owner-${id}`, buyer = linked ? `user_agent_${id}` : owner
  const outsider = `budget-outsider-${id}`, sellers = [`budget-seller-a-${id}`, `budget-seller-b-${id}`]
  await db.insert(schema.users).values([...new Set([owner, buyer, outsider, ...sellers])].map((user) => ({ id: user, name: user, email: `${user}@test.invalid`, password_hash: 'unused' })))
  if (linked) {
    await db.insert(schema.agents).values({ id, name: 'Workflow buyer', description: 'Budget fixture buyer', capabilities: '["code-review"]', endpoint: 'https://example.invalid', owner_address: '', api_key: 'unused' })
    await db.insert(schema.agent_owners).values({ agentId: id, userId: owner, establishedBy: 'test' })
  }
  const services = sellers.map(() => crypto.randomUUID())
  for (let i = 0; i < sellers.length; i++) {
    await db.insert(schema.payout_addresses).values({ user_id: sellers[i], address: treasury })
    await db.insert(schema.service_definitions).values({ id: services[i], seller_id: sellers[i], title: 'Workflow budget fixture',
      description: 'Return private structured review findings.', capabilities: '["code-review"]', price_minor: 100, status: 'active',
      estimated_latency_seconds: 30, max_concurrency: 3, output_schema: '{"type":"object","properties":{"result":{"type":"string"}}}',
      verification_policy: JSON.stringify(policy) })
  }
  const plan = (await import('@/app/api/workflows/plan/route')).POST
  const nodeBudget = 105 * attempts
  const response = await plan(request('/api/workflows/plan', buyer, { client_reference: `workflow-${id}`, objective: 'Review two bounded private code objectives',
    max_budget: { amount: (nodeBudget * 2 / 100).toFixed(2), currency: 'USD' }, deadline_seconds: 600,
    nodes: ['first', 'second'].map((key, index) => ({ key, objective: `Review private code for ${key} objective`, required_capabilities: ['code-review'],
      budget: { amount: (nodeBudget / 100).toFixed(2), currency: 'USD' }, deadline_seconds: index ? 600 : 300,
      depends_on: dependent && index ? ['first'] : [] })) }))
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()))
  const workflow = (await response.json()).workflow
  const body = { version: 1, client_reference: `approval-${id}`, plan_hash: workflow.plan_hash,
    expires_at: new Date(Math.floor(Date.now() / 1000) * 1000 + 900_000).toISOString(), max_gross_minor: nodeBudget * 2,
    max_chain_fee_units: (BigInt(fee) * BigInt(2 * attempts)).toString(), private_data: 'selected_provider_only',
    payment: { rail: 'evm', chain_id: 8453, token_address: token, payer_address: `0x${'11'.repeat(20)}`, treasury_address: treasury,
      minimum_token_reserve_units: '10000000', minimum_native_reserve_wei: '100', max_gas_cost_wei: fee },
    nodes: ['first', 'second'].map((key, index) => ({ key, static_input: { private_text: `private-${key}` },
      provider_requirements: { approved_providers: attempts > 1 ? sellers : [sellers[index]] }, verification: policy,
      max_per_attempt_minor: 105, max_retry_minor: 105 * (attempts - 1), max_attempts: attempts, max_latency_seconds: 60,
      max_chain_fee_per_attempt_units: fee, dependency_inputs: dependent && index ? [{ source_node: 'first', artifact_index: 0, target_field: 'upstream' }] : [] })) }
  const reviewed = (await approval.approveWorkflow(workflow.id, owner, { ...body, payment: payment ?? body.payment })).approval
  const activation = { version: 1, client_reference: `execution-${id}`, approval_id: reviewed.id,
    contract_hash: reviewed.contract_hash, authorize_spending: true }
  return { id, workflowId: workflow.id as string, owner, buyer, outsider, sellers, services, body, reviewed, activation }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
async function activate(f: Fixture) { return budget.activateWorkflow(f.workflowId, f.owner, f.activation) }
async function checkout(f: Fixture, key = 'first') {
  const active = await activate(f), prepared = await budget.prepareWorkflowNode(active.run.id, key, f.buyer)
  const node = prepared.node
  const response = await execute(request(`/api/routes/${node.route_id}/execute`, f.buyer, { mandate_id: node.mandate_id }), context(node.route_id!))
  return { active, node, response, data: await response.json() }
}
const rejectsCode = (action: () => Promise<unknown>, code: string) => assert.rejects(action, (error: unknown) => (error as { code?: string }).code === code)
async function reservations(runId: string) { return db.select().from(schema.workflow_reservations).where(eq(schema.workflow_reservations.run_id, runId)) }

test('review alone cannot execute; explicit activation persists one common clock and stable child references', async () => {
  const f = await fixture(true, true)
  await rejectsCode(() => budget.activateWorkflow(f.workflowId, f.buyer, f.activation), 'WORKFLOW_NOT_FOUND')
  await rejectsCode(() => budget.activateWorkflow(f.workflowId, f.owner, { ...f.activation, authorize_spending: false }), 'INVALID_WORKFLOW_EXECUTION')
  process.env.CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED = 'false'
  await rejectsCode(() => activate(f), 'WORKFLOW_EXECUTION_DISABLED')
  process.env.CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED = 'true'
  const active = await activate(f), replay = await activate(f)
  assert.equal(replay.idempotent, true); assert.equal(replay.run.id, active.run.id)
  assert.equal(replay.run.started_at.getTime(), active.run.started_at.getTime())
  assert.deepEqual(replay.nodes.map((node) => node.planned_route_id), active.nodes.map((node) => node.planned_route_id))
  await rejectsCode(() => budget.activateWorkflow(f.workflowId, f.owner, { ...f.activation, client_reference: `another-${f.id}` }), 'WORKFLOW_EXECUTION_IDEMPOTENCY_CONFLICT')
  await rejectsCode(() => budget.prepareWorkflowNode(active.run.id, 'second', f.buyer), 'WORKFLOW_DEPENDENCY_NOT_READY')
  assert.equal((await reservations(active.run.id)).length, 0)
  const prepared = await budget.prepareWorkflowNode(active.run.id, 'first', f.buyer)
  const [route] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, prepared.node.route_id!))
  assert.equal(route.execution_deadline_at?.getTime(), active.run.started_at.getTime() + 300_000)
  assert.equal(prepared.node.planned_route_id, route.id)
  assert.equal(JSON.parse(route.input_json).private_text, 'private-first')
  assert.equal((await budget.prepareWorkflowNode(active.run.id, 'first', f.buyer)).idempotent, true)
  await approval.revokeWorkflowApproval(f.workflowId, f.owner)
  assert.equal((await activate(f)).run.id, active.run.id) // Recovery does not restart a revoked run.
  assert.equal((await budget.prepareWorkflowNode(active.run.id, 'first', f.buyer)).node.route_id, route.id)
  const denied = await execute(request(`/api/routes/${route.id}/execute`, f.buyer, { mandate_id: prepared.node.mandate_id }), context(route.id))
  assert.equal((await denied.json()).error_code, 'WORKFLOW_INACTIVE')
})

test('real checkout reserves fee-inclusive parent/node cents and exact separate BigInt chain-fee ceilings once', async () => {
  const f = await fixture(), first = await checkout(f)
  assert.equal(first.response.status, 201, JSON.stringify(first.data))
  assert.equal(first.data.trade.total_cost, 1.05)
  const second = await checkout(f, 'second')
  assert.equal(second.response.status, 201, JSON.stringify(second.data))
  const replay = await checkout(f)
  assert.equal(replay.response.status, 200); assert.equal(replay.data.trade.id, first.data.trade.id)
  const ledger = await reservations(first.active.run.id)
  assert.equal(ledger.length, 2); assert.equal(ledger.reduce((sum, row) => sum + row.amount_minor, 0), 210)
  const [run] = await db.select().from(schema.workflow_runs).where(eq(schema.workflow_runs.id, first.active.run.id))
  assert.equal(run.gross_reserved_minor, 210); assert.equal(run.chain_fee_reserved_units, (BigInt(fee) * 2n).toString())
  for (const row of ledger) { assert.equal(row.amount_minor, 105); assert.equal(row.chain_fee_units, fee); assert.equal(row.attempt_number, 1) }
  await db.update(schema.trades).set({ status: 'cancelled' }).where(eq(schema.trades.id, first.data.trade.id))
  assert.equal((await reservations(run.id)).length, 2) // Cancellation never releases the gross allowance.
})

test('node checkout enforces remaining runtime and immutable absolute deadline before creating an order', async () => {
  const f = await fixture(), active = await activate(f), { node } = await budget.prepareWorkflowNode(active.run.id, 'first', f.buyer)
  const [route] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, node.route_id!))
  await db.update(schema.route_plans).set({ execution_deadline_at: new Date(route.execution_deadline_at!.getTime() + 1000) }).where(eq(schema.route_plans.id, route.id))
  const denied = await execute(request(`/api/routes/${route.id}/execute`, f.buyer, { mandate_id: node.mandate_id }), context(route.id))
  assert.equal((await denied.json()).error_code, 'WORKFLOW_CHILD_CONTRACT_CHANGED')
  assert.equal((await reservations(active.run.id)).length, 0)
})

test('parent cancellation, revocation, transferred owner and global pause block every fresh child', async () => {
  for (const action of ['cancel', 'revoke', 'transfer', 'pause']) {
    const f = await fixture(false, true), active = await activate(f), { node } = await budget.prepareWorkflowNode(active.run.id, 'first', f.buyer)
    if (action === 'cancel') await db.update(schema.workflows).set({ state: 'cancelled' }).where(eq(schema.workflows.id, f.workflowId))
    if (action === 'revoke') await approval.revokeWorkflowApproval(f.workflowId, f.owner)
    if (action === 'transfer') await db.update(schema.agent_owners).set({ userId: f.outsider }).where(eq(schema.agent_owners.agentId, f.id))
    if (action === 'pause') process.env.CLAWDMARKET_ROUTE_EXECUTION_PAUSED = 'true'
    try {
      const response = await execute(request(`/api/routes/${node.route_id}/execute`, f.buyer, { mandate_id: node.mandate_id }), context(node.route_id!))
      assert.equal((await response.json()).error_code, action === 'pause' ? 'ROUTE_EXECUTION_PAUSED' : action === 'transfer' ? 'MANDATE_OWNER_CHANGED' : 'WORKFLOW_INACTIVE')
      assert.equal((await reservations(active.run.id)).length, 0)
    } finally { delete process.env.CLAWDMARKET_ROUTE_EXECUTION_PAUSED }
  }
})

test('a corrupted exposure counter fails closed and rolls back capacity, order, policy and mandate reservation', async () => {
  const f = await fixture(), active = await activate(f), { node } = await budget.prepareWorkflowNode(active.run.id, 'first', f.buyer)
  await db.update(schema.workflow_runs).set({ gross_reserved_minor: 1 }).where(eq(schema.workflow_runs.id, active.run.id))
  const response = await execute(request(`/api/routes/${node.route_id}/execute`, f.buyer, { mandate_id: node.mandate_id }), context(node.route_id!))
  assert.equal((await response.json()).error_code, 'WORKFLOW_EXPOSURE_INVALID')
  assert.equal((await reservations(active.run.id)).length, 0)
  const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.services[0]))
  const [mandate] = await db.select().from(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.id, node.mandate_id!))
  assert.equal(service.active_orders, 0); assert.equal(mandate.reserved_minor, 0)
})

test('failure after parent reservation rolls back all financial rows and retries the original references', async () => {
  const f = await fixture(), active = await activate(f), { node } = await budget.prepareWorkflowNode(active.run.id, 'first', f.buyer)
  await db.$client.execute(`CREATE TRIGGER workflow_late_failure AFTER UPDATE OF service_order_id ON route_plans
    WHEN NEW.id = '${node.route_id}' AND NEW.service_order_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'TEST_LATE_FAILURE'); END`)
  try {
    const failed = await execute(request(`/api/routes/${node.route_id}/execute`, f.buyer, { mandate_id: node.mandate_id }), context(node.route_id!))
    assert.equal(failed.status, 500)
    assert.equal((await reservations(active.run.id)).length, 0)
    const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.services[0]))
    const [mandate] = await db.select().from(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.id, node.mandate_id!))
    const [run] = await db.select().from(schema.workflow_runs).where(eq(schema.workflow_runs.id, active.run.id))
    assert.equal(service.active_orders, 0); assert.equal(mandate.reserved_minor, 0); assert.equal(run.gross_reserved_minor, 0)
    assert.equal((await db.select().from(schema.service_orders).where(eq(schema.service_orders.buyer_id, f.buyer))).length, 0)
    assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))).length, 0)
  } finally { await db.$client.execute('DROP TRIGGER workflow_late_failure') }
  const success = await checkout(f)
  assert.equal(success.response.status, 201, JSON.stringify(success.data)); assert.equal(success.node.route_id, node.route_id)
  assert.equal((await reservations(active.run.id)).length, 1)
})

test('independent processes activate and prepare the same child without resetting its references or clock', async () => {
  const f = await fixture()
  const script = `const {activateWorkflow,prepareWorkflowNode}=require('./lib/workflow-execution-budget.ts');
    (async()=>{const a=await activateWorkflow(${JSON.stringify(f.workflowId)},${JSON.stringify(f.owner)},${JSON.stringify(f.activation)});
    const p=await prepareWorkflowNode(a.run.id,'first',${JSON.stringify(f.buyer)});
    console.log(JSON.stringify({run:a.run.id,start:a.run.started_at.getTime(),route:p.node.route_id}));})().finally(()=>require('./lib/db.ts').db.$client.close());`
  const results = await Promise.allSettled([0, 1, 2].map(() => promisify(execFile)(process.execPath,
    ['--conditions=react-server', '--import', 'tsx', '-e', script], { cwd: process.cwd(), env: { ...process.env }, timeout: 30_000 })))
  const recovered = await activate(f), prepared = await budget.prepareWorkflowNode(recovered.run.id, 'first', f.buyer)
  for (const result of results) {
    if (result.status === 'rejected') { assert.match(String(result.reason), /WORKFLOW_APPROVAL_STORAGE_BUSY/); continue }
    const data = JSON.parse(result.value.stdout.trim().split('\n').at(-1)!)
    assert.deepEqual(data, { run: recovered.run.id, start: recovered.run.started_at.getTime(), route: prepared.node.route_id })
  }
  assert.equal((await db.select().from(schema.workflow_runs).where(eq(schema.workflow_runs.workflow_id, f.workflowId))).length, 1)
  assert.equal((await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, prepared.node.route_id!))).length, 1)
})

test('independent process child checkouts atomically retain the full parent gross and chain-fee envelope', async () => {
  const f = await fixture(), active = await activate(f)
  const nodes = await Promise.all(['first', 'second'].map((key) => budget.prepareWorkflowNode(active.run.id, key, f.buyer)))
  for (const { node } of nodes) await db.update(schema.route_plans).set({ state: 'reserving' }).where(eq(schema.route_plans.id, node.route_id!))
  const results = await Promise.allSettled(nodes.map(({ node }) => {
    const script = `const {reserveServiceOrder}=require('./lib/service-order-reservation.ts');const {db}=require('./lib/db.ts');const s=require('./lib/schema.ts');const {eq}=require('drizzle-orm');
      (async()=>{const [p]=await db.select().from(s.route_plans).where(eq(s.route_plans.id,${JSON.stringify(node.route_id)}));
      const candidates=JSON.parse(p.candidates_json);const r=await reserveServiceOrder({serviceId:candidates[0].service_id,routeId:p.id,mandateId:${JSON.stringify(node.mandate_id)},
      principal:{userId:p.buyer_id,agentId:null,kind:'account',usesCookieAuth:false},externalOnly:true,
      request:{client_reference:'checkout:'+p.id,objective:p.objective,input:JSON.parse(p.input_json),provider_requirements:JSON.parse(p.provider_requirements_json),payment_rail:'evm',max_total:105}});
      console.log(JSON.stringify({trade:r.trade.id}));})().finally(()=>db.$client.close());`
    return promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', '-e', script],
      { cwd: process.cwd(), env: { ...process.env }, timeout: 30_000 })
  }))
  for (const result of results) { if (result.status === 'rejected') throw result.reason; assert.ok(JSON.parse(result.value.stdout.trim().split('\n').at(-1)!).trade) }
  const ledger = await reservations(active.run.id)
  assert.equal(ledger.length, 2); assert.equal(new Set(ledger.map((item) => item.trade_id)).size, 2)
  const [run] = await db.select().from(schema.workflow_runs).where(eq(schema.workflow_runs.id, active.run.id))
  assert.equal(run.gross_reserved_minor, f.body.max_gross_minor)
  assert.equal(run.chain_fee_reserved_units, f.body.max_chain_fee_units)
  for (const serviceId of f.services) {
    const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, serviceId))
    assert.equal(service.active_orders, 1)
  }
})

test('funding eligibility requires its original parent reservation and preserves late-payment recovery', async () => {
  const f = await fixture(), purchased = await checkout(f)
  assert.equal(purchased.response.status, 201, JSON.stringify(purchased.data))
  const mandates = await import('@/lib/route-payment-mandate')
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, purchased.data.trade.id))
  assert.equal(await mandates.mandateFundingEligibility(trade), null)
  await db.update(schema.workflow_reservations).set({ amount_minor: 104 }).where(and(eq(schema.workflow_reservations.run_id, purchased.active.run.id), eq(schema.workflow_reservations.trade_id, trade.id)))
  assert.equal(await mandates.mandateFundingEligibility(trade), 'WORKFLOW_EXPOSURE_INVALID')
  await db.update(schema.workflow_reservations).set({ amount_minor: 105 }).where(eq(schema.workflow_reservations.trade_id, trade.id))
  await approval.revokeWorkflowApproval(f.workflowId, f.owner)
  assert.equal(await mandates.mandateFundingEligibility(trade), 'WORKFLOW_INACTIVE')
  const replay = await checkout(f)
  assert.equal(replay.response.status, 200); assert.equal(replay.data.trade.id, trade.id)
  assert.equal((await reservations(purchased.active.run.id)).length, 1)
})

test('a fresh funding claim cannot reset the shared clock or broadcast when provider runtime no longer fits', async (t) => {
  const f = await fixture(), purchased = await checkout(f)
  assert.equal(purchased.response.status, 201)
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, purchased.data.trade.id))
  t.mock.timers.enable({ apis: ['Date'], now: purchased.active.run.started_at.getTime() + 290_000 })
  try {
    assert.equal(await (await import('@/lib/route-payment-mandate')).mandateFundingEligibility(trade), 'WORKFLOW_NODE_RUNTIME_EXCEEDED')
    const recovered = await activate(f)
    assert.equal(recovered.run.started_at.getTime(), purchased.active.run.started_at.getTime())
    assert.equal(recovered.run.deadline_at.getTime(), purchased.active.run.deadline_at.getTime())
  } finally { t.mock.timers.reset() }
})

test('changed immutable inputs, provider approvals and child terms cannot gain fresh workflow authority', async () => {
  for (const change of ['input', 'provider', 'terms']) {
    const f = await fixture(), active = await activate(f), { node } = await budget.prepareWorkflowNode(active.run.id, 'first', f.buyer)
    if (change === 'input') await db.update(schema.route_plans).set({ input_json: '{"private_text":"replacement"}' }).where(eq(schema.route_plans.id, node.route_id!))
    if (change === 'provider') await db.update(schema.route_plans).set({ provider_requirements_json: JSON.stringify({ approved_providers: [f.outsider] }) }).where(eq(schema.route_plans.id, node.route_id!))
    if (change === 'terms') {
      const [row] = await db.select().from(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.id, node.mandate_id!))
      await db.update(schema.route_payment_mandates).set({ terms_json: JSON.stringify({ ...JSON.parse(row.terms_json), max_latency_seconds: 120 }) }).where(eq(schema.route_payment_mandates.id, row.id))
    }
    const response = await execute(request(`/api/routes/${node.route_id}/execute`, f.buyer, { mandate_id: node.mandate_id }), context(node.route_id!))
    assert.equal((await response.json()).error_code, change === 'terms' ? 'WORKFLOW_CHILD_CONTRACT_CHANGED' : 'MANDATE_ROUTE_CHANGED')
    assert.equal((await reservations(active.run.id)).length, 0)
  }
})

test('missing inherited mandate fails closed instead of becoming a manual checkout', async () => {
  const f = await fixture(), active = await activate(f), { node } = await budget.prepareWorkflowNode(active.run.id, 'first', f.buyer)
  // Corrupted legacy/manual state must not silently drop the parent boundary.
  await db.update(schema.workflow_node_runs).set({ mandate_id: null }).where(eq(schema.workflow_node_runs.id, node.id))
  await db.delete(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.id, node.mandate_id!))
  const response = await execute(request(`/api/routes/${node.route_id}/execute`, f.buyer, {}), context(node.route_id!))
  assert.equal((await response.json()).error_code, 'WORKFLOW_MANDATE_REQUIRED')
  assert.equal((await reservations(active.run.id)).length, 0)
  const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.services[0]))
  assert.equal(service.active_orders, 0)
})

test('production workflow activation stays closed even with an execution flag and dummy payment configuration', async () => {
  const f = await fixture()
  process.env.VERCEL_ENV = 'production'
  try { await rejectsCode(() => activate(f), 'WORKFLOW_EXECUTION_DISABLED') }
  finally { delete process.env.VERCEL_ENV }
})

test('only an exact confirmed original refund permits retry; gross buyer and chain-fee budgets never recycle', async () => {
  const f = await fixture(false, false, 2), original = await checkout(f)
  assert.equal(original.response.status, 201, JSON.stringify(original.data))
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, original.data.trade.id))
  // Trusted proof boundary fixture: records no RPC transfer or live wallet spend.
  const { recordExternalTradeFunding } = await import('@/lib/trade-funding')
  const fundingHash = `0x${f.id.replaceAll('-', '').repeat(2)}`
  await recordExternalTradeFunding({ trade, rail: 'evm', txHash: fundingHash, externalId: fundingHash,
    payerAddress: f.body.payment.payer_address, tokenAddress: token, chainId: 8453, tokenSymbol: 'USDC', tokenDecimals: 6,
    tokenAmount: 1050000n, tokenUsdPrice: 1, usdValue: 1.05 })
  const retry = (await import('@/app/api/routes/[id]/retry/route')).POST
  const command = { version: 1, mandate_id: original.node.mandate_id, previous_trade_id: trade.id, retry_operation_id: crypto.randomUUID() }
  const runRetry = (body = command) => retry(request(`/api/routes/${original.node.route_id}/retry`, f.buyer, body), context(original.node.route_id!))
  assert.equal((await (await runRetry()).json()).error_code, 'ROUTE_RETRY_RECONCILIATION_REQUIRED')
  const [order] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.trade_id, trade.id))
  await db.transaction(async (tx) => {
    await tx.update(schema.trades).set({ status: 'cancelled', payout_status: 'refunded' }).where(eq(schema.trades.id, trade.id))
    await tx.update(schema.service_orders).set({ state: 'cancelled', capacity_released_at: new Date() }).where(eq(schema.service_orders.id, order.id))
    await tx.update(schema.service_definitions).set({ active_orders: 0 }).where(eq(schema.service_definitions.id, order.service_id))
    await tx.update(schema.route_plans).set({ state: 'cancelled' }).where(eq(schema.route_plans.id, original.node.route_id!))
  })
  const [refund] = await db.insert(schema.settlement_transfers).values({ business_key: `${trade.id}:buyer_refund`, trade_id: trade.id,
    kind: 'buyer_refund', chain_id: 8453, token_address: token, from_address: treasury, to_address: f.body.payment.payer_address,
    token_amount: '1050000', usd_amount: 1.05, status: 'pending' }).returning()
  assert.equal((await (await runRetry()).json()).error_code, 'ROUTE_RETRY_REFUND_EVIDENCE_MISSING')
  await db.update(schema.settlement_transfers).set({ status: 'confirmed', tx_hash: `0x${'aa'.repeat(32)}`, confirmed_at: new Date(), token_amount: '1049999' }).where(eq(schema.settlement_transfers.id, refund.id))
  assert.equal((await (await runRetry()).json()).error_code, 'ROUTE_RETRY_REFUND_EVIDENCE_MISSING')
  await db.update(schema.settlement_transfers).set({ token_amount: '1050000' }).where(eq(schema.settlement_transfers.id, refund.id))
  const retried = await runRetry(), data = await retried.json()
  assert.equal(retried.status, 201, JSON.stringify(data)); assert.notEqual(data.trade.id, trade.id)
  assert.notEqual(data.trade.seller_id, trade.seller_id)
  const replay = await runRetry()
  assert.equal(replay.status, 200); assert.equal((await replay.json()).trade.id, data.trade.id)
  const entries = await reservations(original.active.run.id)
  assert.deepEqual(entries.map((entry) => entry.attempt_number).sort(), [1, 2])
  assert.equal(entries.reduce((sum, entry) => sum + entry.amount_minor, 0), 210)
  const [run] = await db.select().from(schema.workflow_runs).where(eq(schema.workflow_runs.id, original.active.run.id))
  assert.equal(run.gross_reserved_minor, 210); assert.equal(run.chain_fee_reserved_units, (BigInt(fee) * 2n).toString())
  const [node] = await db.select().from(schema.workflow_node_runs).where(eq(schema.workflow_node_runs.id, original.node.id))
  assert.equal(node.gross_reserved_minor, 210); assert.equal(node.attempt_count, 2)
  const exhausted = await runRetry({ ...command, previous_trade_id: data.trade.id, retry_operation_id: crypto.randomUUID() })
  assert.equal((await exhausted.json()).error_code, 'MANDATE_ATTEMPTS_EXHAUSTED')
  const [route] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, node.route_id!))
  assert.equal(route.execution_deadline_at?.getTime(), node.deadline_at.getTime())
})

test('Tempo children inherit explicit fee-token units and reserve gross exposure without EVM gas substitution', async () => {
  const { PATHUSD_ADDRESS, TEMPO_CHAIN_ID } = await import('@/lib/constants')
  const names = ['MPP_SECRET_KEY_CURRENT', 'MPP_RECIPIENT_ADDRESS', 'TEMPO_RPC_URL'] as const
  const saved = names.map((name) => process.env[name])
  try {
    process.env.MPP_SECRET_KEY_CURRENT = 'workflow-tempo-budget-tests-dummy-secret'
    process.env.MPP_RECIPIENT_ADDRESS = treasury; process.env.TEMPO_RPC_URL = 'https://rpc.example.invalid'
    const f = await fixture(false, false, 1, { rail: 'mpp', chain_id: TEMPO_CHAIN_ID, token_address: PATHUSD_ADDRESS,
      payer_address: `0x${'11'.repeat(20)}`, treasury_address: treasury, minimum_token_reserve_units: '10000000',
      fee_token_address: PATHUSD_ADDRESS, minimum_fee_token_reserve_units: '1000', max_fee_token_cost_units: fee })
    const purchased = await checkout(f)
    assert.equal(purchased.response.status, 201, JSON.stringify(purchased.data)); assert.equal(purchased.data.trade.payment_rail, 'mpp')
    const [row] = await db.select().from(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.id, purchased.node.mandate_id!))
    const terms = JSON.parse(row.terms_json)
    assert.equal(terms.payment.rail, 'mpp'); assert.equal(terms.payment.fee_token_address, PATHUSD_ADDRESS)
    assert.equal(terms.payment.max_fee_token_cost_units, fee); assert.equal(terms.fee_token_decimals, 6)
    assert.equal(Object.hasOwn(terms.payment, 'max_gas_cost_wei'), false)
    const [entry] = await reservations(purchased.active.run.id)
    assert.equal(entry.amount_minor, 105); assert.equal(entry.chain_fee_units, fee)
  } finally {
    names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index] })
  }
})
