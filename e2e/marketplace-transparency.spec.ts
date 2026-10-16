import { test, expect } from '@playwright/test'

for (const width of [1440, 390, 320]) {
  test(`task checkout discloses credit and restricts unsupported seller rails at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/payments/config', route => route.fulfill({ json: { account_credit_enabled: true, mpp_configured: true, erc20_configured: true, new_payments_paused: false } }))
    await page.route('**/api/tasks/local-rail-preview', route => route.fulfill({ json: {
      id: 'local-rail-preview', title: 'Local task checkout fixture', description: 'Disposable preview only', status: 'assigned', budgetUsd: 1, deadlineAt: null,
      required_capabilities: [], winningBidId: 'local-bid', bids: [], viewer: { authenticated: true, is_poster: true, is_seller: false },
      workspace: { output_format: 'text', acceptance_criteria: [], required_json_keys: [], minimum_sources: 0, quote: { sellerAmount: 1, platformFee: 0.05, totalCost: 1.05 },
        funded: false, proof_url: null, checkout: null, trade: null, delivery: null,
        seller_payment_preferences: { supported_payment_rails: ['evm'], payment_rails_confirmed: true } },
    } }))
    const discovery = page.waitForRequest(request => request.url().endsWith('/api/analytics/track') && request.postDataJSON()?.event_type === 'task_discovery')
    await page.goto('/taskboard/local-rail-preview')
    expect((await discovery).postDataJSON()).toEqual({ event_type: 'task_discovery', metadata: { task_id: 'local-rail-preview' } })
    await expect(page.getByRole('heading', { name: 'Local task checkout fixture' })).toBeVisible()
    const rail = page.getByLabel('Payment method', { exact: true })
    await expect(rail.locator('option[value="credit"]')).toBeDisabled()
    await expect(rail.locator('option[value="mpp"]')).toBeDisabled()
    await expect(rail.locator('option[value="evm"]')).toBeEnabled()
    await expect(page.getByText(/Prepaid credit cannot be withdrawn; sellers receive nonwithdrawable account credit/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })
  test(`public evidence distinguishes inventory and ownership without overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    for (const path of ['/', '/marketplace', '/registry', '/observe']) {
      await page.goto(path)
      const evidence = page.getByRole('complementary', { name: 'Marketplace evidence and limitations' })
      await expect(evidence.getByText('Recorded marketplace evidence', { exact: true })).toBeVisible()
      await expect(evidence).toContainText('Ownership unverified:')
      await expect(evidence).toContainText('Executable reusable services with available capacity:')
      await expect(evidence).toContainText('Recorded volume includes controlled and unknown accounts.')
      await expect(evidence).toContainText('Representative evidence review and calibration remain pending')
      expect(await evidence.locator('time').getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
    }
  })

  test(`failed statistics refresh preserves the last observation and labels it stale at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/stats', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ data_status: 'unavailable', observed_at: null }) }))
    await page.goto('/marketplace')
    const evidence = page.getByRole('complementary', { name: 'Marketplace evidence and limitations' })
    await expect(evidence.getByText('Statistics stale', { exact: true })).toBeVisible()
    await expect(evidence).toContainText('Last successful observation:')
    expect(await evidence.locator('time').getAttribute('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test(`seller confirms external-only rails through the account interface at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const suffix = crypto.randomUUID()
    const email = `local-rails-${suffix}@test.invalid`, password = 'DisposablePassword123!'
    const signup = await page.request.post('/api/auth/register', { headers: { 'x-forwarded-for': `2001:db8:${width}::71` }, data: { email, password, name: 'Local seller-rails test fixture', role: 'human' } })
    expect(signup.status()).toBe(201)
    expect((await page.request.post('/api/auth/login', { headers: { 'x-forwarded-for': `2001:db8:${width}::72` }, data: { email, password } })).status()).toBe(200)
    await page.goto('/dashboard?tab=wallet')
    const preferences = page.getByRole('region', { name: 'Seller payment rails', exact: true })
    await expect(preferences.getByRole('button', { name: 'Confirm supported rails' })).toBeEnabled()
    await preferences.getByRole('checkbox', { name: 'CREDIT', exact: true }).uncheck()
    await preferences.getByRole('checkbox', { name: 'LEDGER', exact: true }).uncheck()
    await preferences.getByRole('checkbox', { name: 'MPP', exact: true }).uncheck()
    await preferences.getByRole('checkbox', { name: 'EVM', exact: true }).check()
    await preferences.getByRole('button', { name: 'Confirm supported rails' }).click()
    await expect(preferences.getByRole('status')).toContainText('Payment preferences saved for new orders')
    const stored = await (await page.request.get('/api/payments/seller-rails')).json()
    expect(stored.supported_payment_rails).toEqual(['evm'])
    expect(stored.credit_redeemable).toBe(false)
    await expect(preferences).toContainText('nonwithdrawable prepaid account credit')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
  })
}
