import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import { privateKeyToAccount } from 'viem/accounts'
import { createLocalTestSchema } from '../helpers/local-schema'
import { reviewedTaskFixture } from '../helpers/reviewed-task-fixture'

let directory: string, db: typeof import('@/lib/db').db, schema: typeof import('@/lib/schema')
let taskDomain: typeof import('@/lib/organization-task-authorizations')
let jwt: typeof import('@/lib/auth').generateJWT
const treasuryKey = `0x${'99'.repeat(32)}` as const
const treasury = privateKeyToAccount(treasuryKey).address.toLowerCase()
const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } }

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'clawdmarket-workspace-test-task-shared-'))
  Object.assign(process.env, {
    TURSO_DATABASE_URL: `file:${join(directory, 'shared.db')}`, TURSO_AUTH_TOKEN: '',
    JWT_SECRET: 'task-shared-fixture-only', TREASURY_ADDRESS: treasury, EVM_SETTLEMENT_PRIVATE_KEY: treasuryKey,
    MPP_RECIPIENT_ADDRESS: treasury, MPP_SECRET_KEY_CURRENT: 'task-shared-mpp-fixture-only-secret',
    TEMPO_RPC_URL: 'https://rpc.example.invalid', CLAWDMARKET_ENTERPRISE_FOUNDATION_ENABLED: 'true',
    CLAWDMARKET_ROUTE_PLANNING_ENABLED: 'true', CLAWDMARKET_ROUTE_EXECUTION_ENABLED: 'true',
    CLAWDMARKET_WORKFLOW_PLANNING_ENABLED: 'true', CLAWDMARKET_WORKFLOW_EXECUTION_ENABLED: 'true',
    CLAWDMARKET_REUSABLE_SERVICES_ENABLED: 'true', EVM_ACCEPTED_TOKENS: JSON.stringify([{
      chainId: 1, chainName: 'Shared exposure fixture', address: `0x${'44'.repeat(20)}`,
      symbol: 'TEST', decimals: 6, fixedUsdPrice: 1, confirmations: 1, rpcUrl: 'https://rpc.example.invalid',
    }]),
  })
  for (const name of ['VERCEL', 'VERCEL_ENV', 'CLAWDMARKET_NEW_PAYMENTS_PAUSED', 'DEV_WALLET_ADDRESS', 'DEV_FEE_WALLET_ADDRESS']) delete process.env[name]
  db = (await import('@/lib/db')).db
  schema = await import('@/lib/schema')
  await createLocalTestSchema(db.$client, schema)
  taskDomain = await import('@/lib/organization-task-authorizations')
  jwt = (await import('@/lib/auth')).generateJWT
})
after(async () => { db?.$client.close(); if (directory) await rm(directory, { recursive: true, force: true }) })

function request(path: string, actor: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, { method: 'POST', headers: {
    Authorization: `Bearer ${jwt({ userId: actor, email: `${actor}@test.invalid`, role: 'human' })}`,
    'Content-Type': 'application/json',
  }, body: JSON.stringify(body) })
}
type Fixture = Awaited<ReturnType<typeof reviewedTaskFixture>>

