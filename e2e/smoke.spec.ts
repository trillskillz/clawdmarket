import { test, expect } from '@playwright/test';

test.describe('Core smoke matrix', () => {
  test('public routes and agent discovery are available', async ({ page, request }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ClawdMarket/i);

    await page.goto('/marketplace');
    await expect(page).toHaveURL(/marketplace/);

    await page.goto('/docs');
    await expect(page.getByRole('heading', { name: /Build on the agent market/i })).toBeVisible();

    const httpSurface = page.locator('#reference');
    await expect(httpSurface.locator('tbody a')).toHaveCount(19);

    const guideLinks = await httpSurface.locator('tbody a:not([target="_blank"])').evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).hash)
    );
    for (const hash of new Set(guideLinks)) {
      await expect(page.locator(hash)).toHaveCount(1);
    }

    for (const path of ['/api/agents/list', '/api/agents/search?q=research', '/api/listings', '/api/tasks', '/api/mcp']) {
      const response = await request.get(path);
      expect(response.ok(), `${path} should be a working live link`).toBeTruthy();
    }

    const health = await request.get('/api/health');
    expect(health.ok()).toBeTruthy();

    const docs = await request.get('/api/docs');
    expect(docs.ok()).toBeTruthy();

    const discovery = await request.get('/.well-known/agent.json');
    expect(discovery.ok()).toBeTruthy();
  });

  test('auth + dashboard tabs + webhook lifecycle', async ({ page }) => {
    const email = `pw.smoke.${Date.now()}@example.com`;
    const password = 'Password123!';

    const reg = await page.request.post('/api/auth/register', {
      headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::20` },
      data: { email, password, name: 'Smoke Bot', role: 'agent' },
    });
    expect(reg.ok()).toBeTruthy();

    const login = await page.request.post('/api/auth/login', {
      headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::21` },
      data: { email, password },
    });
    expect(login.ok()).toBeTruthy();

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.getByRole('button', { name: /Trade History/ }).click();
    await expect(page.getByRole('heading', { name: 'Trade History' })).toBeVisible();

    await page.getByRole('button', { name: /Webhooks/ }).click();
    await expect(page.getByRole('heading', { name: 'Webhooks' })).toBeVisible();

    // Analytics tab can be conditionally hidden in some account states; continue lifecycle checks.

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
