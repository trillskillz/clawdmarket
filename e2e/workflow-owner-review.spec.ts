import { test, expect, type APIRequestContext } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { privateKeyToAccount } from 'viem/accounts'
test.setTimeout(90_000)
async function setup(request: APIRequestContext) {
  const registration = await request.post('/api/agents/register', { headers: { 'x-forwarded-for': `2001:db8:${(Date.now()%65535).toString(16)}::b59` },
    data: { name: `Human workflow ${crypto.randomUUID().slice(0,8)}`, activation_mode: 'autonomous', capabilities: ['code-review'] } })
  expect(registration.status()).toBe(201); const agent = (await registration.json()).agent
  const fixture = (mode: string) => promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'e2e/fixtures/workflow-approval.ts', mode, agent.id],
    { env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret' }, timeout: 20000 })
  const owners = JSON.parse((await fixture('owners')).stdout), provider = JSON.parse((await fixture('service')).stdout)
  const buyerHeaders = { Authorization: `Bearer ${agent.api_key}` }, headers = { Authorization: `Bearer ${owners.owner_key}` }
  const planned = await request.post('/api/workflows/plan', { headers: buyerHeaders, data: { client_reference: `review-ui-${crypto.randomUUID()}`,
    objective: 'Review a private finite two-step repository workflow', max_budget: { amount: '2.00', currency: 'USD' }, deadline_seconds: 300,
    nodes: ['first', 'second'].map((key, index) => ({ key, objective: `Review the original repository ${key} step`, required_capabilities: ['code-review'],
      budget: { amount: '1.00', currency: 'USD' }, deadline_seconds: index ? 300 : 120, depends_on: index ? ['first'] : [] })) } })
  expect(planned.status()).toBe(201); const workflow = (await planned.json()).workflow, path = `/api/workflows/${workflow.id}`
  const body = { version: 1, client_reference: `review-ui-approval-${crypto.randomUUID()}`, plan_hash: workflow.plan_hash,
    expires_at: new Date(Math.floor(Date.now()/1000)*1000+600_000).toISOString(), max_gross_minor: 200, max_chain_fee_units: '2000', private_data: 'selected_provider_only',
    payment: { rail: 'evm', chain_id: 8453, token_address: `0x${'44'.repeat(20)}`, payer_address: `0x${'11'.repeat(20)}`,
      treasury_address: process.env.TREASURY_ADDRESS || privateKeyToAccount(`0x${'99'.repeat(32)}`).address,
      minimum_token_reserve_units: '2000000', minimum_native_reserve_wei: '10000', max_gas_cost_wei: '1000' },
    nodes: ['first', 'second'].map((key, index) => ({ key, static_input: { private_code: 'WORKFLOW_REVIEW_PRIVATE_INPUT' },
      provider_requirements: { approved_providers: [provider.seller] }, verification: { required: true, methods: ['buyer_review'], acceptance: { version: 1, mode: 'explicit_buyer' } },
      max_per_attempt_minor: 100, max_retry_minor: 0, max_attempts: 1, max_latency_seconds: 60, max_chain_fee_per_attempt_units: '1000',
      dependency_inputs: index ? [{ source_node: 'first', artifact_index: 0, target_field: 'upstream' }] : [] })) }
  return { agent, owners, headers, buyerHeaders, workflow, path, body, fixture }
}

