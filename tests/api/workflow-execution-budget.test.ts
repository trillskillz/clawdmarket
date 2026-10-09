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
  process.env.CHAT_ENCRYPTION_KEY = 'workflow-dependency-local-fixture-key'
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

test('independent retry and root checkouts retain original refunds, gross exposure and BigInt fee ceilings', async () => {
  const f = await fixture(false, false, 2), original = await checkout(f)
  assert.equal(original.response.status, 201, JSON.stringify(original.data))
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, original.data.trade.id))
  // Trusted proof boundary only; actual payment/refund evidence is covered by the disposable EVM HTTP loop.
  const { recordExternalTradeFunding } = await import('@/lib/trade-funding')
  const { advanceServiceOrder } = await import('@/lib/service-order-state')
  const fundingHash = `0x${f.id.replaceAll('-', '').repeat(2)}`
  await recordExternalTradeFunding({ trade, rail: 'evm', txHash: fundingHash, externalId: fundingHash,
    payerAddress: f.body.payment.payer_address, tokenAddress: token, chainId: 8453, tokenSymbol: 'USDC', tokenDecimals: 6,
    tokenAmount: 1050000n, tokenUsdPrice: 1, usdValue: 1.05 })
  await db.transaction(async (tx) => {
    await tx.update(schema.trades).set({ status: 'cancelled', payout_status: 'refunded' }).where(eq(schema.trades.id, trade.id))
    await advanceServiceOrder(tx, trade.id, 'cancelled')
    await advanceServiceOrder(tx, trade.id, 'cancelled') // Repeated recovery releases capacity once.
    await tx.insert(schema.settlement_transfers).values({ business_key: `${trade.id}:buyer_refund`, trade_id: trade.id,
      kind: 'buyer_refund', chain_id: 8453, token_address: token, from_address: treasury, to_address: f.body.payment.payer_address,
      token_amount: '1050000', usd_amount: 1.05, status: 'confirmed', tx_hash: `0x${'aa'.repeat(32)}`, confirmed_at: new Date() })
  })
  const { node: second } = await budget.prepareWorkflowNode(original.active.run.id, 'second', f.buyer)
  await db.update(schema.route_plans).set({ state: 'reserving' }).where(eq(schema.route_plans.id, second.route_id!))
  const command = { version: 1 as const, mandate_id: original.node.mandate_id!, previous_trade_id: trade.id, retry_operation_id: crypto.randomUUID() }
  const principal = { userId: f.buyer, agentId: null, kind: 'account' as const, usesCookieAuth: false }
  const retryScript = `const {reserveFundedRouteRetry}=require('./lib/route-funded-retry.ts');const {db}=require('./lib/db.ts');
    (async()=>{try{const r=await reserveFundedRouteRetry(${JSON.stringify(original.node.route_id)},${JSON.stringify(principal)},${JSON.stringify(command)});
      console.log(JSON.stringify({trade:r.trade.id}));}catch(e){console.log(JSON.stringify({error:e.code}));if(!e.code)throw e;}})().finally(()=>db.$client.close());`
  const rootScript = `const {reserveServiceOrder}=require('./lib/service-order-reservation.ts');const {db}=require('./lib/db.ts');const s=require('./lib/schema.ts');const {eq}=require('drizzle-orm');
    (async()=>{const [p]=await db.select().from(s.route_plans).where(eq(s.route_plans.id,${JSON.stringify(second.route_id)}));
      const r=await reserveServiceOrder({serviceId:JSON.parse(p.candidates_json)[0].service_id,routeId:p.id,mandateId:${JSON.stringify(second.mandate_id)},
      principal:${JSON.stringify(principal)},externalOnly:true,request:{client_reference:'checkout:'+p.id,objective:p.objective,input:JSON.parse(p.input_json),
      provider_requirements:JSON.parse(p.provider_requirements_json),payment_rail:'evm',max_total:105}});console.log(JSON.stringify({trade:r.trade.id}));})().finally(()=>db.$client.close());`
  const results = await Promise.allSettled([retryScript, retryScript, rootScript].map((script) => promisify(execFile)(process.execPath,
    ['--conditions=react-server', '--import', 'tsx', '-e', script], { cwd: process.cwd(), env: { ...process.env }, timeout: 30_000 })))
  const { reserveFundedRouteRetry } = await import('@/lib/route-funded-retry')
  const recovered = await reserveFundedRouteRetry(original.node.route_id!, principal, command)
  for (let index = 0; index < results.length; index++) {
    const result = results[index]
    if (result.status === 'rejected') throw result.reason
    const data = JSON.parse(result.value.stdout.trim().split('\n').at(-1)!)
    if (index === 2) assert.ok(data.trade)
    else if (data.error) assert.ok(['MANDATE_ATTEMPTS_EXHAUSTED', 'ROUTE_RETRY_PREVIOUS_TRADE_CHANGED', 'ROUTE_RETRY_ATTEMPTS_EXHAUSTED'].includes(data.error), data.error)
    else assert.equal(data.trade, recovered.trade.id)
  }
  const entries = await reservations(original.active.run.id)
  assert.equal(entries.length, 3); assert.equal(new Set(entries.map((entry) => entry.trade_id)).size, 3)
  assert.deepEqual(entries.filter((entry) => entry.node_run_id === original.node.id).map((entry) => entry.attempt_number).sort(), [1, 2])
  assert.equal(entries.filter((entry) => entry.node_run_id === second.id).length, 1)
  const [run] = await db.select().from(schema.workflow_runs).where(eq(schema.workflow_runs.id, original.active.run.id))
  assert.equal(run.gross_reserved_minor, 315); assert.equal(run.chain_fee_reserved_units, (BigInt(fee) * 3n).toString())
  assert.equal((await db.select().from(schema.route_retry_funding_steps).where(eq(schema.route_retry_funding_steps.route_id, original.node.route_id!))).length, 1)
  const nodes = await db.select().from(schema.workflow_node_runs).where(eq(schema.workflow_node_runs.run_id, run.id))
  for (const node of nodes) {
    assert.equal(node.gross_reserved_minor, node.node_key === 'first' ? 210 : 105)
    assert.equal(node.chain_fee_reserved_units, (BigInt(fee) * BigInt(node.attempt_count)).toString())
    const [route] = await db.select().from(schema.route_plans).where(eq(schema.route_plans.id, node.route_id!))
    assert.equal(route.execution_deadline_at?.getTime(), node.deadline_at.getTime())
  }
  const services = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.seller_id, f.sellers[0]))
  const [fallback] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.services[1]))
  assert.equal(services[0].active_orders + fallback.active_orders, 2)
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