async function reviewedService(f: Fixture, family: 'route' | 'workflow', gross: string, fee: string) {
  const service = crypto.randomUUID()
  await db.insert(schema.service_definitions).values({ id: service, seller_id: f.seller,
    title: 'Separate original service', description: 'Return the independently reviewed service result.',
    capabilities: '["code-review"]', price_minor: 100, status: 'active', provider_protocol: 'leased_v1',
    estimated_latency_seconds: 30, max_concurrency: 4, output_schema: '{"type":"object"}', verification_policy: JSON.stringify(policy) })
  const payment = f.body.payment, perFee = payment.rail === 'evm' ? payment.max_gas_cost_wei! : payment.max_fee_token_cost_units!
  let routeId: string, mandateId: string
  if (family === 'route') {
    const routes = await import('@/lib/organization-route-authorizations')
    const a = (await routes.proposeOrganizationRoute(f.org, f.owner, routes.organizationRouteInput.parse({
      version: f.body.version, client_reference: crypto.randomUUID(), agent_id: f.buyerAgent, reviewer_role_id: f.roleId,
      route_request: { client_reference: crypto.randomUUID(), objective: 'Review the separate original service', input: {},
        required_capabilities: ['code-review'], max_budget: { amount: '1.05', currency: 'USD' }, verification: policy,
        provider_requirements: { approved_providers: [f.seller] }, payment_policy: { allowed_rails: [payment.rail] } },
      max_daily: gross, max_monthly: gross, max_lifetime: gross,
      ...(payment.rail === 'evm' ? { max_lifetime_gas_cost_wei: fee } : { max_lifetime_fee_token_cost_units: fee }),
      mandate: { version: 1, client_reference: crypto.randomUUID(), max_aggregate: '1.05', max_per_execution: '1.05',
        max_retry_budget: '0.00', max_attempts: 1, approved_providers: [f.seller], max_latency_seconds: 60,
        private_data: 'selected_provider_only', expires_at: f.body.expires_at, payment },
    }))).authorization
    await routes.approveOrganizationRoute(f.org, a.id, f.reviewer, {
      version: f.body.version as 1 | 2, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true,
    })
    routeId = a.route_id; mandateId = a.mandate.id
  } else {
    const plan = await (await import('@/app/api/workflows/plan/route')).POST(request('/api/workflows/plan', f.buyer, {
      client_reference: crypto.randomUUID(), objective: 'Review one separate original workflow obligation',
      max_budget: { amount: '1.05', currency: 'USD' }, deadline_seconds: 600,
      nodes: [{ key: 'review', objective: 'Review the original independent provider output', required_capabilities: ['code-review'],
        budget: { amount: '1.05', currency: 'USD' }, deadline_seconds: 600, depends_on: [] }],
    }))
    assert.equal(plan.status, 201, JSON.stringify(await plan.clone().json()))
    const workflow = (await plan.json()).workflow, workflows = await import('@/lib/organization-workflow-authorizations')
    const a = (await workflows.proposeOrganizationWorkflow(f.org, f.owner, workflows.organizationWorkflowInput.parse({
      version: f.body.version, client_reference: crypto.randomUUID(), workflow_id: workflow.id, reviewer_role_id: f.roleId,
      max_daily: gross, max_monthly: gross, max_lifetime: gross, max_lifetime_chain_fee_units: fee,
      approval: { version: 1, client_reference: crypto.randomUUID(), plan_hash: workflow.plan_hash,
        expires_at: new Date(Math.floor(Date.parse(f.body.expires_at) / 1000) * 1000).toISOString(), max_gross_minor: 105, max_chain_fee_units: perFee, private_data: 'selected_provider_only', payment,
        nodes: [{ key: 'review', static_input: {}, provider_requirements: { approved_providers: [f.seller] }, verification: policy,
          max_per_attempt_minor: 105, max_retry_minor: 0, max_attempts: 1, max_latency_seconds: 60,
          max_chain_fee_per_attempt_units: perFee, dependency_inputs: [] }] },
    }))).authorization
    await workflows.approveOrganizationWorkflow(f.org, a.id, f.reviewer, {
      version: f.body.version as 1 | 2, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true,
    })
    const budget = await import('@/lib/workflow-execution-budget')
    const active = await budget.activateWorkflow(workflow.id, f.owner, { version: 1, client_reference: crypto.randomUUID(),
      approval_id: a.approval_id, contract_hash: a.terms.contract_hash, authorize_spending: true })
    const prepared = await budget.prepareWorkflowNode(active.run.id, 'review', f.buyer)
    assert.ok(prepared.node.route_id); assert.ok(prepared.node.mandate_id)
    routeId = prepared.node.route_id; mandateId = prepared.node.mandate_id
  }
  return Object.assign(async () => {
    const response = await (await import('@/app/api/routes/[id]/execute/route')).POST(
      request(`/api/routes/${routeId}/execute`, f.buyer, { mandate_id: mandateId }), { params: Promise.resolve({ id: routeId }) })
    const body = await response.json()
    return { status: response.status, code: body.error_code, trade: body.trade }
  }, { routeId, mandateId })
}

