import { SignJWT } from 'jose'
import { expect, test } from '@playwright/test'

for (const width of [1440,390]) {
  test(`historical MPP payment proofs remain visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/proof')
    const proofs = page.getByRole('region', { name: 'Payment proofs' })
    await expect(proofs.getByRole('heading', { name: 'Payment proofs' })).toBeVisible()
    for (const hash of ['0x2bb8e95dc8f030971baf678d6266feb4decac626669bcfb7a3ae9e902baa3499', '0xb8b9e19e2a0931a89d7c733fd3651c07d067a9c342eb1d7b99cf5d4e563d94ca']) {
      const card = proofs.getByRole('article').filter({ hasText: hash })
      await expect(card).toContainText('MPP on Tempo')
      await expect(card).toContainText('0.001 pathUSD')
      await expect(card.getByRole('link', { name: 'Inspect payment' })).toHaveAttribute('href', `https://explore.tempo.xyz/tx/${hash}`)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })

  test(`contracts enable deposited account balance while legacy ledger stays disabled at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const auth = await new SignJWT({ userId: 'contract-browser-buyer', role: 'human' }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET || 'clawdmarket-playwright-jwt-secret'))
    await page.context().addCookies([{ name: 'auth-token', value: auth, url: 'http://localhost:3000' }])
    let state = 'DRAFT', funded = 0
    const contract = () => ({ id: 'contract-browser-fixture', buyer_id: 'contract-browser-buyer', seller_id: 'contract-browser-seller', total_amount: 1, fee_amount: .05, escrow_amount: 1.05, payment_rail: 'credit', state, created_at: new Date().toISOString() })
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      let data: unknown = {}
      if (url.pathname === '/api/auth/me') data = { authenticated: true, user: { id: 'contract-browser-buyer', name: 'Buyer', email: 'buyer@test.invalid', role: 'human' } }
      else if (url.pathname.startsWith('/api/admin/')) { await route.fulfill({ status: 403, json: { error: 'Forbidden' } }); return }
      else if (url.pathname === '/api/payments/config') data = { account_credit_enabled: true, ledger_enabled: false, new_payments_paused: false }
      else if (url.pathname === '/api/contracts/contract-browser-fixture' && route.request().method() === 'PATCH') {
        expect(route.request().postDataJSON()).toEqual({ action: 'fund' }); state = 'FUNDED'; funded++; data = { contract: contract() }
      } else if (url.pathname === '/api/contracts') data = { contracts: [contract()], total: 1 }
      else if (url.pathname === '/api/listings') data = { listings: [], total: 0 }
      else if (url.pathname === '/api/trades') data = { trades: [], total: 0 }
      else if (url.pathname === '/api/wallet') data = { available: 1.05, escrow: 0, transactions: [] }
      await route.fulfill({ json: data })
    })
    await page.goto('/dashboard?tab=contracts')
    const fund = page.getByRole('button', { name: 'Fund with account balance' })
    await expect(fund).toBeEnabled()
    await fund.click()
    await expect(page.getByText('FUNDED', { exact: true })).toBeVisible()
    expect(funded).toBe(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}
