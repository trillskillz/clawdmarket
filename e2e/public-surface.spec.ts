import { expect, test } from '@playwright/test';

const publicRoutes = [
  '/',
  '/why',
  '/marketplace',
  '/registry',
  '/taskboard',
  '/work',
  '/observe',
  '/docs',
  '/proof',
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
];

const legacyRoutes = new Map([
  ['/leaderboard', '/registry'],
  ['/benchmarks', '/registry'],
  ['/karpathy-loop', '/observe'],
  ['/genesis-trade', '/proof'],
  ['/not-for-humans', '/docs'],
  ['/join', '/docs'],
  ['/observe/genome/clawdmarket_seller', '/registry/clawdmarket_seller'],
]);

const retiredTopLevelRoutes = [...legacyRoutes.keys()].filter((route) => !route.startsWith('/observe/genome/'));

function isLegacyRoute(pathname: string) {
  return legacyRoutes.has(pathname) || pathname.startsWith('/observe/genome/');
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test(`public pages render cleanly on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);

    for (const route of publicRoutes) {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const responseErrors: string[] = [];
      const onConsole = (message: { type(): string; text(): string }) => {
        if (message.type() !== 'error') return;
        const value = message.text();
        if (value.startsWith('Failed to load resource:')) return;
        if (value.includes("/_vercel/") && value.includes('MIME type')) return;
        consoleErrors.push(value);
      };
      const onPageError = (error: Error) => pageErrors.push(error.message);
      const onResponse = (response: { status(): number; url(): string }) => {
        if (response.status() < 400) return;
        const url = new URL(response.url());
        if (url.pathname === '/api/auth/me' && response.status() === 401) return;
        if (url.pathname.startsWith('/_vercel/')) return;
        responseErrors.push(`${response.status()} ${url.pathname}`);
      };
      page.on('console', onConsole);
      page.on('pageerror', onPageError);
      page.on('response', onResponse);

      const response = await page.goto(route, { waitUntil: 'load' });
      expect.soft(response?.status(), `${route} should return a successful document`).toBeLessThan(400);
      await expect.soft(page.locator('main'), `${route} should expose its primary content`).toBeVisible();

      const overflow = await page.evaluate(() => ({
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }));
      expect.soft(
        overflow.documentWidth,
        `${route} should not overflow horizontally at ${viewport.width}px`,
      ).toBeLessThanOrEqual(overflow.viewportWidth + 1);
      expect.soft(pageErrors, `${route} should not throw in the browser`).toEqual([]);
      expect.soft(consoleErrors, `${route} should not log console errors`).toEqual([]);
      expect.soft(responseErrors, `${route} should not request failed resources`).toEqual([]);

      page.off('console', onConsole);
      page.off('pageerror', onPageError);
      page.off('response', onResponse);
    }
  });
}

test('public internal links resolve', async ({ page, request, baseURL }) => {
  const links = new Set<string>();
  for (const route of publicRoutes) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    const hrefs = await page.locator('a[href]').evaluateAll((anchors) =>
      anchors.map((anchor) => (anchor as HTMLAnchorElement).href),
    );
    for (const href of hrefs) {
      const url = new URL(href);
      if (url.origin === baseURL && !url.pathname.startsWith('/dashboard')) {
        expect.soft(isLegacyRoute(url.pathname), `${route} should not link to retired route ${url.pathname}`).toBeFalsy();
        links.add(`${url.pathname}${url.search}`);
      }
    }
  }

  for (const href of links) {
    const response = await request.get(href);
    expect.soft(response.status(), `${href} should resolve from a public link`).toBeLessThan(400);
  }
});

test('legacy website routes permanently redirect to current surfaces', async ({ request, baseURL }) => {
  for (const [legacyPath, currentPath] of legacyRoutes) {
    const response = await request.get(legacyPath, { maxRedirects: 0 });
    expect.soft(response.status(), `${legacyPath} should be retired permanently`).toBe(308);
    const location = response.headers().location;
    expect.soft(location, `${legacyPath} should provide a replacement route`).toBeTruthy();
    expect.soft(new URL(location || '/', baseURL || 'http://localhost:3000').pathname, `${legacyPath} redirect target`).toBe(currentPath);
  }
});

test('sitemap excludes retired website routes', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.ok()).toBeTruthy();
  const sitemap = await response.text();

  for (const legacyPath of retiredTopLevelRoutes) {
    expect.soft(sitemap, `${legacyPath} should not be advertised in the sitemap`).not.toContain(`<loc>https://clawdmkt.com${legacyPath}</loc>`);
  }
});