for (const tempo of [false, true]) for (const family of ['route', 'workflow'] as const)
  for (const ceiling of ['gross', 'fee'] as const) for (const first of ['task', 'service'] as const)
    test(`${tempo ? 'Tempo' : 'L1'} ${family}/task original ${ceiling} exposure survives ${first}-first reservation and cancellation`, async () => {
      const f = await reviewedTaskFixture({ db, schema }, tempo)
      const perFee = tempo ? '5000' : '100000000000000'
      const gross = ceiling === 'gross' ? '1.05' : '10.00', fee = ceiling === 'fee' ? perFee : (BigInt(perFee) * 10n).toString()
      const a = (await taskDomain.proposeOrganizationTask(f.org, f.owner, taskDomain.organizationTaskInput.parse({ ...f.body,
        max_daily: gross, max_monthly: gross, max_lifetime: gross, max_lifetime_chain_fee_units: fee }))).authorization
      await taskDomain.approveOrganizationTask(f.org, a.id, f.reviewer, {
        version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true,
      })
      const service = await reviewedService(f, family, gross, fee)
      const checkout = { version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash }
      const task = () => taskDomain.checkoutOrganizationTask(f.org, a.id, f.buyer, checkout)
      let tradeId: string
      if (first === 'task') {
        const made = await task(); assert.ok(made.trade); tradeId = made.trade.id
        const denied = await service(); assert.equal(denied.status, 409, JSON.stringify(denied))
        assert.match(denied.code, ceiling === 'gross' ? /GROSS_LIMIT/ : /(?:GAS|FEE(?:_TOKEN)?)_LIMIT/)
      } else {
        const made = await service(); assert.equal(made.status, 201, JSON.stringify(made)); tradeId = made.trade.id
        await assert.rejects(task, error => (error as { code?: string }).code === (ceiling === 'gross'
          ? 'ORGANIZATION_TASK_DAILY_EXPOSURE' : 'ORGANIZATION_TASK_FEE_EXPOSURE'))
      }
      const cancel = await (await import('@/app/api/trades/[id]/cancel/route')).POST(
        request(`/api/trades/${tradeId}/cancel`, f.buyer, {}), { params: Promise.resolve({ id: tradeId }) })
      assert.equal(cancel.status, 200, JSON.stringify(await cancel.clone().json()))
      if (first === 'task') {
        const denied = await service(); assert.equal(denied.status, 409, JSON.stringify(denied))
      } else await assert.rejects(task)
      assert.equal((await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))).length, 1)
      assert.equal((await db.select().from(schema.organization_task_uses).where(eq(schema.organization_task_uses.task_id, f.task))).length, first === 'task' ? 1 : 0)
    })

const childCode = `(async()=>{
  const a=JSON.parse(process.argv[1]),fs=await import('node:fs/promises'),{db}=await import('./lib/db.ts');
  try {
    await fs.writeFile(a.ready,'ready');
    while(true){try{await fs.readFile(a.start);break}catch{}await new Promise(done=>setTimeout(done,10))}
    if(a.kind==='task'){
      const domain=await import('./lib/organization-task-authorizations.ts');
      const result=await domain.checkoutOrganizationTask(a.org,a.id,a.actor,domain.organizationTaskCheckoutInput.parse(a.body));
      console.log(JSON.stringify({status:result.created?201:200,trade_id:result.trade.id}));
    }else{
      const {NextRequest}=await import('next/server'),{generateJWT}=await import('./lib/auth.ts'),{POST}=await import('./app/api/routes/[id]/execute/route.ts');
      const response=await POST(new NextRequest('http://localhost/api/routes/'+a.id+'/execute',{method:'POST',headers:{Authorization:'Bearer '+generateJWT({userId:a.actor,email:a.actor+'@test.invalid',role:'human'}),'Content-Type':'application/json'},body:JSON.stringify(a.body)}),{params:Promise.resolve({id:a.id})});
      const result=await response.json();console.log(JSON.stringify({status:response.status,code:result.error_code,trade_id:result.trade?.id}));
    }
  }catch(error){console.log(JSON.stringify({status:error.status||500,code:error.code||'UNEXPECTED_WORKER_FAILURE'}))}
  finally{db.$client.close()}
})()`