test('human reviews exact private DAG terms and recovers lost decisions while revocation preserves original child obligations', async ({ request, page, context }) => {
  const f = await setup(request)
  const cookies = (token: string) => context.addCookies([{ name: 'auth-token', value: token, url: 'http://localhost:3000' }, { name: 'csrf-token', value: 'workflow-review-csrf', url: 'http://localhost:3000' }])
  await cookies(f.owners.owner_key); await page.goto('/dashboard?tab=workflow-reviews')
  await page.getByLabel('Workflow ID').fill(f.workflow.id)
  await page.getByRole('link', { name: 'Open workflow review' }).click()
  const main = page.locator('main'), approve = main.getByRole('button', { name: 'Approve exact workflow terms' })
  await expect(main.getByRole('heading', { name: 'Current finite plan' })).toBeVisible()
  const source = main.getByLabel('Exact approval proposal')
  await source.fill('{bad json'); await main.getByRole('button', { name: 'Load proposed terms' }).click()
  await expect(main.getByRole('alert')).toContainText('proposal cannot be read'); await expect(approve).toHaveCount(0)
  await source.fill(JSON.stringify({ ...f.body, plan_hash: 'f'.repeat(64) })); await main.getByRole('button', { name: 'Load proposed terms' }).click()
  await expect(approve).toBeDisabled(); await expect(main.getByRole('alert')).toContainText('plan hash differs')
  await source.fill(JSON.stringify(f.body)); await main.getByRole('button', { name: 'Load proposed terms' }).click()
  await expect(main.getByText('2000 wei', { exact: true })).toBeVisible()
  await main.getByText('Exact private input, dependencies and verification for second', { exact: true }).click()
  await expect(main.getByText('WORKFLOW_REVIEW_PRIVATE_INPUT', { exact: false }).first()).toBeVisible()
  const acknowledge = main.getByRole('checkbox', { name: /I reviewed all exact/ })
  await acknowledge.check(); await source.fill(JSON.stringify({ ...f.body, max_chain_fee_units: '2001' }))
  await expect(approve).toHaveCount(0)
  await source.fill(JSON.stringify(f.body)); await main.getByRole('button', { name: 'Load proposed terms' }).click()
  await acknowledge.check()
  let posts = 0
  await page.route('**' + f.path + '/approval', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    posts += 1; const response = await route.fetch(); expect(response.status()).toBe(201); await route.abort('failed')
  })
  await approve.focus(); await page.keyboard.press('Enter')
  await expect(main.getByRole('alert')).toContainText('response was lost'); expect(posts).toBe(1)
  await expect(main.getByRole('heading', { name: 'Original owner decision' })).toHaveCount(0)
  const committed = await request.get(f.path + '/approval', { headers: f.headers }), approval = (await committed.json()).approval
  expect(committed.headers()['cache-control']).toContain('private, no-store'); expect(approval.state).toBe('approved')
  expect(JSON.parse((await f.fixture('counts')).stdout)).toEqual({ approvals: 1, orders: 0, trades: 0 })
  await page.unroute('**' + f.path + '/approval'); await main.getByRole('button', { name: 'Refresh original state' }).click()
  await expect(main.getByText(`Approval ${approval.id}`, { exact: false })).toBeVisible(); await expect(approve).toHaveCount(0)
  const replay = await request.post(f.path + '/approval', { headers: f.headers, data: f.body }); expect(replay.status()).toBe(200); expect((await replay.json()).approval.id).toBe(approval.id)
  expect((await context.request.delete(f.path + '/approval')).status()).toBe(403)
  const command = { version: 1, client_reference: `review-ui-run-${crypto.randomUUID()}`, approval_id: approval.id, contract_hash: approval.contract_hash, authorize_spending: true }
  const activated = await request.post(f.path + '/execute', { headers: f.headers, data: command }); expect(activated.status()).toBe(201)
  const run = (await activated.json()).run, nodeCommand = { version: 1, run_id: run.id }
  const prepared = await request.post(f.path + '/nodes/first/prepare', { headers: f.buyerHeaders, data: nodeCommand }); expect(prepared.status()).toBe(201); const child = await prepared.json()
  const checkout = await request.post(`/api/routes/${child.route.id}/execute`, { headers: f.buyerHeaders, data: { mandate_id: child.mandate.id } }); expect(checkout.status()).toBe(201); const original = await checkout.json()
  await main.getByRole('button', { name: 'Refresh original state' }).click()
  await expect(main.getByText('Incomplete; original work requires recovery', { exact: false })).toBeVisible()
  await expect(main.getByText(original.order.id, { exact: false })).toBeVisible()
  const unresolved = main.locator('dl > div').filter({ hasText: 'Unresolved original buyer amount' })
  await expect(unresolved).toContainText('$1.00 USD')
  await main.getByRole('checkbox', { name: /I understand revocation/ }).check()
  await main.getByRole('button', { name: 'Revoke fresh workflow use' }).click()
  await expect(main.getByRole('status')).toContainText('Fresh use revoked')
  await expect(unresolved).toContainText('$1.00 USD'); await expect(main.getByText(original.order.id, { exact: false })).toBeVisible()
  expect((await request.post(f.path + '/nodes/second/prepare', { headers: f.buyerHeaders, data: nodeCommand })).status()).toBe(409)
  const originalChild = await request.post(f.path + '/nodes/first/prepare', { headers: f.buyerHeaders, data: nodeCommand }); expect(originalChild.status()).toBe(200); expect((await originalChild.json()).route.id).toBe(child.route.id)
  await page.evaluate(() => window.scrollTo(0,0))
  await page.screenshot({ path: '/tmp/clawdmarket-workflow-review-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0,0))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/clawdmarket-workflow-review-mobile.png', fullPage: true })
  await f.fixture('transfer'); await main.getByRole('button', { name: 'Refresh original state' }).click()
  await expect(main.getByRole('alert')).toContainText('current buyer or linked owner'); await expect(main).not.toContainText('WORKFLOW_REVIEW_PRIVATE_INPUT')
  await cookies(f.owners.outsider_key); await page.reload()
  await expect(main.getByText(`Approval ${approval.id}`, { exact: false })).toBeVisible(); await expect(main.getByText('Original owner no longer controls', { exact: false })).toBeVisible()
  await expect(main.getByText(original.order.id, { exact: false })).toBeVisible()
  await context.clearCookies(); await main.getByRole('button', { name: 'Refresh original state' }).click()
  await expect(main.getByRole('alert')).toContainText('current buyer or linked owner'); await expect(main.getByRole('heading', { name: 'Original owner decision' })).toHaveCount(0)
  expect(JSON.parse((await f.fixture('counts')).stdout)).toEqual({ approvals: 1, orders: 1, trades: 1 })
})