test('marketplace presents an open-ended service catalog', async ({ page, request }) => {
  const stats = await (await request.get('/api/stats')).json();
  await page.goto('/marketplace', { waitUntil: 'load' });

  await expect(page.getByText('Service capacity', { exact: true })).toBeVisible();
  await expect(page.getByText('∞', { exact: true })).toBeVisible();
  await expect(page.getByText('CURRENT CATALOG / OPEN NETWORK', { exact: true })).toBeVisible();
  await expect(page.getByText('Network profiles', { exact: true })).toBeVisible();
  await expect(page.locator('section[aria-label="Marketplace statistics"] div').filter({ hasText: 'Network profiles' }).locator('strong')).toHaveText(String(stats.network_profile_count).padStart(2, '0'));

  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toMatch(/\b\d+\s*\/\s*\d+\s+services online\b/i);
  expect(visibleText).not.toMatch(/showing\s+\d+\s+of\s+\d+\s+services/i);
});

test('homepage uses the authoritative marketplace counters', async ({ page, request }) => {
  const statsResponse = await request.get('/api/stats');
  expect(statsResponse.ok()).toBeTruthy();
  const stats = await statsResponse.json();
  expect(stats.agent_count).toBe(stats.marketplace_profile_count);
  expect(stats.agent_count).toBe(stats.network_profile_count);

  await page.goto('/', { waitUntil: 'load' });
  const liveStats = page.locator('[aria-label="Live marketplace statistics"]');
  await expect(liveStats.getByText('Network profiles', { exact: true })).toBeVisible();
  await expect(liveStats.locator('div').filter({ hasText: 'Network profiles' }).locator('strong')).toHaveText(String(stats.network_profile_count).padStart(2, '0'));
  await expect(liveStats.locator('div').filter({ hasText: 'Tasks routed' }).locator('strong')).toHaveText(String(stats.tasks_routed).padStart(2, '0'));
  await expect(liveStats.locator('div').filter({ hasText: 'Completed trades' }).locator('strong')).toHaveText(String(stats.completed_trades).padStart(2, '0'));
  await expect(liveStats.locator('div').filter({ hasText: 'Recorded volume' }).locator('strong')).toHaveText(`$${Number(stats.recorded_volume_usd).toFixed(2)}`);
});

test('registry headline uses the network profile total', async ({ page, request }) => {
  const stats = await (await request.get('/api/stats')).json();
  await page.goto('/registry', { waitUntil: 'load' });
  await expect(page.getByText('network profiles', { exact: true })).toBeVisible();
  await expect(page.locator('main > header strong')).toHaveText(String(stats.network_profile_count).padStart(2, '0'));
});

test('public pages do not expose GitHub or X links', async ({ page }) => {
  for (const route of publicRoutes) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    const socialLinks = await page.locator('a[href]').evaluateAll((anchors) =>
      anchors
        .map((anchor) => ({
          href: (anchor as HTMLAnchorElement).href,
          label: anchor.textContent?.trim() || anchor.getAttribute('aria-label') || '',
        }))
        .filter(({ href, label }) =>
          /(?:github\.com|twitter\.com|x\.com)/i.test(href)
          || /^(?:github|x|x\s*\/\s*twitter|twitter)(?:\s*↗)?$/i.test(label),
        ),
    );

    expect.soft(socialLinks, `${route} should not expose GitHub or X links`).toEqual([]);
  }
});

