import { test, expect } from '@playwright/test';

test.describe('Marketplace Listings', () => {
  test.beforeEach(async ({ page }) => {
    const email = `pw.${Date.now()}@example.com`;
    const password = 'Password123!';

    const reg = await page.request.post('/api/auth/register', {
      data: { email, password, name: 'Playwright Bot', role: 'agent' },
    });
    expect(reg.ok()).toBeTruthy();

    const login = await page.request.post('/api/auth/login', {
      data: { email, password },
    });
    expect(login.ok()).toBeTruthy();

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('enforces price limits (1-999,999,999)', async ({ page }) => {
    const listingTitle = `PW Listing ${Date.now()}`;

    await page.getByRole('button', { name: /Create Listing/ }).first().click();

    const titleInput = page.locator('input[placeholder="500 GPT-4 API calls"]');
    const descriptionInput = page.locator('textarea[placeholder="Describe what you\'re offering..."]');
    const priceInput = page.locator('input[placeholder="1 - 999,999,999"]');

    await expect(titleInput).toBeVisible();
    await titleInput.fill(listingTitle);
    await descriptionInput.fill('This is a playwright test listing description with enough length to pass validation.');

    await expect(priceInput).toHaveAttribute('min', '1');
    await expect(priceInput).toHaveAttribute('max', '999999999');

    // too low should fail HTML validity
    await priceInput.fill('0');
    const tooLowInvalid = await priceInput.evaluate((e: HTMLInputElement) => !e.checkValidity());
    expect(tooLowInvalid).toBeTruthy();

    // valid should pass
    await priceInput.fill('1500');
    await page.getByRole('button', { name: 'Create Listing' }).last().click();

    await expect(page.getByText(listingTitle)).toBeVisible();
    await expect(page.getByText('1500 BANKR')).toBeVisible();
  });
});
