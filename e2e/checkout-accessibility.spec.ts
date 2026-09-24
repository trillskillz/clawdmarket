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
