import { expect, test } from '@playwright/test'

test('hire dialog holds keyboard focus and Escape restores the hire button', async ({ page }) => {
  await page.route('**/api/payments/config', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      new_payments_paused: false, ledger_enabled: false, ledger_redeemable: false,
      erc20_configured: true, mpp_configured: false, accepted_tokens: [],
    }) })
  })
  await page.route('**/api/listings?*', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      listings: [{ id: 'dialog-fixture', agent_id: 'agent-fixture', seller_id: 'seller-fixture', seller_name: 'Fixture agent',
        title: 'Sourced report', description: 'A scoped report with sources.', category: 'analysis', price_bankr: 10,
        status: 'active', external_payment_ready: true, seller_online: false, seller_availability: 'offline',
        created_at: new Date().toISOString() }], total: 1,
    }) })
  })
  await page.goto('/marketplace')
  const hire = page.getByRole('button', { name: /Hire agent/i })
  await expect(hire).toBeVisible()
  await hire.focus()
  await hire.click()
  const dialog = page.getByRole('dialog', { name: 'Confirm the request.' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Close hire dialog' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog).toContainText('Estimated total: $10.50')
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(hire).toBeFocused()
})

test('an unsigned buyer is sent to wallet access and back to the selected listing', async ({ page }) => {
  await page.route('**/api/payments/config', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      new_payments_paused: false, ledger_enabled: false, ledger_redeemable: false,
      erc20_configured: true, mpp_configured: false,
      accepted_tokens: [{ chain_id: 8453, chain_name: 'Base', token_address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6, fixed_usd_price: 1 }],
    }),
  }))
  await page.route('**/api/listings?*', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      listings: [{ id: 'wallet-signup-fixture', agent_id: 'agent-fixture', seller_id: 'seller-fixture', seller_name: 'Fixture agent',
        title: 'Sourced report', description: 'A scoped report with sources.', category: 'analysis', price_bankr: 10,
        status: 'active', external_payment_ready: true, created_at: new Date().toISOString() }], total: 1,
    }),
  }))
  await page.route('**/api/trades', (route) => route.fulfill({
    status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }),
  }))
  await page.goto('/marketplace')
  await page.getByRole('button', { name: /Hire agent/i }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /Choose payment/i }).click()
  await expect(dialog.getByRole('button', { name: /Internal account credit/i })).toHaveCount(0)
  await dialog.getByRole('button', { name: /ERC-20 wallet/i }).click()
  const walletLink = dialog.getByRole('link', { name: /Continue with wallet/i })
  await expect(walletLink).toHaveAttribute('href', '/auth/login?next=%2Fmarketplace%3Flisting%3Dwallet-signup-fixture#wallet')
  await walletLink.click()
  await expect(page).toHaveURL(/\/auth\/login\?next=%2Fmarketplace%3Flisting%3Dwallet-signup-fixture#wallet$/)
  await expect(page.getByRole('tab', { name: /Signed wallet/ })).toHaveAttribute('aria-selected', 'true')
})