async function completedPrerequisite(accepted = true, backed = true) {
  const f = await fixture(true), purchased = await checkout(f)
  assert.equal(purchased.response.status, 201, JSON.stringify(purchased.data))
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, purchased.data.trade.id))
  const fundingHash = `0x${f.id.replaceAll('-', '').repeat(2)}`
  await (await import('@/lib/trade-funding')).recordExternalTradeFunding({ trade, rail: 'evm', txHash: fundingHash, externalId: fundingHash,
    payerAddress: f.body.payment.payer_address, tokenAddress: token, chainId: 8453, tokenSymbol: 'USDC', tokenDecimals: 6,
    tokenAmount: 1050000n, tokenUsdPrice: 1, usdValue: 1.05 })
  const { uploadPrivateArtifact } = await import('@/lib/private-artifacts'), { createHash } = await import('node:crypto')
  const artifacts = []
  for (const key of ['alpha', 'beta']) {
    const bytes = Buffer.from(JSON.stringify({ result: `private-${key}-${f.id}` }))
    const { artifact } = await uploadPrivateArtifact(trade.id, trade.seller_id, { client_reference: `dependency-${key}-${f.id}`,
      name: `${key}.json`, media_type: 'application/json', content_base64: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') })
    artifacts.push(artifact)
  }
  // The reviewed index follows accepted attachment order, explicitly opposite lexical ID order.
  artifacts.sort((a, b) => b.id.localeCompare(a.id))
  const { delivery } = await (await import('@/lib/trade-delivery')).submitTradeDelivery(trade.id, trade.seller_id,
    { summary: 'Private reviewed upstream findings for the bounded workflow.', artifact_ids: artifacts.map((item) => item.id), verification_artifact_id: artifacts[0].id })
  await db.transaction(async (tx) => {
    if (accepted) await (await import('@/lib/verification-evidence')).advanceBuyerReview(tx, trade.id, 'passed', delivery.content_hash)
    await tx.update(schema.trades).set({ status: 'completed', payout_status: 'complete', completed_at: new Date() }).where(eq(schema.trades.id, trade.id))
    await (await import('@/lib/service-order-state')).advanceServiceOrder(tx, trade.id, 'completed')
    if (backed) await tx.insert(schema.settlement_transfers).values({ business_key: `${trade.id}:seller_payout`, trade_id: trade.id,
      kind: 'seller_payout', chain_id: 8453, token_address: token, from_address: treasury, to_address: treasury,
      token_amount: '1000000', usd_amount: 1, status: 'confirmed', tx_hash: `0x${'bb'.repeat(32)}`, confirmed_at: new Date() })
  })
  return { f, purchased, trade, artifacts, delivery }
}
async function dependencies(f: Fixture, runId: string, user = f.buyer) {
  return (await import('@/lib/workflow-dependency-evidence')).inspectWorkflowDependencies(runId, 'second', user)
}

test('dependency evidence binds the exact accepted artifact order and current backing without granting bytes or executing a child', async () => {
  const { f, purchased, artifacts, delivery } = await completedPrerequisite()
  const evidence = await dependencies(f, purchased.active.run.id), replay = await dependencies(f, purchased.active.run.id, f.owner)
  assert.equal(evidence.bindings.length, 1); assert.equal(evidence.bindings[0].artifact.id, artifacts[0].id)
  assert.equal(evidence.bindings[0].artifact.sha256, artifacts[0].sha256)
  assert.equal(evidence.bindings[0].delivery_hash, delivery.content_hash)
  assert.equal(evidence.dependency_hash, replay.dependency_hash)
  assert.equal(evidence.execution_available, false); assert.equal(evidence.artifact_access_granted, false)
  assert.equal(JSON.stringify(evidence).includes('content_base64'), false)
  assert.equal((await reservations(purchased.active.run.id)).length, 1)
  const prepared = await budget.prepareWorkflowNode(purchased.active.run.id, 'second', f.buyer)
  assert.ok(prepared.node.route_id)
  assert.equal((await db.select().from(schema.workflow_artifact_grants).where(eq(schema.workflow_artifact_grants.node_run_id, prepared.node.id))).length, 0)
  process.env.CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED = 'false'
  try { assert.equal((await dependencies(f, purchased.active.run.id)).dependency_hash, evidence.dependency_hash) }
  finally { process.env.CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED = 'true' }
})

test('missing settlement, unaccepted delivery and completion flags without proof cannot authorize dependency inputs', async () => {
  const pending = await fixture(true), active = await activate(pending)
  await rejectsCode(() => dependencies(pending, active.run.id), 'WORKFLOW_DEPENDENCY_NOT_READY')
  const checkout = await budget.prepareWorkflowNode(active.run.id, 'first', pending.buyer)
  assert.ok(checkout.node.route_id)
  await rejectsCode(() => dependencies(pending, active.run.id), 'WORKFLOW_DEPENDENCY_NOT_SETTLED')
  const unbacked = await completedPrerequisite(true, false)
  await rejectsCode(() => dependencies(unbacked.f, unbacked.purchased.active.run.id), 'WORKFLOW_DEPENDENCY_BACKING_MISSING')
  const unaccepted = await completedPrerequisite(false, true)
  await rejectsCode(() => dependencies(unaccepted.f, unaccepted.purchased.active.run.id), 'WORKFLOW_DEPENDENCY_NOT_ACCEPTED')
})

test('a historical backed receipt cannot substitute for withdrawn current payout or funding evidence', async () => {
  const { f, purchased, trade } = await completedPrerequisite()
  const saved = await (await import('@/lib/route-lifecycle')).persistBackedRouteReceipt(purchased.node.route_id!, f.buyer)
  assert.ok(saved)
  await db.update(schema.settlement_transfers).set({ status: 'submitted' }).where(and(eq(schema.settlement_transfers.trade_id, trade.id), eq(schema.settlement_transfers.kind, 'seller_payout')))
  await rejectsCode(() => dependencies(f, purchased.active.run.id), 'WORKFLOW_DEPENDENCY_BACKING_MISSING')
  await db.update(schema.settlement_transfers).set({ status: 'confirmed' }).where(eq(schema.settlement_transfers.trade_id, trade.id))
  await db.update(schema.payment_receipts).set({ token_amount: '1049999' }).where(eq(schema.payment_receipts.trade_id, trade.id))
  await rejectsCode(() => dependencies(f, purchased.active.run.id), 'WORKFLOW_DEPENDENCY_BACKING_MISSING')
  assert.equal((await db.select().from(schema.route_receipts).where(eq(schema.route_receipts.route_id, purchased.node.route_id!))).length, 1)
})

test('purged bytes, ciphertext swaps and changed accepted artifact metadata fail dependency integrity', async () => {
  for (const change of ['purged', 'swap', 'metadata']) {
    const { f, purchased, artifacts } = await completedPrerequisite()
    if (change === 'purged') await db.update(schema.private_artifacts).set({ purged_at: new Date() }).where(eq(schema.private_artifacts.id, artifacts[0].id))
    if (change === 'metadata') await db.update(schema.private_artifacts).set({ sha256: 'a'.repeat(64) }).where(eq(schema.private_artifacts.id, artifacts[0].id))
    if (change === 'swap') {
      const [payload] = await db.select().from(schema.private_artifact_payloads).where(eq(schema.private_artifact_payloads.artifact_id, artifacts[1].id))
      await db.update(schema.private_artifact_payloads).set({ ciphertext: payload.ciphertext, nonce: payload.nonce }).where(eq(schema.private_artifact_payloads.artifact_id, artifacts[0].id))
    }
    await rejectsCode(() => dependencies(f, purchased.active.run.id), change === 'purged' ? 'ARTIFACT_EXPIRED' : change === 'swap' ? 'ARTIFACT_INTEGRITY_FAILED' : 'WORKFLOW_DEPENDENCY_ARTIFACT_CHANGED')
  }
})

test('dependency inspection is buyer/current-owner private and never expands original artifact authorization', async () => {
  const { f, purchased, trade, artifacts } = await completedPrerequisite()
  await rejectsCode(() => dependencies(f, purchased.active.run.id, f.outsider), 'WORKFLOW_NOT_FOUND')
  await rejectsCode(() => dependencies(f, purchased.active.run.id, trade.seller_id), 'WORKFLOW_NOT_FOUND')
  await rejectsCode(() => (import('@/lib/private-artifacts').then((api) => api.downloadPrivateArtifact(trade.id, artifacts[0].id, f.sellers[1]))), 'TRADE_NOT_FOUND')
  const data = await dependencies(f, purchased.active.run.id)
  assert.equal(data.artifact_access_granted, false)
})

async function dependentCheckout() {
  const source = await completedPrerequisite(), purchased = await checkout(source.f, 'second')
  assert.equal(purchased.response.status, 201, JSON.stringify(purchased.data))
  const grants = await db.select().from(schema.workflow_artifact_grants).where(eq(schema.workflow_artifact_grants.order_id, purchased.data.order.id))
  assert.equal(grants.length, 1)
  return { ...source, dependent: purchased, grant: grants[0] }
}
async function fundDependent(f: Awaited<ReturnType<typeof dependentCheckout>>) {
  const [trade] = await db.select().from(schema.trades).where(eq(schema.trades.id, f.dependent.data.trade.id))
  const hash = `0x${f.f.id.replaceAll('-', '')}${'dd'.repeat(16)}`
  await (await import('@/lib/trade-funding')).recordExternalTradeFunding({ trade, rail: 'evm', txHash: hash, externalId: hash,
    payerAddress: f.f.body.payment.payer_address, tokenAddress: token, chainId: 8453, tokenSymbol: 'USDC', tokenDecimals: 6,
    tokenAmount: 1050000n, tokenUsdPrice: 1, usdValue: 1.05 })
}
async function getGrant(f: Awaited<ReturnType<typeof dependentCheckout>>, user: string | null = f.grant.recipient_id, workflowId = f.f.workflowId) {
  const api = (await import('@/app/api/workflows/[id]/artifacts/[grantId]/route')).GET
  const request = new NextRequest(`http://localhost/api/workflows/${workflowId}/artifacts/${f.grant.id}`, {
    headers: user ? { Authorization: `Bearer ${jwt({ userId: user, email: `${user}@test.invalid`, role: 'human' })}` } : {},
  })
  return api(request, { params: Promise.resolve({ id: workflowId, grantId: f.grant.id }) })
}

test('an exact dependent order grants only the funded selected provider its approved private artifact', async () => {
  const f = await dependentCheckout()
  assert.equal(f.grant.recipient_id, f.dependent.data.trade.seller_id)
  assert.equal(f.grant.recipient_id, f.f.sellers[1])
  const pending = await getGrant(f)
  assert.equal(pending.status, 409); assert.equal((await pending.json()).error_code, 'WORKFLOW_ARTIFACT_ORDER_NOT_FUNDED')
  assert.equal((await getGrant(f, null)).status, 401)
  for (const user of [f.f.outsider, f.f.sellers[0], f.f.buyer]) assert.equal((await getGrant(f, user)).status, 404)
  await fundDependent(f)
  const result = await getGrant(f)
  assert.equal(result.status, 200, await result.clone().text())
  assert.equal(result.headers.get('cache-control'), 'private, no-store')
  assert.equal(result.headers.get('x-artifact-sha256'), f.artifacts[0].sha256)
  assert.ok(result.headers.get('content-security-policy')?.includes('sandbox'))
  const original = await (await import('@/lib/private-artifacts')).downloadPrivateArtifact(f.trade.id, f.artifacts[0].id, f.f.buyer)
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), original.bytes)
  assert.equal((await getGrant(f, f.grant.recipient_id, crypto.randomUUID())).status, 404)
  await rejectsCode(() => import('@/lib/private-artifacts').then((api) => api.downloadPrivateArtifact(f.trade.id, f.artifacts[0].id, f.grant.recipient_id)), 'TRADE_NOT_FOUND')
  const work = (await import('@/app/api/trades/[id]/work-order/route')).GET
  const response = await work(new NextRequest(`http://localhost/api/trades/${f.dependent.data.trade.id}/work-order`, { headers: {
    Authorization: `Bearer ${jwt({ userId: f.grant.recipient_id, email: `${f.grant.recipient_id}@test.invalid`, role: 'human' })}` } }), context(f.dependent.data.trade.id))
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.work_order.dependency_artifacts.length, 1)
  assert.equal(data.work_order.dependency_artifacts[0].download_path, `/api/workflows/${f.f.workflowId}/artifacts/${f.grant.id}`)
  assert.equal(data.work_order.input.upstream.binding_id, f.grant.binding_id)
  assert.equal(data.work_order.input.upstream.sha256, f.artifacts[0].sha256)
})