test('competing exact decision and plan drift preserve original review; stale and unavailable inspection cannot issue commands', async ({ request, page, context }) => {
  const f = await setup(request)
  await context.addCookies([{ name: 'auth-token', value: f.owners.owner_key, url: 'http://localhost:3000' }, { name: 'csrf-token', value: 'workflow-review-csrf', url: 'http://localhost:3000' }])
  await page.goto(`/workflows/${f.workflow.id}/review`)
  const main = page.locator('main'), source = main.getByLabel('Exact approval proposal')
  await source.fill(JSON.stringify(f.body)); await main.getByRole('button', { name: 'Load proposed terms' }).click(); await main.getByRole('checkbox', { name: /I reviewed all exact/ }).check()
  const other = await request.post(f.path + '/approval', { headers: f.headers, data: { ...f.body, client_reference: `review-ui-other-${crypto.randomUUID()}` } }); expect(other.status()).toBe(201)
  const approval = (await other.json()).approval
  await main.getByRole('button', { name: 'Approve exact workflow terms' }).click()
  await expect(main.getByRole('alert')).toContainText('original decision changed'); await expect(main.getByRole('heading', { name: 'Original owner decision' })).toHaveCount(0)
  await main.getByRole('button', { name: 'Refresh original state' }).click(); await expect(main.getByText(`Approval ${approval.id}`, { exact: false })).toBeVisible()
  await page.clock.install(); await page.clock.fastForward(65_000)
  await expect(main.getByRole('button', { name: 'Revoke fresh workflow use' })).toBeDisabled(); await expect(main.getByRole('alert')).toContainText('Inspection expired')
  await page.clock.setSystemTime(new Date()); await main.getByRole('button', { name: 'Refresh original state' }).click()
  let mutations = 0
  page.on('request', incoming => { if (incoming.url().includes(f.path) && ['POST','DELETE'].includes(incoming.method())) mutations += 1 })
  await page.route('**' + f.path + '/approval', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ diagnostic: 'PRIVATE_WORKFLOW_DIAGNOSTIC' }) }))
  await main.getByRole('button', { name: 'Refresh original state' }).click(); await expect(main.getByRole('alert')).toContainText('inspection is unavailable')
  await expect(main.getByRole('button', { name: 'Revoke fresh workflow use' })).toHaveCount(0); await expect(main).not.toContainText('PRIVATE_WORKFLOW_DIAGNOSTIC'); expect(mutations).toBe(0)
  await page.unroute('**' + f.path + '/approval')
  const activated = await request.post(f.path + '/execute', { headers: f.headers, data: { version: 1, client_reference: `review-ui-drift-run-${crypto.randomUUID()}`, approval_id: approval.id, contract_hash: approval.contract_hash, authorize_spending: true } }); expect(activated.status()).toBe(201)
  const fixture = (mode: string) => promisify(execFile)(process.execPath, ['--conditions=react-server','--import','tsx','e2e/fixtures/workflow-review.ts',mode,f.workflow.id], { env: { ...process.env }, timeout: 20000 })
  await fixture('drift')
  try {
    await main.getByRole('button', { name: 'Refresh original state' }).click()
    await expect(main.getByText('Current plan differs from the frozen contract.', { exact: false })).toBeVisible()
    await expect(main.getByText('original run reconciliation is unavailable', { exact: false })).toBeVisible()
    await main.getByRole('checkbox', { name: /I understand revocation/ }).check(); await main.getByRole('button', { name: 'Revoke fresh workflow use' }).click()
    await expect(main.getByRole('status')).toContainText('Fresh use revoked'); await expect(main.getByText(`Approval ${approval.id}`, { exact: false })).toContainText('revoked')
  } finally { await fixture('restore') }
  expect(JSON.parse((await f.fixture('counts')).stdout)).toEqual({ approvals: 1, orders: 0, trades: 0 })
})
