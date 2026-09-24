import { test, expect } from '@playwright/test';

test.describe('Marketplace Listings', () => {
  test.beforeEach(async ({ page }) => {
    const email = `pw.${Date.now()}@example.com`;
    const password = 'Password123!';

    const reg = await page.request.post('/api/auth/register', {
      headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::10` },
      data: { email, password, name: 'Playwright Bot', role: 'agent' },
    });
    expect(reg.ok()).toBeTruthy();

    const login = await page.request.post('/api/auth/login', {
      headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::11` },
      data: { email, password },
    });
    expect(login.ok()).toBeTruthy();

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('enforces price limits (0.01-1,000,000,000)', async ({ page }) => {
    const listingTitle = `PW Listing ${Date.now()}`;

    await page.getByRole('button', { name: /Create Listing/ }).first().click();

    const titleInput = page.getByLabel('Title');
    const descriptionInput = page.getByLabel('Description');
    const priceInput = page.getByLabel('Price (USD)');

    await expect(titleInput).toBeVisible();
    await titleInput.fill(listingTitle);
    await descriptionInput.fill('This is a playwright test listing description with enough length to pass validation.');

    await expect(priceInput).toHaveAttribute('min', '0.01');
    await expect(priceInput).toHaveAttribute('max', '1000000000');

    // too low should fail HTML validity
    await priceInput.fill('0');
    const tooLowInvalid = await priceInput.evaluate((e: HTMLInputElement) => !e.checkValidity());
    expect(tooLowInvalid).toBeTruthy();

    // valid should pass
    await priceInput.fill('1500');
    await page.getByRole('button', { name: 'Create Listing' }).last().click();

    await expect(page.getByText(listingTitle)).toBeVisible();
    await expect(page.getByText(/\$1,?500(?:\.0+)?\s*USD/i)).toBeVisible();
    await expect(page.getByText('Payout setup required')).toBeVisible();
    await page.getByRole('button', { name: 'Set payout wallet' }).click();
    await expect(page.getByLabel('Seller payout address')).toBeVisible();

    await page.goto('/marketplace');
    await page.getByPlaceholder('Service, agent, or capability…').fill(listingTitle);
    await expect(page.getByRole('heading', { name: listingTitle })).toBeVisible();
    await page.getByRole('combobox').selectOption('price_desc');
    await page.getByPlaceholder('Service, agent, or capability…').fill('definitely-no-matching-service');
    await expect(page.getByText('No payment-ready services match this search yet. Sellers can add a payout wallet to make their listings available.')).toBeVisible();
  });
});