test('changed prerequisite basis blocks a fresh dependent checkout and preserves its original frozen binding', async () => {
  const { f, purchased, trade } = await completedPrerequisite()
  const { node } = await budget.prepareWorkflowNode(purchased.active.run.id, 'second', f.buyer)
  const [binding] = await db.select().from(schema.workflow_dependency_bindings).where(eq(schema.workflow_dependency_bindings.node_run_id, node.id))
  await db.update(schema.settlement_transfers).set({ tx_hash: `0x${'cc'.repeat(32)}` }).where(eq(schema.settlement_transfers.trade_id, trade.id))
  const result = await execute(request(`/api/routes/${node.route_id}/execute`, f.buyer, { mandate_id: node.mandate_id }), context(node.route_id!))
  assert.equal((await result.json()).error_code, 'WORKFLOW_DEPENDENCY_CHANGED')
  const [retained] = await db.select().from(schema.workflow_dependency_bindings).where(eq(schema.workflow_dependency_bindings.id, binding.id))
  assert.equal(retained.binding_hash, binding.binding_hash)
  assert.equal((await reservations(purchased.active.run.id)).length, 1)
  assert.equal((await db.select().from(schema.workflow_artifact_grants).where(eq(schema.workflow_artifact_grants.node_run_id, node.id))).length, 0)
})