test('agents without presence history are not mislabeled offline', async ({ page }) => {
  await page.route('**/api/agents/list**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      agents: [{
        id: 'presence-unknown-agent',
        name: 'Presence Unknown Agent',
        description: 'An active agent that has not checked in yet.',
        capabilities: ['testing'],
        status: 'active',
        is_online: false,
        availability: 'unknown',
        last_seen_at: null,
        trust_score: 60,
        trust_confidence: 'low',
        completed_trades: 0,
        rating_count: 0,
      }],
      page: 1,
      limit: 24,
      total: 1,
      total_pages: 1,
      has_more: false,
    }),
  }));
  await page.goto('/registry');
  await expect(page.getByText('not checked in', { exact: true })).toBeVisible();
  await expect(page.getByText('offline', { exact: true })).toHaveCount(0);

  await page.route('**/api/listings?**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      listings: [{
        id: 'presence-unknown-service',
        seller_id: 'user_agent_presence-unknown-agent',
        agent_id: 'presence-unknown-agent',
        seller_name: 'Presence Unknown Agent',
        seller_role: 'agent',
        title: 'Presence-aware testing',
        description: 'A service whose seller has not sent its first authenticated check-in.',
        category: 'analysis',
        price_bankr: 1,
        status: 'active',
        seller_online: false,
        seller_availability: 'unknown',
        seller_last_seen_at: null,
        agent_trust: 60,
        agent_trust_confidence: 'low',
        completed_trades: 0,
      }],
      page: 1,
      limit: 24,
      total: 1,
      total_pages: 1,
      has_more: false,
    }),
  }));
  await page.goto('/marketplace');
  await expect(page.getByText('not checked in', { exact: true })).toBeVisible();
});

test('observe uses current authoritative market telemetry', async ({ page, request }) => {
  const [statsResponse, paymentsResponse, activityResponse] = await Promise.all([
    request.get('/api/stats'),
    request.get('/api/payments/config'),
    request.get('/api/activity'),
  ]);
  expect(statsResponse.ok()).toBeTruthy();
  expect(paymentsResponse.ok()).toBeTruthy();
  expect(activityResponse.ok()).toBeTruthy();

  const stats = await statsResponse.json();
  const payments = await paymentsResponse.json();
  const activity = await activityResponse.json();
  await page.goto('/observe', { waitUntil: 'load' });

  const statRail = page.locator('section[aria-label="Network statistics"]');
  await expect(statRail.getByText('01 / Network profiles', { exact: true })).toBeVisible();
  await expect(statRail.locator('div').filter({ hasText: 'Network profiles' }).locator('strong')).toHaveText(String(stats.network_profile_count));
  await expect(statRail.locator('div').filter({ hasText: 'Online now' }).locator('strong')).toHaveText(String(stats.agents_online));
  await expect(statRail.locator('div').filter({ hasText: 'Tasks routed' }).locator('strong')).toHaveText(String(stats.tasks_routed));
  await expect(statRail.locator('div').filter({ hasText: 'Completed trades' }).locator('strong')).toHaveText(String(stats.completed_trades));
  await expect(statRail.locator('div').filter({ hasText: 'Recorded volume' }).locator('strong')).toHaveText(`$${Number(stats.recorded_volume_usd).toFixed(2)}`);
  await expect(page.getByText('HTTP REFRESH / 5S', { exact: true })).toBeVisible();

  const expectedRails = [
    ...(payments.ledger_enabled ? ['ACCOUNT'] : []),
    ...(payments.mpp_configured ? ['MPP'] : []),
    ...(payments.erc20_configured ? ['ERC-20'] : []),
  ];
  await expect(page.getByText(expectedRails.length ? expectedRails.join(' + ') : 'UNAVAILABLE', { exact: true })).toBeVisible();

  if (Array.isArray(activity) && activity.length > 0) {
    await expect(page.locator('[aria-label="Recent market activity"] article').first()).toContainText(activity[0].description);
  }
});
