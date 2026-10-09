import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('administrator inspects aggregate routing incidents and issues exact revision-bound commands with original-state recovery', async ({ page, request, context }) => {
  await page.clock.install()
  const fixture = (mode: string, id?: string) => promisify(execFile)(process.execPath,
    ['--conditions=react-server', '--import', 'tsx', 'e2e/fixtures/routing-operations.ts', mode, ...(id ? [id] : [])],
    { env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret' }, timeout: 20_000 })
  const owner = JSON.parse((await fixture('seed')).stdout), path = '/api/admin/routing/pause'
  const headers = { Authorization: `Bearer ${owner.admin}` }
  const current = async () => (await (await request.get(path, { headers })).json()).control
  const cookie = (name: string, value: string) => ({ name, value, url: 'http://localhost:3000' })
  await page.goto('/dashboard/admin/routing')
  await expect(page).toHaveURL(/\/auth\/login/)
  expect((await request.get('/api/admin/routing/health')).status()).toBe(401)
  await expect(page.getByRole('heading', { name: 'New routing admission' })).toHaveCount(0)
  await context.addCookies([cookie('auth-token', owner.viewer), cookie('csrf-token', 'routing-console-csrf')])
  await page.goto('/dashboard/admin/routing')
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('link', { name: 'Open routing operations' })).toHaveCount(0)
  expect((await context.request.get('/api/admin/routing/health')).status()).toBe(403)
  await context.addCookies([cookie('auth-token', owner.admin)])
  await page.goto('/dashboard')
  await page.locator('nav[aria-label="Dashboard sections"]').getByRole('button', { name: /Admin/ }).click()
  await page.getByRole('link', { name: 'Open routing operations' }).click()
  await expect(page.getByRole('heading', { name: 'New routing admission' })).toBeVisible()
  const health = await request.get('/api/admin/routing/health', { headers })
  expect(health.headers()['cache-control']).toContain('private, no-store')
  expect((await health.json()).financial_health.healthy).toBe(true)
  const before = await current()
  expect(before.paused).toBe(false)
  await page.screenshot({ path: '/tmp/clawdmarket-routing-console-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Pause new routing', exact: true }).click()
  await expect(page.getByTestId('routing-admission')).toHaveText(`Paused · Revision ${before.revision + 1}`)
  expect((await current()).paused).toBe(true)

  // Another operator commits against the same displayed revision. The stale UI cannot overwrite it.
  expect((await request.post(path, { headers, data: { paused: true, expected_revision: before.revision + 1 } })).status()).toBe(200)
  await page.getByRole('button', { name: 'Resume routing admission' }).click()
  await expect(page.locator('main').getByRole('alert')).toContainText('Another operator changed routing')
  expect((await current()).revision).toBe(before.revision + 2)
  await expect(page.getByRole('button', { name: 'Resume routing admission' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Refresh routing state' }).click()
  await expect(page.getByTestId('routing-admission')).toContainText(`Revision ${before.revision + 2}`)
  await page.getByRole('button', { name: 'Resume routing admission' }).click()
  await expect(page.getByTestId('routing-admission')).toHaveText(`Accepting authorized requests · Revision ${before.revision + 3}`)

  const csrfDenied = await context.request.post(path, { data: { paused: true, expected_revision: before.revision + 3 } })
  expect(csrfDenied.status()).toBe(403); expect((await current()).revision).toBe(before.revision + 3)

  // Commit the real command, discard its response, and require an explicit original-state read.
  let commands = 0
  await page.route('**/api/admin/routing/pause', async route => {
    if (route.request().method() !== 'POST') return route.continue()
    commands++; const committed = await route.fetch(); expect(committed.status()).toBe(200); await route.abort('failed')
  })
  await page.getByRole('button', { name: 'Pause new routing', exact: true }).click()
  await expect(page.locator('main').getByRole('alert')).toContainText('The command response was lost')
  expect(commands).toBe(1); expect((await current()).revision).toBe(before.revision + 4)
  await expect(page.getByRole('button', { name: 'Resume routing admission' })).toHaveCount(0)
  await page.unroute('**/api/admin/routing/pause')
  await page.getByRole('button', { name: 'Refresh routing state' }).click()
  await expect(page.getByTestId('routing-admission')).toHaveText(`Paused · Revision ${before.revision + 4}`)

  await fixture('uncertain', owner.viewerId)
  try {
    await page.getByRole('button', { name: 'Refresh routing state' }).click()
    await expect(page.getByRole('button', { name: 'Resume routing admission' })).toBeDisabled()
    await expect(page.getByText(/^account credit invariant$/i)).toBeVisible()
    const rejected = await request.post(path, { headers, data: { paused: false, expected_revision: before.revision + 4 } })
    expect(rejected.status()).toBe(409); expect((await current()).revision).toBe(before.revision + 4)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: '/tmp/clawdmarket-routing-console-mobile.png', fullPage: true })
    const body = await page.locator('main').innerText()
    expect(body).not.toContain(owner.viewerId); expect(body).not.toContain(owner.admin)
  } finally { await fixture('repair', owner.viewerId) }

  await page.getByRole('button', { name: 'Refresh routing state' }).click()
  await expect(page.getByRole('button', { name: 'Resume routing admission' })).toBeEnabled()
  await page.clock.fastForward(65_000)
  await expect(page.getByText('Observation expired. Refresh before changing routing.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume routing admission' })).toBeDisabled()
  expect((await current()).revision).toBe(before.revision + 4)
  await page.clock.resume()
  await page.clock.setSystemTime(new Date())
  await page.getByRole('button', { name: 'Refresh routing state' }).click()
  await expect(page.getByRole('button', { name: 'Resume routing admission' })).toBeEnabled()
  await page.getByRole('button', { name: 'Resume routing admission' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('routing-admission')).toHaveText(`Accepting authorized requests · Revision ${before.revision + 5}`)
  await page.getByRole('link', { name: 'Back to administration' }).click()
  await expect(page.getByRole('region', { name: 'Administration workspace' })).toBeVisible()
  await page.getByRole('link', { name: 'Open routing operations' }).click()
  await expect(page.getByRole('heading', { name: 'Provider execution' })).toBeVisible()
  await context.clearCookies()
  await page.getByRole('button', { name: 'Refresh routing state' }).click()
  await expect(page.locator('main').getByRole('alert')).toHaveText('Sign in as an administrator to inspect routing operations.')
  await expect(page.getByRole('heading', { name: 'Provider execution' })).toHaveCount(0)
})

test('console distinguishes a modeled environment hold from closed rollout and refuses unavailable observations', async ({ page, context }) => {
  const result = await promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'e2e/fixtures/routing-operations.ts', 'seed'],
    { env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret' }, timeout: 20_000 })
  const owner = JSON.parse(result.stdout)
  await context.addCookies([{ name: 'auth-token', value: owner.admin, url: 'http://localhost:3000' }])
  let writes = 0
  await page.route('**/api/admin/routing/pause', async route => { if (route.request().method() === 'POST') writes++; await route.continue() })
  await page.route('**/api/admin/routing/health', async route => {
    const actual = await route.fetch(), snapshot = await actual.json()
    await route.fulfill({ response: actual, json: { ...snapshot, flags: { ...snapshot.flags, route_execution: false },
      admission: { ...snapshot.admission, paused: true, source: 'environment', reason_code: 'ENVIRONMENT_PAUSE' } } })
  })
  await page.goto('/dashboard/admin/routing')
  await expect(page.getByText('An environment hold is active. The console cannot clear it.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Resume routing admission' })).toBeDisabled()
  await expect(page.getByText(/Routing execution rollout is closed\./)).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.unroute('**/api/admin/routing/health')
  await page.route('**/api/admin/routing/health', route => route.fulfill({ status: 503, json: { error: 'Private diagnostic must not become console content' } }))
  await page.getByRole('button', { name: 'Refresh routing state' }).click()
  await expect(page.locator('main').getByRole('alert')).toHaveText('Routing observations are unavailable. Refresh to inspect current state.')
  await expect(page.getByRole('heading', { name: 'New routing admission' })).toHaveCount(0)
  expect(await page.locator('main').innerText()).not.toContain('Private diagnostic')
  expect(writes).toBe(0)
})