test('artifact grant failure atomically rolls back dependent capacity, money and order reservations', async () => {
  const { f, purchased } = await completedPrerequisite()
  const { node } = await budget.prepareWorkflowNode(purchased.active.run.id, 'second', f.buyer)
  await db.$client.execute(`CREATE TRIGGER workflow_grant_failure BEFORE INSERT ON workflow_artifact_grants
    WHEN NEW.node_run_id = '${node.id}' BEGIN SELECT RAISE(ABORT, 'TEST_GRANT_FAILURE'); END`)
  try {
    const response = await execute(request(`/api/routes/${node.route_id}/execute`, f.buyer, { mandate_id: node.mandate_id }), context(node.route_id!))
    assert.equal(response.status, 500)
    assert.equal((await reservations(purchased.active.run.id)).length, 1)
    const [run] = await db.select().from(schema.workflow_runs).where(eq(schema.workflow_runs.id, purchased.active.run.id))
    const [mandate] = await db.select().from(schema.route_payment_mandates).where(eq(schema.route_payment_mandates.id, node.mandate_id!))
    const [service] = await db.select().from(schema.service_definitions).where(eq(schema.service_definitions.id, f.services[1]))
    assert.equal(run.gross_reserved_minor, 105); assert.equal(mandate.reserved_minor, 0); assert.equal(service.active_orders, 0)
  } finally { await db.$client.execute('DROP TRIGGER workflow_grant_failure') }
  const resumed = await checkout(f, 'second')
  assert.equal(resumed.response.status, 201, JSON.stringify(resumed.data))
  assert.equal(resumed.node.route_id, node.route_id)
  assert.equal((await db.select().from(schema.workflow_artifact_grants).where(eq(schema.workflow_artifact_grants.node_run_id, node.id))).length, 1)
})

