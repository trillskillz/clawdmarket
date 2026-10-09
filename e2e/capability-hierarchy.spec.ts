import { test, expect } from '@playwright/test'

for (const failure of ['http', 'network'] as const) {
  test(`semantic search shows a connection error and retries after ${failure} failure`, async ({ page }) => {
    let outcome: 'success' | 'failure' | 'empty' = 'success'
    const queries: string[] = []
    await page.route('**/api/agents/search?**', async (route) => {
      queries.push(new URL(route.request().url()).searchParams.get('q') || '')
      if (outcome === 'failure') {
        if (failure === 'network') return route.abort('failed')
        return route.fulfill({ status: 503, json: { message: 'Search temporarily unavailable' } })
      }
      return route.fulfill({ json: { agents: outcome === 'empty' ? [] : [{
        id: 'semantic-recovery-agent', name: 'Semantic Recovery Agent', capabilities: ['web-research'],
      }], total: outcome === 'empty' ? 0 : 1, keywords: outcome === 'empty' ? [] : ['research'], mode: 'keyword' } })
    })
    await page.goto('/registry')
    await page.getByRole('button', { name: 'Semantic' }).click()
    const search = page.getByRole('textbox', { name: 'Describe the agent you need' })
    await search.fill('research')
    const result = page.getByRole('heading', { name: 'Semantic Recovery Agent', exact: true })
    await expect(result).toBeVisible()
    await expect(page.getByText('MATCHED TERMS', { exact: true })).toBeVisible()

    outcome = 'failure'
    await search.fill('research failing')
    await expect(page.getByText('CONNECTION ERROR', { exact: true })).toBeVisible()
    await expect(page.getByText('NO MATCH', { exact: true })).toHaveCount(0)
    await expect(page.getByText('MATCHED TERMS', { exact: true })).toHaveCount(0)
    await expect(result).toHaveCount(0)

    outcome = 'success'
    await page.getByRole('button', { name: 'Retry connection' }).click()
    await expect(result).toBeVisible()
    await expect(page.getByText('CONNECTION ERROR', { exact: true })).toHaveCount(0)
    expect(queries.filter((query) => query === 'research failing')).toHaveLength(2)

    outcome = 'empty'
    await search.fill('unknown capability')
    await expect(page.getByText('NO MATCH', { exact: true })).toBeVisible()
    await expect(page.getByText('CONNECTION ERROR', { exact: true })).toHaveCount(0)
  })
}

test('registry family discovery filters real registrations in keyword and semantic modes on desktop and mobile', async ({ request, page }) => {
  const prefix = `Hierarchy ${Date.now()}`
  for (const [index, skill] of ['web-research', 'code-review'].entries()) {
    const registered = await request.post('/api/agents/register', {
      headers: { 'x-forwarded-for': `2001:db8:86:${index}:${(Date.now() % 65535).toString(16)}::1` },
      data: { name: `${prefix} ${skill}`, activation_mode: 'autonomous', capabilities: [skill] },
    })
    expect(registered.status()).toBe(201)
  }
  const hierarchy = await (await request.get('/api/capabilities/hierarchy')).json()
  expect(hierarchy.matching.purchase).toBe('exact_canonical_leaves')
  await page.goto('/registry')
  await page.getByRole('textbox', { name: 'Filter agents by name or capability' }).fill(prefix)
  const family = page.getByRole('combobox', { name: 'Capability family' })
  await family.selectOption('family:research')
  await expect(page.getByRole('heading', { name: `${prefix} web-research`, exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: `${prefix} code-review`, exact: true })).toHaveCount(0)
  await family.selectOption('family:code')
  await expect(page.getByRole('heading', { name: `${prefix} code-review`, exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: `${prefix} web-research`, exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Semantic' }).click()
  await page.getByRole('textbox', { name: 'Describe the agent you need' }).fill(prefix)
  await expect(page.getByRole('heading', { name: `${prefix} code-review`, exact: true })).toBeVisible()
  await family.selectOption('family:research')
  await expect(page.getByRole('heading', { name: `${prefix} web-research`, exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: `${prefix} code-review`, exact: true })).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(family).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

for (const mode of ['keyword', 'semantic'] as const) {
  test(`${mode} pagination keeps family filters and discards a late page from the previous family`, async ({ page }) => {
    let releaseOldPage!: () => void
    const oldPageGate = new Promise<void>((resolve) => { releaseOldPage = resolve })
    let sawOldPage!: () => void
    const oldPageRequested = new Promise<void>((resolve) => { sawOldPage = resolve })
    let oldPageAborted = false
    page.on('requestfailed', (request) => {
      const url = new URL(request.url())
      if (url.pathname.startsWith('/api/agents/') && url.searchParams.get('page') === '2') oldPageAborted = true
    })
    const row = (name: string) => ({ id: name, name, description: 'Pagination fixture', capabilities: ['web-research'] })
    await page.route('**/api/agents/list?**', async (route) => {
      if (mode === 'semantic') return route.fulfill({ json: { agents: [], total: 0 } })
      const url = new URL(route.request().url())
      if (url.searchParams.get('family') === 'family:code') return route.fulfill({ json: { agents: [row('Current code provider')], total: 1 } })
      if (url.searchParams.get('page') === '2') {
        expect(url.searchParams.get('family')).toBe('family:research')
        sawOldPage()
        await oldPageGate
        await route.fulfill({ json: { agents: [row('Late research provider')], total: 25 } }).catch(() => undefined)
        return
      }
      await route.fulfill({ json: { agents: Array.from({ length: 24 }, (_, i) => row(`Research provider ${i}`)), total: 25 } })
    })
    await page.route('**/api/agents/search?**', async (route) => {
      const url = new URL(route.request().url())
      expect(url.searchParams.get('q')).toBe('research')
      if (url.searchParams.get('family') === 'family:code') return route.fulfill({ json: { agents: [row('Current code provider')], total: 1, keywords: ['research'] } })
      if (url.searchParams.get('page') === '2') {
        expect(url.searchParams.get('family')).toBe('family:research')
        sawOldPage()
        await oldPageGate
        await route.fulfill({ json: { agents: [row('Late research provider')], total: 25, keywords: ['research'] } }).catch(() => undefined)
        return
      }
      await route.fulfill({ json: { agents: Array.from({ length: 24 }, (_, i) => row(`Research provider ${i}`)), total: 25, keywords: ['research'] } })
    })
    await page.goto('/registry')
    const family = page.getByRole('combobox', { name: 'Capability family' })
    await family.selectOption('family:research')
    if (mode === 'semantic') {
      await page.getByRole('button', { name: 'Semantic' }).click()
      await page.getByRole('textbox', { name: 'Describe the agent you need' }).fill('research')
    }
    await expect(page.getByRole('heading', { name: 'Research provider 0', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Load more agents' }).click()
    await oldPageRequested
    await family.selectOption('family:code')
    await expect(page.getByRole('heading', { name: 'Current code provider', exact: true })).toBeVisible()
    await expect.poll(() => oldPageAborted).toBe(true)
    releaseOldPage()
    await expect(page.getByRole('heading', { name: 'Late research provider', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Research provider 0', exact: true })).toHaveCount(0)
    await expect(page.getByText('Showing 1 of 1 agents')).toBeVisible()
  })
}
