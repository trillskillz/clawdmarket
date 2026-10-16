import { test, expect, type Page } from '@playwright/test'
import { sign } from 'jsonwebtoken'
const buyer = 'contract-disclosure-buyer', seller = 'contract-disclosure-seller', id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
async function account(page: Page, reviewed: boolean, actor = buyer, unavailable = false) {
  const token = sign({ userId: actor, role: 'human' }, process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret', { expiresIn: '1h' })
  await page.context().addCookies([{ name: 'auth-token', value: token, url: 'http://localhost:3000', httpOnly: true }])
  const c = { id, buyer_id: buyer, seller_id: seller, payment_rail: 'credit', state: actor === seller ? 'FUNDED' : reviewed ? 'AWAITING_REVIEW' : 'DRAFT', total_amount: 1, fee_amount: .05, escrow_amount: 1.05, created_at: new Date().toISOString(), reviewed_contract: reviewed }
  let reads = 0, writes = 0
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET') writes++
    if (path === '/api/auth/me') return route.fulfill({ json: { authenticated: true, user: { id: actor, name: 'Original participant', email: 'fixture@test.invalid', role: 'human' } } })
    if (path.startsWith('/api/admin/')) return route.fulfill({ status: 403, json: { error: 'denied' } })
    if (path === '/api/contracts') return route.fulfill({ json: { contracts: [c], total: 1 } })
    if (path === `/api/contracts/${id}`) {
      reads++; return route.fulfill({ json: { contract: c, milestones: [{ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', contract_id: id, title: 'Original report', milestone_index: 0, amount: 1, state: reads === 1 ? 'AWAITING_BUYER_REVIEW' : 'APPROVED', review_window_hours: 24, acceptance_spec: '{}' }] } })
    }
    if (path === '/api/payments/config') return route.fulfill({ status: unavailable ? 503 : 200, json: unavailable ? { error: 'unavailable' } : { account_credit_enabled: true } })
    const json = path === '/api/listings' ? { listings: [] } : path === '/api/trades' ? { trades: [] } : path === '/api/auth/api-keys' ? { keys: [] } : path === '/api/webhooks' ? { webhooks: [] } : {}
    return route.fulfill({ json })
  })
  return { reads: () => reads, writes: () => writes }
}
for (const width of [1440, 390, 320]) test(`reviewed dashboard credit disclosures exclude hashless approval and payment at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); const calls = await account(page, true)
  await page.goto('/dashboard?tab=contracts')
  await expect(page.getByText(/Prepaid credit is nonwithdrawable/)).toBeVisible()
  await expect(page.getByText(/exact output acceptance and credit release use its original reviewed workflow/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fund with account balance' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Load Milestones' }).click()
  await expect(page.getByText('AWAITING_BUYER_REVIEW', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Refresh Milestones' }).click()
  await expect(page.getByText('APPROVED', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Release Payment', exact: true })).toHaveCount(0)
  expect(calls.reads()).toBe(2); expect(calls.writes()).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
})
test('seller sees nonwithdrawable settlement before start', async ({ page }) => {
  await account(page, true, seller)
  await page.goto('/dashboard?tab=contracts')
  await expect(page.getByText(/Sellers receive nonwithdrawable account credit, not external tokens/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
})
test('unavailable payment readiness keeps ordinary funding closed and displays the missing dependency', async ({ page }) => {
  const calls = await account(page, false, buyer, true)
  await page.goto('/dashboard?tab=contracts')
  await expect(page.getByText(/Account-balance readiness is unavailable/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fund with account balance' })).toBeDisabled()
  expect(calls.writes()).toBe(0)
})