test('funded grants deny revoked parent/child authority, withdrawn backing and revoked recipient access', async () => {
  for (const action of ['parent', 'child', 'grant', 'backing']) {
    const f = await dependentCheckout(); await fundDependent(f)
    if (action === 'parent') await approval.revokeWorkflowApproval(f.f.workflowId, f.f.owner)
    if (action === 'child') await (await import('@/lib/route-payment-mandate')).revokeRouteMandate(f.dependent.node.route_id!, f.f.owner)
    if (action === 'grant') await db.update(schema.workflow_artifact_grants).set({ revoked_at: new Date() }).where(eq(schema.workflow_artifact_grants.id, f.grant.id))
    if (action === 'backing') await db.update(schema.settlement_transfers).set({ status: 'submitted' }).where(eq(schema.settlement_transfers.trade_id, f.trade.id))
    const response = await getGrant(f)
    assert.equal((await response.json()).error_code, action === 'parent' ? 'WORKFLOW_INACTIVE' : action === 'child' ? 'MANDATE_INACTIVE'
      : action === 'grant' ? 'WORKFLOW_ARTIFACT_GRANT_REVOKED' : 'WORKFLOW_DEPENDENCY_BACKING_MISSING')
    const recovered = await checkout(f.f, 'second')
    assert.equal(recovered.response.status, 200); assert.equal(recovered.data.trade.id, f.dependent.data.trade.id)
    const original = await (await import('@/lib/private-artifacts')).downloadPrivateArtifact(f.trade.id, f.artifacts[0].id, f.f.buyer)
    assert.ok(original.bytes.length) // Original private result and economic recovery remain available.
  }
})

