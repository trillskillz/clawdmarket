import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
test.setTimeout(90_000)

test('owner configures enterprise ceilings and assignments while exact purchases retain original history through conflict and response loss', async ({ request, page, context }) => {
  const registered = await request.post('/api/agents/register', { headers: { 'x-forwarded-for': `2001:db8:${(Date.now()%65535).toString(16)}::b57` },
    data: { name: `Enterprise HTTP ${crypto.randomUUID().slice(0,8)}`, activation_mode: 'autonomous', capabilities: ['code-review'] } })
  expect(registered.status()).toBe(201); const agent = (await registered.json()).agent
  const fixture = (mode: string) => promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'e2e/fixtures/workflow-approval.ts', mode, agent.id],
    { env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret' }, timeout: 20000 })
  const owner = JSON.parse((await fixture('owners')).stdout), provider = JSON.parse((await fixture('service')).stdout)
  const headers = { Authorization: `Bearer ${owner.owner_key}` }, buyerHeaders = { Authorization: `Bearer ${agent.api_key}` }
  const created = await request.post('/api/organizations', { headers, data: { client_reference: crypto.randomUUID(), name: 'Owner enterprise acceptance' } })
  expect(created.status()).toBe(201); const id = (await created.json()).organization.id, path = `/api/organizations/${id}`
  const cookies = async (token: string) => context.addCookies([{ name: 'auth-token', value: token, url: 'http://localhost:3000' }, { name: 'csrf-token', value: 'enterprise-browser-csrf', url: 'http://localhost:3000' }])
  await cookies(owner.owner_key)
  await page.goto('/dashboard?tab=enterprise')
  await expect(page.getByRole('heading', { name: 'Organization workspaces' })).toBeVisible()
  await page.getByRole('link', { name: 'Open enterprise workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Owner enterprise acceptance' })).toBeVisible()
  const main = page.locator('main'), organization = main.getByRole('region', { name: 'Organization budget' })
  const fillBudget = async (region: typeof organization, values: string[]) => {
    for (const [index, label] of ['Per purchase limit', 'Daily limit', 'Monthly limit'].entries()) await region.getByLabel(label, { exact: true }).fill(values[index])
  }
  await fillBudget(organization, ['2.00', '2.00', '3.00'])
  await organization.getByRole('button', { name: 'Save organization budget' }).click()
  await expect(organization.getByText(/Version 1\./)).toBeVisible()
  expect((await context.request.put(path + '/budget', { data: { expected_version: 1, max_per_execution: '3.00', max_daily: '3.00', max_monthly: '3.00' } })).status()).toBe(403)
  const concurrent = await request.put(path + '/budget', { headers, data: { expected_version: 1, max_per_execution: '3.00', max_daily: '3.00', max_monthly: '3.00' } })
  expect(concurrent.status()).toBe(200)
  await organization.getByLabel('Daily limit', { exact: true }).fill('2.50')
  await organization.getByRole('button', { name: 'Save organization budget' }).click()
  await expect(main.getByRole('alert')).toContainText('Configuration changed')
  await expect(organization).toHaveCount(0)
  await page.getByRole('button', { name: 'Refresh current state' }).click()
  await expect(organization.getByText(/Version 2\./)).toBeVisible()
  let writes = 0
  await page.route('**' + path + '/budget', async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    writes += 1; const response = await route.fetch(); expect(response.status()).toBe(200); await route.abort('failed')
  })
  await organization.getByLabel('Daily limit', { exact: true }).fill('4.00')
  await organization.getByRole('button', { name: 'Save organization budget' }).click()
  await expect(main.getByRole('alert')).toContainText('response was lost')
  expect(writes).toBe(1)
  const actual = await request.get(path + '/budget', { headers }); expect((await actual.json()).version).toBe(3)
  await page.unroute('**' + path + '/budget')
  await page.getByRole('button', { name: 'Refresh current state' }).click()
  await expect(organization.getByText(/Version 3\./)).toBeVisible()
  for (const name of ['Engineering', 'Research']) {
    await page.getByLabel('Department name', { exact: true }).fill(name)
    await page.getByLabel('Department slug', { exact: true }).fill(name.toLowerCase())
    await page.getByRole('button', { name: 'Create department', exact: true }).click()
    await expect(main.getByRole('status')).toContainText('Department saved')
  }
  const teams = (await (await request.get(path + '/teams', { headers })).json()).teams
  const engineering = teams.find((item: { name: string }) => item.name === 'Engineering'), research = teams.find((item: { name: string }) => item.name === 'Research')
  await page.getByLabel('Inspect department').selectOption(engineering.id)
  const department = main.getByRole('region', { name: 'Department budget' })
  await expect(department.getByText(/Version 0\./)).toBeVisible()
  await fillBudget(department, ['1.00', '1.00', '3.00'])
  await department.getByRole('button', { name: 'Save department budget' }).click()
  await expect(department.getByText(/Version 1\./)).toBeVisible()
  await page.getByRole('combobox', { name: 'Owned agent', exact: true }).selectOption(agent.id)
  await page.getByLabel('Cost center', { exact: true }).fill('ENGINEERING')
  await page.getByRole('button', { name: 'Assign owned agent' }).click()
  await expect(main.getByRole('status')).toContainText('Agent assigned')
  await fixture('purchasing-policy')
  const quote = async () => {
    const order = { client_reference: crypto.randomUUID(), objective: 'Review original enterprise private input', input: { private_code: 'const enterpriseSecret = 42' }, payment_rail: 'evm', max_total: '1.00', expected_price: '0.95' }
    const response = await request.post(path + '/purchasing/requests', { headers, data: { version: 1, client_reference: crypto.randomUUID(), buyer_agent_id: agent.id,
      service_id: provider.service, requester_role_id: null, reviewer_role_id: null, order, expires_at: new Date(Date.now()+1800_000).toISOString() } })
    expect(response.status(), await response.text()).toBe(201)
    return { order, purchase: (await response.json()).request }
  }
  const q = await quote()
  await page.getByRole('button', { name: 'Refresh current state' }).click()
  const history = main.getByTestId('purchase-history-entry')
  await expect(history).toHaveCount(1); await expect(history).toContainText('ENGINEERING')
  await expect(history).not.toContainText('enterpriseSecret')
  await history.getByRole('link', { name: 'Review exact purchase' }).click()
  await page.getByRole('button', { name: 'Approve exact purchase' }).click()
  await expect(page.getByRole('status')).toHaveText('Purchase approved.')
  const inspected = await request.get(path + '/purchasing/requests/' + q.purchase.id, { headers })
  const approvalId = (await inspected.json()).approval.id
  const original = await request.post(`/api/services/${provider.service}/orders`, { headers: buyerHeaders, data: { ...q.order, purchasing_approval_id: approvalId } })
  expect(original.status(), await original.text()).toBe(201); const purchase = await original.json()
  const other = await quote()
  const decision = await request.post(path + `/purchasing/requests/${other.purchase.id}/approval`, { headers, data: { version: 1, client_reference: crypto.randomUUID(), request_hash: other.purchase.request_hash, approve: true, expires_at: other.purchase.expires_at } })
  expect(decision.status()).toBe(201)
  const second = await request.post(`/api/services/${provider.service}/orders`, { headers: buyerHeaders, data: { ...other.order, purchasing_approval_id: (await decision.json()).approval.id } })
  expect(second.status()).toBe(409); expect((await second.json()).error_code).toBe('TEAM_DAILY_LIMIT')
  expect((await request.delete(path + `/purchasing/requests/${q.purchase.id}/approval`, { headers })).status()).toBe(200)
  await page.goto(`/organizations/${id}`)
  await expect(history.filter({ hasText: purchase.order.id })).toContainText('Approval revoked')
  await page.getByRole('button', { name: 'Unassign agent', exact: true }).click()
  await expect(main.getByRole('status')).toContainText('Agent unassigned')
  await page.getByLabel('Inspect department').selectOption(research.id)
  await expect(department.getByText(/Version 0\./)).toBeVisible()
  await page.getByRole('combobox', { name: 'Owned agent', exact: true }).selectOption(agent.id)
  await page.getByLabel('Cost center', { exact: true }).fill('RESEARCH')
  await page.getByRole('button', { name: 'Assign owned agent' }).click()
  await expect(main.getByRole('status')).toContainText('Agent assigned')
  await expect(history.filter({ hasText: purchase.order.id })).toContainText('Engineering · ENGINEERING')
  expect((await (await request.get(path + `/teams/${engineering.id}/budget`, { headers })).json()).usage.reserved_or_spent_today).toBe('1.00')
  expect((await (await request.get(path + `/teams/${research.id}/budget`, { headers })).json()).usage.reserved_or_spent_today).toBe('0.00')
  const replay = await request.post(`/api/services/${provider.service}/orders`, { headers: buyerHeaders, data: { ...q.order, purchasing_approval_id: approvalId } })
  expect(replay.status()).toBe(200); expect((await replay.json()).order.id).toBe(purchase.order.id)
  await page.clock.install(); await page.clock.fastForward(65_000)
  await expect(organization.getByRole('button', { name: 'Save organization budget' })).toBeDisabled()
  await expect(main.getByRole('alert')).toContainText('Inspection expired')
  await page.clock.setSystemTime(new Date()); await page.getByRole('button', { name: 'Refresh current state' }).click()
  await expect(organization.getByRole('button', { name: 'Save organization budget' })).toBeEnabled()
  await page.screenshot({ path: '/tmp/clawdmarket-enterprise-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0,0))
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/clawdmarket-enterprise-mobile.png', fullPage: true })
  await page.getByRole('link', { name: 'Back to Enterprise' }).click()
  await expect(page.getByRole('heading', { name: 'Organization workspaces' })).toBeVisible()
  const invitation = await request.post(path + '/invitations', { headers, data: { client_reference: crypto.randomUUID(), target_account_id: `workflow-outsider-${agent.id}` } })
  expect(invitation.status()).toBe(201)
  expect((await request.post(`/api/organizations/invitations/${(await invitation.json()).invitation_id}/accept`, { headers: { Authorization: `Bearer ${owner.outsider_key}` } })).status()).toBe(200)
  await cookies(owner.outsider_key); await page.reload()
  await expect(page.getByText('Viewer membership', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open enterprise workspace' })).toHaveCount(0)
  await page.goto(`/organizations/${id}`); await expect(main.getByRole('alert')).toContainText('current organization owner')
  await expect(history).toHaveCount(0); await expect(organization).toHaveCount(0)
  expect((await request.get(path + '/purchasing/requests', { headers: { Authorization: `Bearer ${owner.outsider_key}` } })).status()).toBe(404)
  await cookies(owner.owner_key); await page.reload(); await expect(history).toHaveCount(2)
  await context.clearCookies(); await page.getByRole('button', { name: 'Refresh current state' }).click()
  await expect(main.getByRole('alert')).toContainText('current organization owner'); await expect(history).toHaveCount(0)
  expect(JSON.parse((await fixture('counts')).stdout)).toEqual({ approvals: 0, orders: 1, trades: 1 })
})

test('owner pages original purchase metadata and unavailable inspection clears all configuration controls', async ({ request, page, context }) => {
  const registration = await request.post('/api/agents/register', { headers: { 'x-forwarded-for': `2001:db8:${(Date.now()%65535).toString(16)}::b58` },
    data: { name: `History HTTP ${crypto.randomUUID().slice(0,8)}`, activation_mode: 'autonomous', capabilities: ['code-review'] } })
  expect(registration.status()).toBe(201); const agent = (await registration.json()).agent
  const fixture = (mode: string) => promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'e2e/fixtures/workflow-approval.ts', mode, agent.id],
    { env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret' }, timeout: 20000 })
  const owner = JSON.parse((await fixture('owners')).stdout), provider = JSON.parse((await fixture('service')).stdout)
  const headers = { Authorization: `Bearer ${owner.owner_key}` }
  const created = await request.post('/api/organizations', { headers, data: { client_reference: crypto.randomUUID(), name: 'Owner paginated history' } })
  expect(created.status()).toBe(201); const id = (await created.json()).organization.id, path = `/api/organizations/${id}`
  expect((await request.put(path + '/agents', { headers, data: { agent_id: agent.id, cost_center: 'ORIGINAL' } })).status()).toBe(200)
  const ids: string[] = []
  for (let index = 0; index < 26; index += 1) {
    const quoted = await request.post(path + '/purchasing/requests', { headers, data: { version: 1, client_reference: crypto.randomUUID(), buyer_agent_id: agent.id,
      service_id: provider.service, requester_role_id: null, reviewer_role_id: null, expires_at: new Date(Date.now()+1800_000).toISOString(),
      order: { client_reference: crypto.randomUUID(), objective: `Inspect original private purchase ${index}`, input: { secret: 'history-private-input' }, payment_rail: 'evm', max_total: '1.00' } } })
    expect(quoted.status(), await quoted.text()).toBe(201); ids.push((await quoted.json()).request.id)
  }
  await context.addCookies([{ name: 'auth-token', value: owner.owner_key, url: 'http://localhost:3000' }, { name: 'csrf-token', value: 'enterprise-page-csrf', url: 'http://localhost:3000' }])
  await page.goto(`/organizations/${id}`)
  const main = page.locator('main'), entries = main.getByTestId('purchase-history-entry')
  await expect(entries).toHaveCount(25)
  await page.getByRole('button', { name: 'Load older purchases' }).focus(); await page.keyboard.press('Enter')
  await expect(entries).toHaveCount(26)
  await expect(page.getByRole('button', { name: 'Load older purchases' })).toHaveCount(0)
  const links = await entries.getByRole('link', { name: 'Review exact purchase' }).evaluateAll(items => items.map(item => item.getAttribute('href')!.split('/').at(-1)))
  expect(new Set(links)).toEqual(new Set(ids)); await expect(main).not.toContainText('history-private-input')
  const organization = main.getByRole('region', { name: 'Organization budget' })
  await organization.getByLabel('Daily limit', { exact: true }).fill('2.00')
  await organization.getByRole('button', { name: 'Save organization budget' }).focus(); await page.keyboard.press('Enter')
  await expect(organization.getByText(/Version 1\./)).toBeVisible()
  let mutations = 0
  page.on('request', incoming => { if (incoming.url().includes(path) && ['POST', 'PUT', 'DELETE'].includes(incoming.method())) mutations += 1 })
  await page.route('**' + path + '/budget', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ diagnostic: 'private-system-diagnostic' }) }))
  await page.getByRole('button', { name: 'Refresh current state' }).click()
  await expect(main.getByRole('alert')).toContainText('Inspection is unavailable')
  await expect(organization).toHaveCount(0); await expect(entries).toHaveCount(0)
  await expect(main).not.toContainText('private-system-diagnostic'); expect(mutations).toBe(0)
  await page.unroute('**' + path + '/budget'); await page.getByRole('button', { name: 'Refresh current state' }).click()
  await expect(organization.getByText(/Version 1\./)).toBeVisible(); await expect(entries).toHaveCount(25)
  expect(JSON.parse((await fixture('counts')).stdout)).toEqual({ approvals: 0, orders: 0, trades: 0 })
})
