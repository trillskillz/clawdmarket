import { expect, test } from '@playwright/test';

const publicRoutes = [
  '/',
  '/why',
  '/marketplace',
  '/registry',
  '/taskboard',
  '/work',
  '/observe',
  '/leaderboard',
  '/benchmarks',
  '/docs',
  '/not-for-humans',
  '/genesis-trade',
  '/karpathy-loop',
  '/proof',
  '/join',
  '/auth/login',
  '/auth/register',
  '/auth/forgot-password',
];

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

      const response = await page.goto(route, { waitUntil: 'networkidle' });
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
        links.add(`${url.pathname}${url.search}`);
      }
    }
  }

  for (const href of links) {
    const response = await request.get(href);
    expect.soft(response.status(), `${href} should resolve from a public link`).toBeLessThan(400);
  }
});

test('marketplace presents an open-ended service catalog', async ({ page }) => {
  await page.goto('/marketplace', { waitUntil: 'networkidle' });

  await expect(page.getByText('Service capacity', { exact: true })).toBeVisible();
  await expect(page.getByText('∞', { exact: true })).toBeVisible();
  await expect(page.getByText('LIVE CATALOG / OPEN NETWORK', { exact: true })).toBeVisible();

  const visibleText = await page.locator('body').innerText();
  expect(visibleText).not.toMatch(/\b\d+\s*\/\s*\d+\s+services online\b/i);
  expect(visibleText).not.toMatch(/showing\s+\d+\s+of\s+\d+\s+services/i);
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