test('whole workflow reconciliation cannot report a partial graph as completed and persists one exact aggregate receipt', async () => {
  const f = await dependentCheckout(), { inspectWorkflowRun, reconcileWorkflow } = await import('@/lib/workflow-reconciliation')
  const partial = await reconcileWorkflow(f.f.workflowId, f.f.buyer)
  assert.equal(partial.completed, false); assert.equal(partial.receipt_persisted, false)
  assert.equal(partial.receipt.totals.gross_buyer_minor, 210)
  assert.equal(partial.receipt.totals.unresolved_buyer_minor, 105)
  assert.equal(partial.receipt.nodes.filter((node) => node.phase === 'completed').length, 1)
  assert.equal((await db.select().from(schema.workflow_receipts).where(eq(schema.workflow_receipts.run_id, f.purchased.active.run.id))).length, 0)
  await fundDependent(f)
  const { delivery } = await (await import('@/lib/trade-delivery')).submitTradeDelivery(f.dependent.data.trade.id, f.grant.recipient_id,
    { summary: 'Completed downstream review based on the approved exact private dependency.', artifact: { result: 'accepted downstream findings' } })
  await db.transaction(async (tx) => {
    await (await import('@/lib/verification-evidence')).advanceBuyerReview(tx, f.dependent.data.trade.id, 'passed', delivery.content_hash)
    await tx.update(schema.trades).set({ status: 'completed', payout_status: 'complete', completed_at: new Date() }).where(eq(schema.trades.id, f.dependent.data.trade.id))
    await (await import('@/lib/service-order-state')).advanceServiceOrder(tx, f.dependent.data.trade.id, 'completed')
    await tx.insert(schema.settlement_transfers).values({ business_key: `${f.dependent.data.trade.id}:seller_payout`, trade_id: f.dependent.data.trade.id,
      kind: 'seller_payout', chain_id: 8453, token_address: token, from_address: treasury, to_address: treasury,
      token_amount: '1000000', usd_amount: 1, status: 'confirmed', tx_hash: `0x${'ee'.repeat(32)}`, confirmed_at: new Date() })
  })
  const result = await reconcileWorkflow(f.f.workflowId, f.f.buyer)
  assert.equal(result.completed, true); assert.equal(result.receipt_persisted, true); assert.equal(result.idempotent, false)
  assert.equal(result.receipt.nodes.length, 2); assert.equal(result.receipt.attempts.length, 2)
  assert.equal(result.receipt.totals.confirmed_seller_payout_minor, 200)
  assert.equal(result.receipt.totals.gross_marketplace_fee_minor, 10)
  assert.equal(result.receipt.totals.unresolved_buyer_minor, 0)
  assert.equal(result.receipt.totals.chain_fee_ceiling_units, (BigInt(fee) * 2n).toString())
  assert.equal(result.receipt.totals.actual_chain_fee_units, null)
  const replay = await reconcileWorkflow(f.f.workflowId, f.f.buyer)
  assert.equal(replay.idempotent, true); assert.equal(replay.content_hash, result.content_hash)
  await rejectsCode(() => inspectWorkflowRun(f.f.workflowId, f.f.outsider), 'WORKFLOW_NOT_FOUND')
  await db.update(schema.settlement_transfers).set({ status: 'submitted' }).where(eq(schema.settlement_transfers.trade_id, f.trade.id))
  const withdrawn = await reconcileWorkflow(f.f.workflowId, f.f.buyer)
  assert.equal(withdrawn.completed, false); assert.equal(withdrawn.receipt_persisted, false)
  assert.equal(withdrawn.saved_receipt?.content_hash, result.content_hash)
  assert.equal((await db.select().from(schema.workflow_receipts).where(eq(schema.workflow_receipts.run_id, result.run.id))).length, 1)
})

