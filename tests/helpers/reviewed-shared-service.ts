import assert from 'node:assert/strict'
import type { NextRequest } from 'next/server'
import type { reviewedTaskFixture, TaskFixtureSource } from './reviewed-task-fixture'

type Base = Awaited<ReturnType<typeof reviewedTaskFixture>>
type Fixture = Pick<Base, 'org' | 'owner' | 'reviewer' | 'buyer' | 'seller' | 'buyerAgent' | 'roleId'> & { body: Pick<Base['body'], 'version' | 'expires_at' | 'payment'> }
type RequestFactory = (path: string, actor: string, body: unknown) => NextRequest
const policy = { required: true, methods: ['buyer_review', 'schema'], acceptance: { version: 1, mode: 'explicit_buyer' } }

export async function reviewedSharedService(source: TaskFixtureSource, request: RequestFactory, f: Fixture, family: 'route' | 'workflow', gross: string, fee: string) {
  const { db, schema } = source
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