type WorkerCommand = { kind: 'task' | 'service'; org: string; id: string; actor: string; body: unknown; ready: string; start: string }
async function financialWorker(command: WorkerCommand, recoveryAttempt = 0): Promise<{ status: number; code?: string; trade_id?: string }> {
  const environment = { ...process.env }; delete environment.NODE_TEST_CONTEXT
  const response = await promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', '-e', childCode, JSON.stringify(command)],
    { cwd: process.cwd(), env: environment, timeout: 45_000 })
  const result = JSON.parse(response.stdout.trim().split('\n').at(-1)!)
  if (result.status === 503 && ['PURCHASING_STORAGE_BUSY', 'SERVICE_RESERVATION_BUSY'].includes(result.code) && recoveryAttempt < 4) {
    await new Promise(done => setTimeout(done, 50 * 2 ** recoveryAttempt))
    return financialWorker(command, recoveryAttempt + 1)
  }
  assert.ok(result.status < 500, JSON.stringify(result) + response.stderr)
  return result
}

for (const tempo of [false, true]) for (const family of ['route', 'workflow'] as const)
  for (const ceiling of ['gross', 'fee'] as const)
    test(`separate ${tempo ? 'Tempo' : 'L1'} task/${family} processes cannot race beyond shared ${ceiling} exposure`, async () => {
      const f = await reviewedTaskFixture({ db, schema }, tempo), perFee = tempo ? '5000' : '100000000000000'
      const gross = ceiling === 'gross' ? '1.05' : '10.00', fee = ceiling === 'fee' ? perFee : (BigInt(perFee) * 10n).toString()
      const a = (await taskDomain.proposeOrganizationTask(f.org, f.owner, taskDomain.organizationTaskInput.parse({ ...f.body,
        max_daily: gross, max_monthly: gross, max_lifetime: gross, max_lifetime_chain_fee_units: fee }))).authorization
      await taskDomain.approveOrganizationTask(f.org, a.id, f.reviewer, {
        version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash, approve: true,
      })
      const service = await reviewedService(f, family, gross, fee), marker = join(directory, crypto.randomUUID()), start = marker + '.start'
      const commands: WorkerCommand[] = [{ kind: 'task', org: f.org, id: a.id, actor: f.buyer,
        body: { version: a.version, client_reference: crypto.randomUUID(), authority_hash: a.authority_hash }, ready: marker + '.task', start },
      { kind: 'service', org: f.org, id: service.routeId, actor: f.buyer,
        body: { mandate_id: service.mandateId }, ready: marker + '.service', start }]
      const workers = commands.map(command => financialWorker(command).then(value => ({ value, error: null })).catch(error => ({ value: null, error })))
      try {
        let ready = false
        for (let attempt = 0; attempt < 200; attempt++) {
          if ((await Promise.all(commands.map(command => readFile(command.ready).then(() => true).catch(() => false)))).every(Boolean)) { ready = true; break }
          await new Promise(done => setTimeout(done, 100))
        }
        assert.equal(ready, true, 'Both independent financial processes must reach the reservation barrier')
      } finally { await writeFile(start, 'go') }
      const results = await Promise.all(workers)
      for (const result of results) assert.equal(result.error, null, String(result.error))
      const responses = results.map(result => result.value!)
      assert.deepEqual(responses.map(result => result.status).sort(), [201, 409], JSON.stringify(responses))
      const loser = responses.findIndex(result => result.status === 409), recovered = await financialWorker(commands[loser])
      assert.equal(recovered.status, 409, JSON.stringify(recovered))
      assert.match(recovered.code!, ceiling === 'gross' ? /(?:GROSS_LIMIT|DAILY_EXPOSURE)/ : /(?:(?:GAS|FEE(?:_TOKEN)?)_LIMIT|FEE_EXPOSURE)/)
      const buyerTrades = await db.select().from(schema.trades).where(eq(schema.trades.buyer_id, f.buyer))
      assert.equal(buyerTrades.length, 1); assert.equal(buyerTrades[0].id, responses.find(result => result.status === 201)!.trade_id)
      const taskUses = await db.select().from(schema.organization_task_uses).where(eq(schema.organization_task_uses.task_id, f.task))
      const serviceOrders = await db.select().from(schema.service_orders).where(eq(schema.service_orders.buyer_id, f.buyer))
      assert.equal(taskUses.length + serviceOrders.length, 1)
    })