test('workflow HTTP activation, child preparation and recovery inspect enforce owner/buyer scope and exact references', async () => {
  const f = await fixture(false, true)
  const api = await import('@/app/api/workflows/[id]/execute/route')
  const prepare = (await import('@/app/api/workflows/[id]/nodes/[key]/prepare/route')).POST
  const response = await api.POST(request(`/api/workflows/${f.workflowId}/execute`, f.buyer, f.activation), context(f.workflowId))
  assert.equal(response.status, 401)
  const authorized = await api.POST(request(`/api/workflows/${f.workflowId}/execute`, f.owner, f.activation), context(f.workflowId))
  assert.equal(authorized.status, 201, await authorized.clone().text())
  const { run } = await authorized.json()
  const command = { version: 1, run_id: run.id }, params = { params: Promise.resolve({ id: f.workflowId, key: 'first' }) }
  const denied = await prepare(request(`/api/workflows/${f.workflowId}/nodes/first/prepare`, f.outsider, command), params)
  assert.equal(denied.status, 404)
  const child = await prepare(request(`/api/workflows/${f.workflowId}/nodes/first/prepare`, f.buyer, command), params)
  assert.equal(child.status, 201, await child.clone().text())
  const data = await child.json(); assert.equal(data.funds_moved, false); assert.equal(data.route.id, data.node.planned_route_id)
  assert.equal(data.mandate.id, data.node.mandate_id)
  const altered = await prepare(request(`/api/workflows/${f.workflowId}/nodes/first/prepare`, f.buyer, { ...command, max_budget: 999 }), params)
  assert.equal(altered.status, 400)
  process.env.CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED = 'false'
  try {
    const replay = await api.POST(request(`/api/workflows/${f.workflowId}/execute`, f.owner, f.activation), context(f.workflowId))
    assert.equal(replay.status, 200); assert.equal((await replay.json()).run.id, run.id)
    const observed = await api.GET(new NextRequest(`http://localhost/api/workflows/${f.workflowId}/execute`, { headers: {
      Authorization: `Bearer ${jwt({ userId: f.buyer, email: `${f.buyer}@test.invalid`, role: 'human' })}` } }), context(f.workflowId))
    assert.equal(observed.status, 200); assert.equal(observed.headers.get('cache-control'), 'private, no-store')
    assert.equal((await observed.json()).completed, false)
  } finally { process.env.CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED = 'true' }
})


