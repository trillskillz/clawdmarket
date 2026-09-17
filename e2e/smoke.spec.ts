import { test, expect } from '@playwright/test';

test.describe('Core smoke matrix', () => {
  test('security boundaries reject malformed auth input and privileged browser CORS', async ({ request }) => {
    const malformedLogin = await request.post('/api/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      data: '{malformed',
    });
    expect(malformedLogin.status()).toBe(400);
    expect(malformedLogin.headers()['cache-control']).toContain('no-store');

    const authPreflight = await request.fetch('/api/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://attacker.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });
    expect(authPreflight.headers()['access-control-allow-origin']).toBeUndefined();

    const mcpPreflight = await request.fetch('/api/mcp', {
      method: 'OPTIONS',
      headers: { Origin: 'https://agent.example', 'Access-Control-Request-Method': 'POST' },
    });
    expect(mcpPreflight.headers()['access-control-allow-origin']).toBe('*');
  });

  test('public routes and agent discovery are available', async ({ page, request }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ClawdMarket/i);

    await page.goto('/marketplace');
    await expect(page).toHaveURL(/marketplace/);

    await page.goto('/docs');
    await expect(page.getByRole('heading', { name: /Build on the agent market/i })).toBeVisible();

    const docsNavigation = page.locator('aside[aria-label="Documentation sections"]');
    await expect(docsNavigation.getByRole('link', { name: /Start/ })).toHaveAttribute('aria-current', 'location');
    await page.locator('#payments').scrollIntoViewIfNeeded();
    await expect(docsNavigation.getByRole('link', { name: /Payments/ })).toHaveAttribute('aria-current', 'location');
    await page.locator('#reference').scrollIntoViewIfNeeded();
    await expect(docsNavigation.getByRole('link', { name: /API reference/ })).toHaveAttribute('aria-current', 'location');

    const httpSurface = page.locator('#reference');
    await expect(httpSurface.locator('tbody a')).toHaveCount(33);
    for (const path of [
      '/api/tasks/:id',
      '/api/tasks/:id/accept/:bidId',
      '/api/tasks/:id/fund',
      '/api/trades/:id/delivery',
      '/api/trades/:id/confirm',
      '/api/trades/:id/dispute',
      '/api/trades/:id/cancel',
      '/api/trades/:id/fund/evm/intent',
      '/api/payments/config',
    ]) {
      expect(await httpSurface.getByText(path, { exact: true }).count(), `${path} should be documented`).toBeGreaterThan(0);
    }

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
    const openApi = await docs.json();
    expect(openApi.info['x-agent-contract-version']).toBe('1.5');
    expect(openApi.paths['/api/tasks/{id}/accept/{bid_id}']?.post).toBeTruthy();

    const skill = await request.get('/skill.md');
    expect(skill.ok()).toBeTruthy();
    expect(await skill.text()).toContain('contract-version: "1.5"');

    const discovery = await request.get('/.well-known/agent.json');
    expect(discovery.ok()).toBeTruthy();
  });

  test('seller profiles expose trust, services, and a canonical legacy route', async ({ page, request }) => {
    const seller = await request.get('/api/agents/clawdmarket_seller');
    expect(seller.ok()).toBeTruthy();
    const profile = await seller.json();
    expect(profile.profile_kind).toBe('reference');
    expect(profile.active_listings.length).toBeGreaterThan(0);

    await page.goto('/registry/clawdmarket_seller');
    await expect(page.getByRole('heading', { name: profile.name, exact: true })).toBeVisible();
    await expect(page.getByText('MARKET TRUST', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: `Services from ${profile.name}.` })).toBeVisible();
    await expect(page.locator('main')).toContainText(profile.active_listings[0].title);

    await page.goto('/agent/clawdmarket-seller');
    await expect(page).toHaveURL(/\/registry\/clawdmarket_seller$/);
  });

  test('sign-in gateway supports account and wallet access views', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByRole('heading', { name: 'Sign in.' })).toBeVisible();
    await expect(page.locator('#login-email')).toBeVisible();

    await page.getByRole('tab', { name: /Signed wallet/ }).click();
    await expect(page.getByRole('heading', { name: 'Prove wallet control.' })).toBeVisible();
    await expect(page.getByText(/one-time ClawdMarket authentication message/i)).toBeVisible();

    const email = `pw.signin.${Date.now()}@example.com`;
    const password = 'Password123!';
    const registration = await page.request.post('/api/auth/register', {
      headers: { 'x-forwarded-for': `2001:db8:${(Date.now() % 65536).toString(16)}::19` },
      data: { email, password, name: 'Sign-in Gateway', role: 'agent' },
    });
    expect(registration.status()).toBe(201);

    await page.getByRole('tab', { name: /Email account/ }).click();
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill(password);
    await page.getByRole('button', { name: /Enter workspace/ }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
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
