import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { privateKeyToAccount } from 'viem/accounts'

test('HTTP owner review freezes a private DAG, preserves identity and cannot authorize route payment', async ({ request, page }) => {
  const registered = await request.post('/api/agents/register', { headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65535).toString(16)}::b51` },
    data: { name: `Workflow HTTP ${crypto.randomUUID().slice(0, 8)}`, activation_mode: 'autonomous', capabilities: ['code-review'] } })
  expect(registered.status()).toBe(201)
  const agent = (await registered.json()).agent
  const fixture = (mode: string) => promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'e2e/fixtures/workflow-approval.ts', mode, agent.id],
    { env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret' }, timeout: 20000 })
  const owners = JSON.parse((await fixture('owners')).stdout)
  const buyerHeaders = { Authorization: `Bearer ${agent.api_key}` }, ownerHeaders = { Authorization: `Bearer ${owners.owner_key}` }
  const created = await request.post('/api/workflows/plan', { headers: buyerHeaders, data: {
    client_reference: `http-workflow-${crypto.randomUUID()}`, objective: 'Research and review this private repository',
    max_budget: { amount: '2.00', currency: 'USD' }, deadline_seconds: 300,
    nodes: [{ key: 'research', objective: 'Research current repository requirements', required_capabilities: ['research'], budget: { amount: '1.00', currency: 'USD' }, deadline_seconds: 120 },
      { key: 'review', objective: 'Review the repository using that research', required_capabilities: ['code-review'], budget: { amount: '1.00', currency: 'USD' }, deadline_seconds: 300, depends_on: ['research'] }] } })
  expect(created.status()).toBe(201)
  const workflow = (await created.json()).workflow, path = `/api/workflows/${workflow.id}/approval`
  const review = await request.get(path, { headers: ownerHeaders })
  expect(review.status()).toBe(200)
  expect(review.headers()['cache-control']).toContain('private, no-store')
  expect((await review.json()).plan_hash).toBe(workflow.plan_hash)
  expect((await review.json()).workflow.nodes).toHaveLength(2)
  const policy = { required: true, methods: ['buyer_review'], acceptance: { version: 1, mode: 'explicit_buyer' } }
  const body = { version: 1, client_reference: `http-approval-${crypto.randomUUID()}`, plan_hash: workflow.plan_hash,
    expires_at: new Date(Math.floor(Date.now() / 1000) * 1000 + 600000).toISOString(), max_gross_minor: 200, max_chain_fee_units: '2000',
    private_data: 'selected_provider_only', payment: { rail: 'evm', chain_id: 8453, token_address: `0x${'44'.repeat(20)}`,
      payer_address: `0x${'11'.repeat(20)}`, treasury_address: process.env.TREASURY_ADDRESS || privateKeyToAccount(`0x${'99'.repeat(32)}`).address,
      minimum_token_reserve_units: '2000000', minimum_native_reserve_wei: '10000', max_gas_cost_wei: '1000' },
    nodes: [{ key: 'research', static_input: { private_text: 'WORKFLOW_HTTP_PRIVATE_INPUT' }, provider_requirements: { approved_providers: ['http-seller'] }, verification: policy,
      max_per_attempt_minor: 100, max_retry_minor: 0, max_attempts: 1, max_latency_seconds: 60, max_chain_fee_per_attempt_units: '1000', dependency_inputs: [] },
      { key: 'review', static_input: {}, provider_requirements: { approved_providers: ['http-seller'] }, verification: policy,
        max_per_attempt_minor: 100, max_retry_minor: 0, max_attempts: 1, max_latency_seconds: 60, max_chain_fee_per_attempt_units: '1000',
        dependency_inputs: [{ source_node: 'research', artifact_index: 0, target_field: 'research_artifact' }] }] }
  expect((await request.post(path, { headers: buyerHeaders, data: body })).status()).toBe(401)
  const approved = await request.post(path, { headers: ownerHeaders, data: body })
  expect(approved.status()).toBe(201)
  const approval = (await approved.json()).approval
  expect(approval.spending_authority).toBe(false)
  expect(approval.execution_available).toBe(false)
  const replay = await request.post(path, { headers: ownerHeaders, data: body })
  expect(replay.status()).toBe(200)
  expect((await replay.json()).approval.id).toBe(approval.id)
  expect((await request.post(path, { headers: ownerHeaders, data: { ...body, max_chain_fee_units: '2001' } })).status()).toBe(409)
  expect((await request.get(path)).status()).toBe(401)
  expect((await request.get(path, { headers: { Authorization: `Bearer ${owners.outsider_key}` } })).status()).toBe(404)
  const route = await request.post('/api/routes/plan', { headers: buyerHeaders, data: { client_reference: `http-workflow-route-guard-${crypto.randomUUID()}`,
    objective: 'Review this repository without a financial mandate', required_capabilities: ['code-review'], max_budget: { amount: '1.00', currency: 'USD' } } })
  expect(route.status()).toBe(201)
  const routeId = (await route.json()).route.id
  const payment = await request.post(`/api/routes/${routeId}/execute`, { headers: buyerHeaders, data: { mandate_id: approval.id } })
  expect(payment.status()).toBe(404)
  expect((await payment.json()).error_code).toBe('MANDATE_NOT_FOUND')
  await page.goto('/proof')
  const inspected = await page.evaluate(async ({ path, key }) => {
    const response = await fetch(path, { headers: { Authorization: `Bearer ${key}` } })
    return { status: response.status, body: await response.json() }
  }, { path, key: owners.owner_key })
  expect(inspected.status).toBe(200)
  expect(inspected.body.approval.contract.terms.nodes[0].static_input.private_text).toBe('WORKFLOW_HTTP_PRIVATE_INPUT')
  await fixture('transfer')
  expect((await request.get(path, { headers: ownerHeaders })).status()).toBe(404)
  const revoked = await request.delete(path, { headers: { Authorization: `Bearer ${owners.outsider_key}` } })
  expect(revoked.status()).toBe(200)
  expect((await revoked.json()).approval.state).toBe('revoked')
  expect(JSON.parse((await fixture('counts')).stdout)).toEqual({ approvals: 1, orders: 0, trades: 0 })
})