test('workflow HTTP cookies require CSRF, oversized writes are bounded and cancellation preserves original obligations', async () => {
  const f = await fixture(), api = await import('@/app/api/workflows/[id]/execute/route')
  const ownerCookie = jwt({ userId: f.owner, email: `${f.owner}@test.invalid`, role: 'human' })
  const cookieRequest = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, { method: 'POST',
    headers: { Cookie: `auth-token=${ownerCookie}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const denied = await api.POST(cookieRequest(`/api/workflows/${f.workflowId}/execute`, f.activation), context(f.workflowId))
  assert.equal(denied.status, 403); assert.equal(denied.headers.get('cache-control'), 'private, no-store')
  const huge = await api.POST(request(`/api/workflows/${f.workflowId}/execute`, f.owner, { ...f.activation, padding: 'x'.repeat(2048) }), context(f.workflowId))
  assert.equal(huge.status, 413)
  assert.equal((await db.select().from(schema.workflow_runs).where(eq(schema.workflow_runs.workflow_id, f.workflowId))).length, 0)
  const run = (await budget.activateWorkflow(f.workflowId, f.owner, f.activation)).run
  const node = (await budget.prepareWorkflowNode(run.id, 'first', f.buyer)).node
  const checkout = await execute(request(`/api/routes/${node.route_id}/execute`, f.buyer, { mandate_id: node.mandate_id }), context(node.route_id!))
  assert.equal(checkout.status, 201, await checkout.clone().text())
  const { order } = await checkout.json()
  const prepare = (await import('@/app/api/workflows/[id]/nodes/[key]/prepare/route')).POST
  assert.equal((await prepare(cookieRequest(`/api/workflows/${f.workflowId}/nodes/second/prepare`, { version: 1, run_id: run.id }), { params: Promise.resolve({ id: f.workflowId, key: 'second' }) })).status, 403)
  const reconcile = (await import('@/app/api/workflows/[id]/reconcile/route')).POST
  assert.equal((await reconcile(cookieRequest(`/api/workflows/${f.workflowId}/reconcile`, { version: 1, run_id: run.id }), context(f.workflowId))).status, 403)
  const cancel = (await import('@/app/api/workflows/[id]/route')).DELETE
  const cancelled = await cancel(new NextRequest(`http://localhost/api/workflows/${f.workflowId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${ownerCookie}` } }), context(f.workflowId))
  assert.equal(cancelled.status, 200); assert.equal((await cancelled.json()).funds_state, 'recover_original_children')
  const rejected = await prepare(request(`/api/workflows/${f.workflowId}/nodes/second/prepare`, f.buyer, { version: 1, run_id: run.id }), { params: Promise.resolve({ id: f.workflowId, key: 'second' }) })
  assert.equal(rejected.status, 409)
  const current = await api.GET(new NextRequest(`http://localhost/api/workflows/${f.workflowId}/execute`, { headers: { Authorization: `Bearer ${ownerCookie}` } }), context(f.workflowId))
  assert.equal(current.status, 200); assert.equal((await current.json()).receipt.totals.unresolved_buyer_minor, 105)
  const [preserved] = await db.select().from(schema.service_orders).where(eq(schema.service_orders.id, order.id))
  assert.equal(preserved.capacity_released_at, null)
  assert.equal((await db.select().from(schema.workflow_reservations).where(eq(schema.workflow_reservations.order_id, order.id))).length, 1)
})


test('swapped or malformed fee observations cannot turn original workflow costs into measured fees', async () => {
  const f = await dependentCheckout(), { inspectWorkflowRun } = await import('@/lib/workflow-reconciliation')
  const [funding] = await db.select().from(schema.payment_receipts).where(eq(schema.payment_receipts.trade_id, f.trade.id))
  await db.update(schema.payment_receipts).set({ chain_fee_evidence_json: '{' }).where(eq(schema.payment_receipts.id, funding.id))
  await rejectsCode(() => inspectWorkflowRun(f.f.workflowId, f.f.buyer), 'WORKFLOW_CHAIN_FEE_EVIDENCE_INVALID')
  const { measuredEvmChainFee } = await import('@/lib/chain-fee-evidence')
  const foreign = measuredEvmChainFee(1, { transactionHash: funding.tx_hash!, blockHash: `0x${'11'.repeat(32)}`, blockNumber: 55n,
    from: funding.payer_address!, gasUsed: 50_000n, effectiveGasPrice: 1n, type: 'eip1559' })!
  await db.update(schema.payment_receipts).set({ chain_fee_evidence_json: JSON.stringify(foreign) }).where(eq(schema.payment_receipts.id, funding.id))
  await rejectsCode(() => inspectWorkflowRun(f.f.workflowId, f.f.buyer), 'WORKFLOW_CHAIN_FEE_EVIDENCE_INVALID')
  await db.update(schema.payment_receipts).set({ chain_id: 1 }).where(eq(schema.payment_receipts.id, funding.id))
  await rejectsCode(() => inspectWorkflowRun(f.f.workflowId, f.f.buyer), 'WORKFLOW_CHAIN_FEE_EVIDENCE_INVALID')
  await db.update(schema.payment_receipts).set({ chain_id: 8453, chain_fee_evidence_json: null }).where(eq(schema.payment_receipts.id, funding.id))
  const original = await inspectWorkflowRun(f.f.workflowId, f.f.buyer)
  assert.equal(original.receipt.totals.actual_chain_fee_units, null)
  assert.equal(original.receipt.totals.chain_fee_measurement, 'not_recorded')
  assert.equal(original.receipt.totals.gross_buyer_minor, 210)
  assert.equal(original.receipt.totals.unresolved_buyer_minor, 105)
  assert.equal((await db.select().from(schema.workflow_receipts).where(eq(schema.workflow_receipts.run_id, original.run.id))).length, 0)
})
