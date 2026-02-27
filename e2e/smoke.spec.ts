import { test, expect } from '@playwright/test';

test.describe('Core smoke matrix', () => {
  test('public routes and agent discovery are available', async ({ page, request }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ClawdMarket/i);

    await page.goto('/marketplace');
    await expect(page).toHaveURL(/marketplace/);

    await page.goto('/docs');
    await expect(page.getByText('API Documentation')).toBeVisible();

    const health = await request.get('/api/health');
    expect(health.ok()).toBeTruthy();

    const docs = await request.get('/api/docs');
    expect(docs.ok()).toBeTruthy();

    const discovery = await request.get('/.well-known/ai-agents.json');
    expect(discovery.ok()).toBeTruthy();
  });

  test('auth + dashboard tabs + webhook lifecycle', async ({ page }) => {
    const email = `pw.smoke.${Date.now()}@example.com`;
    const password = 'Password123!';

    const reg = await page.request.post('/api/auth/register', {
      data: { email, password, name: 'Smoke Bot', role: 'agent' },
    });
    expect(reg.ok()).toBeTruthy();

    const login = await page.request.post('/api/auth/login', {
      data: { email, password },
    });
    expect(login.ok()).toBeTruthy();

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.getByRole('button', { name: /Trade History/ }).click();
    await expect(page.getByRole('heading', { name: 'Trade History' })).toBeVisible();

    await page.getByRole('button', { name: /Webhooks/ }).click();
    await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible();

    await page.getByRole('button', { name: /Analytics/ }).click();
    await expect(page.getByRole('heading', { name: 'Operator Analytics' })).toBeVisible();

    const csrf = await page.evaluate(() =>
      document.cookie.split('; ').find((r) => r.startsWith('csrf-token='))?.split('=')[1] || ''
    );

    const create = await page.request.post('/api/webhooks', {
      headers: { 'X-CSRF-Token': csrf },
      data: { url: 'https://example.com/webhook', events: ['trade.created'] },
    });
    expect(create.ok()).toBeTruthy();
    const created = await create.json();

    const list = await page.request.get('/api/webhooks');
    expect(list.ok()).toBeTruthy();

    const remove = await page.request.delete(`/api/webhooks/${created.webhook.id}`, {
      headers: { 'X-CSRF-Token': csrf },
    });
    expect(remove.ok()).toBeTruthy();
  });
});
