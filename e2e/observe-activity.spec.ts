import { test, expect } from '@playwright/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

for (const width of [1440, 390]) {
  test(`Observe combines public transactions, live registrations and only the caller wallet in descending order at ${width}px`, async ({ page, context, request }) => {
    test.setTimeout(60_000)
    const fixture = JSON.parse((await promisify(execFile)(process.execPath, ['--conditions=react-server', '--import', 'tsx', 'e2e/fixtures/observe-activity.ts'],
      { env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret' } })).stdout)
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/observe')
    const feed = page.getByRole('log', { name: 'Live activity feed' })
    await expect(feed.getByText('Market refund confirmed: $2.00', { exact: true }).last()).toBeVisible()
    await expect(feed.getByText('Market payment recorded: 2.00 USDC', { exact: true }).last()).toBeVisible()
    await expect(feed.getByText(/Your wallet/)).toHaveCount(0)
    const checkOrder = async () => {
      const times = await feed.locator('time').evaluateAll(nodes => nodes.map(node => ({ iso: node.getAttribute('datetime')!, title: node.getAttribute('title')!, text: node.textContent! })))
      expect(times.length).toBeGreaterThan(0)
      for (const [index, time] of times.entries()) {
        expect(Number.isFinite(Date.parse(time.iso))).toBe(true)
        expect(time.title).toContain('UTC')
        expect(time.text).toContain('2026')
        if (index) expect(Date.parse(times[index - 1].iso)).toBeGreaterThanOrEqual(Date.parse(time.iso))
      }
    }
    await checkOrder()
    await context.addCookies([{ name: 'auth-token', value: fixture.token, url: 'http://localhost:3000' }])
    await expect(feed.getByText(/Your wallet · Wallet deposit credited: available \+\$9\.00/).last()).toBeVisible({ timeout: 12_000 })
    await checkOrder()
    await context.clearCookies()
    await expect(feed.getByText(/Your wallet/)).toHaveCount(0, { timeout: 12_000 })
    await page.route('**/api/stats', route => route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } }))
    const ip = `2001:db8:${(Date.now()%65535).toString(16)}:${width.toString(16)}::a1`
    const registration = await request.post('/api/auth/register', { headers: { 'x-forwarded-for': ip }, data: {
      email: `observe-human-${crypto.randomUUID()}@test.invalid`, password: 'ObserveAccount123!', name: 'PRIVATE-REGISTRATION-NAME', role: 'human',
    } })
    expect(registration.status()).toBe(201)
    await expect.poll(async () => (await feed.locator('article').first().textContent()) || '', { timeout: 12_000 }).toContain('New member account registered')
    await expect(feed).not.toContainText('PRIVATE-REGISTRATION-NAME')
    await checkOrder()
    const snapshot = await feed.locator('article p').allTextContents()
    await page.route('**/api/activity', route => route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } }))
    await expect(page.getByText('refresh delayed', { exact: false }).first()).toBeVisible({ timeout: 12_000 })
    expect(await feed.locator('article p').allTextContents()).toEqual(snapshot)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
}
